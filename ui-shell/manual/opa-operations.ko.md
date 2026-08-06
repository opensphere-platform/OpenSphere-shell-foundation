# OpenSphere OPA 설치 및 운영 안내서

## 1. 상태와 역할
FoundationModel/identity의 `engines.opa=enabled` 선언으로 OPA 1.18.2-static production profile을 설치합니다. OPA는 2 replicas로 실행하며 정책 부재, undefined 결과 또는 bundle 검증 실패를 allow로 바꾸지 않습니다.

## 2. 정책 공급망
정책은 exact-digest Foundation Control Plane image에 포함된 ES256 서명 bundle로 공급합니다. OPA는 `opensphere-production` scope, signing key ID와 bundle revision을 검증한 뒤에만 활성화합니다. 새 bundle 검증이 실패하면 마지막으로 검증된 revision을 유지합니다.

현재 기준 revision은 `opensphere-prod-54418c8a00105447`, key ID는 `opensphere-opa-edge-bundle-v1`입니다. edge-local key는 개발 클러스터 전용이며 candidate/stable/ga 승격 시 해당 채널의 승인된 정책 서명키로 다시 빌드해야 합니다.

## 3. 평가 API와 인증
평가 endpoint는 `https://foundation-identity-opa.opensphere-foundation.svc:8181`입니다. cert-manager가 관리하는 OPA 전용 CA로 mTLS를 강제하며, `foundation.opensphere.io/opa-client=true` label을 가진 승인 Pod만 NetworkPolicy 평가 경로에 접근할 수 있습니다. API는 `POST /v1/data/opensphere/**`만 허용하고 Policy/Data mutation과 ad-hoc query API는 거부합니다.

## 4. 영속 decision log
OPA는 모든 decision event에서 원문 `input`과 non-deterministic cache를 제거합니다. 두 개의 `foundation-identity-opa-control` replica가 gzip batch를 받아 결과, policy path, bundle revision, timestamp만 전용 StackGres PostgreSQL의 `opensphere_opa_decision_log` 테이블에 저장합니다. sink는 원문 input이 남은 batch를 거부하고, 보존기간은 30일입니다.

Allow/Deny 결과는 sink가 제공하는 제한된 Prometheus outcome 차원으로 집계합니다. subject, resource, JWT, input 원문과 decision ID는 metric label로 사용하지 않습니다.

## 5. 가용성과 Monitoring
OPA와 control service는 각각 2 replicas, PDB `minAvailable: 1`, topology spread와 anti-affinity를 사용합니다. ServiceMonitor는 OPA와 durable sink를 15초마다 수집하며 PrometheusRule은 target down, PostgreSQL 저장 실패와 원문 input 거부를 경보합니다.

Console Monitoring은 최근 1시간, 60초 query step, 15초 화면 갱신 기준이며 Carbon Charts로 평가 처리량, p95 지연, HTTP 오류율, Go runtime과 durable Allow/Deny 비율을 표시합니다.

## 6. 복구
정책 rollback은 검증된 Control Plane exact digest와 bundle revision으로 수행합니다. Decision log 복구는 StackGres backup plan을 따르며, OPA 인증서는 cert-manager가 자동 회전합니다.

## 7. 참고
- https://www.openpolicyagent.org/docs/security
- https://www.openpolicyagent.org/docs/monitoring
- https://www.openpolicyagent.org/docs/management-bundles
- https://www.openpolicyagent.org/docs/management-decision-logs
