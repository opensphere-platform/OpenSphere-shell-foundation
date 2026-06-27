# Foundation Phase 3 — 선언형 프로비저닝 (PostgresClaim / OpenSearchIndexClaim)

> 다관점 설계 Workflow(4 설계 + 적대적 종합, 5 agents·481k tok) 결과의 실행 요약.
> 근거: CNPG 공식문서 + 파서 repo 실파일(`opensphere-foundation-shell/control-plane/*.go`, gates, CRD, ADR-FND-001/006).

## 핵심 결론

1. **PG는 라이브로 닫힌다 (ADR-005 무위반).**
   컨트롤러는 SQL/execInPod을 직접 실행하지 않고 **CNPG 선언형 CR 2종만 SSA**한다:
   - `Cluster.spec.managed.roles[]` 패치 → operator가 `CREATE/ALTER ROLE` 수행.
   - `Database` CR(`postgresql.cnpg.io/v1`, CNPG v1.25 도입·v1.29 GA, **클러스터에 라이브 확인**) → operator가 `CREATE DATABASE` + `owner` 지정 + `extensions`.
   - **진짜 차단점**: CNPG managed role은 `passwordSecret`를 *참조만* 하고 비밀번호를 **생성하지 않는다**(없으면 NULL). → **컨트롤러가 password Secret을 mint해야 한다**. 그런데 게이트 `g-cp-rbac.sh:17`이 `secrets`를 무조건 FAIL → **ns-한정 create-only 예외 1줄이 필수**(D6). 이게 4개 설계가 모두 놓친 지점.

2. **OpenSearch는 라이브로 안 닫힌다 → MVP 범위 밖.**
   현 plain single-node StatefulSet엔 선언형 Index CRD가 없고, operator도 미설치. ensure-Job 내 `curl PUT`은 ADR-FND-001 §12(in-cluster 직접 mutate 금지) 정신 위반. → **MVP는 OpenSearchIndexClaim CRD·UI·Accept-stub(`Ready=False reason=AwaitingOperator`)만**. write-path는 opensearch-operator 승격 후 `OpensearchIndexTemplate`/`OpensearchISMPolicy` CRD로. dev는 auto-create-index ON이라 앱이 lazy-create.

3. **그룹/버전 = `provisioning.opensphere.io/v1alpha1` 고정.**
   read RBAC(`rbac-foundation-read.yaml`)·ApplicationSet·기존 facade CRD가 못박음. (설계안의 `foundation.opensphere.io`/`v1` 승격은 기각.)

## ⚠️ 검증 발견 — managed.roles는 atomic 배열 (설계 종합 정정)

설계 종합은 "공유 `Cluster.spec.managed.roles[]`에 owner role을 **항목별 SSA로 부분소유**"한다고 가정했다. **실 CNPG CRD 확인 결과 이 가정은 틀렸다:**

```
clusters.postgresql.cnpg.io  spec.managed.roles
  x-kubernetes-list-type: None      ← atomic 배열 (map 아님)
  x-kubernetes-list-map-keys: None
```

- **atomic 배열**이라 SSA가 항목별 머지를 못 한다. 한 claim이 `managed.roles:[{name:svc_x}]`를 force-apply하면 **배열 전체를 소유**(다른 claim들의 role을 clobber)하거나, 다른 field-manager와 **충돌**한다.
- 더해 `modelReconciler`(install 번들)가 같은 Cluster를 SSA하고 pgclaim 컨트롤러가 Update(RMW)하면 **SSA↔Update 혼용 clobber** 위험.

**정정된 올바른 패턴 (구현 시 이걸로):**
> pgclaim 컨트롤러(또는 cluster-level 집계 reconciler)가 **clusterRef의 모든 PostgresClaim을 list → 전체 managed.roles 배열을 재구성 → 그 배열 필드의 단일 field-manager로 SSA 적용**. 원자배열을 *통째로* 한 manager가 소유하므로 충돌·clobber 없음. 불변식: **FoundationModel install 번들(bundle_data.go)은 공유 Cluster의 managed.roles를 설정하지 않는다**(컨트롤러가 유일 writer). 확장 시 `isolation: dedicated`(claim별 전용 Cluster)로 격상하면 집계 자체가 불필요.

이 정정 없이는 멀티-claim에서 role이 사라진다. (Database CR은 `spec.cluster·name·owner·ensure·extensions`, status.applied 확인 — 정상.)

