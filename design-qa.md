# Foundation Plugin Surface Design QA

검증일: 2026-07-20

정본 화면: `/pfss/postgres`

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
2. Syncope와 OPA의 정본 경로는 각각 `/pfss/syncope`, `/pfss/opa`다.
3. 같은 카탈로그 계층의 LiteLLM, Langfuse, Stalwart, Novu, Mattermost, OTel, Tempo, Loki, Grafana Operator, PTM도 직접 경로를 사용한다.
4. `/pfss/modules`는 PFS 모듈 카탈로그 개요로만 남는다.
5. 폐기된 `/pfss/modules/<plugin>` 패턴은 router, registry, manual contribution 및 배포 bundle에서 제거됐다.
6. 로컬 build, manual 21건, surface 계약, 20개 독립 plugin catalog 검증이 모두 통과했다.
7. 실행 클러스터의 Foundation은 `Activated/Ready`, workload·page·api·manual은 모두 `Ready`다.
8. 독립 Apache Syncope `edge` 이미지의 `plugin.json`과 실행 bundle 모두 `/pfss/syncope`를 사용하며 `/modules/`를 포함하지 않는다.

## 시각 증거

- `audit-evidence/2026-07-20-route-parity/comparison-postgres-addc.png`
- `audit-evidence/2026-07-20-pfs-parity/07-addc.png`

final result: passed

---

# PostgreSQL Integrated Header Design QA

- 검증일: 2026-08-06
- Source visual truth: `C:\Users\cmars\.codex\generated_images\019fd187-a424-7c91-a849-d30a4986c817\exec-66072f01-1084-48f8-a765-f3d22aa727a2.png`
- Browser-rendered implementation: `implementation-postgres-integrated-header.png`
- Focused header evidence: `implementation-postgres-integrated-header-focused.png`
- Runtime: `https://localhost:1114/pfss/postgres`
- State: `opensphere-foundation` Namespace, `pgc-platform-dev-pg · stackgres` instance, Overview tab

## Capture normalization

- Source pixels: `2213 × 711`; isolated header-and-tabs concept, no browser or Console chrome.
- Implementation pixels: `2403 × 1857`; default in-app browser viewport and full Console shell.
- Focused implementation capture: `2021 × 221`; the deployed header band at the same runtime viewport.
- CSS geometry: PostgreSQL header `1819.38 × 145.54px`, tabs `1819.38 × 54.10px`.
- Density normalization: no device-density resampling was used. The comparison treated the source as an isolated composition reference and compared the implementation's focused header region at its native browser density. Console chrome and page content outside the header were excluded from fidelity findings.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: existing OpenSphere/Clarity typography, hierarchy, weight, line height, wrapping, and compact control labels are preserved. The source concept's larger apparent text is explained by its isolated 2213px crop; normalized hierarchy and optical weight match the deployed header.
- Spacing and layout rhythm: Namespace and PostgreSQL instance controls are side-by-side in the existing release metadata row. There is no separate context band. The deployed PostgreSQL header and the unchanged Percona PSMDB reference header both measure exactly `145.54px`; tabs start at the same `y=297.69px` and measure `54.10px`.
- Colors and tokens: Clarity/OpenSphere foreground, border, semantic Ready green, blue action, and white surface tokens match the existing PFS header system and the selected concept.
- Image and icon fidelity: the existing PostgreSQL logo is reused without replacement or approximation. Refresh uses the Clarity `Renew16` icon and remains sharp at native density.
- Copy and content: Namespace, PostgreSQL instance, lifecycle, version, profile, add, and refresh labels match the selected concept while retaining Korean product copy and accessible labels.
- P3 follow-up polish: none required for acceptance.

## Full-view comparison evidence

The source concept and `implementation-postgres-integrated-header.png` were opened together in the same comparison input. The deployed page preserves the selected composition: brand at left, lifecycle/version/profile in the center, Namespace and PostgreSQL instance at right, and tabs immediately below without an intervening block. The surrounding Console shell and Overview cards are expected product context absent from the isolated concept.

