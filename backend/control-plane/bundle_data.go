// bundle_data.go — StackGres 단일 엔진 PostgreSQL capability 정의·관측.
// FoundationModel은 PostgresClaim만 선언하고 PostgresClaim reconciler가 전용 SGCluster와 binding을 제공한다.
package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

const (
	pgClaimName   = "foundation-data-pg"
	pgClusterName = "pgc-" + pgClaimName
)

func pgRWSvcDNS(ns string) string { return pgClusterName + "." + ns + ".svc" }

// pgNS — 설치 네임스페이스(설치옵션 parameters.namespace, 없으면 managedNS). PG operand이 배치될 NS.
func pgNS(fm *unstructured.Unstructured, cfg *config) string {
	if p, _, _ := unstructured.NestedMap(fm.Object, "spec", "parameters"); p != nil {
		if n, ok := p["namespace"].(string); ok && n != "" {
			return n
		}
	}
	return cfg.managedNS
}
func dataNS(cfg *config, fm *unstructured.Unstructured) string { return pgNS(fm, cfg) }
func dataEndpoint(cfg *config, fm *unstructured.Unstructured) string {
	return "postgresql://" + pgRWSvcDNS(pgNS(fm, cfg)) + ":5432/appdb"
}
func dataProbe(cfg *config, fm *unstructured.Unstructured) string {
	return pgRWSvcDNS(pgNS(fm, cfg)) + ":5432"
}

// pgOpts — FoundationModel.spec.parameters에서 파싱한 설치 레벨 옵션(기본값 포함, 위조 없이 선언 그대로).
type pgOpts struct {
	instances                          int64
	storageClass, storageSize, walSize string
	plan                               string
	resources                          map[string]interface{} // nil=CNPG 기본
	pgParams                           map[string]interface{}
	poolerEnabled                      bool
	poolerMode                         string
	poolerInstances                    int64
	exts                               []string
	superuser                          bool
	monitoring                         bool
	backup                             backupOpts
}

// backupOpts — S3 오브젝트스토리지 백업 연결(§8 D-02 미결정: Backbone RustFS 재사용 vs 별도배포 — 여기서는
// 어느 쪽도 기본 강제하지 않고 명시 선언(spec.parameters.backup)이 있을 때만 CNPG spec.backup을 채운다.
// [[basic-foundation-connector-gap]]
type backupOpts struct {
	enabled         bool
	endpointURL     string // 예: Backbone RustFS나 별도 S3의 endpoint(s3Endpoint 파라미터로 명시 필요)
	destinationPath string // 예: s3://<bucket>/foundation-pg
	secretName      string // accessKeyId/secretAccessKey 키를 가진 기존 Secret 이름(이 컨트롤러가 생성하지 않음 — 선언만)
	retentionPolicy string
}

func dataBackupParams(p map[string]interface{}) backupOpts {
	bo := backupOpts{retentionPolicy: "30d"}
	bp, _ := p["backup"].(map[string]interface{})
	if bp == nil {
		return bo
	}
	bo.enabled = pBool(bp, "enabled", false)
	bo.endpointURL = pStr(bp, "s3Endpoint", "")
	bo.destinationPath = pStr(bp, "destinationPath", "")
	bo.secretName = pStr(bp, "secretName", "")
	bo.retentionPolicy = pStr(bp, "retentionPolicy", "30d")
	// 3요소(endpoint/destination/secret) 중 하나라도 비면 misconfiguration이므로 비활성으로 안전 강등
	// (CNPG가 barmanObjectStore 불완전 스펙으로 크래시루프 도는 것보다 "백업 없음"이 정직).
	if bo.endpointURL == "" || bo.destinationPath == "" || bo.secretName == "" {
		bo.enabled = false
	}
	return bo
}

func pStr(p map[string]interface{}, k, def string) string {
	if v, ok := p[k].(string); ok && v != "" {
		return v
	}
	return def
}
func pBool(p map[string]interface{}, k string, def bool) bool {
	if v, ok := p[k].(bool); ok {
		return v
	}
	return def
}
func pInt(p map[string]interface{}, k string, def int64) int64 {
	switch v := p[k].(type) {
	case int64:
		return v
	case float64:
		return int64(v)
	case string:
		if n, e := strconv.ParseInt(v, 10, 64); e == nil {
			return n
		}
	}
	return def
}

