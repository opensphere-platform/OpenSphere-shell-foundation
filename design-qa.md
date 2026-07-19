# Foundation 전체 Plugin — 통합 Design QA

검증일: 2026-07-19  
대상 배포: `opensphere-shell-foundation:0.2.0-edge.8`, `opensphere-plugin-samba-ad:0.1.1-edge.2`

## 시각 정본과 증거

- 사용자 제공 제품 상세 헤더 정본: `C:\Users\cmars\AppData\Local\Temp\codex-clipboard-8d8cb0b0-a3a4-4267-99f1-f066afba5cc5.png`
- 현재 PostgreSQL 구현: `visual-qa/final-postgres.png`
- 결합 비교본: `design-qa-comparison.png`
- 대표 구현 화면:
  - `visual-qa/final-mattermost.png`
  - `visual-qa/final-otel.png`
  - `visual-qa/final-addc.png`
- 뷰포트/상태: 로그인된 Chrome, 3840 × 2160, 각 plugin의 Overview 또는 설치 전 Preflight 상태

결합 비교본에서 제품 정체성, 실제 로고, 릴리스 메타데이터, 수평 관리 탭, 콘텐츠 카드의 순서를 한 화면에서 대조했다. OpenSphere 전역 셸과 보조 내비게이션은 제품 고유 영역이므로 정본에 없는 추가 컨텍스트로 유지했다.

## 적용한 공통 계약

- 장식 박스 없는 실제 `logos.opl.io.kr` 로고와 제품 제목·설명
- Lifecycle, Version, Profile, Namespace 메타데이터
- Overview, 실행 기반, 설치·운영 구성, Topology, Consumers, Protection, Events, Upgrade, Documentation 수명주기
- 실제 Kubernetes/API 상태 기반 Ready, Pending, Error, Empty 상태
- plugin 소유 한글 운영 문서와 공식 문서 링크
- Foundation package 활성화 시 Manual Registry 및 통합 검색 자동 기여
- Foundation 소속 operand의 표준 namespace: `opensphere-foundation`

Argo CD(`argocd`), Crossplane(`crossplane-system`), CloudNativePG operator(`cnpg-system`), Percona operator(`psmdb-operator`), Velero(`velero`)는 Foundation이 소비하는 외부 control-plane/installer이며 Foundation 소속 operand가 아니므로 고유 namespace를 유지한다.

## 브라우저 회귀검사

21개 경로를 실제 배포 환경에서 순회했다.

- Data: PostgreSQL, Percona PSMDB, Valkey, OpenSearch, RustFS
- Identity: Keycloak, Samba-AD, Apache Syncope, OPA
- AI / Retrieval: LiteLLM, Langfuse
- Communication: Stalwart, Novu, Mattermost
- Observability: OpenTelemetry Collector, Grafana Tempo, Grafana Loki, Grafana Operator
- Backup / Restore: PTM
- Platform Delivery: Argo CD, Crossplane

결과:

- 21/21 정상 렌더링
- 21/21 Documentation 또는 plugin 소유 문서 진입점 확인
- 20/20 설치 후 관리 화면에서 Upgrade 탭 확인
- Samba-AD는 설치 전 Preflight가 BLOCK 상태이므로 Upgrade 대신 원인·해결·한글 문서를 노출
- Foundation 소속 operand 화면은 모두 `opensphere-foundation` 표시
- Argo CD와 Crossplane은 외부 제어 기반으로 고유 namespace 표시
- PostgreSQL Documentation 탭에서 한글 안내서와 PostgreSQL 19/CloudNativePG 공식 문서 확인
- `/manual?doc=plugin:foundation/postgresql-operations-ko` 실제 렌더링 확인

## 상호작용과 상태 검증

- PostgreSQL Overview → Upgrade → Documentation 탭 전환 성공
- PostgreSQL 한글 안내서 링크가 Console Manual Registry 문서로 이동
- Samba-AD Preflight가 Crossplane 선행조건 실패를 숨기지 않고 설치를 차단
- Samba-AD 차단 화면에서도 한글 운영 안내서에 접근 가능
- 아직 설치되지 않은 operand는 가짜 운영 수치 대신 실제 Pending/Empty 상태를 표시
- PostgreSQL 모니터링 차트는 Cluster/PodMonitor 부재 시 데이터를 조작하지 않고 준비 상태를 표시하며, operand 가동 시 Prometheus 실데이터를 사용하도록 구성

## 시각 평가 및 수정 이력

| 우선순위 | 발견 | 반영 | 결과 |
|---|---|---|---|
| P1 | plugin마다 다른 헤더·탭·메타데이터 구조 | PostgreSQL 파일럿의 단일 page-frame을 21개 plugin에 확대 | 해결 |
| P1 | 설치 전 화면에서 문서 접근이 끊김 | Samba-AD Preflight에 plugin 소유 한글 문서·공식 문서 진입점 추가 | 해결 |
| P1 | PFS operand namespace가 기능별로 분산 | 실제 Foundation 멤버를 `opensphere-foundation`으로 통일 | 해결 |
| P2 | 정본과 달리 로고 주변 장식이 강조됨 | 장식 없는 실제 로고와 평면 헤더로 통일 | 해결 |
| P2 | 미설치 상태에 운영 수치를 오인할 가능성 | 실제 Ready/Pending/Error/Empty 상태로 통일 | 해결 |

## 남은 조건부 검증

현재 클러스터에 PostgreSQL operand와 PodMonitor가 없으므로 **채워진 시계열 차트**는 캡처하지 않았다. 이는 UI 계약 차단이 아니라 운영 데이터가 아직 없는 정상 Empty 상태다. Cluster가 생성되면 같은 Overview 화면이 Prometheus 실측값을 표시한다.

## 최종 결과

final result: passed
