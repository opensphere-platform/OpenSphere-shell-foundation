// foundation-control-plane — Foundation Shell의 두뇌(종합계획서 §1 [C]).
// D-1: noop → 실 선언형 reconcile. 컨트롤러 2개를 한 매니저에 등록한다.
//   A) modelReconciler  : FoundationModel watch → observability 번들 SSA 배포/라벨회수 + status.observed(정직 메트릭).
//   B) claimReconciler  : FoundationClaim watch → FoundationBinding 발급 + 연결담보 finalizer + release.
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
	fmGVK = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "FoundationModel"}
	fcGVK = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "FoundationClaim"}
	fbGVK = schema.GroupVersionKind{Group: grp, Version: ver, Kind: "FoundationBinding"}
)

// config — 좌표는 코드에 박지 않고 플래그로(Deployment args). G-HARDCODE 정신.
type config struct {
	managedNS      string
	collectorImage string
	keycloakImage  string
	pgImage        string
}

func gvkObj(g schema.GroupVersionKind) *unstructured.Unstructured {
	o := &unstructured.Unstructured{}
	o.SetGroupVersionKind(g)
	return o
}

func main() {
	cfg := &config{}
	flag.StringVar(&cfg.managedNS, "managed-namespace", "opensphere-foundation", "관리 번들(operand)을 배치할 네임스페이스")
	flag.StringVar(&cfg.collectorImage, "collector-image", "otel/opentelemetry-collector-contrib:0.111.0", "observability collector operand 이미지")
	flag.StringVar(&cfg.keycloakImage, "keycloak-image", "quay.io/keycloak/keycloak:26.0", "identity Keycloak operand 이미지")
	flag.StringVar(&cfg.pgImage, "pg-image", "ghcr.io/cloudnative-pg/postgresql:17", "data PostgreSQL operand 이미지(CloudNativePG Cluster)")
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

	ctrl.Log.Info("foundation-control-plane 시작 (reconcile — observability(D-1)·identity(D-3) 배포/회수 + claim 연결담보)",
		"managedNS", cfg.managedNS, "collectorImage", cfg.collectorImage, "keycloakImage", cfg.keycloakImage)
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		ctrl.Log.Error(err, "manager 시작 실패")
		os.Exit(1)
	}
}
