# OpenSphere Novu 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. email, push, chat provider를 통합하는 notification orchestration capability입니다.

## 2. 전제조건
PostgreSQL, Valkey, provider credential Secret과 OIDC가 필요합니다.

## 3. 설치·운영 계약
API, worker, web dashboard와 provider adapter의 버전·digest·리소스를 확정하고 template, subscriber, delivery queue와 실패 이벤트를 실제 상태로 노출합니다.

## 4. 보호
provider 자격 회전, template revision, 수신자 개인정보와 delivery 감사를 관리합니다.

## 5. 현재 제한
NotificationClaim과 provider binding, rollback 증거가 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://docs.novu.co/

