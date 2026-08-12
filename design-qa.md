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

# Keycloak Release Metadata Right Alignment Design QA

- 검증일: 2026-08-10
- Source visual truth: `C:\Users\cmars\AppData\Local\Temp\codex-clipboard-a32d7bf5-22ed-40cc-b545-7be69161371b.png`
- Implementation URL: `https://localhost:1114/pfss/keycloak`
- Comparison evidence: `audit-evidence/2026-08-10-pfs-header-alignment/reference-vs-implementation.png`
- Implementation screenshot: `audit-evidence/2026-08-10-pfs-header-alignment/keycloak-after.png`

## Findings and fix

1. Before: the four-column release metadata grid used a 27rem minimum Namespace track. At the verification viewport its right edge exceeded the PFS header boundary by about 198px.
2. Fix: the header now reserves a bounded 60% right-hand metadata track; the release grid fills that track, uses a shrinkable Namespace column, and explicitly aligns itself to the end.
3. After: Lifecycle, Version, Profile, and Namespace remain on one row; the metadata grid ends at the header content edge with the intended 10px inset and has 0px overflow.

## Visual and runtime verification

- Reference and browser-rendered implementation were reviewed together in one comparison image.
- Typography, labels, values, header height, tab navigation, service logo, and surrounding layout remain intact.
- Responsive rules below 1180px remain authoritative and were not broadened by the desktop alignment rule.
- Browser console error entries after the final Keycloak render: 0.
- Official version: `202608101419`.
- Source revision: `b62f9b3d104de507346dfec10f7028005e8d6d1d`.
- Foundation registration: Activated / Compatible / Current; workload Ready on exact digest `sha256:7d8e91f44c17aa11cbf2dc3d2eb50d74b2770b426bb96db295f0b765d55d2514`.

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

---

# PostgreSQL Instance Switch Layout Design QA

- 검증일: 2026-08-06
- Approved visual truth: `qa-postgres-overview-header-20260803.png`
- Same-state regression source: `source-postgres-instance-switch-broken-20260806.png`
- Implementation screenshot: `implementation-postgres-instance-switch-fixed-20260806.png`
- Runtime: `https://localhost:1114/pfss/postgres`
- State: `opensphere-foundation` / `foundation-data-pg · cloudnativepg` / `Overview`

## Capture normalization

- Regression source and implementation capture: 2163 × 1671 pixels.
- CSS layout viewport: 2163 × 1670; device scale 1; visual scale 1; browser zoom 117%.
- The same-state pair was captured without resampling and used for exact overflow comparison.
- The 1973 × 1671 approved reference was used to confirm the established header height, navigation placement, and overall layout contract.

## Full-view comparison evidence

- The broken CloudNativePG state and the fixed CloudNativePG state were opened together at native resolution.
- The approved existing design and the fixed implementation were also opened together to verify that the compact selector integration did not increase the header height or remove navigation.
- Lifecycle, PostgreSQL version, profile, namespace, instance selector, twelve navigation tabs, and Overview content remain readable without overlap or horizontal layout growth.

## Focused region comparison

- The full native-resolution comparison kept the dense header labels and values readable, so a separate cropped artifact was not required.
- The header status cells and Overview status tile were inspected directly at native resolution in both before and after captures.

## Findings and comparison history

1. Before: long raw lifecycle text and the full container image value overflowed fixed-width header/status areas, causing a P1 header collision and P2 Overview-card expansion.
2. Fix: lifecycle and version use compact display labels; header/package values use `min-width: 0`, no-wrap, ellipsis, and constrained metric layout. Full raw operational details remain available in the detail cards and conditions.
3. After: no P0, P1, or P2 visual findings remain across typography, spacing, alignment, overflow, and hierarchy.

## Primary interaction verification

- Completed a StackGres → CloudNativePG → StackGres → CloudNativePG instance round trip.
- Verified all twelve restored tabs: Overview, Monitoring, Operator, Cluster plan, Topology, Configuration, Databases & Roles, Backups, Events, Claims, Upgrade, and Documentation.
- Namespace and PostgreSQL instance selectors remained stable and the established header height was preserved during state changes.

