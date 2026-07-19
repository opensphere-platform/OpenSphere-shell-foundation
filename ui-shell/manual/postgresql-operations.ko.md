# OpenSphere PostgreSQL 19 플러그인 설치 및 운영 안내서

이 문서는 OpenSphere Platform Foundation Service Stack(PFS)의 PostgreSQL 플러그인을 이용해 CloudNativePG Operator와 PostgreSQL 19 Cluster를 설치하고 운영하는 관리자를 위한 한글 안내서다. 문서와 기본 설치 화면은 PostgreSQL 19 beta를 기준으로 하며 이전 major 버전 선택지는 제공하지 않는다.

> PostgreSQL 19는 현재 개발 단계의 beta 버전이다. OpenSphere 개발·검증의 기본값은 19이지만, 운영 승격 전에는 PostgreSQL 19 정식 릴리스와 사용 중인 CloudNativePG 버전의 지원 여부를 다시 확인해야 한다.

## 1. 플러그인이 관리하는 범위

PostgreSQL 플러그인은 다음 두 단계를 하나의 관리 화면에서 처리한다.

1. CloudNativePG Operator 준비: `cnpg-system` 네임스페이스의 Operator와 CRD 준비 상태를 확인하고, 필요하면 승인된 Helm 경로로 설치한다.
2. PostgreSQL Cluster 관리: `postgresql.cnpg.io/v1`의 `Cluster` 선언을 생성하고 인스턴스, 스토리지, 백업, 접속, 관측과 업그레이드를 관리한다.

Operator는 PostgreSQL 플러그인의 내부 실행 기반이며 별도 PFS 플러그인으로 계산하지 않는다. PostgreSQL Cluster가 실제 Data Plane 서비스다.

## 2. 설치 전 확인

관리자는 Cluster 생성 전에 다음 항목을 확인한다.

- PFS Control Plane이 Ready 상태인가.
- CloudNativePG Operator와 필수 CRD가 Ready 상태인가.
- 선택할 StorageClass가 원하는 내구성, 확장 가능 여부와 reclaim 정책을 제공하는가.
- 운영 환경이면 단일 노드 로컬 스토리지가 아닌 장애 도메인을 고려한 영구 스토리지를 사용하는가.
- 백업을 사용할 경우 S3 호환 Object Storage, 대상 경로와 인증 Secret이 준비되었는가.
- 모니터링을 사용할 경우 Prometheus Operator가 `PodMonitor`를 수집할 수 있는가.

OpenSphere의 `Development` 프로파일은 기능 검증을 위한 단일 인스턴스 구성을 허용한다. 운영 서비스에는 복수 인스턴스, 외부 백업과 복구 시험을 포함한 `Production HA` 또는 승인된 사용자 정의 프로파일을 사용한다.

## 3. 설치 절차

### 3.1 Operator 준비

1. PostgreSQL 화면에서 **Operator 준비**를 선택한다.
2. 설치할 CloudNativePG chart와 app 버전을 확인한다.
3. **Operator 설치**를 실행한다.
4. Deployment Ready 수와 CRD 확인 결과가 모두 정상인지 확인한다.

Operator 업그레이드는 관리 중인 PostgreSQL 인스턴스의 rolling update와 primary 전환을 유발할 수 있다. 적용 전에 CloudNativePG 릴리스 노트와 현재 Cluster의 `primaryUpdateStrategy`를 확인한다.

### 3.2 PostgreSQL Cluster 생성

1. **Cluster 생성**에서 운영 프로파일과 PostgreSQL 19 beta 이미지를 확인한다.
2. 인스턴스 수, CPU와 메모리 프로파일을 설정한다.
3. StorageClass와 data/WAL 용량을 설정한다.
4. 모니터링, PgBouncer, superuser 외부 접근과 S3 연속 백업 정책을 검토한다.
5. **PostgreSQL Cluster 생성**을 실행한다.
6. Topology에서 모든 인스턴스가 Ready이고 Primary가 하나인지 확인한다.

기본 이미지는 CloudNativePG PostgreSQL 19 beta의 승인된 `standard-trixie` 변형이다. 임의의 컨테이너 태그를 직접 입력하지 않고 OpenSphere BOM과 화면의 승인된 선택 목록을 사용한다.

## 4. 접속과 권한

CloudNativePG가 생성한 애플리케이션용 Secret과 read/write 또는 read-only Service를 사용한다. 애플리케이션은 `postgres` superuser 계정을 기본 접속 계정으로 사용하지 않는다.

- 데이터베이스와 역할은 PostgreSQL 화면의 **Databases**에서 관리한다.
- 애플리케이션별 역할에는 필요한 데이터베이스와 스키마 권한만 부여한다.
- 외부 접속이 필요하면 Service 노출, NetworkPolicy, TLS와 인증서 신뢰를 함께 설계한다.
- 화면, ConfigMap, 로그나 Git에 비밀번호와 Secret 원문을 기록하지 않는다.

