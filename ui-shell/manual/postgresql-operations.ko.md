# OpenSphere PostgreSQL 멀티 인스턴스 설치 및 운영 안내서

이 문서는 Platform Foundation Service Stack의 PostgreSQL 플러그인에서 Namespace별 전용 StackGres PostgreSQL을 설치하고 운영하는 관리자를 위한 안내서다. StackGres가 유일한 실행 엔진이며, 화면에 표시된 SGCluster와 PostgreSQL major 버전이 운영 정본이다.

## 1. 플러그인이 관리하는 범위

PostgreSQL 플러그인은 다음 범위를 하나의 Namespace-first 화면에서 제공한다.

1. Namespace와 PostgreSQL 인스턴스 선택
2. StackGres Operator 및 선택한 `SGCluster` 상태 확인
3. Topology, Configuration, Databases & Roles, Backups, Events, Claims 관리
4. Prometheus 기반 최근 1시간 운영 지표 확인
5. PostgresClaim과 AddOnPlan을 통한 전용 클러스터 수명주기 관리

각 인스턴스는 `provisioning.opensphere.io/v1beta1` PostgresClaim 하나에 독립 SGCluster, PVC, application role, database와 connection Secret을 할당한다.

## 2. 설치 전 확인

- Foundation Control Plane과 StackGres Operator가 Ready인가.
- 대상 Namespace와 StorageClass가 준비됐는가.
- 선택한 AddOnPlan의 인스턴스 수, CPU, 메모리, 저장공간과 PostgreSQL 버전이 요구사항에 맞는가.
- 운영 환경이면 백업 Object Storage와 실제 복구 시험 계획이 있는가.
- Prometheus Operator가 `PodMonitor`를 수집할 수 있는가.

Development 단일 인스턴스는 기능 검증용이다. 장애 내성이 필요한 서비스에는 2노드 Compact HA 또는 3노드 Production HA 계획과 외부 백업을 사용한다.

## 3. 전용 PostgreSQL 설치

1. 우측 상단에서 Namespace를 선택한다. 필요한 Namespace가 없으면 **추가**를 사용한다.
2. PostgreSQL이 없는 Namespace에서는 cluster name, database, application owner와 plan을 입력한다.
3. **PostgreSQL 설치**를 실행한다.
4. PostgresClaim이 Ready가 되고 전용 StackGres SGCluster가 생성될 때까지 진행 상태를 확인한다.
5. Topology에서 Primary와 모든 인스턴스가 Ready인지 확인한다.
6. Configuration에서 CPU, Memory, Storage, PostgreSQL 버전과 명시 파라미터를 확인한다.

설치와 변경은 PostgresClaim/AddOnPlan 선언을 통해 수행한다. 생성된 SGCluster나 하위 리소스를 화면 밖에서 임의 패치하지 않는다.

## 4. 접속과 권한

애플리케이션은 선택한 인스턴스의 binding Secret과 RW/RO Service를 사용한다. Secret 원문은 Console, 로그 또는 Git에 노출하지 않는다.

- StackGres 전용 인스턴스: `<cluster>-binding` 또는 화면에 표시된 application Secret
- 읽기/쓰기: `<cluster>.<namespace>.svc:5432`, 읽기 전용: `<cluster>-replicas.<namespace>.svc:5432`
- pgAdmin: 선택한 StackGres 인스턴스와 데이터베이스의 객체만 표시
- application owner: 필요한 database/schema 권한만 보유하고 superuser로 사용하지 않음

Claims 조회·생성은 Main Shell의 인증된 host API 경로와 사용자 권한 정책을 통과해야 한다.

## 5. 관측과 장애 대응

Overview와 Monitoring은 Kubernetes 상태와 Shared Observability Prometheus의 시계열을 함께 사용한다.

- 인스턴스 Ready 수와 Primary 위치
- 연결 수, commit/rollback, cache hit
- WAL 생성량과 replication lag
- CPU, memory와 PVC 사용률
- 재시작, failover와 Kubernetes Events

StackGres exporter가 활성화돼도 PodMonitor가 없거나 Prometheus target이 Down이면 시계열은 표시되지 않는다. 메트릭 부재를 정상값 0으로 해석하지 말고 PodMonitor, target, exporter endpoint 순서로 확인한다.

## 6. 백업과 복구

백업 미구성은 Development 계획에서 허용되는 명시적 상태일 수 있지만 운영 완료를 뜻하지 않는다. 운영 계획에서는 다음을 검증한다.

- Object Storage 또는 지원되는 volume snapshot
- retention과 schedule
- 마지막 성공 백업과 WAL archive 상태
- 별도 클러스터로의 실제 복구 시험
- 승인된 RPO/RTO와 삭제 전 최종 백업

백업·복원은 StackGres `SGBackup`과 plan의 선언형 수명주기에서 수행한다.

## 7. Configuration과 RBAC

Configuration은 선택한 SGCluster, SGPostgresConfig와 SGInstanceProfile을 읽는다. 값이 `—`이고 권한 경고가 나오면 `foundation-backing-read` 역할에 StackGres 리소스의 `get/list/watch`가 적용됐는지 확인한다.

필요한 대표 리소스는 `sgclusters`, `sgpgconfigs`, `sginstanceprofiles`, `sgbackups`, `sgscripts`다.

## 8. 업그레이드

현재 화면에 표시된 PostgreSQL major 버전과 StackGres 버전을 기준으로 계획한다.

- StackGres: PostgresClaim plan과 StackGres 수명주기
- 선행조건: StackGres 호환성, 백업·복구 지점, extension과 애플리케이션 호환성, rollback 증거

major 버전 선택만 바꿔 production에 즉시 적용하지 않는다. 별도 환경에서 복구 또는 blue/green 전환을 먼저 검증한다.

## 9. 삭제

삭제 전에 최종 백업, PVC/Object Storage 보존 정책, 애플리케이션 연결 전환과 감사 기록을 확인한다. `Retain` 정책의 데이터는 Claim 삭제 후에도 보존되며, `Delete`는 해당 Claim 소유 리소스를 회수한다.

## 10. 공식 참고 문서

- PostgreSQL 현재 문서: https://www.postgresql.org/docs/current/
- StackGres 현재 문서: https://stackgres.io/doc/latest/

외부 문서와 화면이 다르면 설치된 OpenSphere release, 선택한 실제 SGCluster와 화면의 StackGres/PostgreSQL 버전을 우선 확인한다.
