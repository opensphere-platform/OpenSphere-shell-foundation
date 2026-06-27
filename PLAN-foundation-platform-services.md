# OpenSphere Foundation 구현 계획서 — 공용 백킹서비스 subShell (PostgreSQL · OpenSearch + 확장)

> 작성 2026-06-27 (4-에이전트 병렬 조사 + 합성). GitLab/Help-Center 등 **상위 서비스보다 먼저** 잡는 데이터/인프라 기반.
> 대상 = `OpenSphere-shell-foundation`(V2, 실재 subShell) + 부모 리포의 provisioning CRD/컨트롤러·GitOps 자산.

## 1. 목표
상위 서비스(GitLab 연동·Help Center 문서+검색·Directus·Keycloak·Syncope·Novu·AI Level …)가 의존하는 **공용 백킹서비스 계층**을 콘솔 안의 "하나의 운영 가능한 표면"으로 세운다. **Foundation = subShell, 각 백킹서비스(PostgreSQL·OpenSearch …) = 그 안의 모듈(plugin)**. Phase 0에서 실제 PG+OpenSearch가 docker-desktop에 떠 health 검증을 통과하고, 상위 서비스가 표준 방식(`PostgresClaim` 등)으로 DB/인덱스를 선언·소비할 수 있게 한다. 이 데이터/인프라 Foundation은 **Kanidm(콘솔 spine)·Keycloak(워크스페이스) 두 identity 기반보다 아래** — Keycloak 자신도 PostgreSQL이 필요하므로 Foundation이 먼저다.

## 2. 핵심 발견 (조사 결과)
- ✅ **foundation subShell 실재**(skeleton 아님): `OpenSphere-shell-foundation`에 `kind: subShell` 매니페스트·server.js·plugins/ 디렉터리 존재.
- ✅ **subShell⊕plugin 중첩이 오늘 빌드 가능**: SDK `OpenSphereSubShellContext.host.mountChild(manifestUrl)`/`children()` 계약(context.ts:110-116), `HOST_KINDS=[mainShell,subShell]`(kinds.ts), foundation-shell이 `/plugins/*` 서빙(server.js:224-228). **단** main shell이 아직 `kind`를 런타임 소비 안 함(advisory, v0.3→v0.4), `normalizeManifest()`는 v2 kind 무시 → **v1은 평면 advisory-kind로 출시**, v0.4에서 1급 nested 승격.
- ✅ **provisioning 자산 다수 in-tree**: `PostgresClaim` CRD(`provisioning.opensphere.io/v1alpha1`)+컨트롤러, **ADR-005 선언형 write-path**(execInPod 금지, Claim→GitOps 렌더→ArgoCD sync), `BucketClaim`(object storage 다음 순번), `dupa-control`/`backup_controller` 패턴, gitops-repo/ArgoCD.
- ✅ **리소스 여유 충분**: 2노드 ~48 vCPU/~80GiB, 현재 4.3% CPU·9.6% RAM → 여유 ~45.8 vCPU·~72GiB. v1 추가 ~2 vCPU/4-5Gi. **유일 메모리 위험축 = OpenSearch JVM heap**.

## 3. 아키텍처
`mainShell(콘솔 루트 host) → Foundation subShell(데이터/인프라 도메인 host) → 모듈 플러그인(PostgreSQL·OpenSearch 관리 UI, leaf)`.
Foundation subShell은 두 측면을 동시에:
- **UI**: Angular-Element + server.js 피처 컨테이너가 `/plugins/*`로 모듈 UI 서빙, 콘솔 nav '운영 Operate' 밴드에 'Foundation' 자동등록(cluster-manager 참조, **셸 무수정**).
- **데이터 평면(P2)**: 모듈은 단순 UI가 아니라 실제 백킹서비스(CloudNativePG `Cluster`, `OpenSearchCluster`)를 **operator-per-concern**로 뒤에 둔다.

상위 서비스는 operand(특정 DB 엔진)가 아니라 **capability**(`PostgresClaim` → connection Secret)에만 의존. 모든 인프라 쓰기는 **ADR-005 선언형 write-path**: Claim(northbound facade) 작성 → engine 라우팅(gitops 기본=manifest 렌더→ArgoCD; operator) → status conditions(Accepted/Rendered/Synced/Ready)+connectionSecretRef. 콘솔 관리 UI 쓰기는 server.js가 Kanidm ES256 id_token JWKS 검증 후 Impersonate-User(SA 광범위 write 금지, secrets 차단).

## 4. subShell⊕plugin 모델 (v1 결정)
**NESTING은 구조적으로 오늘 가능하나, v1은 "평면 advisory-kind"로 출시**:
- Foundation은 콘솔에 단일 subShell guest로 등록, 그 안의 모듈 UI는 **foundation-shell이 `/plugins/*`로 직접 서빙·라우팅**(`activate()`가 `host.mountChild()` 자체 구현, 콘솔 컨트롤러 reconcile에 의존 안 함). → 콘솔 무수정 동작. v0.4가 `kind+hostRef`를 trust-root로 채택하면 `hostRef=foundation` 1급 nested로 **무중단 승격**.

