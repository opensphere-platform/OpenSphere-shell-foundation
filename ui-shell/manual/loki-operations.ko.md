# OpenSphere Grafana Loki 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. Foundation 로그의 저장·조회 capability입니다.

## 2. 전제조건
OpenTelemetry Collector, S3 capability, tenant와 민감정보 정책이 필요합니다.

## 3. 설치·운영 계약
distributor, ingester, querier, compactor의 버전·digest·리소스와 retention을 확정합니다. ingestion rate, chunk, query, compaction과 이벤트를 실제 상태로 표시해야 합니다.

## 4. 보호
tenant 격리, PII 마스킹, S3 lifecycle과 보존/삭제 감사를 적용합니다.

## 5. 현재 제한
LogQueryBinding과 데이터 보호 경계가 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://grafana.com/docs/loki/latest/

