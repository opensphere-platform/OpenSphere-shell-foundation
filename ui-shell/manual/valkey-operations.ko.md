# OpenSphere Valkey 플러그인 설치 및 운영 안내서

## 1. 역할
Redis 호환 캐시·키값 저장 capability입니다. Foundation Control Plane이 StatefulSet, primary/read/headless Service, PVC, NetworkPolicy, Secret 참조, exporter와 ServiceMonitor를 하나의 수명주기로 관리합니다.

## 2. 설치 순서
1. Runtime 탭에서 Foundation Control Plane이 Ready인지 확인합니다.
2. Cluster plan에서 사람용 버전 `9.1.0`, 인스턴스, StorageClass, PVC, 자원, AOF/RDB, eviction과 Monitoring을 선택합니다.
3. Secret 생성/회전은 최근 MFA(AAL2)와 8자 이상의 작업 사유가 필요합니다. password는 한 번만 표시됩니다.
4. Development는 단일 primary, Replicated profile은 pod 0 primary와 두 read replica를 만듭니다. 현재 자동 장애조치는 제공하지 않으므로 HA로 간주하지 않습니다.

## 3. 운영 확인
- 쓰기: `foundation-data-valkey.opensphere-foundation.svc:6379`
- 읽기/발견: `foundation-data-valkey-read.opensphere-foundation.svc:6379`
- Pod 발견/메트릭: `foundation-data-valkey-headless.opensphere-foundation.svc`

Topology에서 primary/read replica, Pod Ready, 노드, 재시작, Service와 PVC를 확인합니다. Monitoring은 redis_exporter와 Prometheus의 최근 1시간 시계열을 10분 간격으로 표시하며, 메트릭 부재를 정상값 0으로 위장하지 않습니다.

## 4. 보호와 업그레이드
AOF/RDB와 PVC는 재시작 내구성을 제공하지만 백업을 완결하지 않습니다. 검증된 원격 백업 connector가 준비되기 전까지 Console은 백업 완료라고 표시하지 않습니다. major 변경 전 데이터 형식·복제·복구 호환성을 확인합니다.

## 5. 보안
ClusterIP 전용이며 인증 값은 exact SecretRef만 사용합니다. Keys & ACL 탭은 `SCAN`, 크기 제한 조회, string `SET`, `DEL`, TTL, 사전 정의 ACL profile만 허용합니다. 임의 명령, `FLUSH*`, script, `CONFIG SET`, raw terminal은 제공하지 않습니다. 변경은 console-admin, MFA(AAL2), 8자 이상의 작업 사유와 감사 이벤트를 요구합니다.

## 6. 참고
- https://valkey.io/topics/
