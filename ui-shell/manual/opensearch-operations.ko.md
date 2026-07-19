# OpenSphere OpenSearch 플러그인 설치 및 운영 안내서

## 1. 역할
통합 검색, vector retrieval, 인덱스와 로그 검색을 제공하는 PFS 검색 capability입니다.

## 2. 설치 순서
PFS Control Plane, `vm.max_map_count`, StorageClass를 확인하고 버전, 노드 수, heap, PVC, TLS/auth와 snapshot 정책을 설정합니다. 소비점은 `opensphere-search.opensphere-foundation.svc:9200`입니다.

## 3. 운영 확인
Topology와 전용 관리 화면에서 cluster health, 노드, active shard 비율, 인덱스, 문서 수, template, task와 event를 확인합니다.

## 4. 보호와 업그레이드
운영 profile은 TLS/auth를 필수로 하고 S3 snapshot과 restore drill을 갖춰야 합니다. major 변경은 index compatibility와 rolling-upgrade 경로를 검토합니다.

## 5. 문제 해결
heap 압력, unassigned shard, disk watermark, PVC, 보안 plugin 설정과 Kubernetes Event 순으로 확인합니다.

## 6. 참고
- https://docs.opensearch.org/latest/

