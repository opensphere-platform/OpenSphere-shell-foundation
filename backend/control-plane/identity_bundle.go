// identity_bundle.go — identity operand(Keycloak OIDC + Samba-AD 디렉터리) 정의·관측 + 번들 레지스트리(모델→bundleSpec).
package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

//go:embed identity_bundle.yaml
var identityBundleYAML string

const (
	keycloakName   = "foundation-identity-keycloak"
	sambaName      = "foundation-identity-samba"
	workforceRealm = "opensphere-workforce"
	sambaRealm     = "OPENSPHERE.LOCAL" // 번들 env DOMAIN과 단일 선언(치환 아님 — 변경 시 둘 다)
)

func keycloakSvcDNS(ns string) string { return keycloakName + "." + ns + ".svc" }
func sambaSvcDNS(ns string) string    { return sambaName + "." + ns + ".svc" }
func issuerURL(ns string) string {
	return "http://" + keycloakSvcDNS(ns) + ":8080/realms/" + workforceRealm
}
func ldapURL(ns string) string { return "ldap://" + sambaSvcDNS(ns) + ":389" }

// engineEnabled — 엔진별 설치옵션(FoundationModel.spec.parameters.engines.<engine>). 기본 enabled;
// 명시적 "disabled"만 끔(정직: 알 수 없는 값은 enabled로 취급하지 않고 그대로 켜짐 — fail-open 설치옵션).
func engineEnabled(fm *unstructured.Unstructured, engine string) bool {
	v, found, _ := unstructured.NestedString(fm.Object, "spec", "parameters", "engines", engine)
	return !found || v != "disabled"
}

// buildIdentityBundle — keycloak operand(임베드 yaml) + samba operand(plugin이 소유·제공).
// self-contained(2026-07-06): samba 선언은 이 번들에 없다 — engines.samba=enabled면 plugin
// (OpenSphere-plugin-samba-ad) GET /operand/manifests로 받아 라벨 스탬프 후 SSA 대상에 합류시킨다.
// "control-plane은 plugin이 내민 선언을 apply만" 원칙. 회수(withdraw)는 라벨 기반이라 소유 이전 후에도 동일.
func buildIdentityBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	objs, err := buildBundle(identityBundleYAML, cfg.managedNS, cfg.keycloakImage, "identity", fm.GetName())
	if err != nil {
		return nil, err
	}
	out := objs[:0]
	for _, o := range objs {
		if !engineEnabled(fm, "keycloak") && strings.HasPrefix(o.GetName(), keycloakName) {
			continue
		}
		out = append(out, o)
	}
	// samba operand = plugin 소유. enabled면 plugin에서 fetch해 라벨 스탬프 후 합류(disabled면 미포함→회수).
	if engineEnabled(fm, "samba") {
		sobjs, ferr := fetchPluginOperand("http://" + cfg.sambaPluginSvc + "/operand/manifests")
		if ferr != nil {
			return nil, fmt.Errorf("samba operand(plugin) 조회 실패: %w", ferr)
		}
		for _, o := range sobjs {
			o.SetNamespace(cfg.managedNS)
			stampLabels(o, "identity", fm.GetName())
			l := o.GetLabels()
			l[lblEngine] = "samba"
			o.SetLabels(l)
			out = append(out, o)
		}
	}
	return out, nil
}

// fetchPluginOperand — plugin이 소유한 operand 선언을 GET(self-contained). {items:[k8s objects]} 파싱.
func fetchPluginOperand(url string) ([]*unstructured.Unstructured, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Items []map[string]interface{} `json:"items"`
	}
	if err := json.Unmarshal(b, &payload); err != nil {
		return nil, err
	}
	out := make([]*unstructured.Unstructured, 0, len(payload.Items))
	for _, m := range payload.Items {
		out = append(out, &unstructured.Unstructured{Object: m})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("빈 operand 선언")
	}
	return out, nil
}

// identityReady — 활성 엔진 전부 ready여야 Installed(비활성 엔진은 판정에서 제외 — 정직).
func identityReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	ok := true
	if engineEnabled(fm, "keycloak") {
		ok = ok && r.deploymentReady(ctx, keycloakName)
	}
	if engineEnabled(fm, "samba") {
		ok = ok && r.deploymentReady(ctx, sambaName)
	}
	return ok
}

// observeIdentity — keycloak_up/samba_up=readyReplicas(실신호, 엔진별). 디스크립터 메트릭(oidc_login_success_ratio·
// scim_sync_lag_s)은 실 로그인/SCIM 데이터가 없으므로 정직하게 n/a(D-7 observability·Syncope SCIM 연동). 위조 0.
func observeIdentity(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, ready bool) ([]interface{}, map[string]interface{}) {
	engineUp := func(id, dep string, enabled bool) map[string]interface{} {
		m := map[string]interface{}{"id": id, "unit": "bool", "source": "Deployment.status.readyReplicas"}
		if !enabled {
			m["value"], m["healthy"], m["note"] = "n/a", false, "engines 설치옵션으로 비활성(parameters.engines)"
			return m
		}
		if r.deploymentReady(ctx, dep) {
			m["value"], m["healthy"] = "1", true
		} else {
			m["value"], m["healthy"] = "0", false
		}
		return m
	}
	kc := engineUp("keycloak_up", keycloakName, engineEnabled(fm, "keycloak"))
	sm := engineUp("samba_up", sambaName, engineEnabled(fm, "samba"))
	login := map[string]interface{}{"id": "oidc_login_success_ratio", "unit": "ratio", "value": "n/a", "healthy": false, "source": "observability(D-7)", "note": "실 로그인 데이터 없음(D-7 연동)"}
	scim := map[string]interface{}{"id": "scim_sync_lag_s", "unit": "s", "value": "n/a", "healthy": false, "source": "Syncope SCIM(D-7)", "note": "Syncope SCIM endpoint/connector 미구현(D-7)"}
	return []interface{}{kc, sm, login, scim}, nil
}

