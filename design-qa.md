# Foundation Plugin Surface Design QA

검증일: 2026-07-20

검증 브라우저: 로그인된 사용자 Chrome, 1728 × 859

정본 화면: `/p/foundation/postgres`

## 검증 대상

- Foundation subShell `0.2.0-edge.11`의 20개 plugin 화면
- Foundation에 종속된 Samba-AD plugin `/p/foundation/addc`
- 공통 계약: 단일 평면 헤더, 4열 메타데이터, 11개 탭, 3단계 수명주기, 3열 Overview

## 구현·배포 상태

| 대상 | 구현 | 이미지 | 클러스터 | 판정 |
|---|---|---|---|---|
| Foundation 20개 화면 | commit `46541e7` | `0.2.0-edge.11` · `sha256:6180ae245425...` | Activated / Ready | 통과 |
| Samba-AD ADDC | commit `f36f3f2` | `0.1.1-edge.7` · `sha256:21fa2d8c4ab3...` | `edge.6` 유지 | 배포 차단 |

Foundation 이미지는 digest, descriptor, signature, provenance, SBOM, permission profile 및 amd64/arm64 검증을 통과한 뒤 `os extensions install`과 `activate`로 배포했다.

## 현재 실행 화면 감사

1. 21개 모든 경로에서 HTTP/Error 화면이 없고 11개 탭과 단일 `aria-selected=true`가 존재한다.
2. 21개 모든 경로에서 `1 → 2 → 3` 단계 버튼을 확인했다.
3. Foundation 20개 경로는 roving tabindex가 정확히 1개이며 `ArrowRight`로 `Overview → Operator`가 전환된다.
4. OTel과 Crossplane은 누락됐던 3단계 스트립과 직각 3열 Overview를 추가했다.
5. Chrome 로그는 extension-host 검증 성공 `info`만 있고 warning/error는 없다.
6. ADDC의 시각 구조는 PostgreSQL과 일치하지만 현재 배포본 `edge.6`에는 roving tabindex와 방향키 처리가 없다.

## 시각 증거

- `audit-evidence/2026-07-20-pfs-completion/comparison-postgres-addc-after.png`
- `audit-evidence/2026-07-20-pfs-completion/comparison-otel-before-after.png`
- `audit-evidence/2026-07-20-pfs-completion/comparison-crossplane-before-after.png`
- `audit-evidence/2026-07-20-pfs-completion/route-audit-before.json`
- `audit-evidence/2026-07-20-pfs-completion/route-audit-after.json`

## 배포 차단 근거

Samba-AD `edge.7` 설치는 Console admission에서 HTTP 409 `PlatformSupportProfileRequiredForPfsPlugin`으로 거절됐다.

- HIS Ready: `Blocked`
- Platform Support Profile: `Blocked`
- Observability: `TelemetryEvidenceMissing`
- Security/Policy: `PolicyEvidenceMissing`
- 개발 예외는 Foundation subShell 활성화만 허용하며 PFS plugin 설치·업그레이드는 허용하지 않는다.

감사 중 `kubectl` 직접 교체나 admission 우회는 수행하지 않았다. ADDC의 최종 배포 검증은 HIS/Platform Support Profile을 Ready로 만들거나, 사용자가 PFS plugin 업그레이드에 한정된 별도 개발 예외를 명시 승인한 뒤 진행해야 한다.

final result: blocked
