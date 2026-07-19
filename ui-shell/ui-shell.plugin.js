// ─────────────────────────────────────────────────────────────────────────
// Foundation — OpenSphere subShell 진입점 (SDK 표준 골격).
//   셸 계약: ESM activate/deactivate. light DOM. Angular Element <osp-foundation-shell>를 셸 본문에 주입.
//   server.js가 /api/k8s/* 프록시 + WS exec + /app(번들) 서빙.
// ─────────────────────────────────────────────────────────────────────────
const TAG = 'osp-foundation-shell'; // www/main.js(Angular Elements)가 customElements.define(TAG)
let injected = false;
let hostContextInstalled = false;
let activeContext;

const FOUNDATION_MANUALS = [
  ['postgresql-operations-ko', 'OpenSphere PostgreSQL 19 플러그인 설치 및 운영 안내서', 'postgresql-operations.ko.md', '/p/foundation/postgres', ['postgresql', 'cloudnativepg', 'data']],
  ['percona-psmdb-operations-ko', 'OpenSphere Percona PSMDB 플러그인 설치 및 운영 안내서', 'percona-psmdb-operations.ko.md', '/p/foundation/psmdb', ['mongodb', 'percona', 'data']],
  ['valkey-operations-ko', 'OpenSphere Valkey 플러그인 설치 및 운영 안내서', 'valkey-operations.ko.md', '/p/foundation/valkey', ['valkey', 'cache', 'data']],
  ['opensearch-operations-ko', 'OpenSphere OpenSearch 플러그인 설치 및 운영 안내서', 'opensearch-operations.ko.md', '/p/foundation/opensearch', ['opensearch', 'search', 'vector', 'data']],
  ['rustfs-operations-ko', 'OpenSphere RustFS 플러그인 설치 및 운영 안내서', 'rustfs-operations.ko.md', '/p/foundation/rustfs', ['rustfs', 's3', 'object-storage', 'data']],
  ['keycloak-operations-ko', 'OpenSphere Keycloak 플러그인 설치 및 운영 안내서', 'keycloak-operations.ko.md', '/p/foundation/keycloak', ['keycloak', 'oidc', 'identity']],
  ['samba-addc-operations-ko', 'OpenSphere Samba AD DC 플러그인 설치 및 운영 안내서', 'samba-addc-operations.ko.md', '/p/foundation/addc', ['samba', 'ad-dc', 'ldap', 'identity']],
  ['syncope-operations-ko', 'OpenSphere Apache Syncope 플러그인 계획 및 운영 안내서', 'syncope-operations.ko.md', '/p/foundation/modules/syncope', ['syncope', 'iga', 'scim', 'identity']],
  ['opa-operations-ko', 'OpenSphere OPA 플러그인 계획 및 운영 안내서', 'opa-operations.ko.md', '/p/foundation/modules/opa', ['opa', 'policy', 'authorization']],
  ['litellm-operations-ko', 'OpenSphere LiteLLM 플러그인 계획 및 운영 안내서', 'litellm-operations.ko.md', '/p/foundation/modules/litellm', ['litellm', 'llm', 'ai']],
  ['langfuse-operations-ko', 'OpenSphere Langfuse 플러그인 계획 및 운영 안내서', 'langfuse-operations.ko.md', '/p/foundation/modules/langfuse', ['langfuse', 'llm-observability', 'ai']],
  ['stalwart-operations-ko', 'OpenSphere Stalwart 플러그인 계획 및 운영 안내서', 'stalwart-operations.ko.md', '/p/foundation/modules/stalwart', ['stalwart', 'mail', 'jmap', 'communication']],
  ['novu-operations-ko', 'OpenSphere Novu 플러그인 계획 및 운영 안내서', 'novu-operations.ko.md', '/p/foundation/modules/novu', ['novu', 'notification', 'communication']],
  ['mattermost-operations-ko', 'OpenSphere Mattermost 플러그인 계획 및 운영 안내서', 'mattermost-operations.ko.md', '/p/foundation/modules/mattermost', ['mattermost', 'chatops', 'communication']],
  ['otel-operations-ko', 'OpenSphere OpenTelemetry Collector 플러그인 설치 및 운영 안내서', 'otel-operations.ko.md', '/p/foundation/modules/otel', ['opentelemetry', 'otlp', 'observability']],
  ['tempo-operations-ko', 'OpenSphere Grafana Tempo 플러그인 계획 및 운영 안내서', 'tempo-operations.ko.md', '/p/foundation/modules/tempo', ['grafana', 'tempo', 'traces', 'observability']],
  ['loki-operations-ko', 'OpenSphere Grafana Loki 플러그인 계획 및 운영 안내서', 'loki-operations.ko.md', '/p/foundation/modules/loki', ['grafana', 'loki', 'logs', 'observability']],
  ['grafana-operator-operations-ko', 'OpenSphere Grafana Operator 플러그인 계획 및 운영 안내서', 'grafana-operator-operations.ko.md', '/p/foundation/modules/grafana-operator', ['grafana', 'dashboards', 'observability']],
  ['ptm-operations-ko', 'OpenSphere .ptm 보호 플러그인 계획 및 운영 안내서', 'ptm-operations.ko.md', '/p/foundation/modules/ptm', ['ptm', 'velero', 'backup', 'restore']],
  ['argocd-operations-ko', 'OpenSphere Argo CD Delivery 플러그인 계획 및 운영 안내서', 'argocd-operations.ko.md', '/p/foundation/delivery/argocd', ['argocd', 'gitops', 'delivery']],
  ['crossplane-operations-ko', 'OpenSphere Crossplane Delivery 플러그인 설치 및 운영 안내서', 'crossplane-operations.ko.md', '/p/foundation/delivery/crossplane', ['crossplane', 'provider', 'delivery']],
].map(([id, title, file, route, tags]) => ({ id, title, path: `plugins/manual/${file}`, sourcePath: `ui-shell/manual/${file}`, route, tags }));

