# OpenSphere Langfuse 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. LLM trace, prompt registry와 비용 분석을 제공하는 AI observability capability입니다.

## 2. 전제조건
PostgreSQL, ClickHouse 사용 결정, S3 capability와 OIDC가 필요합니다.

## 3. 설치·운영 계약
web, worker, metadata DB와 trace store의 버전·digest·리소스·보존기간을 BOM으로 고정합니다. 운영 화면은 ingestion, queue, storage, consumer와 이벤트의 실제 상태를 표시합니다.

## 4. 보호
prompt/response 민감정보 마스킹, tenant 격리, trace 보존과 S3 export/restore를 검증합니다.

## 5. 현재 제한
ClickHouse 및 데이터 보호 경계가 확정되기 전 설치는 잠깁니다.

## 6. 참고
- https://langfuse.com/docs