// extraIdentity — OIDC issuer + LDAP 디렉터리 좌표를 status에 노출(소비자·UI가 읽는 연결 정본).
// FoundationModel.status는 preserve-unknown.
func extraIdentity(cfg *config, o *unstructured.Unstructured) {
	setNested(o, issuerURL(cfg.managedNS), "status", "issuerURL")
	setNested(o, issuerURL(cfg.managedNS)+"/protocol/openid-connect/certs", "status", "jwksURL")
	setNested(o, ldapURL(cfg.managedNS), "status", "ldapURL")
	setNested(o, sambaRealm, "status", "directoryRealm")
}

// bundleSpec — 모델별 operand 번들 정의. modelReconciler가 레지스트리로 일반화 처리(observability 동작 불변).
type bundleSpec struct {
	model      string
	slice      string // controlPlane 표기용(D-1/D-3 …)
	deployName string // 준비도 대상 Deployment
	image      func(*config) string
	build      func(*config, *unstructured.Unstructured) ([]*unstructured.Unstructured, error) // fm 전달(spec.parameters 설치옵션)
	observe    func(context.Context, *modelReconciler, *unstructured.Unstructured, bool) ([]interface{}, map[string]interface{})
	extra      func(*config, *unstructured.Unstructured) // 모델별 추가 status(없으면 nil)
	endpoint   func(*config) string                      // P6 Binding spec.endpoint(모델별, NS 고정)
	probe      func(*config) string                      // P6 연결 probe host:port(모델별, NS 고정)
	// ready/gone — Deployment가 아닌 operand(예: CNPG Cluster CR)의 준비도/소멸 판정 오버라이드(nil이면 Deployment 기준). fm로 설치 NS 파악.
	ready func(context.Context, *modelReconciler, *unstructured.Unstructured) bool
	gone  func(context.Context, *modelReconciler, *unstructured.Unstructured) bool
	// nsOf — operand 설치 네임스페이스(설치옵션 parameters.namespace). nil이면 managedNS. install/withdraw가 사용.
	nsOf func(*config, *unstructured.Unstructured) string
	// engines — 이 번들이 엔진 단위 설치옵션(parameters.engines.<id>)을 지원하는 엔진 목록(2026-07-06).
	// install()이 disabled 엔진의 기존 operand를 lblEngine 셀렉터로 회수한다(비어있으면 엔진 게이트 없음).
	engines []string
	// endpointFM/probeFM — 설치 NS에 의존하는 Binding 좌표(있으면 endpoint/probe 대신 사용). claimReconciler가 fm 조회 후 호출.
	endpointFM func(*config, *unstructured.Unstructured) string
	probeFM    func(*config, *unstructured.Unstructured) string
}

var bundles = map[string]bundleSpec{
	"observability": {
		model: "observability", slice: "D-1", deployName: collectorName,
		image:    func(c *config) string { return c.collectorImage },
		build:    buildObservabilityBundle,
		observe:  observeObservability,
		endpoint: func(c *config) string { return "http://" + collectorSvcDNS(c.managedNS) + ":4317" },
		probe:    func(c *config) string { return collectorSvcDNS(c.managedNS) + ":4317" },
	},
	"identity": {
		model: "identity", slice: "D-3", deployName: keycloakName,
		image:    func(c *config) string { return c.keycloakImage },
		build:    buildIdentityBundle,
		observe:  observeIdentity,
		extra:    extraIdentity,
		ready:    identityReady, // 2026-07-06: Keycloak+Samba 복수 엔진 — 활성 엔진 전부 ready 기준
		engines:  []string{"keycloak", "samba"},
		endpoint: func(c *config) string { return issuerURL(c.managedNS) },
		probe:    func(c *config) string { return keycloakSvcDNS(c.managedNS) + ":8080" },
	},
	// data — Bootstrap+Operator 구조 첫 적용. CloudNativePG(채택) Cluster CR을 hybrid-wrap. 설치 NS는 옵션(parameters.namespace).
	"data": {
		model: "data", slice: "D-4", deployName: pgClusterName,
		image:      func(c *config) string { return c.pgImage },
		build:      buildDataBundle,
		observe:    observeData,
		ready:      dataReady, // Deployment 아님 → Cluster.status.readyInstances(설치 NS)
		gone:       dataGone,
		nsOf:       dataNS,       // 설치옵션 NS
		endpointFM: dataEndpoint, // 설치 NS의 -rw 서비스
		engines:    []string{"opensearch"},
		probeFM:    dataProbe,
	},
}
