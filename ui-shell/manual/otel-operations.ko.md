# OpenSphere OpenTelemetry Collector 플러그인 설치 및 운영 안내서

## 1. 역할
Foundation workload의 metric, log, trace를 OTLP로 수집해 승인된 backend로 전달하는 중앙 gateway입니다.

## 2. 설치 순서
PFS Control Plane, provider-helm과 HIS Shared Observability를 확인하고 서명 BOM의 chart/app 버전을 선택합니다. 기본 endpoint는 ClusterIP OTLP gRPC 4317, HTTP 4318입니다.

## 3. 운영 확인
Deployment Ready, image, receiver, processor, exporter, queue와 retry 상태를 확인합니다. exporter SecretRef와 endpoint 연결 실패를 이벤트/로그에 표시합니다.

## 4. 보호
namespace allowlist, SecretRef, memory limiter, batch, retry와 queue를 사용합니다. 직접 외부 공개는 금지합니다.

## 5. 업그레이드
collector component 호환성과 exporter endpoint, config rollback을 검증한 뒤 서명 BOM 버전만 적용합니다.

## 6. 참고
- https://opentelemetry.io/docs/collector/

