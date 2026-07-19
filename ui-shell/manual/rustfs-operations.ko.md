# OpenSphere RustFS 플러그인 설치 및 운영 안내서

## 1. 역할
S3 호환 오브젝트 스토리지 capability입니다. plugin 번들, 매뉴얼 이미지, 정적 자산과 백업 대상 버킷을 제공합니다.

## 2. 설치 순서
버전, profile, replica, StorageClass와 PVC를 선택하고 기존 자격 Secret을 연결합니다. 개발은 single-node를 허용하지만 운영은 distributed profile과 장애 도메인을 요구합니다.

## 3. 운영 확인
S3 API는 `opensphere-rustfs.opensphere-foundation.svc:9000`, 관리 UI는 9001입니다. Pod Ready, PVC, 용량, 이벤트와 endpoint를 확인합니다.

## 4. 보호와 보안
관리 UI는 ClusterIP가 기본이며 외부 공개 시 TLS, OIDC와 접근 정책 승인이 필요합니다. 자격 값은 SecretRef로만 관리하고 bucket/versioning/lifecycle 정책을 별도 검증합니다.

## 5. 업그레이드
데이터 형식, erasure layout과 rollback 지원을 확인한 뒤 서명 BOM 버전만 적용합니다.

## 6. 참고
- https://docs.rustfs.com/

