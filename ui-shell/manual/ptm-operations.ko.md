# OpenSphere .ptm 보호 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. Velero를 실행 기반으로 PFS 데이터의 BackupPolicy, BackupRun과 RestoreRequest를 관리합니다.

## 2. 전제조건
S3 capability, CSI snapshot, 영구 감사와 복구 승인 정책이 필요합니다.

## 3. 설치·운영 계약
Velero/controller, object-store plugin, snapshot support와 검증 job의 버전·digest·리소스를 확정합니다. RPO/RTO, 최근 백업, 검증 복구와 이벤트를 실제 상태로 표시해야 합니다.

## 4. 보호
불변 백업, 자격 Secret 회전, 별도 장애 도메인과 정기 restore drill을 요구합니다.

## 5. 현재 제한
ProtectionBinding과 승인 workflow가 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://velero.io/docs/

