# OpenSphere Valkey 플러그인 설치 및 운영 안내서

## 1. 역할
Redis 호환 캐시·키값 저장 capability입니다. Foundation Control Plane이 StatefulSet, ClusterIP Service, PVC와 Secret 참조를 관리합니다.

## 2. 설치 순서
버전과 profile을 선택하고 replica, StorageClass, PVC, 메모리 한도, AOF 정책과 기존 자격 Secret을 검증합니다. Production은 복제 토폴로지와 장애 전환 정책이 확정되기 전 단일 replica로 승인하지 않습니다.

## 3. 운영 확인
`foundation-data-valkey.opensphere-foundation.svc:6379`가 내부 소비점입니다. Topology에서 Pod Ready, 노드, 재시작, 이미지와 PVC를 확인합니다.

## 4. 보호와 업그레이드
AOF 영속화만으로 백업이 완결되지 않습니다. 외부 백업·복구 절차와 메모리 eviction 정책을 함께 검증하고 major 변경 전 호환성을 확인합니다.

## 5. 보안
ClusterIP 전용이며 인증 값은 SecretRef만 사용합니다. 생성된 자격 증명은 한 번만 표시합니다.

## 6. 참고
- https://valkey.io/topics/

