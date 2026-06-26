// identity_bundle.go — identity operand(Keycloak OIDC) 정의·관측 + 번들 레지스트리(모델→bundleSpec).
package main

import (
	"context"
	_ "embed"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

//go:embed identity_bundle.yaml
var identityBundleYAML string

const (
	keycloakName   = "foundation-identity-keycloak"
	workforceRealm = "opensphere-workforce"
)

func keycloakSvcDNS(ns string) string { return keycloakName + "." + ns + ".svc" }
func issuerURL(ns string) string {
	return "http://" + keycloakSvcDNS(ns) + ":8080/realms/" + workforceRealm
}

func buildIdentityBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	return buildBundle(identityBundleYAML, cfg.managedNS, cfg.keycloakImage, "identity", fm.GetName())
}

// observeIdentity — keycloak_up=readyReplicas(실신호). 디스크립터 메트릭(oidc_login_success_ratio·scim_sync_lag_s)은
// 실 로그인/SCIM 데이터가 없으므로 정직하게 n/a(D-7 observability·SCIM-GW 연동). 위조 0.
func observeIdentity(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, ready bool) ([]interface{}, map[string]interface{}) {
	up := map[string]interface{}{"id": "keycloak_up", "unit": "bool", "source": "Deployment.status.readyReplicas"}
	if ready {
		up["value"], up["healthy"] = "1", true
	} else {
		up["value"], up["healthy"] = "0", false
	}
	login := map[string]interface{}{"id": "oidc_login_success_ratio", "unit": "ratio", "value": "n/a", "healthy": false, "source": "observability(D-7)", "note": "실 로그인 데이터 없음(D-7 연동)"}
	scim := map[string]interface{}{"id": "scim_sync_lag_s", "unit": "s", "value": "n/a", "healthy": false, "source": "SCIM-GW(D-7)", "note": "SCIM-GW 미배포(D-7)"}
	return []interface{}{up, login, scim}, nil
}

// extraIdentity — OIDC issuer 좌표를 status에 노출(D-3 산출물: status.issuerURL/jwksURL). FoundationModel.status는 preserve-unknown.
func extraIdentity(cfg *config, o *unstructured.Unstructured) {
	setNested(o, issuerURL(cfg.managedNS), "status", "issuerURL")
	setNested(o, issuerURL(cfg.managedNS)+"/protocol/openid-connect/certs", "status", "jwksURL")
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
		probeFM:    dataProbe,
	},
}
