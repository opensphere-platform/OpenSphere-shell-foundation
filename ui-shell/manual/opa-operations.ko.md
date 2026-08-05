# OpenSphere OPA 설치 및 운영 안내서

## 1. 상태와 역할
FoundationModel/identity의 `engines.opa=enabled` 선언으로 OPA 1.18.2-static을 설치합니다. 초기 profile은 평가 경로와 Monitoring을 검증하기 위한 development 상태이며 fail-open을 허용하지 않습니다.

## 2. 구현 전제조건
설치 자체는 fail-closed bootstrap policy로 가능합니다. Production Ready 판정에는 서명된 policy bundle 저장소, 결정 로그 영구 감사, 소비자 인증·TLS와 Console RBAC mapping이 추가로 필요합니다.

## 3. 설치 계약
Foundation control-plane이 OPA Deployment, 내부 Service, ServiceMonitor, NetworkPolicy와 bootstrap ConfigMap을 SSA로 관리합니다. 평가 API는 `POST /v1/data/opensphere/**`만 허용하고 Policy/Data mutation API는 거부합니다.

## 4. 운영 표면
Monitoring은 Prometheus 최근 1시간, 60초 query step, 15초 화면 갱신 기준입니다. Carbon Charts로 평가 처리량, p95 지연, HTTP 오류율, Go heap과 goroutine을 표시합니다.

allow와 deny는 정상 평가 시 모두 HTTP 200이므로 OPA native Prometheus metric만으로 결과를 구분할 수 없습니다. 결과 비율은 영속 decision-log sink에서 집계해야 하며 subject, resource, JWT, input 원문, decision ID를 Prometheus label에 넣지 않습니다.

## 5. 현재 제한
bootstrap policy는 항상 deny입니다. 설치 후에도 서명 bundle과 영속 decision-log sink가 없으면 화면은 `Development Ready`로만 표시하고 운영 승격을 차단합니다. OPA는 데이터 저장소가 아니므로 DB 백업 대신 bundle artifact, revision manifest, 검증 키와 decision-log 보존 정책을 복구 대상으로 관리합니다.

## 6. 참고
- https://www.openpolicyagent.org/docs/security
- https://www.openpolicyagent.org/docs/monitoring
- https://www.openpolicyagent.org/docs/management-introduction
