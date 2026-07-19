export type DataEngineId = 'psmdb' | 'valkey' | 'rustfs' | 'opensearch';
export type WorkloadKind = 'psmdb' | 'statefulset';

export interface EngineVersion {
  value: string;
  label: string;
  channel: 'stable' | 'candidate' | 'edge';
}

export interface DataEngineSpec {
  id: DataEngineId;
  name: string;
  capability: string;
  provider: string;
  logo: string;
  description: string;
  docs: string;
  manualId: string;
  workloadKind: WorkloadKind;
  workloadName: string;
  namespace: string;
  endpoint: string;
  port: number;
  versions: EngineVersion[];
  defaultVersion: string;
  defaultStorage: string;
  defaultReplicas: number;
  operator?: {
    name: string;
    namespace: string;
    deployment: string;
    crd: string;
    chart: string;
    chartVersion: string;
    repository: string;
  };
  claims: { name: string; status: 'available' | 'planned'; description: string }[];
  policies: { name: string; description: string }[];
  hostPrerequisites?: string[];
}

const LOGO = 'https://logos.opl.io.kr/i';

export const DATA_ENGINE_SPECS: Record<DataEngineId, DataEngineSpec> = {
  psmdb: {
    id: 'psmdb', name: 'Percona PSMDB', capability: 'data.document.mongodb', provider: 'Percona Operator for MongoDB',
    logo: `${LOGO}/percona`, docs: 'https://docs.percona.com/percona-operator-for-mongodb/', manualId: 'percona-psmdb-operations-ko',
    description: 'MongoDB 호환 문서 데이터베이스. Operator와 ReplicaSet을 한 plugin 수명주기로 설치하고 운영합니다.',
    workloadKind: 'psmdb', workloadName: 'foundation-data-mongodb', namespace: 'opensphere-foundation',
    endpoint: 'foundation-data-mongodb-rs0.opensphere-foundation.svc', port: 27017,
    versions: [
      { value: '8.0', label: 'Percona Server for MongoDB 8.0 · stable', channel: 'stable' },
      { value: '7.0', label: 'Percona Server for MongoDB 7.0 · maintained', channel: 'stable' },
    ],
    defaultVersion: '8.0', defaultStorage: '20Gi', defaultReplicas: 3,
    operator: {
      name: 'Percona Operator for MongoDB', namespace: 'psmdb-operator', deployment: 'psmdb-operator',
      crd: 'perconaservermongodbs.psmdb.percona.com', chart: 'psmdb-operator', chartVersion: '1.22.0',
      repository: 'https://percona.github.io/percona-helm-charts/',
    },
    claims: [{ name: 'DocumentDatabaseClaim', status: 'planned', description: '앱별 database/user/Secret 발급 계약' }],
    policies: [
      { name: 'TLS', description: 'Operator 관리 TLS와 내부 전용 Service' },
      { name: 'Backup', description: 'PBM 기반 S3 백업과 restore 검증' },
      { name: 'Upgrade', description: 'Operator SmartUpdate와 major 변경 승인' },
    ],
    hostPrerequisites: ['Percona Operator 1.22.0', 'RWO PersistentVolume', '운영 profile은 3 replicas 권장'],
  },
  valkey: {
    id: 'valkey', name: 'Valkey', capability: 'data.cache.valkey', provider: 'Foundation Control Plane',
    logo: `${LOGO}/valkey`, docs: 'https://valkey.io/topics/', manualId: 'valkey-operations-ko',
    description: 'Redis 호환 인메모리 데이터 저장소. 인증, AOF 영속화, 복제 토폴로지와 소비자 연결을 관리합니다.',
    workloadKind: 'statefulset', workloadName: 'foundation-data-valkey', namespace: 'opensphere-foundation',
    endpoint: 'foundation-data-valkey.opensphere-foundation.svc', port: 6379,
    versions: [
      { value: '9.1.0', label: 'Valkey 9.1.0 · stable', channel: 'stable' },
      { value: '9.0.4', label: 'Valkey 9.0.4 · maintained', channel: 'stable' },
    ],
    defaultVersion: '9.1.0', defaultStorage: '10Gi', defaultReplicas: 1,
    claims: [{ name: 'CacheClaim', status: 'planned', description: '앱별 key prefix/ACL/Secret 발급 계약' }],
    policies: [
      { name: 'Persistence', description: 'AOF everysec + PVC' },
      { name: 'Authentication', description: '기존 Secret 참조, 평문 자격 저장 금지' },
      { name: 'Exposure', description: 'ClusterIP 전용, 직접 외부 공개 금지' },
    ],
    hostPrerequisites: ['RWO PersistentVolume', '메모리 overcommit 검토'],
  },
  rustfs: {
    id: 'rustfs', name: 'RustFS', capability: 'data.object.s3', provider: 'Foundation Control Plane',
    logo: `${LOGO}/rustfs`, docs: 'https://docs.rustfs.com/', manualId: 'rustfs-operations-ko',
    description: 'S3 호환 오브젝트 스토리지. 데이터 PVC, 자격 Secret, 버킷 소비 계약과 백업 대상을 관리합니다.',
    workloadKind: 'statefulset', workloadName: 'opensphere-rustfs', namespace: 'opensphere-foundation',
    endpoint: 'opensphere-rustfs.opensphere-foundation.svc', port: 9000,
    versions: [
      { value: '1.0.0-beta.10', label: 'RustFS 1.0.0-beta.10 · candidate', channel: 'candidate' },
      { value: '1.0.0-beta.8', label: 'RustFS 1.0.0-beta.8 · rollback', channel: 'candidate' },
    ],
    defaultVersion: '1.0.0-beta.10', defaultStorage: '50Gi', defaultReplicas: 1,
    claims: [{ name: 'BucketClaim', status: 'planned', description: '앱별 bucket/access key/policy 발급 계약' }],
    policies: [
      { name: 'Credentials', description: '기존 Secret 참조와 키 회전' },
      { name: 'Durability', description: '개발 single-node, 운영 distributed profile' },
      { name: 'Console', description: '관리 UI는 기본 ClusterIP; 공개 시 OIDC ingress' },
    ],
    hostPrerequisites: ['RWO PersistentVolume', '운영 profile은 4개 이상 PVC 권장'],
  },
  opensearch: {
    id: 'opensearch', name: 'OpenSearch', capability: 'data.search.opensearch', provider: 'Foundation Control Plane',
    logo: `${LOGO}/opensearch`, docs: 'https://docs.opensearch.org/latest/', manualId: 'opensearch-operations-ko',
    description: '검색·벡터·인덱스 capability. 노드/샤드/인덱스/템플릿/스냅샷과 소비 계약을 운영합니다.',
    workloadKind: 'statefulset', workloadName: 'opensphere-search', namespace: 'opensphere-foundation',
    endpoint: 'opensphere-search.opensphere-foundation.svc', port: 9200,
    versions: [
      { value: '3.7.0', label: 'OpenSearch 3.7.0 · stable', channel: 'stable' },
      { value: '2.19.6', label: 'OpenSearch 2.19.6 · maintained LTS line', channel: 'stable' },
      { value: '2.17.0', label: 'OpenSearch 2.17.0 · legacy', channel: 'candidate' },
    ],
    defaultVersion: '3.7.0', defaultStorage: '50Gi', defaultReplicas: 1,
    claims: [{ name: 'OpenSearchIndexClaim', status: 'planned', description: '앱별 index/template/role 발급 계약' }],
    policies: [
      { name: 'Heap', description: '메모리 limit의 약 50%로 Xms/Xmx 고정' },
      { name: 'Snapshots', description: 'S3 repository + restore drill' },
      { name: 'Security', description: '운영 profile에서 TLS/auth 필수' },
    ],
    hostPrerequisites: ['vm.max_map_count ≥ 262144', 'RWO PersistentVolume', '운영 profile은 전용 data node 권장'],
  },
};