**모듈=플러그인 매핑 = 하이브리드**: 서비스 생애주기는 operator+Claim 선언형 write-path가 소유(ADR-005, GitOps 멱등), operator 설치·공유 인스턴스 CR 부트스트랩은 모듈 배포 번들이 동반. 모듈 UI = **read/health/발급목록/Secret참조의 얇은 운영 표면**. 앱별 DB/인덱스 생성은 **절대 명령형(execInPod) 아님 — Claim 선언으로만**.

## 5. 서비스
| 서비스 | 역할 | 배포 | Footprint(dev) | 관리 플러그인 | 프로비저닝 |
|---|---|---|---|---|---|
| **PostgreSQL** | 공용 관계형 DB capability (Keycloak·Syncope·Directus·GitLab·Help Center 영속) | **CloudNativePG operator 1.29.x**(Helm) + 단일 공유 `Cluster`(instances=1) | ~0.5 vCPU/512Mi req(1-2Gi limit) + PVC 5-10Gi | CNPG Cluster/Pod health·RW/RO endpoint·발급 PostgresClaim 목록·connectionSecretRef·pg_isready | `PostgresClaim`(기존 CRD) engine=gitops 기본, 공유 인스턴스+Claim당 DB/role/Secret |
| **OpenSearch** | 공용 검색/인덱스 (Help Center 문서검색·로그·카탈로그) | **opensearch-k8s-operator 3.0.x**(Helm) + 단일 `OpenSearchCluster`(heap pin) | ~0.5-1 vCPU/1.5-2Gi(**JVM heap 512Mi pin 필수**) + PVC 5-10Gi | `_cluster/health`·노드/샤드·발급 인덱스·Secret 참조(read-only 프록시) | `OpenSearchIndexClaim`(신규, PostgresClaim 동형) |

## 6. 프로비저닝 계약 (상위 서비스 소비 방식)
**단일 권위 표면 = Claim CRD → connection Secret** (ADR-005 write-path v0.1). **v1부터 CRD-claim 채택**(PostgresClaim CRD·컨트롤러 이미 in-tree라 추가비용 낮음):
1. 상위 서비스가 자기 ns에 `PostgresClaim{database,owner,size,version,engine=gitops}` 또는 `OpenSearchIndexClaim{index,owner,shards,replicas,engine}` 작성 — **유일하게 사용자가 만지는 northbound facade**.
2. Foundation 컨트롤러(110라인 reconcile, dupa-control/backup_controller 동형)가 engine 라우팅: gitops(기본)=공유 인스턴스에 DB/role 또는 index/role 생성 manifest 렌더→ArgoCD sync.
3. 컨트롤러가 랜덤 비번 role 생성 + connection Secret(host/port/db/user/pass 또는 endpoint/index/cred) 주입, `status.connectionSecretRef` 노출.
4. status conditions: Accepted→Rendered→Synced→Ready. 상위 서비스는 Ready 후 Secret을 envFrom 마운트.
- **execInPod/명령형 mutate 금지**(CI grep-gate). 단 Phase 0 부트스트랩 동안만 operator admin Secret 직접 참조를 임시 폴백 허용, Phase 1에서 Claim 경로로 대체.

## 7. 컴포넌트
| 컴포넌트 | 종류 | 책임 |
|---|---|---|
| `OpenSphere-shell-foundation` | subShell | Foundation 도메인 host. nav '운영 Operate'/'Foundation' 등록, /plugins·/app·/api/k8s·/api/nodes·/api/admin/events, activate()가 host.mountChild() |
| `foundation-postgres-plugin` | plugin(모듈 UI) | CNPG health·endpoint·Claim목록 + CNPG operator Helm·공유 Cluster CR 부트스트랩 번들 동반 |
| `foundation-opensearch-plugin` | plugin(모듈 UI) | OpenSearch health·인덱스 + operator Helm·공유 OpenSearchCluster(heap pin) 부트스트랩 번들 |
| `foundation-provisioning-controller` | controller(110라인) | Claim watch→engine 라우팅→DB/index+role 렌더→Secret 주입→status conditions |
| `OpenSearchIndexClaim` CRD | CRD | OpenSearch 인덱스 northbound facade(PostgresClaim 동형) |
| 부트스트랩 매니페스트 번들 | GitOps(ArgoCD App) | opensphere-foundation ns + operators + 공유 인스턴스 + Claim CRD/RBAC |

## 8. nav 통합
콘솔 nav '운영 Operate' 밴드 아래 단일 'Foundation'(subShell) 자동등록(매니페스트에 이미 선언). 내부에서 모듈은 `<osp-tree-nav>` 표준 트리로 좌측 렌더, `host.mountChild()`로 선택 모듈 우측 본문 마운트. **§3.3 메뉴 출처 규칙 준수**(native/DUPA 등록만, phantom 금지, registry-driven). v0.4 채택 시 모듈은 `hostRef=foundation` 1급 승격, nav 경험 동일.

