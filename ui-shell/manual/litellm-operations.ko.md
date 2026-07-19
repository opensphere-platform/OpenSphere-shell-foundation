# OpenSphere LiteLLM 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. 다중 LLM provider의 model/embedding route, 예산과 rate policy를 제공하는 model gateway입니다.

## 2. 전제조건
provider credential Secret, PostgreSQL, OpenSearch vector capability, OAA Gateway 계약이 필요합니다.

## 3. 설치·운영 계약
proxy, provider registry, budget policy와 route adapter의 서명 BOM을 확정하고 요청 성공률, 지연, 비용, rate limit과 이벤트를 실제 backend 상태로 표시합니다.

## 4. 보호
provider 키는 화면·로그에 노출하지 않습니다. prompt/response 감사와 민감정보 정책을 적용합니다.

## 5. 현재 제한
reconciler, credential binding과 비용 감사가 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://docs.litellm.ai/

