# OpenSphere Grafana Operator 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. Grafana instance, datasource, dashboard와 folder/team mapping을 선언형으로 관리합니다.

## 2. 전제조건
HIS Prometheus, Tempo/Loki datasource, OIDC와 Ingress 정책이 필요합니다.

## 3. 설치·운영 계약
Operator, Grafana instance, Datasource/Dashboard CR의 버전·digest·리소스를 확정하고 CR condition, datasource health와 이벤트를 실제 상태로 표시합니다.

## 4. 보호
관리자 자격 Secret, dashboard GitOps, 외부 공개 TLS/OIDC와 접근 승인 정책이 필요합니다.

## 5. 현재 제한
DashboardClaim과 datasource binding이 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://grafana.github.io/grafana-operator/docs/