## 9. 배포
- **Footprint**: v1 합계 ~2 vCPU/~4-5Gi req(foundation-shell ~50m/64Mi, 모듈 2×~50m/64Mi, CNPG operator+PG ~1 vCPU/1.5Gi, OS operator+인스턴스 ~0.7 vCPU/2Gi, 컨트롤러 ~50m/64Mi). 여유 ~72GiB 내 안전, 위험축은 OpenSearch heap뿐.
- **Storage**: StorageClass `standard`(local-path, Delete, WaitForFirstConsumer). PG·OpenSearch PVC 각 5-10Gi.
- **Secrets**: Opaque 자격증명 + claim별 connection Secret. TLS=operator self-signed CA, 콘솔 프록시는 명시 `ca` 신뢰(검증 비활성화 금지). secrets 프록시 전면 차단.
- **⚠️ 서명**: `trust.keyId=opensphere-plugins-v2`(v1/ez09 분실). foundation-shell+모듈 매니페스트 v2 서명, sha256/signaturePath 일치, dupa-trusted-keys 정합 확인(stale 함정).

## 10. 단계 (Phase)
| Phase | 산출물 | 검증 |
|---|---|---|
| **0** 실 PG+OpenSearch bring-up | opensphere-foundation에 PG·OpenSearch Pod Running, health green/yellow | `pg_isready`=accepting + `_cluster/health` 정상, PVC Bound, 메모리 압박 없음 |
| **1** Foundation subShell 등록 | 콘솔 '운영 Operate'에 'Foundation' 자동 등장(셸 무수정) | /registry에 foundation·reg.phase=Enabled, 클릭 시 본문 로드 |
| **2** 모듈 UI(PG·OpenSearch 관리) | Foundation 트리에 2 모듈, 실 인스턴스 health 라이브 | Foundation→각 모듈이 Phase0 인스턴스 실상태 렌더, phantom 없음 |
| **3** provisioning 계약(Claim→Secret) | Claim만 작성하면 DB/인덱스+role+Secret 자동 발급(execInPod 없이) | 테스트 Claim status Ready+connectionSecretRef, 그 Secret으로 연결 성공 |
| **4** 다음 서비스 발판 + 1급 승격 경로 | 3번째 서비스 PoC(권고: object storage MinIO) + 승격 문서화 | 신규 모듈 동일 패턴 health 검증, openDecisions 해소 |

**공수**: ~6-9 작업일. **MVP(Phase 0-2)=2-3일이면 콘솔에 실 PG/OpenSearch가 보이고 health 통과**. 자산 대부분 존재(foundation-shell·PostgresClaim·컨트롤러·gitops 렌더)해 신규 구현 비중이 낮음.

## 11. 위험
| 위험 | 완화 |
|---|---|
| docker-desktop 메모리 OOM | 전부 단일노드·낮은 req/limit(PG 512Mi/1Gi, OS 1.5-2Gi). metrics-server 부재→OOMKilled events watch |
| **OpenSearch JVM heap 미설정 OOM**(가장 빈번) | CR에 `-Xms512m -Xmx512m` pin(limit의 ~50%), Phase 0 deliverable에 포함, health=red 시 heap/디스크 워터마크 우선 |
| PVC local-path Delete reclaim 데이터 유실 | volumeClaimTemplate 영속, claim삭제≠PVC삭제, prod는 Retain 별도(openDecision) |
| nesting 미완(advisory kind) | v1 평면+foundation-shell 자체 host.mountChild() 우회(무수정), v0.4 무중단 승격 |
| 서명 v2 trusted-key stale | v2 서명+dupa-trusted-keys 일치 확인+sha/sig 일치+태그 re-pull |
| 셸 빌드 @opensphere/sdk file: 의존 | foundation-shell+SDK 스테이징 컨텍스트 멀티스테이지 빌드(binding에서 검증된 함정) |
| 명령형 프로비저닝 유혹(execInPod) | DB/인덱스 생성은 Claim 선언으로만, 모듈 UI는 read+발급목록만, secrets 차단 유지 |

## 12. 미결 결정 (인간 확정 필요 — 권장 포함)
1. **nested 1급 vs 평면(v0.4 §14-2)** → **v1 평면 advisory-kind**(무수정, 오늘 동작), v0.4 승격.
2. **모듈=UI만 vs 서비스+UI 번들** → **하이브리드**(서비스=operator+Claim 선언형, operator설치/공유CR 부트스트랩은 모듈 번들 동반, UI는 얇은 운영 표면).
3. **provisioning v1부터 CRD-claim vs 수동 Secret** → **v1 CRD-claim**(PostgresClaim 이미 존재), Phase0만 admin Secret 임시 폴백.
4. **PG·OpenSearch 다음 서비스** → **object storage(MinIO/RustFS)** 우선(BucketClaim 존재), 그다음 Redis/NATS. v1 비포함.
5. **operator vs plain StatefulSet** → **operator**(CNPG/opensearch-operator), engine=gitops 폴백(plain) 유지.
6. **PVC reclaim(dev Delete vs prod Retain)** → dev standard(Delete) 허용, prod Retain+백업은 별도 plane.
