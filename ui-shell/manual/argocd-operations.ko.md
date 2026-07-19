# OpenSphere Argo CD Delivery 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. Git repository의 서명된 desired state를 target cluster에 동기화하는 Foundation 기본 write-path입니다.

## 2. 전제조건
Git credential Secret, OIDC, ApplicationSet 정책과 서명된 desired state가 필요합니다.

## 3. 설치·운영 계약
API/server, application controller, repo server와 ApplicationSet controller의 버전·digest·리소스를 확정합니다. sync/health, diff, revision, 이벤트와 rollback을 실제 API 상태로 표시해야 합니다.

## 4. 보호
Git commit 감사, sync 승인, credential 회전과 destructive prune 정책을 적용합니다.

## 5. 현재 제한
승인된 repository binding과 rollback 증거가 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://argo-cd.readthedocs.io/