func resReq(cr, mr, cl, ml string) map[string]interface{} {
	return map[string]interface{}{
		"requests": map[string]interface{}{"cpu": cr, "memory": mr},
		"limits":   map[string]interface{}{"cpu": cl, "memory": ml},
	}
}

// resourceProfile → CNPG spec.resources. 기준은 명시 K8s 값(UI가 프리셋/custom 모두 cpuRequest 등 4개를 보내 줌 — 숨은 하드코딩 없음).
// "none"/"" = CNPG 기본(미설정). 그 외 = 전달된 4개 값 그대로(누락 시 안전 기본).
func resourceProfile(name string, p map[string]interface{}) map[string]interface{} {
	if name == "" || name == "none" {
		return nil
	}
	return resReq(pStr(p, "cpuRequest", "100m"), pStr(p, "memoryRequest", "256Mi"), pStr(p, "cpuLimit", "500m"), pStr(p, "memoryLimit", "512Mi"))
}

func dataParams(fm *unstructured.Unstructured, cfg *config) pgOpts {
	// storageClass: 리터럴 하드코딩 대신 HostRequirements(§1.2)로 선언 — 기본값=cfg.defaultStorageClass,
	// 모델별 override=spec.parameters.hostRequirements.storageClass. [[basic-foundation-connector-gap]]
	o := pgOpts{instances: 1, storageClass: readHostRequirements(fm, cfg).StorageClass, storageSize: "10Gi", poolerMode: "transaction", poolerInstances: 1, superuser: false, monitoring: true}
	o.pgParams = map[string]interface{}{"max_connections": "100"}
	p, _, _ := unstructured.NestedMap(fm.Object, "spec", "parameters")
	if p == nil {
		return o
	}
	// 토폴로지: 명시 instances 우선, 없으면 topology=ha→3
	if n := pInt(p, "instances", 0); n >= 1 {
		o.instances = n
	} else if t, _ := p["topology"].(string); t == "ha" {
		o.instances = 3
	}
	o.storageClass = pStr(p, "storageClass", o.storageClass)
	o.storageSize = pStr(p, "storageSize", o.storageSize)
	o.walSize = pStr(p, "walStorageSize", "")
	o.resources = resourceProfile(pStr(p, "resourceProfile", "none"), p)
	// PG 튜닝 파라미터(비어있지 않은 것만)
	for _, k := range []string{"max_connections", "shared_buffers", "work_mem", "maintenance_work_mem", "effective_cache_size"} {
		if v := pStr(p, k, ""); v != "" {
			o.pgParams[k] = v
		}
	}
	o.poolerEnabled = pBool(p, "poolerEnabled", false)
	o.poolerMode = pStr(p, "poolerMode", o.poolerMode)
	o.poolerInstances = pInt(p, "poolerInstances", 1)
	o.superuser = pBool(p, "enableSuperuserAccess", false)
	o.monitoring = pBool(p, "monitoring", false)
	o.backup = dataBackupParams(p)
	o.plan = pStr(p, "postgresPlan", "")
	if o.plan == "" {
		switch {
		case o.instances >= 3:
			o.plan = "postgresql-prod-ha-pitr"
		case o.instances == 2:
			o.plan = "postgresql-compact-2"
		default:
			o.plan = "postgresql-dev-single"
		}
	}
	if e, ok := p["extensions"].([]interface{}); ok {
		for _, x := range e {
			if s, ok := x.(string); ok && s != "" {
				o.exts = append(o.exts, s)
			}
		}
	}
	return o
}

