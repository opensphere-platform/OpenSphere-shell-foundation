import { HostedPlugin } from './hosted-plugin';
import { POSTGRES_LEVEL_SURFACE, REQUIRED_POSTGRES_LEVEL_CAPABILITIES, verifyPluginSurface } from './plugin-surface.contract';

const PG_SURFACE = { standard: POSTGRES_LEVEL_SURFACE, capabilities: REQUIRED_POSTGRES_LEVEL_CAPABILITIES } as const;

// 선언형 SoT — hostRef=foundation으로 귀속된 plugin 매니페스트. 하드코딩 MODULES 배열을 대체.
// 형태가 '관리 대상(kind/hostRef/capability/healthRef/lifecycle)'이지 'id+name+icon 메뉴'가 아니다.
// 진화(후속): controller registry(/api/.../registrations?hostRef=foundation)에서 hydrate.
export const FOUNDATION_PLUGINS: HostedPlugin[] = [
  {
    id: 'postgres', name: 'PostgreSQL', icon: 'db', kind: 'plugin', hostRef: 'foundation',
    capability: 'data.sql.postgres', capabilityLabel: '관계형 DB',
    desc: '공용 관계형 데이터베이스 capability · CloudNativePG. PostgresClaim으로 전용 DB 발급.',
    consumePoint: 'foundation-data-pg-rw.opensphere-foundation.svc:5432',
    healthRef: 'cnpg', model: 'data', view: { module: 'postgres' },
    surface: PG_SURFACE,
    activation: { packageId: 'postgres', element: 'osp-foundation-postgres' },
  },
  {
    id: 'psmdb', name: 'Percona PSMDB', icon: 'db', kind: 'plugin', hostRef: 'foundation',
    capability: 'data.document.mongodb', capabilityLabel: '문서 DB',
    desc: 'MongoDB 호환 문서 데이터베이스 capability · Percona Operator 기반 ReplicaSet.',
    consumePoint: 'foundation-data-mongodb-rs0.opensphere-foundation.svc:27017',
    healthRef: 'data-engine', model: 'data', dataEngineId: 'psmdb', view: { module: 'psmdb' },
    surface: PG_SURFACE,
    activation: { packageId: 'percona-psmdb', element: 'osp-foundation-percona-psmdb' },
  },
  {
    id: 'valkey', name: 'Valkey', icon: 'db', kind: 'plugin', hostRef: 'foundation',
    capability: 'data.cache.valkey', capabilityLabel: '캐시/키값 저장소',
    desc: 'Redis 호환 캐시 capability · AOF 영속화와 인증을 갖춘 Valkey.',
    consumePoint: 'foundation-data-valkey.opensphere-foundation.svc:6379',
    healthRef: 'data-engine', model: 'data', dataEngineId: 'valkey', view: { module: 'valkey' },
    surface: PG_SURFACE,
    activation: { packageId: 'valkey', element: 'osp-foundation-valkey' },
  },
  {
    id: 'opensearch', name: 'OpenSearch', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'data.search.opensearch', capabilityLabel: '검색/인덱스',
    desc: '공용 검색·인덱스 capability · OpenSearch. Help Center 종합검색의 백본.',
    consumePoint: 'opensphere-search.opensphere-foundation.svc:9200',
    healthRef: 'os', model: 'data', view: { module: 'opensearch' },
    surface: PG_SURFACE,
    activation: { packageId: 'opensearch', element: 'osp-foundation-opensearch' },
  },
  {
    id: 'rustfs', name: 'RustFS', icon: 'storage', kind: 'plugin', hostRef: 'foundation',
    capability: 'data.object.s3', capabilityLabel: '오브젝트 스토리지(S3)',
    desc: '공용 S3 호환 object storage capability · RustFS(MinIO 대안). 버킷·정적자산·백업 대상.',
    consumePoint: 'opensphere-rustfs.opensphere-foundation.svc:9000',
    healthRef: 'rustfs', model: 'data', view: { module: 'rustfs' },
    surface: PG_SURFACE,
    activation: { packageId: 'rustfs', element: 'osp-foundation-rustfs' },
  },
  // 2026-07-06(Samba-AD 편입): identity 엔진 2종의 consumePoint를 control-plane identity 번들 실물
  // (foundation-identity-*)로 정합 — 실물은 FoundationModel(identity) CR → reconciler(SSA)가 만든다.
  {
    id: 'keycloak', name: 'Keycloak', icon: 'key', kind: 'plugin', hostRef: 'foundation',
    capability: 'identity.iam.workspace', capabilityLabel: '신원/SSO (IAM)',
    desc: 'workspace/사원 IAM·SSO capability · Keycloak(identity 번들 D-3, start-dev). Samba-AD LDAP federation. (Kanidm 콘솔과 무관)',
    consumePoint: 'foundation-identity-keycloak.opensphere-foundation.svc:8080',
    healthRef: 'keycloak', model: 'identity', view: { module: 'keycloak' },
    surface: PG_SURFACE,
    activation: { packageId: 'keycloak', element: 'osp-foundation-keycloak' },
  },
  {
    id: 'samba', name: 'Samba-AD', icon: 'users', kind: 'plugin', hostRef: 'foundation',
    capability: 'identity.directory.ad', capabilityLabel: '디렉터리 (AD/LDAP)',
    desc: 'workspace/사원 디렉터리 capability · Samba AD DC(identity 번들, engines.samba 설치옵션). Keycloak이 LDAP(389)로 federation.',
    consumePoint: 'foundation-identity-samba.opensphere-foundation.svc:389',
    healthRef: 'samba', model: 'identity', view: { module: 'addc' },
    surface: PG_SURFACE,
    activation: { packageId: 'samba-ad', element: 'osp-samba-ad' },
  },
  {
    id: 'syncope', name: 'Apache Syncope', icon: 'users', kind: 'plugin', hostRef: 'foundation',
    capability: 'identity.iga.syncope', capabilityLabel: 'IGA / SCIM',
    desc: 'Workforce IGA 단일 권위와 SCIM 2.0 프로비저닝 capability.', consumePoint: 'foundation-identity-syncope.opensphere-foundation.svc:8080',
    healthRef: 'declared', model: 'identity', view: { module: 'syncope' }, surface: PG_SURFACE,
    activation: { packageId: 'apache-syncope', element: 'osp-foundation-apache-syncope', installModule: 'syncope' },
  },
  {
    id: 'opa', name: 'Open Policy Agent', icon: 'key', kind: 'plugin', hostRef: 'foundation',
    capability: 'identity.policy.opa', capabilityLabel: 'Policy Decision',
    desc: 'Rego 기반 정책 결정점과 정책 bundle 배포 capability.', consumePoint: 'foundation-identity-opa.opensphere-foundation.svc:8181',
    healthRef: 'declared', model: 'identity', view: { module: 'opa' }, surface: PG_SURFACE,
    activation: { packageId: 'opa', element: 'osp-foundation-opa', installModule: 'opa' },
  },
  {
    id: 'litellm', name: 'LiteLLM', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'ai.gateway.litellm', capabilityLabel: 'LLM Gateway',
    desc: '다중 모델 공급자를 단일 OpenAI 호환 API로 제공하는 LLM gateway.', consumePoint: 'foundation-ai-litellm.opensphere-foundation.svc:4000',
    healthRef: 'declared', model: 'ai', view: { module: 'litellm' }, surface: PG_SURFACE,
    activation: { packageId: 'litellm', element: 'osp-foundation-litellm', installModule: 'litellm' },
  },
  {
    id: 'langfuse', name: 'Langfuse', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'ai.observability.langfuse', capabilityLabel: 'LLM Observability',
    desc: 'LLM trace·평가·비용 관측 capability.', consumePoint: 'foundation-ai-langfuse.opensphere-foundation.svc:3000',
    healthRef: 'declared', model: 'ai', view: { module: 'langfuse' }, surface: PG_SURFACE,
    activation: { packageId: 'langfuse', element: 'osp-foundation-langfuse', installModule: 'langfuse' },
  },
  {
    id: 'stalwart', name: 'Stalwart Mail Server', icon: 'users', kind: 'plugin', hostRef: 'foundation',
    capability: 'communication.mail.stalwart', capabilityLabel: 'Mail / JMAP',
    desc: 'SMTP·IMAP·JMAP 메일 백본 capability.', consumePoint: 'foundation-communication-stalwart.opensphere-foundation.svc:8080',
    healthRef: 'declared', model: 'communication', view: { module: 'stalwart' }, surface: PG_SURFACE,
    activation: { packageId: 'stalwart', element: 'osp-foundation-stalwart', installModule: 'stalwart' },
  },
  {
    id: 'novu', name: 'Novu', icon: 'users', kind: 'plugin', hostRef: 'foundation',
    capability: 'communication.notify.novu', capabilityLabel: 'Notification',
    desc: 'Email·Chat·Push 통합 알림 orchestration capability.', consumePoint: 'foundation-communication-novu-api.opensphere-foundation.svc:3000',
    healthRef: 'declared', model: 'communication', view: { module: 'novu' }, surface: PG_SURFACE,
    activation: { packageId: 'novu', element: 'osp-foundation-novu', installModule: 'novu' },
  },
  {
    id: 'mattermost', name: 'Mattermost', icon: 'users', kind: 'plugin', hostRef: 'foundation',
    capability: 'communication.collaboration.mattermost', capabilityLabel: 'Collaboration',
    desc: '팀 협업·ChatOps channel capability.', consumePoint: 'foundation-communication-mattermost.opensphere-foundation.svc:8065',
    healthRef: 'declared', model: 'communication', view: { module: 'mattermost' }, surface: PG_SURFACE,
    activation: { packageId: 'mattermost', element: 'osp-foundation-mattermost', installModule: 'mattermost' },
  },
  {
    id: 'otel', name: 'OpenTelemetry Collector', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'observability.collector.otel', capabilityLabel: 'Telemetry Collector',
    desc: 'Foundation 공용 OTLP 수집·처리·내보내기 capability.', consumePoint: 'foundation-observability-collector.opensphere-foundation.svc:4317',
    healthRef: 'declared', model: 'observability', view: { module: 'otel' }, surface: PG_SURFACE,
    activation: { packageId: 'opentelemetry', element: 'osp-foundation-opentelemetry', installModule: 'otel' },
  },
  {
    id: 'tempo', name: 'Grafana Tempo', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'observability.tracing.tempo', capabilityLabel: 'Trace Store',
    desc: '분산 trace 저장·조회 capability.', consumePoint: 'foundation-observability-tempo.opensphere-foundation.svc:3200',
    healthRef: 'declared', model: 'observability', view: { module: 'tempo' }, surface: PG_SURFACE,
    activation: { packageId: 'grafana-tempo', element: 'osp-foundation-grafana-tempo', installModule: 'tempo' },
  },
  {
    id: 'loki', name: 'Grafana Loki', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'observability.logs.loki', capabilityLabel: 'Log Store',
    desc: 'Foundation 로그 집계·보존·조회 capability.', consumePoint: 'foundation-observability-loki.opensphere-foundation.svc:3100',
    healthRef: 'declared', model: 'observability', view: { module: 'loki' }, surface: PG_SURFACE,
    activation: { packageId: 'grafana-loki', element: 'osp-foundation-grafana-loki', installModule: 'loki' },
  },
  {
    id: 'grafana-operator', name: 'Grafana Operator', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'observability.dashboard.grafana', capabilityLabel: 'Dashboard',
    desc: 'Grafana instance·datasource·dashboard 선언 capability.', consumePoint: 'foundation-observability-grafana.opensphere-foundation.svc:3000',
    healthRef: 'declared', model: 'observability', view: { module: 'grafana-operator' }, surface: PG_SURFACE,
    activation: { packageId: 'grafana-operator', element: 'osp-foundation-grafana-operator', installModule: 'grafana-operator' },
  },
  {
    id: 'ptm', name: '.ptm / Velero', icon: 'storage', kind: 'plugin', hostRef: 'foundation',
    capability: 'backup.snapshot.ptm', capabilityLabel: 'Backup / Restore',
    desc: 'Velero 기반 백업과 OpenSphere 동일시점 .ptm 복구 capability.', consumePoint: 'foundation-backup-velero.opensphere-foundation.svc:8085',
    healthRef: 'declared', model: 'backup', view: { module: 'ptm' }, surface: PG_SURFACE,
    activation: { packageId: 'ptm', element: 'osp-foundation-ptm', installModule: 'ptm' },
  },
  {
    id: 'argocd', name: 'Argo CD / ApplicationSet', icon: 'storage', kind: 'plugin', hostRef: 'foundation',
    capability: 'delivery.gitops.argocd', capabilityLabel: 'GitOps Delivery',
    desc: '서명된 desired state를 target cluster에 동기화하는 GitOps write-path.', consumePoint: 'argocd-server.opensphere-foundation.svc:443',
    healthRef: 'declared', model: 'delivery', view: { module: 'delivery' }, surface: PG_SURFACE,
    activation: { packageId: 'argocd', element: 'osp-foundation-argocd', installModule: 'delivery', installTab: 'argocd' },
  },
  {
    id: 'crossplane', name: 'Crossplane', icon: 'storage', kind: 'plugin', hostRef: 'foundation',
    capability: 'delivery.provisioning.crossplane', capabilityLabel: 'Provisioning Adapter',
    desc: 'Provider 기반 외부 managed resource provisioning adapter.', consumePoint: 'crossplane-webhooks.opensphere-foundation.svc:9443',
    healthRef: 'declared', model: 'delivery', view: { module: 'delivery' }, surface: PG_SURFACE,
    activation: { packageId: 'crossplane', element: 'osp-foundation-crossplane', installModule: 'delivery', installTab: 'crossplane' },
  },
];

FOUNDATION_PLUGINS.forEach((plugin) => verifyPluginSurface(plugin.id, plugin.surface));
