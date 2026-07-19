# OpenSphere Percona PSMDB 플러그인 설치 및 운영 안내서

## 1. 역할
Percona Server for MongoDB 기반 문서 데이터베이스 capability입니다. PFS Control Plane이 Percona Operator와 `PerconaServerMongoDB/foundation-data-mongodb`의 선언 상태를 관리합니다.

## 2. 설치 순서
1. PFS Control Plane과 provider-helm을 확인합니다.
2. Percona Operator 1.22.0과 CRD 준비 상태를 확인합니다.
3. 버전, ReplicaSet 수, StorageClass, PVC 용량과 리소스를 선택합니다.
4. Production은 3 replica, TLS, S3/PBM 백업을 승인한 뒤 적용합니다.

## 3. 운영 확인
Topology에서 CR, Pod, 노드, 이미지와 재시작 수를 확인하고 Events의 Warning을 우선 처리합니다. 서비스 소비점은 `foundation-data-mongodb-rs0.opensphere-foundation.svc:27017`입니다.

## 4. 보호와 업그레이드
major 변경 전 PBM 백업과 restore drill이 필요합니다. StorageClass 변경은 새 PVC 마이그레이션으로 처리하며 Secret 값은 화면이나 FoundationModel에 저장하지 않습니다.

## 5. 문제 해결
Operator 미준비, PVC Pending, TLS Secret, ReplicaSet quorum, Pod 이벤트 순으로 확인합니다.

## 6. 참고
- https://docs.percona.com/percona-operator-for-mongodb/