## MVP 1차 (라이브 검증까지)

PostgresClaim만 · CNPG managed roles + Database CR · 컨트롤러 SSA · connection Secret = `opensphere-foundation` ns.

흐름: `PostgresClaim` → [Accept clusterRef Ready] → [password Secret mint(crypto-rand)] → [**전 claim 집계 → 전체 `managed.roles` 배열 재구성 → 단일 field-manager SSA**(atomic 배열, 위 정정)] → [`Database` CR SSA] → [connection Secret 작성] → `status.phase=Ready`.

## 생성/변경 파일 (라벨)

| 파일 | 위치 | 라벨 |
|---|---|---|
| 모듈 Claims UI (claims.types·claims-list·new-claim-form + PG/OS 탭 + 스타일) | **V2** `OpenSphere-shell-foundation/src/app/modules/`, `app.component.ts` | ✅ 자동작성·배포·검증 (foundation:v5) |
| `provisioning.opensphere.io_postgresclaims.yaml` (확장) | parent `third_party/provisioning/crds/` (canonical) + 본 repo `provisioning/crds/`(참조) | ⛔ **사용자 apply** (CRD = classifier 차단) |
| `provisioning.opensphere.io_opensearchindexclaims.yaml` (신규) | 동상 | ⛔ **사용자 apply** |
| `reconcile_pgclaim.go` (신규, D3) + `main.go` 등록 | parent `opensphere-foundation-shell/control-plane/` | ✅ 자동작성 / ⛔ 빌드·배포는 사용자 |
| `reconcile_osindexclaim.go` (Accept-stub) | 동상 | ✅ 자동작성 |
| `g-cp-rbac.sh` D6 패치 (secrets ns-한정 예외) | parent `.../deploy/hack/gates/` | ✅ 자동작성 |
| `control-plane.yaml` RBAC (D4) | parent `.../deploy/` | ⛔ **사용자 apply** (RBAC = classifier 차단) |
| `rbac-foundation-read.yaml` (이미 작성) | V2 | ⛔ **사용자 apply** (provisioning read) |

## 사용자-게이트 배포 단계 (라이브 프로비저닝 활성화)

```bash
# 1. CRD 적용 (classifier가 에이전트 apply 차단 → 사용자가 직접)
kubectl apply -f third_party/provisioning/crds/provisioning.opensphere.io_postgresclaims.yaml
kubectl apply -f third_party/provisioning/crds/provisioning.opensphere.io_opensearchindexclaims.yaml
# 2. 모듈 read 권한 (CNPG·provisioning 조회)
kubectl apply -f OpenSphere-shell-foundation/rbac-foundation-read.yaml
# 3. 컨트롤러 RBAC (postgresclaims watch + secrets ns-한정 create)
kubectl apply -f opensphere-foundation-shell/deploy/control-plane.yaml
# 4. 컨트롤러 빌드·배포 (reconcile_pgclaim.go 포함)
#    (게이트 g-cp-rbac.sh D6 패치가 선행 — secrets ns-한정 예외)
```

## 라이브 검증 기준 (PLAN §10 Phase 3)

```bash
kubectl apply -f provisioning/samples/postgresclaim-helpcenter.yaml
kubectl get cluster opensphere-pg -n opensphere-foundation -o jsonpath='{.spec.managed.roles}'   # svc_helpcenter
kubectl get database -n opensphere-foundation                                                     # pgc-…-helpcenter Ready
kubectl get postgresclaim helpcenter -o jsonpath='{.status.phase}'                                # Ready
# status.connectionSecretRef의 Secret으로 psql 연결 성공
```

## 후속 (MVP 밖)

- OpenSearch write-path = opensearch-operator 3.x 설치 후 선언형 CRD.
- `privileges: readwrite/readonly` 객체수준 GRANT(CNPG 범위 밖 — 별도 `DatabaseGrant` 또는 operator post-init).
- cross-ns connection Secret projection(ESO/sealed-secrets).
- `isolation: dedicated`(per-claim 전용 Cluster), `deletionPolicy: retain|delete`.
- engine=gitops(ArgoCD ApplicationSet 렌더) — 현 PoC raw 경로 폐기·CNPG로 교체.

전체 설계 원문: 세션 산출물 `phase3-synthesis.md` (적대적 검증 PART A–F).
