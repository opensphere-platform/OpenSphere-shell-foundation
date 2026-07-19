# OpenSphere OPA 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. policy bundle을 기반으로 authorization 결정을 제공하며 fail-open을 허용하지 않습니다.

## 2. 구현 전제조건
서명된 policy bundle 저장소, 결정 로그 영구 감사, Console RBAC mapping과 SecretRef가 필요합니다.

## 3. 설치 계약
OPA server, bundle fetcher, decision-log exporter와 admission adapter의 버전·digest·리소스·NetworkPolicy를 BOM에 고정합니다.

## 4. 운영 표면
bundle revision, decision latency/error, consumer endpoint, audit delivery, 이벤트와 rollback을 실제 상태로 노출해야 합니다.

## 5. 현재 제한
control-plane reconciler와 정책 감사 저장소 연결 전에는 설치 실행을 제공하지 않습니다.

## 6. 참고
- https://www.openpolicyagent.org/docs/