## Focused region comparison evidence

The source concept and `implementation-postgres-integrated-header-focused.png` were opened together in a second comparison input. The focused pass verified logo scale, metadata separators, label/value hierarchy, underline selects, add action, refresh icon, one-row control alignment, and the direct header-to-tabs transition. No cropped control, overflow, extra vertical band, or material wrapping mismatch was visible.

## Comparison history

1. Earlier concept iterations placed Namespace and instance controls in a separate band, increasing the apparent header stack. This was rejected because it changed the established PFS layout.
2. The selected implementation projects both controls into the existing plugin release area, arranges them left-to-right, removes the standalone context bar, and keeps the existing header/tab geometry.
3. Post-fix visual evidence is the deployed full-view and focused captures above. The final comparison found no actionable P0/P1/P2 issue, so no additional visual-fix iteration was required.

## Primary interactions tested

- Switched Namespace from `opensphere-foundation` to `default`: the instance selector disappeared and the dedicated PostgreSQL installation form appeared.
- Switched back to `opensphere-foundation`: the instance selector returned.
- Switched between `pgc-platform-dev-pg · stackgres` and `foundation-data-pg · cloudnativepg`, then restored the StackGres instance.
- Verified the refresh control and both selects expose accessible labels in the rendered DOM.

## Runtime and console verification

- Official version: `202608062153`
- Exact digest: `sha256:78e43e90784eb40c76475d31361abf4e6d868eb4aaa0b6a9fd1b84d6811423ed`
- Foundation rollout: `2/2`; UI registration: `Activated / Current / Ready`.
- Browser console: no new warning or error after the cache-bypass reload. Two retained warnings at `12:58:12Z` and `12:58:33Z` predate the successful reload and correspond to the old cached manifest during pin rotation.

final result: passed

---

# PostgreSQL Administration Design QA

- 검증일: 2026-08-05
- Reference source: official pgAdmin 4 View Data and Query Tool screenshots
- Implementation: `src/app/modules/postgres/admin/pg-admin.tab.ts`, `src/app/modules/postgres/admin/pg-admin.service.ts`
- Runtime: `https://localhost:1114/pfss/postgres/admin`
- Final comparison evidence: `../.codex-tmp/pgadmin-data-query-redesign/09-final-reference-comparison.png`

## Visible comparison

- Left Object Explorer follows the pgAdmin server → database → schema → object hierarchy.
- Table selection opens a dedicated `Data View` containing only the read-only row grid, refresh action, row limit, and result status.
- `Query - appdb` remains an independent workspace with editor, Data Output, Messages, and Query History.
- `Data View` and `Query - appdb` remain simultaneously visible at the verified desktop viewport; the selected table path stays in the context/header instead of widening the tab.
- Layout, spacing, borders, tab states, icons, selected-tree state, data grid, and query split were checked together with the official pgAdmin references in one comparison image.

## Interaction verification

- Selected `public.opensphere_opa_decision_log`; Data View loaded four live rows without exposing the SQL editor.
- Collapsed and reopened `Tables`: `aria-expanded` changed `true → false → true`, and the table node count changed `1 → 0 → 1`.
- Collapsed and reopened `public`; all descendant groups were removed and restored.
- Query Tool executed `SELECT 1 AS query_tool_check;` and preserved its result independently.
- Returning to Data View restored the four table rows and did not show the Query Tool editor/result.
- Read-only query limits remain visible: 10 second timeout and 500 row maximum.

## Runtime verification

- Official version: `202608052305`
- Source revision: `61e0536de1915d98e5b4e5d1fbf24c386f1c4940`
- Foundation deployment rolled out with 2/2 replicas on exact digest `sha256:e2a21d8c67b5906ac0ef29507cf7dee4e9d05b3fc78259df42c921cc4f57aadd`.
- Immutable version tag and `edge` resolve to the same digest.
- Browser console errors: none.
- P0 findings: none.
- P1 findings: none.
- P2 findings: none.

final result: passed