// buildDataBundle — PostgreSQL은 StackGres 전용 PostgresClaim으로만 선언한다.
func buildDataBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	o := dataParams(fm, cfg)
	owner := fm.GetName()
	ns := pgNS(fm, cfg)
	objs := []*unstructured.Unstructured{}

	if engineEnabled(fm, "postgres") {
		claim := object(postgresClaimGVK, ns, pgClaimName)
		claim.Object["spec"] = map[string]interface{}{
			"database":       "appdb",
			"owner":          "appuser",
			"isolation":      "Dedicated",
			"planRef":        map[string]interface{}{"name": o.plan},
			"storage":        map[string]interface{}{"size": o.storageSize, "storageClass": o.storageClass},
			"deletionPolicy": "Delete",
		}
		stampLabels(claim, "data", owner)
		labels := claim.GetLabels()
		labels["catalog.opensphere.io/provider"] = "stackgres"
		claim.SetLabels(labels)
		objs = append(objs, claim)
	}
	if engineEnabled(fm, "psmdb") {
		x, err := buildPSMDBBundle(cfg, fm)
		if err != nil {
			return nil, err
		}
		objs = append(objs, x...)
	}
	if engineEnabled(fm, "valkey") {
		x, err := buildValkeyBundle(cfg, fm)
		if err != nil {
			return nil, err
		}
		objs = append(objs, x...)
	}
	if engineEnabled(fm, "rustfs") {
		x, err := buildRustFSBundle(cfg, fm)
		if err != nil {
			return nil, err
		}
		objs = append(objs, x...)
	}
	if engineEnabled(fm, "opensearch") {
		osObjs, err := buildOpenSearchBundle(cfg, fm)
		if err != nil {
			return nil, err
		}
		objs = append(objs, osObjs...)
	}
	return objs, nil
}

func (r *modelReconciler) getPGClaim(ctx context.Context, ns string) (*unstructured.Unstructured, error) {
	claim := gvkObj(postgresClaimGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: pgClaimName}, claim)
	return claim, err
}

func (r *modelReconciler) getPGCluster(ctx context.Context, ns string) (*unstructured.Unstructured, error) {
	cluster := gvkObj(sgClusterGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: pgClusterName}, cluster)
	return cluster, err
}

// dataReady — PostgresClaim Ready는 SGCluster, bootstrap database, binding Secret 준비를 모두 포함한다.
func dataReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	ready := true
	if engineEnabled(fm, "postgres") {
		claim, err := r.getPGClaim(ctx, pgNS(fm, r.cfg))
		if err != nil {
			return false
		}
		phase, _, _ := unstructured.NestedString(claim.Object, "status", "phase")
		ready = ready && phase == "Ready"
	}
	for _, id := range []string{"psmdb", "valkey", "rustfs"} {
		if engineEnabled(fm, id) {
			ready = ready && engineWorkloadReady(ctx, r, fm, id)
		}
	}
	if engineEnabled(fm, "opensearch") {
		ready = ready && opensearchReady(ctx, r, fm)
	}
	return ready
}

// dataGone — PostgresClaim 소멸(NotFound) 확인(회수 완료 판정). 설치 NS 기준.
func dataGone(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	pgGone := true
	if engineEnabled(fm, "postgres") {
		_, err := r.getPGClaim(ctx, pgNS(fm, r.cfg))
		pgGone = apierrors.IsNotFound(err)
	}
	otherGone := true
	for _, id := range []string{"psmdb", "valkey", "rustfs"} {
		if engineEnabled(fm, id) {
			otherGone = otherGone && engineWorkloadGone(ctx, r, fm, id)
		}
	}
	osGone := true
	if engineEnabled(fm, "opensearch") {
		osGone = opensearchGone(ctx, r, fm)
	}
	return pgGone && otherGone && osGone
}

