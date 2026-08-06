# OpenSphere Apache Syncope 설치 및 운영 안내서

## 1. 역할과 운영 판정

Apache Syncope 4.0.7은 workforce IGA와 SCIM 2.0 프로비저닝의 단일 권위다. Keycloak과 Samba-AD는 downstream이며 사용자 변경의 정본이 아니다. `Production Ready`는 다음을 모두 만족할 때만 표시한다.

- Core StatefulSet 2개 이상 Ready
- 전용 StackGres `pgc-foundation-identity-syncope-pg`의 `syncope` database와 최소권한 role
- 이미지 기본 admin/anonymous/JWS 값 제거 및 32자 AES key
- Core TLS, PostgreSQL TLS, namespace NetworkPolicy
- OpenJPA TCP remote commit을 통한 다중 Core 캐시 일관성
- Prometheus target과 durable `AuditEvent` 관측

## 2. Secret 선행조건

Secret 값은 FoundationModel이나 브라우저에 저장하지 않는다. 플랫폼 installer 권한으로 다음을 1회 실행한다.

```powershell
./scripts/Initialize-SyncopeSecrets.ps1 -Context docker-desktop
```

이 명령은 `foundation-identity-syncope-db-auth`와 `foundation-identity-syncope-runtime`을 만들며 값을 출력하지 않는다. 생성된 일회용 관리자 평문은 즉시 폐기하므로 direct Syncope admin 로그인은 기본 운영 경로가 아니다.

## 3. 설치

Apache Syncope의 Install 탭에서 production profile과 replicas를 검토하고 설치한다. Control Plane은 전용 PostgresClaim과 다음 리소스를 선언형으로 조정한다.

- `DatabaseRole/foundation-identity-syncope`, `Database/foundation-identity-syncope`
- TLS CA/서버 Certificate
- `StatefulSet/foundation-identity-syncope`, headless/client Service, PDB
- ServiceMonitor, PrometheusRule, NetworkPolicy

## 4. Monitoring

Monitoring 탭은 Carbon Charts만 사용한다. Prometheus scrape는 15초, 최근 1시간 query range의 step은 PostgreSQL과 같은 60초, 화면 갱신은 15초다. Core availability와 p95 health latency, CPU/memory, 사용자·그룹·외부 리소스, durable audit event 누계를 표시한다. 값이 없으면 0을 꾸미지 않고 target/시계열 없음 상태를 표시한다.

## 5. 백업과 감사

Syncope 상태와 감사 이벤트는 전용 StackGres의 `syncope` database에 영속된다. StackGres backup/PITR plan에 이 database가 포함되는지 확인하고, 복구 훈련에서는 DB뿐 아니라 runtime Secret과 connector 설정의 정합성을 함께 검증한다. Metrics는 감사 원장을 대체하지 않는다.

## 6. 업그레이드

4.0.7 미만 4.0 계열은 2026년에 공개된 여러 보안 취약점의 영향 범위이므로 허용하지 않는다. upgrade 전 DB backup, schema 호환성, connector 동작과 audit 연속성을 확인하고 Core를 순차 교체한다.

## 7. 참고

- https://syncope.apache.org/docs/4.0/reference-guide.html
- https://syncope.apache.org/security
