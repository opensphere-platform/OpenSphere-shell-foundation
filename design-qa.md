# Foundation Plugin — PostgreSQL/ADDC Design QA

검증일: 2026-07-20

기준 화면: `/p/foundation/postgres`

대상 화면: `/p/foundation/addc`
배포 버전: Foundation `0.2.0-edge.10`, Samba-AD `0.1.1-edge.6`

## 시각 정본과 비교 조건

- PostgreSQL 기준 캡처: `audit-evidence/2026-07-20-pfs-parity/02-postgres-edge10.png`
- ADDC 구현 캡처: `audit-evidence/2026-07-20-pfs-parity/01-addc-edge10.png`
- 동일 뷰포트 비교본: `audit-evidence/2026-07-20-pfs-parity/03-postgres-addc-comparison.png`
- 문서 탭 비교본: `audit-evidence/2026-07-20-pfs-parity/06-postgres-addc-documentation-comparison.png`
- ADDC Operator 증거: `audit-evidence/2026-07-20-pfs-parity/07-addc-operator.png`
- ADDC 최종 캡처: `audit-evidence/2026-07-20-pfs-parity/08-addc-final.png`
- 뷰포트/상태: 로그인된 사용자 Chrome, 1728 × 859, 설치 전 `Operator required`

## PostgreSQL 기준 공통 화면 계약

- Foundation 전역 사이드바, breadcrumb, `← PFS 모듈` 복귀 링크
- 장식 박스 없는 실제 제품 로고, capability, 제목, 설명
- Lifecycle, Version, Profile, Namespace 4열 메타데이터
- 다음 순서의 11개 수평 탭
  1. Overview
  2. Operator
  3. Cluster plan
  4. Topology
  5. Configuration
  6. 제품별 핵심 도메인
  7. Backups
  8. Events
  9. Claims
  10. Upgrade
  11. Documentation
- `Operator 준비 → Cluster 생성 → 운영 관리` 3단계 수명주기
- `Package readiness`, 제품 health, `Operations policy` 3열 Overview
- 설치 전에도 Operator와 Documentation에 접근 가능한 관리 흐름

ADDC의 제품별 차이는 여섯 번째 탭 `Directory & Roles`, LDAP/AD DC health, Realm, Directory 접근·보안 정책뿐이다. 레이아웃과 탐색 흐름은 PostgreSQL과 동일하다.

## 브라우저 상호작용 검증

1. `/p/foundation/addc` — 11개 탭, 3단계 수명주기, 3열 상태 패널 렌더링 확인
2. `Cluster plan` 클릭 — `/p/foundation/addc/cluster` 전환 확인
3. `Operator` 클릭 — `/p/foundation/addc/operator`와 `Foundation installer` 차단 사유 확인
4. `Documentation` 클릭 — `/p/foundation/addc/documentation`, Console Manual Registry, 한글 안내서 진입점 확인
5. 최종적으로 Overview로 복귀하고 Chrome의 warning/error 로그가 0건임을 확인

## 시각 대조 결과

| 항목 | PostgreSQL 기준 | ADDC 결과 |
|---|---|---|
| 콘텐츠 폭과 상단 여백 | 전역 셸 안의 전체 가용 폭 | 일치 |
| 헤더 높이·로고·메타데이터 | 단일 평면 헤더, 4열 메타데이터 | 일치 |
| 탭 수와 순서 | 11개 | 일치 |
| 도메인 탭 | Databases & Roles | Directory & Roles — 의도된 차이 |
| 수명주기 스트립 | 3단계 전체 폭 | 일치 |
| Overview 카드 | 3열 동일 폭 | 일치 |
| Documentation | 같은 헤더/탭 프레임 안에서 문서 기여 표시 | 일치 |
| 브라우저 오류 | 없음 | warning/error 0건 |

## 접근성 범위

현재 QA에서는 탭의 명시적 텍스트, 선택 상태, disabled 상태, 읽을 수 있는 상태 메시지를 확인했다. 키보드 전 경로 및 스크린리더 조합별 완전 적합성은 별도 접근성 감사 범위다.

## 최종 결과

final result: passed