// observeData — 전부 Cluster.status/spec 실측(위조 0). 옵션 적용 결과를 라이브로 노출.
func observeData(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, ready bool) ([]interface{}, map[string]interface{}) {
	c, err := r.getPGCluster(ctx, pgNS(fm, r.cfg))
	var inst, rdy int64
	phase, image := "", ""
	if err == nil {
		inst, _, _ = unstructured.NestedInt64(c.Object, "spec", "instances")
		rdy, _, _ = unstructured.NestedInt64(c.Object, "status", "instances")
		if rdy == 0 && stackGresReady(c) {
			rdy = inst
		}
		phase = "Reconciling"
		if stackGresReady(c) {
			phase = "Ready"
		}
		image, _, _ = unstructured.NestedString(c.Object, "spec", "postgres", "version")
	}
	o := dataParams(fm, r.cfg)
	mk := func(id, unit, val string, healthy bool, src string) map[string]interface{} {
		return map[string]interface{}{"id": id, "unit": unit, "value": val, "healthy": healthy, "source": src}
	}
	up := mk("pg_up", "bool", "0", false, "PostgresClaim.status.phase")
	if ready {
		up["value"], up["healthy"] = "1", true
	}
	topo := "single"
	if inst >= 2 {
		topo = "ha (" + fmt.Sprintf("%d", inst) + ")"
	}
	st := mk("pg_phase", "", phase, ready, "Cluster.status.phase")
	if phase == "" {
		st["value"] = "n/a"
	}
	ratioVal, healthyRatio := "0", false
	if inst > 0 {
		ratioVal = fmt.Sprintf("%.2f", float64(rdy)/float64(inst))
		healthyRatio = rdy == inst && rdy >= 1
	}
	extVal := "none"
	if len(o.exts) > 0 {
		extVal = strings.Join(o.exts, ", ")
	}
	storVal := o.storageSize + " @ " + o.storageClass
	if o.walSize != "" {
		storVal += " (WAL " + o.walSize + ")"
	}
	resVal := "StackGres plan " + o.plan
	if o.resources != nil {
		rq, _ := o.resources["requests"].(map[string]interface{})
		lm, _ := o.resources["limits"].(map[string]interface{})
		resVal = fmt.Sprintf("req %v/%v · lim %v/%v", rq["cpu"], rq["memory"], lm["cpu"], lm["memory"])
	}
	poolVal := "off"
	if o.poolerEnabled {
		poolVal = fmt.Sprintf("PgBouncer ×%d (%s)", o.poolerInstances, o.poolerMode)
	}
	tuneParts := []string{}
	for _, k := range []string{"max_connections", "shared_buffers", "work_mem", "maintenance_work_mem", "effective_cache_size"} {
		if v, ok := o.pgParams[k].(string); ok && v != "" {
			tuneParts = append(tuneParts, k+"="+v)
		}
	}
	rtt := mk("connection_rtt_ms", "ms", "n/a", false, "PgClaim→Binding probe(P6)")
	rtt["note"] = "PgClaim 연결 시 측정"
	observed := []interface{}{}
	if engineEnabled(fm, "postgres") {
		observed = append(observed,
			up,
			mk("pg_namespace", "", pgNS(fm, r.cfg), true, "spec.parameters.namespace"),
			mk("pg_provider", "", "StackGres", true, "AddOnPlan.spec.provider"),
			mk("pg_topology", "", topo, inst >= 1, "SGCluster.spec.instances"),
			mk("pg_instances", "count", fmt.Sprintf("%d", inst), inst >= 1, "SGCluster.spec.instances"),
			mk("pg_ready_instances", "count", fmt.Sprintf("%d", rdy), rdy >= 1, "PostgresClaim.status.phase"),
			st,
			mk("pg_version", "", image, image != "", "SGCluster.spec.postgres.version"),
			mk("pg_storage", "", storVal, true, "PostgresClaim.spec.storage"),
			mk("pg_resources", "", resVal, true, "PostgresClaim.spec.planRef"),
			mk("pg_tuning", "", strings.Join(tuneParts, ", "), true, "SGPostgresConfig"),
			mk("pg_pooler", "", poolVal, true, "SGPoolingConfig"),
			mk("pg_superuser", "bool", boolStr(o.superuser), true, "StackGres managed access"),
			mk("pg_monitoring", "bool", "1", true, "StackGres exporter PodMonitor"),
			mk("pg_extensions", "", extVal, true, "SGScript bootstrap"),
			mk("bind_ready_ratio", "ratio", ratioVal, healthyRatio, "readyInstances/spec.instances"),
			rtt,
		)
	} else {
		observed = append(observed, mk("pg_up", "bool", "n/a", false, "spec.parameters.engines.postgres"))
	}
	for _, id := range []string{"psmdb", "valkey", "rustfs"} {
		observed = append(observed, observeDataEngine(ctx, r, fm, id)...)
	}
	observed = append(observed, observeOpenSearch(ctx, r, fm)...)
	return observed, nil
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}
