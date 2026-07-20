# Foundation Plugin Surface Design QA

검증일: 2026-07-20

정본 화면: `/p/foundation/postgres`

## 검증 대상

- Foundation subShell `0.2.0-edge.13`
- Foundation 종속 Samba-AD plugin `0.1.1-edge.8`
- 공통 화면 계약: 단일 평면 헤더, 4열 메타데이터, 11개 탭, 3단계 수명주기, 3열 Overview
- URL 계약: `/modules`는 카탈로그 개요에만 사용하고 개별 plugin은 직접 경로를 사용

## 구현·배포 상태

| 대상 | 구현 | 이미지 | 실행 판정 |
|---|---|---|---|
| Foundation | `799aa0d` | `0.2.0-edge.13` · `sha256:d5896870d8ff...` | Activated / Ready |
| Apache Syncope plugin package | `799aa0d` | `0.1.0-edge.2` · `sha256:5885c3c24bc5...` | Signed edge package / direct route verified |
| Samba-AD ADDC | `d739ff1` | `0.1.1-edge.8` · `sha256:439d45b960ac...` | Ready |

두 이미지는 descriptor, signature, provenance, SBOM, permission profile, amd64/arm64 검증을 통과한 digest로 설치했다.

## 화면·경로 감사

1. ADDC는 PostgreSQL과 동일한 전체 폭 host, 헤더, 11개 탭, 3단계 수명주기 및 3열 Overview를 사용한다.
2. Syncope와 OPA의 정본 경로는 각각 `/p/foundation/syncope`, `/p/foundation/opa`다.
3. 같은 카탈로그 계층의 LiteLLM, Langfuse, Stalwart, Novu, Mattermost, OTel, Tempo, Loki, Grafana Operator, PTM도 직접 경로를 사용한다.
4. `/p/foundation/modules`는 PFS 모듈 카탈로그 개요로만 남는다.
5. 폐기된 `/p/foundation/modules/<plugin>` 패턴은 router, registry, manual contribution 및 배포 bundle에서 제거됐다.
6. 로컬 build, manual 21건, surface 계약, 20개 독립 plugin catalog 검증이 모두 통과했다.
7. 실행 클러스터의 Foundation은 `Activated/Ready`, workload·page·api·manual은 모두 `Ready`다.
8. 독립 Apache Syncope `edge` 이미지의 `plugin.json`과 실행 bundle 모두 `/p/foundation/syncope`를 사용하며 `/modules/`를 포함하지 않는다.

## 시각 증거

- `audit-evidence/2026-07-20-route-parity/comparison-postgres-addc.png`
- `audit-evidence/2026-07-20-pfs-parity/07-addc.png`

final result: passed
