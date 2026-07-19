# OpenSphere Crossplane Delivery 플러그인 설치 및 운영 안내서

## 1. 역할
GitOps 기본 write-path와 병행하는 선택적 provisioning adapter입니다. 승인된 Provider와 managed Release만 관리합니다.

## 2. 설치·운영 확인
Crossplane core, RBAC manager, Provider installed/healthy condition, ProviderConfig와 Release Ready를 확인합니다. 무단 core 재설치 기능은 제공하지 않습니다.

## 3. 소비 계약
Foundation plugin은 provider-helm Release를 사용하고 외부 managed resource는 승인된 Provider CR을 사용합니다. GitOps와 field ownership을 분리합니다.

## 4. 보호와 업그레이드
Provider allowlist, SecretRef, composition/CRD migration과 rollback 증거가 필요합니다. Provider major upgrade는 관리 리소스 회수 정책을 검증한 뒤 진행합니다.

## 5. 문제 해결
Provider Installed/Healthy, ProviderConfig, controller 로그, Release condition과 Kubernetes Event 순으로 확인합니다.

## 6. 참고
- https://docs.crossplane.io/

