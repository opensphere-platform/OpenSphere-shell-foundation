// foundation-control-plane — Foundation Shell의 두뇌(종합계획서 §1 [C]).
// D-1: noop → 실 선언형 reconcile. 컨트롤러 2개를 한 매니저에 등록한다.
//
//	A) modelReconciler  : FoundationModel watch → observability 번들 SSA 배포/라벨회수 + status.observed(정직 메트릭).
//	B) claimReconciler  : FoundationClaim watch → FoundationBinding 발급 + 연결담보 finalizer + release.
//
// ADR-005R1(INV-1) 정합: 인프라는 SSA/DeleteAllOf로만 바꾼다(명령형 0). secret 권한 없음(§5).
package main

import (
	"flag"
	"os"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
)

var (
	fmGVK  = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "FoundationModel"}
	fcGVK  = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "FoundationClaim"}
	fbGVK  = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "FoundationBinding"}
	idcGVK = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "IdentityDirectoryClaim"}
	idbGVK = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "IdentityDirectoryBinding"}
)

// config — 좌표는 코드에 박지 않고 플래그로(Deployment args). G-HARDCODE 정신.
type config struct {
	managedNS           string
	collectorImage      string
	keycloakImage       string
	sambaImage          string // (deprecated 2026-07-06) samba operand는 plugin이 소유 — 미사용, arg 호환 위해 잔존
	sambaPluginSvc      string // samba operand 선언 제공 plugin svc(self-contained) — GET /operand/manifests
	pgImage             string
	psmdbImage          string
	valkeyImage         string
	rustfsImage         string
	opensearchImage     string
	defaultStorageClass string // HostRequirements 기본값(§1.2) — Basic StorageClass 이름의 단일 선언점
}

func gvkObj(g schema.GroupVersionKind) *unstructured.Unstructured {
	o := &unstructured.Unstructured{}
	o.SetGroupVersionKind(g)
	return o
}

func main() {
	cfg := &config{}
	flag.StringVar(&cfg.managedNS, "managed-namespace", "opensphere-foundation", "관리 번들(operand)을 배치할 네임스페이스")
	// [[ghcr-image-mirror-policy]]: 원본 레지스트리 직접참조 폐지, ghcr.io/opensphere-platform/mirror/* 경유로 조달.
	flag.StringVar(&cfg.collectorImage, "collector-image", "ghcr.io/opensphere-platform/mirror/opentelemetry-collector-contrib:0.111.0", "observability collector operand 이미지(GHCR 미러, origin=otel/opentelemetry-collector-contrib:0.111.0)")
	flag.StringVar(&cfg.keycloakImage, "keycloak-image", "ghcr.io/opensphere-platform/mirror/keycloak:26.0", "identity Keycloak operand 이미지(GHCR 미러, origin=quay.io/keycloak/keycloak:26.0)")
	flag.StringVar(&cfg.sambaImage, "samba-image", "ghcr.io/opensphere-platform/mirror/samba-domain:20260701025204", "(deprecated) samba operand는 plugin이 소유·렌더 — 이 플래그는 미사용(arg 호환)")
	flag.StringVar(&cfg.sambaPluginSvc, "samba-plugin-svc", "samba-ad.opensphere-system.svc:8080", "samba operand 선언 제공 plugin svc(self-contained, GET /operand/manifests)")
	flag.StringVar(&cfg.pgImage, "pg-image", "ghcr.io/opensphere-platform/mirror/postgresql:19beta2-standard-trixie", "data PostgreSQL 19 beta operand 이미지(CloudNativePG Cluster) — image-source: OpenSphere curated GHCR mirror")
	flag.StringVar(&cfg.psmdbImage, "psmdb-image", "ghcr.io/opensphere-platform/mirror/percona-server-mongodb:8.0", "data PSMDB operand image(GHCR mirror)")
	flag.StringVar(&cfg.valkeyImage, "valkey-image", "ghcr.io/opensphere-platform/mirror/valkey:9.1.0-alpine", "data Valkey operand image(GHCR mirror)")
	flag.StringVar(&cfg.rustfsImage, "rustfs-image", "ghcr.io/opensphere-platform/mirror/rustfs:1.0.0-beta.10", "data RustFS operand image(GHCR mirror)")
	// HostRequirements(§1.2 "Basic은 요구만 선언") 기본값 — 클러스터 실측 StorageClass 이름(rancher.io/local-path 기반 "standard").
	flag.StringVar(&cfg.defaultStorageClass, "default-storage-class", "standard", "PVC가 참조할 Basic StorageClass 기본값(FoundationModel.spec.parameters.hostRequirements.storageClass로 모델별 override 가능)")
	flag.StringVar(&cfg.opensearchImage, "opensearch-image", "ghcr.io/opensphere-platform/mirror/opensearch:3.7.0", "data OpenSearch operand image(GHCR mirror, origin=opensearchproject/opensearch:3.7.0)")
	flag.Parse()

	ctrl.SetLogger(zap.New())
	mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{HealthProbeBindAddress: ":8081"})
	if err != nil {
		ctrl.Log.Error(err, "manager 생성 실패")
		os.Exit(1)
	}
	_ = mgr.AddHealthzCheck("healthz", healthz.Ping)
	_ = mgr.AddReadyzCheck("readyz", healthz.Ping)

	// 캐시 비경유(direct) 클라이언트 — 관리 번들(Deployment/Service/…)은 네임스페이스 한정 Role로만 접근.
	// 캐시 클라이언트는 타입별 클러스터 전역 informer를 띄우므로(네임스페이스 Role과 충돌) 번들은 direct로 읽고 쓴다.
	direct, err := client.New(mgr.GetConfig(), client.Options{Scheme: mgr.GetScheme(), Mapper: mgr.GetRESTMapper()})
	if err != nil {
		ctrl.Log.Error(err, "direct client 생성 실패")
		os.Exit(1)
	}

	if err := ctrl.NewControllerManagedBy(mgr).For(gvkObj(fmGVK)).
		Complete(&modelReconciler{cached: mgr.GetClient(), direct: direct, cfg: cfg}); err != nil {
		ctrl.Log.Error(err, "model 컨트롤러 등록 실패")
		os.Exit(1)
	}
	if err := ctrl.NewControllerManagedBy(mgr).For(gvkObj(fcGVK)).Owns(gvkObj(fbGVK)).
		Complete(&claimReconciler{cached: mgr.GetClient(), direct: direct, cfg: cfg}); err != nil {
		ctrl.Log.Error(err, "claim 컨트롤러 등록 실패")
		os.Exit(1)
	}
	if err := ctrl.NewControllerManagedBy(mgr).For(gvkObj(idcGVK)).Owns(gvkObj(idbGVK)).
		Complete(&identityDirectoryReconciler{cached: mgr.GetClient(), direct: direct, cfg: cfg}); err != nil {
		ctrl.Log.Error(err, "identity directory 컨트롤러 등록 실패")
		os.Exit(1)
	}

	ctrl.Log.Info("foundation-control-plane 시작 (reconcile — observability(D-1)·identity(D-3) 배포/회수 + claim/typed identity 연결담보)",
		"managedNS", cfg.managedNS, "collectorImage", cfg.collectorImage, "keycloakImage", cfg.keycloakImage)
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		ctrl.Log.Error(err, "manager 시작 실패")
		os.Exit(1)
	}
}