function injectOnce(base) {
  if (injected) return;
  injected = true;
  window.__OSP_NG_API_BASE__ = base; // Angular 앱이 /api/k8s/* 프록시를 셸 경유로 호출
  const v = `?v=${Date.now()}`; // 재배포 번들 즉시 반영(PoC 캐시버스터)
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = `${base}/app/styles.css${v}`;
  css.setAttribute('data-osp-plugin', 'foundation');
  document.head.appendChild(css);
  const s = document.createElement('script');
  s.type = 'module'; s.src = `${base}/app/main.js${v}`;
  s.setAttribute('data-osp-plugin', 'foundation');
  document.head.appendChild(s);
}

async function contributeFoundationManuals(ctx) {
  if (!ctx.extensions.manual) throw new Error("Foundation Manual contribution requires the 'manual:contribute' grant");
  if (!ctx.api?.fetch) throw new Error('Foundation Manual contribution requires the approved plugin API proxy');
  const documents = await Promise.all(FOUNDATION_MANUALS.map(async (manual) => {
    const response = await ctx.api.fetch(manual.path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${manual.id} Manual asset HTTP ${response.status}`);
    const content = await response.text();
    if (!content.trim()) throw new Error(`${manual.id} Manual asset is empty`);
    return {
      id: manual.id, title: manual.title, content, route: manual.route, sourcePath: manual.sourcePath,
      documentType: 'howto', tags: ['pfs', '설치', '운영', ...manual.tags],
    };
  }));
  ctx.extensions.manual.contribute({
    sourceId: 'plugin:foundation',
    name: 'OpenSphere Foundation Plugin Manuals',
    authorityTier: 2,
    language: 'ko',
    documents,
  });
}

export async function activate(ctx) {
  const base = (ctx.api?.baseUrl ?? '').replace(/\/$/, '');
  const contexts = window.__OPENSPHERE_HOST_CONTEXTS__ ||= Object.create(null);
  contexts.foundation = { api: { baseUrl: base, fetch: ctx.api?.fetch } };
  hostContextInstalled = true;
  activeContext = ctx;
  injectOnce(base);
  ctx.extensions.registerPage({
    id: ctx.pluginId,
    title: 'Foundation',
    navBand: '운영 Operate',
    elementTag: TAG,
  });
  await contributeFoundationManuals(ctx);
}

export function deactivate() {
  activeContext?.extensions.manual?.clear();
  if (hostContextInstalled && window.__OPENSPHERE_HOST_CONTEXTS__) delete window.__OPENSPHERE_HOST_CONTEXTS__.foundation;
  document.querySelectorAll('[data-osp-plugin="foundation"]').forEach((node) => node.remove());
  activeContext = undefined;
  hostContextInstalled = false;
  injected = false;
}