## Runtime and console verification

- Official version: `202608062257`.
- Source revision: `dc0e8cacc9653a30c0a631202c8bea267ac37ea3`.
- Foundation deployment: 2/2 replicas on exact digest `sha256:f137695317cebe02eb7a134d7771e054d0b2d013e04e5da25946256147f25183`.
- Foundation and PostgreSQL registrations: Activated / Compatible / Current.
- Immutable version tag and `edge` resolve to the same digest.
- Browser runtime, console, and network error events after the interaction pass: 0.

final result: passed

---

# PostgreSQL Overview Content Hierarchy Design QA

- 검증일: 2026-08-06
- Source visual truth: `C:\Users\cmars\AppData\Local\Temp\codex-clipboard-d1a104a4-2bbf-407d-9eaf-97ecb63d5871.png`
- Implementation URL: `https://localhost:1114/pfss/postgres`
- Implementation screenshot captures: in-app Browser tab 16, `IMPLEMENTATION TOP` and `IMPLEMENTATION DETAILS` capture outputs attached to this task.
- State: `opensphere-foundation` / `pgc-platform-dev-pg · stackgres` / `Overview`.

## Capture normalization

- Source: 1948 × 1042 pixels at 96 DPI.
- Implementation: browser-rendered desktop capture at the existing OpenSphere verification viewport (2163 × 1670 CSS viewport, device scale 1, browser zoom 117%).
- The source is a focused Overview content capture while the implementation includes persistent OpenSphere shell chrome. Comparisons therefore used the matching monitoring-header/chart region and the Persistent volumes/detail-card region rather than treating shell chrome as design drift.

## Findings and comparison history

1. P1 — The source showed the `PostgreSQL 운영 상태` heading and explanatory copy with insufficient contrast against the dark monitoring header. The implementation now uses white heading text and a light secondary foreground on `#102a43`; the post-fix top comparison shows both lines clearly.
2. P1 — The approved Overview hierarchy had previously been split into monitoring and details, but the restoration commit rendered all content as one trailing block. The implementation again renders monitoring immediately after the three lifecycle steps, the readiness dashboard next, details after the dashboard, and Description/Documentation last.
3. P2 — The two detail cards used auto-fill tracks, occupied only part of the available row, and presented oversized/heavy copy. The implementation uses two equal `minmax(0, 1fr)` tracks across the full width, equal-height cards, 0.72rem/500 headings, 0.66rem body copy, and 0.65rem/400 monospace values.
4. Post-fix comparison — The source and final implementation were opened together twice: once for the full monitoring/header region and once for the focused Persistent volumes/detail-card region. No actionable P0, P1, or P2 finding remains.

## Required fidelity surfaces

- Fonts and typography: heading and body optical weights are restrained; endpoint values wrap without dominating their labels.
- Spacing and layout rhythm: monitoring, readiness, details, and documentation follow the restored operational hierarchy; the detail cards occupy balanced 50/50 tracks.
- Colors and visual tokens: the monitoring header now has accessible foreground/background separation while existing Clarity semantic colors remain unchanged.
- Image quality and asset fidelity: the supplied PostgreSQL logo and chart rendering remain unchanged; no placeholder, CSS-drawn, or replacement asset was introduced.
- Copy and content: the StackGres exporter description, operational labels, endpoint values, PVC evidence, and conditions remain intact.

## Primary interaction and runtime verification

- Completed a `StackGres → CloudNativePG → StackGres` instance-selector round trip.
- Verified that both providers keep the Overview heading, provider-specific exporter copy, detail cards, and all twelve navigation tabs.
- Browser navigation and selector interactions completed without runtime exceptions or visible error state; console error output observed during the final interaction pass: 0.
- Official version: `202608062350`.
- Source revision: `7dd05564e14c15d40724336b20342c7a22b62fd7`.
- Foundation deployment: 2/2 replicas on exact digest `sha256:767d18e8eba7ef3b90a9f3ad4322fcb02e98dda8596e9be19e127231065351f0`.
- Foundation registration: Activated / Current.
- Immutable version tag and `edge` resolve to the same digest.

final result: passed
