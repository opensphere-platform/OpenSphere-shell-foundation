# OpenSphere Grafana Tempo 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. 분산 trace 저장·조회 capability이며 OpenTelemetry Collector의 trace exporter를 소비합니다.

## 2. 전제조건
OpenTelemetry Collector, S3 capability와 HIS Shared Observability 연계가 필요합니다.

## 3. 설치·운영 계약
distributor, ingester, querier, compactor의 버전·digest·리소스와 tenant/retention을 확정합니다. ingestion, block, query, compaction과 이벤트를 실제 상태로 표시해야 합니다.

## 4. 보호
tenant 격리, S3 lifecycle, 보존기간과 데이터 삭제 정책을 검증합니다.

## 5. 현재 제한
TraceQueryBinding과 S3 보호 경계가 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://grafana.com/docs/tempo/latest/