## 5. 스토리지 운영

PostgreSQL data volume과 선택적 WAL volume은 PVC에 저장한다. StorageClass는 PVC가 생성된 뒤 단순 변경할 수 있는 값이 아니다.

- 용량 증설은 StorageClass의 `allowVolumeExpansion`과 CSI 기능을 확인한 뒤 수행한다.
- StorageClass 변경은 새 Cluster 또는 새 PVC로 데이터를 이관하는 작업으로 계획한다.
- reclaim 정책이 `Delete`이면 PVC 삭제 시 실제 volume이 함께 삭제될 수 있다.
- 로컬 provisioner는 노드 장애 시 자동 복구와 재배치가 제한될 수 있으므로 운영 내구성 요건을 별도로 검증한다.

## 6. 백업과 복구

운영 환경은 Cluster Ready만으로 완료가 아니다. Object Storage 또는 지원되는 volume snapshot을 사용한 백업과 실제 복구 시험이 필요하다.

OpenSphere 화면에서 S3 연속 백업을 켤 때 다음 값을 검증한다.

- S3 endpoint와 destination path
- 인증 정보를 가진 Kubernetes Secret
- retention policy
- WAL archive 상태와 마지막 성공 시각
- 정기 base backup 또는 ScheduledBackup 정책

복구 목표는 RPO와 RTO로 정의한다. 백업 성공 표시만 확인하지 말고 별도 Cluster로 Point-In-Time Recovery 또는 지정 시점 복구를 정기적으로 시험한다.

## 7. 관측과 장애 대응

Topology, Events와 모니터링 지표를 함께 확인한다.

- 인스턴스 Ready 수와 Primary 위치
- replication 지연과 WAL archive 실패
- PVC 용량과 filesystem 사용률
- 재시작, failover, switchover 이벤트
- 연결 수, 장기 실행 쿼리와 lock 대기
- 백업 마지막 성공 시각

Primary 장애 시 Operator가 승격을 수행하더라도 원인 분석 전에 리소스를 임의 삭제하지 않는다. 먼저 Events, Pod 상태, PVC 연결, 노드 상태와 Operator 로그를 수집한다.

## 8. 업그레이드

### PostgreSQL 19 beta/정식 릴리스 갱신

PostgreSQL 19 beta 갱신과 향후 19 정식 릴리스 전환은 승인된 이미지 참조 변경으로 처리한다. 적용 전 CloudNativePG 지원 여부, 릴리스 노트, 백업 상태와 replica 건강성을 확인한다.

### Major upgrade

PostgreSQL 19 이후의 major upgrade는 저장 형식과 extension 호환성을 포함한 별도 변경 작업이다. 테스트 환경에서 다음 중 승인된 방식을 검증한다.

- 논리 dump/restore를 이용한 blue/green 전환
- 논리 replication을 이용한 온라인 전환
- CloudNativePG가 지원하는 `pg_upgrade` 기반 오프라인 in-place upgrade

사용 중인 extension과 기반 OS 계열의 호환성을 반드시 확인한다. production에서 major 버전 선택만 바꾸어 즉시 적용하지 않는다.

## 9. 삭제

Cluster 삭제 전 다음 사항을 확인한다.

1. 최종 백업과 복구 검증이 완료되었는가.
2. PVC와 object backup의 보존 또는 삭제 정책이 승인되었는가.
3. 애플리케이션 연결이 새 대상 또는 중단 상태로 전환되었는가.
4. 감사 기록에 대상, 승인자와 데이터 처분 결과가 남았는가.

Operator는 다른 PostgreSQL Cluster가 사용 중이면 삭제하지 않는다. Operator와 Cluster의 수명주기는 분리해서 판단한다.

## 10. 공식 참고 문서

이 한글 문서는 OpenSphere의 설치·운영 계약을 설명한다. 엔진과 Operator의 세부 사양은 아래 공식 문서를 함께 확인한다.

- PostgreSQL 19 beta 문서: https://www.postgresql.org/docs/19/
- CloudNativePG 현재 문서: https://cloudnative-pg.io/documentation/current/
- CloudNativePG 설치와 업그레이드: https://cloudnative-pg.io/documentation/current/installation_upgrade/
- CloudNativePG PostgreSQL 업그레이드: https://cloudnative-pg.io/documentation/current/postgres_upgrades/
- CloudNativePG 백업: https://cloudnative-pg.io/documentation/current/backup/

OpenSphere 화면의 값과 외부 문서가 충돌하면 설치된 OpenSphere BOM, 실제 Cluster 상태, PostgreSQL 19 문서와 해당 beta/정식 릴리스 노트를 기준으로 변경 계획을 다시 검토한다.
