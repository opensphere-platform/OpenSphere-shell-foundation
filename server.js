// Foundation — server.js. SDK 표준 subShell 피처 컨테이너: 제네릭 /api/k8s/* 프록시 + WS exec + Angular 범용콘솔(www) + subShell ui-shell 서빙.
// 셸 nginx가 /api/plugins/foundation/<X> → 이 서버 /<X> 로 prefix strip 프록시.
//   /plugins/*  → 매니페스트/번들/서명
//   /app/*      → Angular dist(main.js, styles.css)
//   /api/nodes  → 노드 집계
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { Pool } = require('pg');
const { WebSocketServer, WebSocket } = require('ws');
const COOKIE = 'osng_token'; // 브라우저 WS는 커스텀 헤더를 못 실음 → 신원 토큰을 HttpOnly 쿠키로 전달
// ⚠️ 'bearer' 쿠키는 Console Supabase access token이 아님 — 읽지 말 것.
//    신원 전달 정본 = Main Shell ctx.api.fetch가 주입한 Authorization Bearer.
function tokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function requestToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}
const PORT = process.env.PORT || 8080;
const FOUNDATION_OWNER_ONLY = process.env.FOUNDATION_OWNER_ONLY === 'true';
const PLUGINS = process.env.PLUGINS_DIR || '/app/plugins';
const WWW = process.env.WWW_DIR || '/app/www';
const VERSION = process.env.APP_VERSION || (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGINS, 'module-package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
})();
const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const APISERVER = 'https://kubernetes.default.svc';
const tok = () => fs.readFileSync(`${SA}/token`, 'utf8').trim();

// ── Supabase identity and Kubernetes write boundary ────────────────────────
// Foundation owns neither an IdP nor a parallel JWT verifier. The Console Backend
// evaluates the Supabase session and the canonical console.operator_role projection.
const CONSOLE_IDENTITY_URL = (process.env.CONSOLE_IDENTITY_URL
  || 'http://opensphere-console-backend.opensphere-console.svc.cluster.local:8080').replace(/\/$/, '');
// Kubernetes RBAC still uses platform group names. Only the evaluated Console roles
// below may be projected; a caller cannot inject arbitrary Impersonate-Group values.
const K8S_GROUP_BY_CONSOLE_ROLE = Object.freeze({
  'console-admins': 'opensphere-console-admins',
  'console-operators': 'opensphere-console-operators',
  'console-viewers': 'opensphere-console-viewers',
});
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FND_NS = process.env.FOUNDATION_NS || 'opensphere-foundation';
const CLUSTER_MANAGER_URL = process.env.CLUSTER_MANAGER_URL || 'http://cluster-manager.opensphere-console.svc.cluster.local:8080';
const FOUNDATION_AUDIT_URL = (process.env.FOUNDATION_AUDIT_URL
  || 'http://opensphere-console-dupa-controller.opensphere-console.svc.cluster.local:8080').replace(/\/$/, '');
const FOUNDATION_READINESS_TIMEOUT_MS = Number(process.env.FOUNDATION_READINESS_TIMEOUT_MS || 15000);
const SAMBA_BOOTSTRAP_SECRET = process.env.SAMBA_BOOTSTRAP_SECRET || 'foundation-identity-samba-creds';
const SAMBA_BOOTSTRAP_SECRET_KEY = 'domain-password';
const VALKEY_SERVICE = process.env.VALKEY_SERVICE || `foundation-data-valkey.${FND_NS}.svc`;
const VALKEY_PORT = Number(process.env.VALKEY_PORT || 6379);
const VALKEY_DEFAULT_SECRET = 'foundation-data-valkey-auth';
const RUSTFS_SERVICE = process.env.RUSTFS_SERVICE || `opensphere-rustfs.${FND_NS}.svc:9000`;
const RUSTFS_DEFAULT_SECRET = 'rustfs-credentials';
const PSMDB_NAME = 'foundation-data-mongodb';
const PSMDB_CONNECTION_SECRET = `${PSMDB_NAME}-databaseadmin-conn-str`;
const PSMDB_TLS_SECRET = `${PSMDB_NAME}-ssl`;
const POSTGRES_ADMIN = Object.freeze({
  namespace: FND_NS,
  cluster: 'pgc-foundation-data-pg',
  secret: 'pgc-foundation-data-pg-binding',
  service: `pgc-foundation-data-pg.${FND_NS}.svc`,
  port: 5432,
  statementTimeoutMs: 10000,
  rowLimit: 500,
});
const PG_NAME_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const PG_COLUMN_TYPES = Object.freeze(new Set([
  'bigint', 'bigserial', 'boolean', 'bytea', 'date', 'double precision', 'integer',
  'json', 'jsonb', 'numeric', 'real', 'smallint', 'text', 'time',
  'timestamp', 'timestamp with time zone', 'uuid', 'varchar(255)',
]));
const PG_DEFAULTS = Object.freeze(new Set(['', 'now()', 'gen_random_uuid()', 'true', 'false']));
const STACKGRES_EXTENSION_INDEX_URL = process.env.STACKGRES_EXTENSION_INDEX_URL
  || 'https://extensions.stackgres.io/postgres/repository/v2/index.json';
const STACKGRES_EXTENSION_CACHE_MS = Number(process.env.STACKGRES_EXTENSION_CACHE_MS || 60 * 60 * 1000);
const PG_EXTENSION_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const PG_EXTENSION_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const POSTGRES_PROFILE_KINDS = Object.freeze({
  instance: Object.freeze({ apiVersion: 'stackgres.io/v1', apiKind: 'SGInstanceProfile', resource: 'sginstanceprofiles' }),
  postgres: Object.freeze({ apiVersion: 'stackgres.io/v1', apiKind: 'SGPostgresConfig', resource: 'sgpgconfigs' }),
  pooling: Object.freeze({ apiVersion: 'stackgres.io/v1', apiKind: 'SGPoolingConfig', resource: 'sgpoolconfigs' }),
  objectStorage: Object.freeze({ apiVersion: 'stackgres.io/v1beta1', apiKind: 'SGObjectStorage', resource: 'sgobjectstorages' }),
});
const POSTGRES_RUNTIME_CATALOG = 'opensphere-stackgres';
const POSTGRES_OWNER_CONTRACT_VERSION = 'v1';
const POSTGRES_OWNER_SOURCE_REVISION = String(process.env.OS_SOURCE_REVISION
  || process.env.SOURCE_REVISION || process.env.APP_VERSION || VERSION || 'unknown').trim() || 'unknown';
const POSTGRES_OWNER_EVIDENCE_TTL_SECONDS = Math.max(15, Math.min(3600,
  Number(process.env.POSTGRES_OWNER_EVIDENCE_TTL_SECONDS || 60) || 60));
const pgPools = new Map();
const pgCredentialCache = new Map();
let stackGresExtensionCache = { fetchedAt: 0, body: null };
const POSTGRES_DEFAULT_ID = 'stackgres:' + FND_NS + ':' + POSTGRES_ADMIN.cluster;
const FOUNDATION_API = '/apis/foundation.opensphere.io/v1alpha1';
const HIS_STATUS_SCHEMA = 'his-status.opensphere.io/v1alpha1';
const FOUNDATION_CORE_CRDS = Object.freeze([
  'foundationmodels.foundation.opensphere.io',
  'foundationmoduledescriptors.foundation.opensphere.io',
  'foundationclaims.foundation.opensphere.io',
  'foundationbindings.foundation.opensphere.io',
  'identitydirectoryclaims.foundation.opensphere.io',
  'identitydirectorybindings.foundation.opensphere.io',
]);
const FOUNDATION_ENGINE_MODEL = Object.freeze({
  keycloak: 'identity',
  samba: 'identity',
  postgres: 'data',
  psmdb: 'data',
  valkey: 'data',
  opensearch: 'data',
  rustfs: 'data',
});
const FOUNDATION_CLAIM_MODELS = Object.freeze(['identity', 'data']);
const FOUNDATION_BOOTSTRAP_TEMPLATE_ID = 'foundation-control-plane-bootstrap';
const K8S_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
function k8sGroups(groups) {
  return [...new Set((groups || []).map((role) => K8S_GROUP_BY_CONSOLE_ROLE[role]).filter(Boolean))];
}
function requireConsoleAdmin(actor) {
  if (!actor.groups.includes('console-admins')) throw { code: 403, msg: 'requires console-admins' };
  return actor;
}
function requireFoundationOwner(actor) {
  requireConsoleAdmin(actor);
  if (actor.assurance !== 'aal2') throw { code: 403, msg: 'Foundation owner action requires MFA assurance aal2' };
  return actor;
}
async function verifySupabaseToken(rawToken, identityFetch = fetch) {
  if (!rawToken) throw { code: 401, msg: 'no bearer token' };
  let response;
  try {
    response = await identityFetch(`${CONSOLE_IDENTITY_URL}/api/identity/session`, {
      headers: { authorization: `Bearer ${rawToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw { code: 503, msg: 'Supabase identity authority unavailable' };
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw { code: response.status === 403 ? 403 : 401, msg: body.error || 'invalid Supabase session' };
  return {
    username: body.username || body.subject || 'unknown',
    subject: body.subject || '',
    groups: Array.isArray(body.groups) ? body.groups : [],
    permissions: Array.isArray(body.permissions) ? body.permissions : [],
    assurance: body.assurance || 'aal1',
    provider: 'supabase',
  };
}
async function verifyToken(rawToken) {
  return verifySupabaseToken(rawToken);
}
const readBody = (req) => new Promise((resolve, reject) => {
  const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject);
});
const jsonRes = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const k8sJson = async (method, path, body, actor, contentType) => {
  const headers = new Headers({
    Authorization: `Bearer ${tok()}`,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': contentType || (method === 'PATCH' ? 'application/merge-patch+json' : 'application/json') } : {}),
  });
  if (actor) {
    headers.set('Impersonate-User', actor.username);
    for (const group of k8sGroups(actor.groups)) headers.append('Impersonate-Group', group);
  }
  const r = await fetch(`${APISERVER}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, json, text };
};

function pgName(value, field = 'name') {
  const name = String(value || '').trim();
  if (!PG_NAME_RE.test(name)) throw { code: 400, msg: `${field} is not a supported PostgreSQL identifier` };
  return name;
}
function pgIdentifier(value, field = 'name') {
  return `"${pgName(value, field).replace(/"/g, '""')}"`;
}
function decodeSecretValue(data, key) {
  const encoded = data?.[key];
  return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
}
function postgresServiceHost(value, namespace = POSTGRES_ADMIN.namespace) {
  const host = String(value || '').trim();
  if (!host) return POSTGRES_ADMIN.service;
  if (host === 'localhost' || host.includes('.') || host.includes(':')) return host;
  return host + '.' + namespace + '.svc';
}
function parsePostgresClusterId(value) {
  const id = String(value || POSTGRES_DEFAULT_ID).trim();
  const match = id.match(/^stackgres:([a-z0-9]([-a-z0-9]*[a-z0-9])?):([a-z0-9]([-a-z0-9]*[a-z0-9])?)$/);
  if (!match) throw { code: 400, msg: 'cluster must be stackgres:namespace:name' };
  return { id, provider: 'stackgres', namespace: match[1], name: match[3] };
}
function postgresExtensionName(value, field = 'extension name') {
  const name = String(value || '').trim();
  if (!PG_EXTENSION_RE.test(name)) throw { code: 400, msg: `${field} is not a supported PostgreSQL extension identifier` };
  return name;
}
function postgresExtensionVersion(value, field = 'extension version') {
  const version = String(value || '').trim();
  if (version && !PG_EXTENSION_VERSION_RE.test(version)) throw { code: 400, msg: `${field} is not a supported StackGres extension version` };
  return version;
}
function sanitizePostgresExtensions(value) {
  if (!Array.isArray(value) || value.length > 32) throw { code: 400, msg: 'extensions must be an array with at most 32 items' };
  const seen = new Set();
  return value.map((item, index) => {
    requireClosedOwnerBody(item, ['name', 'version', 'publisher', 'repository']);
    const name = postgresExtensionName(item.name, `extensions[${index}].name`);
    const publisher = String(item.publisher || '').trim();
    const repository = String(item.repository || '').trim();
    if (publisher && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(publisher)) throw { code: 400, msg: `extensions[${index}].publisher is invalid` };
    if (repository && !/^https:\/\//.test(repository)) throw { code: 400, msg: `extensions[${index}].repository must use https` };
    const identity = name;
    if (seen.has(identity)) throw { code: 400, msg: `duplicate extension: ${name}` };
    seen.add(identity);
    const version = postgresExtensionVersion(item.version, `extensions[${index}].version`);
    return { name, ...(version ? { version } : {}), ...(publisher ? { publisher } : {}), ...(repository ? { repository } : {}) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function postgresExtensionSpecDiff(before, after) {
  const key = (item) => item.name;
  const previous = new Map((before || []).map((item) => [key(item), item]));
  const next = new Map((after || []).map((item) => [key(item), item]));
  return {
    add: [...next].filter(([id]) => !previous.has(id)).map(([, item]) => item),
    update: [...next].filter(([id, item]) => previous.has(id) && JSON.stringify(previous.get(id)) !== JSON.stringify(item)).map(([, item]) => item),
    remove: [...previous].filter(([id]) => !next.has(id)).map(([, item]) => item),
  };
}
function stackGresExtensionVersions(item, postgresVersion, flavor = 'vanilla') {
  const major = String(postgresVersion || '').split('.')[0];
  return (item?.versions || []).filter((version) => (version.availableFor || []).some((build) =>
    String(build.postgresVersion || '').split('.')[0] === major && String(build.flavor || 'vanilla') === flavor))
    .map((version) => String(version.version)).filter(Boolean);
}
async function stackGresExtensionCatalog(postgresVersion, catalogFetch = fetch) {
  const now = Date.now();
  if (!stackGresExtensionCache.body || now - stackGresExtensionCache.fetchedAt > STACKGRES_EXTENSION_CACHE_MS) {
    const response = await catalogFetch(STACKGRES_EXTENSION_INDEX_URL, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw { code: 502, msg: `StackGres extension catalog HTTP ${response.status}` };
    stackGresExtensionCache = { fetchedAt: now, body: await response.json() };
  }
  const extensions = (stackGresExtensionCache.body?.extensions || []).map((item) => {
    const versions = stackGresExtensionVersions(item, postgresVersion);
    if (!versions.length) return null;
    const channels = Object.fromEntries(Object.entries(item.channels || {}).filter(([, version]) => versions.includes(String(version))));
    return {
      name: item.name, publisher: item.publisher || 'com.ongres', repository: item.repository || '',
      license: item.license || '', abstract: item.abstract || '', description: item.description || '',
      tags: Array.isArray(item.tags) ? item.tags : [], versions, channels,
    };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return { extensions, publishers: stackGresExtensionCache.body?.publishers || [], source: STACKGRES_EXTENSION_INDEX_URL };
}
function postgresClusterProjection(item) {
  const namespace = item?.metadata?.namespace || '';
  const name = item?.metadata?.name || '';
  const stackGresConditions = item?.status?.conditions || [];
  const ready = (stackGresConditions.some((condition) => ['ClusterReady', 'Ready'].includes(condition.type) && condition.status === 'True')
      || (stackGresConditions.some((condition) => condition.type === 'Bootstrapped' && condition.status === 'True')
        && stackGresConditions.some((condition) => condition.type === 'ComponentsUpdated' && condition.status === 'True')
        && !stackGresConditions.some((condition) => condition.type === 'Failed' && condition.status === 'True')
        && !!item?.status?.binding?.name));
  return {
    id: 'stackgres:' + namespace + ':' + name, provider: 'stackgres', namespace, name,
    displayName: item?.metadata?.annotations?.['opensphere.io/display-name'] || name,
    mode: 'Dedicated',
    phase: ready ? 'Ready' : (item?.status?.phase || 'Provisioning'),
    ready, instances: Number(item?.spec?.instances || 0),
    readyInstances: Number(item?.status?.readyInstances || item?.status?.instances || 0),
    postgresVersion: String(item?.spec?.postgres?.version || item?.spec?.imageCatalogRef?.major || item?.spec?.imageName || ''),
    storage: item?.spec?.pods?.persistentVolume?.size || item?.spec?.storage?.size || '',
    plan: item?.metadata?.labels?.['catalog.opensphere.io/plan'] || '',
    bindingSecret: item?.status?.binding?.name || name + '-binding',
    extensions: sanitizePostgresExtensions(item?.spec?.postgres?.extensions || []),
    extensionStatus: Array.isArray(item?.status?.extensions) ? item.status.extensions : [],
    uid: item?.metadata?.uid || '', createdAt: item?.metadata?.creationTimestamp || null,
  };
}
async function postgresFleetClusters(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const sg = await k8sJson('GET', '/apis/stackgres.io/v1/sgclusters', undefined, actor);
    if (!sg.ok && sg.status !== 404) throw { code: sg.status, msg: 'StackGres PostgreSQL fleet unavailable: ' + k8sFailure(sg) };
    const clusters = ((sg.ok ? sg.json?.items : []) || [])
      .map((item) => postgresClusterProjection(item))
      .sort((a, b) => Number(b.ready) - Number(a.ready) || a.displayName.localeCompare(b.displayName));
    return jsonRes(res, 200, { schema: 'foundation.postgres.fleet/v1beta1', clusters, refreshedAt: new Date().toISOString() });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}
async function postgresExtensions(req, res, url) {
  if (!['GET', 'POST'].includes(req.method || '')) return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try {
    actor = req.method === 'POST' ? await foundationOwnerActor(req) : requireConsoleAdmin(await verifyToken(requestToken(req)));
    if (req.method === 'GET') {
      const clusterId = url.searchParams.get('cluster') || '';
      let cluster = null;
      let postgresVersion = String(url.searchParams.get('postgresVersion') || '').trim();
      if (clusterId) {
        const target = parsePostgresClusterId(clusterId);
        const result = await k8sJson('GET', `/apis/stackgres.io/v1/namespaces/${target.namespace}/sgclusters/${target.name}`, undefined, actor);
        if (!result.ok) throw { code: result.status, msg: 'StackGres cluster unavailable: ' + k8sFailure(result) };
        cluster = result.json;
        postgresVersion = String(cluster?.spec?.postgres?.version || postgresVersion);
      }
      if (!/^\d+(?:\.\d+)?$/.test(postgresVersion)) throw { code: 400, msg: 'postgresVersion must be derived from an AddOnPlan or SGCluster' };
      const catalog = await stackGresExtensionCatalog(postgresVersion);
      const desired = sanitizePostgresExtensions(cluster?.spec?.postgres?.extensions || []);
      return jsonRes(res, 200, {
        schema: 'foundation.postgres.extensions/v1alpha1', postgresVersion,
        catalog: catalog.extensions, publishers: catalog.publishers, source: catalog.source,
        desired, observed: Array.isArray(cluster?.status?.extensions) ? cluster.status.extensions : [],
        pendingRestart: Boolean(cluster?.status?.extensionsPendingRestart || cluster?.status?.pendingRestart),
        refreshedAt: new Date().toISOString(),
      });
    }
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['cluster', 'extensions', 'reason', 'dryRun']);
    if (!String(body.cluster || '').trim()) throw { code: 400, msg: 'cluster is required; OpenSphere does not select an implicit PostgreSQL instance' };
    const target = parsePostgresClusterId(body.cluster);
    const reason = requireOwnerReason(body.reason);
    const desired = sanitizePostgresExtensions(body.extensions);
    await requireManagedPostgresNamespace(target.namespace, actor);
    const clusterPath = `/apis/stackgres.io/v1/namespaces/${target.namespace}/sgclusters/${target.name}`;
    const current = await k8sJson('GET', clusterPath, undefined, actor);
    if (!current.ok) throw { code: current.status, msg: 'StackGres cluster unavailable: ' + k8sFailure(current) };
    const postgresVersion = String(current.json?.spec?.postgres?.version || '');
    const catalog = await stackGresExtensionCatalog(postgresVersion);
    const available = new Map(catalog.extensions.map((item) => [`${item.publisher || 'com.ongres'}/${item.name}`, item]));
    for (const item of desired) {
      const entry = available.get(`${item.publisher || 'com.ongres'}/${item.name}`);
      if (!entry) throw { code: 400, msg: `${item.name} is not compatible with PostgreSQL ${postgresVersion}` };
      if (item.version && !entry.versions.includes(item.version)) throw { code: 400, msg: `${item.name} ${item.version} is not compatible with PostgreSQL ${postgresVersion}` };
    }
    const before = sanitizePostgresExtensions(current.json?.spec?.postgres?.extensions || []);
    const diff = postgresExtensionSpecDiff(before, desired);
    const impact = {
      restartMayBeRequired: diff.update.length > 0 || diff.remove.length > 0,
      databaseActivationRequired: diff.add.map((item) => item.name),
      removedBinaries: diff.remove.map((item) => item.name),
    };
    const claimName = String(current.json?.metadata?.labels?.['provisioning.opensphere.io/postgres-claim'] || '');
    if (!claimName) throw { code: 409, msg: 'Extensions can only be changed through the owning PostgresClaim' };
    const claimPath = `/apis/provisioning.opensphere.io/v1beta1/namespaces/${target.namespace}/postgresclaims/${claimName}`;
    const claim = await k8sJson('GET', claimPath, undefined, actor);
    if (!claim.ok) throw { code: claim.status, msg: 'PostgresClaim authority unavailable: ' + k8sFailure(claim) };
    const patch = { metadata: { resourceVersion: claim.json?.metadata?.resourceVersion }, spec: { extensions: desired } };
    const validation = await k8sJson('PATCH', `${claimPath}?dryRun=All&fieldManager=opensphere-foundation`, patch, actor);
    if (!validation.ok) throw { code: validation.status, msg: `Extension dry-run rejected: ${k8sFailure(validation)}` };
    if (body.dryRun === true) return jsonRes(res, 200, { accepted: true, dryRun: true, cluster: target.id, before, desired, diff, impact });
    const auditTarget = `PostgresClaim/${target.namespace}/${claimName}`;
    await publishFoundationAudit(actor, 'postgres-extensions-apply', auditTarget, 'attempt', reason);
    const applied = await k8sJson('PATCH', claimPath, patch, actor);
    if (!applied.ok) throw { code: applied.status, msg: k8sFailure(applied) };
    await publishFoundationAudit(actor, 'postgres-extensions-apply', auditTarget, 'accepted', reason);
    return jsonRes(res, 200, { accepted: true, cluster: target.id, authority: auditTarget, before, desired, diff, impact, resourceVersion: applied.json?.metadata?.resourceVersion || '' });
  } catch (e) {
    if (actor && req.method === 'POST') await publishFoundationAudit(actor, 'postgres-extensions-apply', 'PostgresClaim', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}
async function postgresFleetNamespaces(req, res) {
  if (!['GET', 'POST'].includes(req.method || '')) return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try {
    actor = req.method === 'POST'
      ? await foundationOwnerActor(req)
      : requireConsoleAdmin(await verifyToken(requestToken(req)));
    if (req.method === 'GET') {
      const result = await k8sJson('GET', '/api/v1/namespaces', undefined, actor);
      if (!result.ok) throw { code: result.status, msg: 'PostgreSQL Namespace inventory unavailable: ' + k8sFailure(result) };
      const namespaces = (result.json?.items || [])
        .filter((item) => !item?.metadata?.deletionTimestamp)
        .map((item) => ({
          name: item?.metadata?.name || '',
          managed: item?.metadata?.labels?.['opensphere.io/managed-by'] === 'foundation',
          phase: item?.status?.phase || 'Active',
        }))
        .filter((item) => item.name)
        .sort((a, b) => Number(b.managed) - Number(a.managed) || a.name.localeCompare(b.name));
      return jsonRes(res, 200, { schema: 'foundation.postgres.namespaces/v1', namespaces });
    }
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['name', 'reason']);
    const name = requireK8sName(body.name, 'namespace');
    const reason = requireOwnerReason(body.reason);
    const existing = await k8sJson('GET', `/api/v1/namespaces/${name}`, undefined, actor);
    if (existing.ok) {
      if (existing.json?.metadata?.deletionTimestamp) throw { code: 409, msg: `Namespace ${name} is terminating` };
      return jsonRes(res, 200, { accepted: true, created: false, namespace: name });
    }
    if (existing.status !== 404) throw { code: existing.status, msg: k8sFailure(existing) };
    await publishFoundationAudit(actor, 'postgres-namespace-create', `Namespace/${name}`, 'attempt', reason);
    const created = await k8sJson('POST', '/api/v1/namespaces', {
      apiVersion: 'v1', kind: 'Namespace', metadata: {
        name,
        labels: {
          'opensphere.io/managed-by': 'foundation',
          'opensphere.io/purpose': 'postgres-fleet',
          'pod-security.kubernetes.io/enforce': 'baseline',
          'pod-security.kubernetes.io/warn': 'restricted',
        },
      },
    }, actor);
    if (!created.ok && created.status !== 409) throw { code: created.status, msg: k8sFailure(created) };
    await publishFoundationAudit(actor, 'postgres-namespace-create', `Namespace/${name}`, 'accepted', reason);
    return jsonRes(res, created.status === 409 ? 200 : 201, { accepted: true, created: created.status !== 409, namespace: name });
  } catch (e) {
    if (actor && req.method === 'POST') await publishFoundationAudit(actor, 'postgres-namespace-create', 'Namespace', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}

async function requireManagedPostgresNamespace(namespace, actor) {
  const result = await k8sJson('GET', `/api/v1/namespaces/${namespace}`, undefined, actor);
  if (!result.ok) throw { code: result.status, msg: `Namespace ${namespace} is unavailable: ${k8sFailure(result)}` };
  const labels = result.json?.metadata?.labels || {};
  const managed = labels['opensphere.io/managed-by'] === 'foundation'
    || labels['app.kubernetes.io/managed-by'] === 'foundation-control-plane';
  if (!managed) throw { code: 403, msg: `Namespace ${namespace} is not admitted for Foundation PostgreSQL` };
}
function sanitizePostgresClaimProfileRefs(value) {
  if (value === undefined) return undefined;
  profileOnlyKeys(value, ['instanceProfile', 'postgresConfig', 'poolingConfig', 'objectStorage'], 'profileRefs');
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => String(item || '').trim())
    .map(([key, item]) => [key, requireK8sName(item, `profileRefs.${key}`)]));
}
function postgresClaimResource(body) {
  const name = requireK8sName(body.name, 'claim name');
  const namespace = requireK8sName(body.namespace, 'namespace');
  const database = pgName(body.database, 'database');
  const owner = pgName(body.owner, 'owner');
  const plan = requireK8sName(body.plan, 'plan');
  const postgresVersion = String(body.postgresVersion || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(postgresVersion)) throw { code: 400, msg: 'postgresVersion must be selected from the approved runtime catalog' };
  const deletionPolicy = String(body.deletionPolicy || 'Retain');
  if (!['Retain', 'Delete'].includes(deletionPolicy)) throw { code: 400, msg: 'deletionPolicy must be Retain or Delete' };
  const alias = String(body.alias || '').trim();
  if (!alias || alias.length > 160) throw { code: 400, msg: 'alias must be 1..160 characters' };
  const spec = { planRef: { name: plan }, isolation: 'Dedicated', database, owner, postgresVersion, deletionPolicy };
  const extensions = body.extensions === undefined ? undefined : sanitizePostgresExtensions(body.extensions);
  const profileRefs = sanitizePostgresClaimProfileRefs(body.profileRefs);
  if (extensions?.length) spec.extensions = extensions;
  if (profileRefs && Object.keys(profileRefs).length) spec.profileRefs = profileRefs;
  if (body.storage !== undefined) {
    profileOnlyKeys(body.storage, ['size', 'storageClass'], 'storage');
    const size = String(body.storage.size || '').trim();
    const storageClass = String(body.storage.storageClass || '').trim();
    if (size && !/^[0-9]+(?:Mi|Gi|Ti)$/.test(size)) throw { code: 400, msg: 'storage.size must be a binary quantity such as 20Gi' };
    if (storageClass) requireK8sName(storageClass, 'storage.storageClass');
    spec.storage = { ...(size ? { size } : {}), ...(storageClass ? { storageClass } : {}) };
  }
  return {
    apiVersion: 'provisioning.opensphere.io/v1beta1', kind: 'PostgresClaim',
    metadata: {
      name, namespace,
      labels: { 'opensphere.io/managed-by': 'foundation', 'opensphere.io/component': 'postgres-fleet' },
      annotations: { 'opensphere.io/display-name': alias },
    },
    spec,
  };
}

// R2D2 and other external callers submit the public Foundation contract. The
// control-plane alone is allowed to materialize the internal PostgresClaim.
function foundationPostgresClaimResource(body) {
  const postgres = postgresClaimResource(body);
  const parameters = {
    database: postgres.spec.database,
    owner: postgres.spec.owner,
    plan: postgres.spec.planRef.name,
    postgresVersion: postgres.spec.postgresVersion,
    deletionPolicy: postgres.spec.deletionPolicy,
  };
  if (postgres.spec.storage) parameters.storage = postgres.spec.storage;
  if (postgres.spec.extensions) parameters.extensions = postgres.spec.extensions;
  if (postgres.spec.profileRefs) parameters.profileRefs = postgres.spec.profileRefs;
  return {
    apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'FoundationClaim',
    metadata: {
      name: postgres.metadata.name, namespace: postgres.metadata.namespace,
      labels: {
        'opensphere.io/managed-by': 'foundation-osaa',
        'foundation.opensphere.io/model': 'data',
        'foundation.opensphere.io/module': 'postgres',
      },
      annotations: { 'opensphere.io/display-name': postgres.metadata.annotations['opensphere.io/display-name'] },
    },
    spec: { model: 'data', module: 'postgres', request: { type: 'Instance' }, parameters },
  };
}

function foundationPostgresClaimProjection(resource) {
  const conditions = Array.isArray(resource?.status?.conditions) ? resource.status.conditions : [];
  return {
    namespace: String(resource?.metadata?.namespace || ''),
    name: String(resource?.metadata?.name || ''),
    uid: String(resource?.metadata?.uid || ''),
    resourceVersion: String(resource?.metadata?.resourceVersion || ''),
    generation: Number(resource?.metadata?.generation || 0),
    observedGeneration: Number(resource?.status?.observedGeneration || 0),
    phase: String(resource?.status?.phase || 'Pending'),
    reason: String(resource?.status?.reason || ''),
    bindingRef: resource?.status?.bindingRef || null,
    ready: resource?.status?.phase === 'Bound' && Number(resource?.status?.observedGeneration || 0) === Number(resource?.metadata?.generation || 0),
    conditions: conditions.map((condition) => ({
      type: String(condition?.type || ''), status: String(condition?.status || ''),
      reason: String(condition?.reason || ''), message: String(condition?.message || '').slice(0, 300),
    })).filter((condition) => condition.type),
  };
}
async function postgresClaims(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try {
    actor = await foundationOwnerActor(req);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['name', 'namespace', 'alias', 'database', 'owner', 'plan', 'postgresVersion', 'deletionPolicy', 'extensions', 'profileRefs', 'storage', 'reason', 'confirm', 'dryRun']);
    const reason = requireOwnerReason(body.reason);
    const resource = postgresClaimResource(body);
    requirePostgresClaimConfirm(body.confirm, resource);
    await requireManagedPostgresNamespace(resource.metadata.namespace, actor);
    const [planResult, runtimeCatalog] = await Promise.all([
      k8sJson('GET', `/apis/catalog.opensphere.io/v1alpha1/addonplans/${resource.spec.planRef.name}`, undefined, actor),
      loadPostgresRuntimeCatalog(actor),
    ]);
    if (!planResult.ok) throw { code: planResult.status, msg: `AddOnPlan unavailable: ${k8sFailure(planResult)}` };
    validatePostgresClaimPlan(planResult.json, runtimeCatalog, resource);
    const path = `/apis/provisioning.opensphere.io/v1beta1/namespaces/${resource.metadata.namespace}/postgresclaims`;
    const existing = await k8sJson('GET', `${path}/${resource.metadata.name}`, undefined, actor);
    if (existing.ok) {
      const same = JSON.stringify(existing.json?.spec || {}) === JSON.stringify(resource.spec)
        && existing.json?.metadata?.annotations?.['opensphere.io/display-name'] === resource.metadata.annotations['opensphere.io/display-name'];
      if (!same) throw { code: 409, msg: `PostgresClaim ${resource.metadata.namespace}/${resource.metadata.name} already exists with a different contract` };
      return jsonRes(res, 200, { accepted: true, created: false, namespace: resource.metadata.namespace, name: resource.metadata.name });
    }
    if (existing.status !== 404) throw { code: existing.status, msg: k8sFailure(existing) };
    const validation = await k8sJson('POST', `${path}?dryRun=All&fieldManager=opensphere-foundation`, resource, actor);
    if (!validation.ok) throw { code: validation.status, msg: `PostgresClaim dry-run rejected: ${k8sFailure(validation)}` };
    if (body.dryRun === true) return jsonRes(res, 200, { accepted: true, dryRun: true, resource: validation.json || resource });
    const target = `PostgresClaim/${resource.metadata.namespace}/${resource.metadata.name}`;
    await publishFoundationAudit(actor, 'postgres-claim-create', target, 'attempt', reason);
    const created = await k8sJson('POST', path, resource, actor);
    if (!created.ok) throw { code: created.status, msg: k8sFailure(created) };
    await publishFoundationAudit(actor, 'postgres-claim-create', target, 'accepted', reason);
    return jsonRes(res, 201, { accepted: true, created: true, namespace: resource.metadata.namespace, name: resource.metadata.name });
  } catch (e) {
    if (actor) await publishFoundationAudit(actor, 'postgres-claim-create', 'PostgresClaim', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}

function postgresRuntimeCatalogProjection(resource) {
  const versions = (resource?.spec?.versions || []).map((item) => ({
    version: String(item?.version || ''),
    major: String(item?.major || ''),
    patroniVersion: String(item?.patroniVersion || ''),
    lifecycle: String(item?.lifecycle || ''),
    image: String(item?.image || ''),
  })).filter((item) => item.version && item.major
    && /^ghcr\.io\/opensphere-platform\/mirror\/ongres\/patroni@sha256:[a-f0-9]{64}$/.test(item.image));
  return {
    name: String(resource?.metadata?.name || POSTGRES_RUNTIME_CATALOG),
    resourceVersion: String(resource?.metadata?.resourceVersion || ''),
    provider: String(resource?.spec?.provider || ''),
    operatorVersion: String(resource?.spec?.operatorVersion || ''),
    defaultVersion: String(resource?.spec?.defaultVersion || ''),
    versions,
  };
}

function postgresPlanProjection(resource) {
  const spec = resource?.spec || {};
  const supportedPostgresVersions = Array.isArray(spec.supportedPostgresVersions)
    ? spec.supportedPostgresVersions.map((value) => String(value || '').trim()).filter((value) => /^\d+(?:\.\d+)?$/.test(value))
    : [];
  return {
    name: String(resource?.metadata?.name || ''),
    resourceVersion: String(resource?.metadata?.resourceVersion || ''),
    lifecycle: String(spec.lifecycle || ''),
    profile: String(spec.profile || ''),
    provider: String(spec.provider || ''),
    postgresVersion: String(spec.postgresVersion || ''),
    supportedPostgresVersions,
    instances: Number(spec.instances || 0),
    pooling: spec.pooling === true,
    storage: {
      size: String(spec.storage?.size || ''),
      storageClass: String(spec.storage?.storageClass || ''),
    },
    resources: {
      cpu: String(spec.resources?.cpu || ''),
      memory: String(spec.resources?.memory || ''),
    },
    backup: {
      enabled: spec.backup?.enabled === true,
      retention: Number(spec.backup?.retention || 0),
      schedule: String(spec.backup?.cronSchedule || ''),
    },
    productionHA: spec.constraints?.productionHA === true,
    warning: String(spec.constraints?.warning || ''),
  };
}

function postgresClaimProjection(resource) {
  const conditions = Array.isArray(resource?.status?.conditions) ? resource.status.conditions : [];
  return {
    namespace: String(resource?.metadata?.namespace || ''),
    name: String(resource?.metadata?.name || ''),
    uid: String(resource?.metadata?.uid || ''),
    resourceVersion: String(resource?.metadata?.resourceVersion || ''),
    displayName: String(resource?.metadata?.annotations?.['opensphere.io/display-name'] || ''),
    generation: Number(resource?.metadata?.generation || 0),
    plan: String(resource?.spec?.planRef?.name || ''),
    postgresVersion: String(resource?.spec?.postgresVersion || ''),
    database: String(resource?.spec?.database || ''),
    owner: String(resource?.spec?.owner || ''),
    deletionPolicy: String(resource?.spec?.deletionPolicy || ''),
    phase: String(resource?.status?.phase || 'Pending'),
    ready: conditions.some((condition) => condition?.type === 'Ready' && condition?.status === 'True'),
    observedGeneration: Number(resource?.status?.observedGeneration || 0),
    conditions: conditions.map((condition) => ({
      type: String(condition?.type || ''), status: String(condition?.status || ''),
      reason: String(condition?.reason || ''), message: String(condition?.message || '').slice(0, 300),
    })).filter((condition) => condition.type),
  };
}

function validatePostgresClaimPlan(planResource, runtimeCatalog, resource) {
  const plan = postgresPlanProjection(planResource);
  if (plan.provider !== 'stackgres' || planResource?.spec?.capabilityRef !== 'postgresql') {
    throw { code: 409, msg: `AddOnPlan ${plan.name || resource.spec.planRef.name} is not a PostgreSQL owner plan` };
  }
  if (plan.lifecycle !== 'Available') {
    throw { code: 409, msg: `AddOnPlan ${plan.name} is ${plan.lifecycle || 'Unavailable'} and cannot accept new claims` };
  }
  const requestedVersion = resource.spec.postgresVersion;
  const runtime = (runtimeCatalog?.versions || []).find((item) => item.version === requestedVersion && item.lifecycle === 'Available');
  if (!runtime) throw { code: 400, msg: `PostgreSQL ${requestedVersion} is not an Available owner runtime` };
  if (plan.supportedPostgresVersions.length && !plan.supportedPostgresVersions.includes(requestedVersion)) {
    throw { code: 400, msg: `PostgreSQL ${requestedVersion} is not supported by AddOnPlan ${plan.name}` };
  }
  if (plan.postgresVersion && plan.postgresVersion.split('.')[0] !== requestedVersion.split('.')[0]) {
    throw { code: 400, msg: `PostgreSQL ${requestedVersion} is incompatible with AddOnPlan ${plan.name}` };
  }
  return plan;
}

function postgresClaimConfirmation(resource) {
  return `create PostgreSQL cluster ${resource.metadata.namespace}/${resource.metadata.name} plan ${resource.spec.planRef.name} version ${resource.spec.postgresVersion}`;
}

function requirePostgresClaimConfirm(value, resource) {
  const supplied = String(value || '');
  const expected = postgresClaimConfirmation(resource);
  // The existing human-operated PFSS form confirms with the exact claim name.
  // R2D2 uses the stronger plan/version-bound phrase returned by the plan API.
  if (supplied !== resource.metadata.name && supplied !== expected) {
    throw { code: 400, msg: `confirmation must exactly equal ${expected}` };
  }
  return supplied;
}

async function loadPostgresRuntimeCatalog(actor) {
  const result = await k8sJson('GET', `/apis/catalog.opensphere.io/v1alpha1/postgresruntimecatalogs/${POSTGRES_RUNTIME_CATALOG}`, undefined, actor);
  if (!result.ok) throw { code: result.status, msg: 'PostgreSQL runtime catalog unavailable: ' + k8sFailure(result) };
  const catalog = postgresRuntimeCatalogProjection(result.json);
  if (catalog.provider !== 'stackgres' || !catalog.operatorVersion || !catalog.defaultVersion || !catalog.versions.length) {
    throw { code: 409, msg: 'PostgreSQL runtime catalog is incomplete' };
  }
  return catalog;
}

function postgresInstanceRequestSchema() {
  return {
    type: 'object', additionalProperties: false,
    required: ['name', 'namespace', 'alias', 'database', 'owner', 'plan', 'postgresVersion', 'deletionPolicy', 'reason'],
    properties: {
      name: { type: 'string' }, namespace: { type: 'string' }, alias: { type: 'string' },
      database: { type: 'string' }, owner: { type: 'string' }, plan: { type: 'string' },
      postgresVersion: { type: 'string' }, deletionPolicy: { type: 'string', enum: ['Retain', 'Delete'], default: 'Retain' },
      storage: { type: 'object', additionalProperties: false, properties: {
        size: { type: 'string' }, storageClass: { type: 'string' },
      } },
      profileRefs: { type: 'object', additionalProperties: false, properties: {
        instanceProfile: { type: 'string' }, postgresConfig: { type: 'string' },
        poolingConfig: { type: 'string' }, objectStorage: { type: 'string' },
      } },
      extensions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name'], properties: {
        name: { type: 'string' }, version: { type: 'string' }, publisher: { type: 'string' }, repository: { type: 'string' },
      } } },
      reason: { type: 'string' },
    },
  };
}

function postgresOwnerActionDefinitions() {
  const availableInWebShell = (reason) => ({ available: true, reason });
  return [
    {
      actionId: 'capability.read', toolId: 'foundation.capabilities', requestType: 'Instance',
      command: 'os foundation capabilities', method: 'GET', path: '/api/foundation/osaa/postgres/capabilities',
      executionClass: 'console-api', risk: 'low', riskClass: 'R0', scope: 'read',
      inputSchema: { type: 'object', properties: { capability: { type: 'string', enum: ['data.sql.postgres'] } } },
      webShell: availableInWebShell('Uses the same canonical Foundation Owner API capability contract as CLI and R2D2.'),
      description: 'Discover PFSS control capabilities',
    },
    {
      actionId: 'readiness.read', toolId: 'foundation.readiness', requestType: 'Instance',
      command: 'os foundation readiness', method: 'GET', path: '/api/foundation/osaa/postgres/readiness',
      executionClass: 'console-api', risk: 'low', riskClass: 'R0', scope: 'read',
      inputSchema: { type: 'object', properties: { capability: { type: 'string', enum: ['data.sql.postgres'] } } },
      webShell: availableInWebShell('Read-only readiness is served by the canonical Foundation Owner API.'),
      description: 'Evaluate PFSS PostgreSQL plan and execution readiness',
    },
    {
      actionId: 'catalog.read', toolId: 'foundation.postgres.catalog', requestType: 'Instance',
      command: 'os foundation postgres catalog', method: 'GET', path: '/api/foundation/osaa/postgres/catalog',
      executionClass: 'console-api', risk: 'low', riskClass: 'R0', scope: 'read', inputSchema: { type: 'object', properties: {} },
      webShell: availableInWebShell('Read-only catalog data is served by the canonical Foundation Owner API.'),
      description: 'Read the authoritative PostgreSQL runtime and plan catalog',
    },
    {
      actionId: 'cluster.plan', toolId: 'foundation.postgres.plan.create', requestType: 'Instance',
      command: 'os foundation postgres plan create', method: 'POST', path: '/api/foundation/osaa/postgres/durable-plan',
      executionClass: 'console-api', risk: 'medium', riskClass: 'R2', scope: 'write-plan', inputSchema: postgresInstanceRequestSchema(),
      supportsFile: true,
      webShell: availableInWebShell('Creates only the canonical durable Owner plan; execution still requires a separate exact-confirmation apply.'),
      description: 'Create a durable PostgreSQL operation plan',
    },
    {
      actionId: 'cluster.create', toolId: 'foundation.postgres.apply', requestType: 'Instance',
      command: 'os foundation postgres apply <planId>', method: 'POST', path: '/api/foundation/osaa/postgres/durable-apply/{planId}',
      executionClass: 'console-api', risk: 'medium', riskClass: 'R2', scope: 'write', explicitAction: true,
      pathParams: ['planId'], approval: 'exact-confirmation',
      inputSchema: { type: 'object', additionalProperties: false, required: ['confirm'], properties: { confirm: { type: 'string' } } },
      webShell: availableInWebShell('Uses the canonical AAL2 exact-confirmation durable Owner apply path.'),
      description: 'Accept an unexpired durable PostgreSQL plan',
    },
    {
      actionId: 'cluster.status', toolId: 'foundation.postgres.status', requestType: 'Instance',
      command: 'os foundation postgres status <namespace> <name>', method: 'GET',
      path: '/api/foundation/osaa/postgres/claims/{namespace}/{name}', pathParams: ['namespace', 'name'],
      executionClass: 'console-api', risk: 'low', riskClass: 'R0', scope: 'read', inputSchema: { type: 'object', properties: {} },
      webShell: availableInWebShell('Reads the canonical FoundationClaim and PostgresClaim status projection.'),
      description: 'Read reconciled FoundationClaim and PostgresClaim status',
    },
    {
      actionId: 'operation.watch', toolId: 'foundation.operation.watch', requestType: 'Instance',
      command: 'os foundation operation watch <operationId>', method: 'GET',
      path: '/api/foundation/osaa/operations/{operationId}', pathParams: ['operationId'],
      executionClass: 'console-api', risk: 'low', riskClass: 'R0', scope: 'read', inputSchema: { type: 'object', properties: {} },
      webShell: availableInWebShell('Watches the same durable operationId and postcondition receipt used by every channel.'),
      description: 'Watch durable operation progress and postconditions',
    },
  ];
}

function postgresOwnerAction(actionId) {
  const action = postgresOwnerActionDefinitions().find((item) => item.actionId === actionId);
  if (!action) throw new Error(`unknown PostgreSQL owner action: ${actionId}`);
  return action;
}

function postgresOwnerActionBinding(action) {
  return {
    method: action.method, path: action.path,
    ...(action.pathParams?.length ? { pathParams: [...action.pathParams] } : {}),
    ...(action.approval ? { approval: action.approval } : {}),
  };
}

function postgresOwnerContractProjection(actionId) {
  const action = postgresOwnerAction(actionId);
  return {
    contractVersion: POSTGRES_OWNER_CONTRACT_VERSION,
    sourceRevision: POSTGRES_OWNER_SOURCE_REVISION,
    capabilityId: 'data.sql.postgres', requestType: action.requestType,
    semanticIdentity: {
      capabilityId: 'data.sql.postgres', requestType: action.requestType,
      actionId: action.actionId, toolId: action.toolId,
    },
    actionBinding: postgresOwnerActionBinding(action),
  };
}

function postgresOwnerActionProjection(action) {
  return {
    ...postgresOwnerContractProjection(action.actionId),
    actionId: action.actionId, toolId: action.toolId, requestType: action.requestType,
    executionClass: action.executionClass, risk: action.risk, riskClass: action.riskClass,
    scope: action.scope, webShell: { ...action.webShell }, actionBinding: postgresOwnerActionBinding(action),
    inputSchema: action.inputSchema,
  };
}

function postgresReadinessEvidence(id, source, result, observedAt, revision) {
  const observedMs = Date.parse(observedAt);
  const expiresAt = new Date(observedMs + POSTGRES_OWNER_EVIDENCE_TTL_SECONDS * 1000).toISOString();
  const resolvedRevision = String(revision || result?.json?.metadata?.resourceVersion
    || result?.body?.sourceRevision || result?.body?.evidenceRevision
    || `${result?.ok ? 'observed' : 'unavailable'}:${result?.status || 'unknown'}`);
  return {
    id, source, revision: resolvedRevision, observedAt,
    ttlSeconds: POSTGRES_OWNER_EVIDENCE_TTL_SECONDS, expiresAt,
    stale: Date.now() > Date.parse(expiresAt), status: result?.ok ? 'Observed' : 'Unavailable',
  };
}

const POSTGRES_READINESS_STAGE_BY_BLOCKER = Object.freeze({
  POSTGRES_CLAIM_CRD_NOT_INSTALLED: 'Contract',
  FOUNDATION_CONTROL_PLANE_NOT_READY: 'Provider',
  STACKGRES_CRD_NOT_INSTALLED: 'Provider',
  STACKGRES_OPERATOR_NOT_READY: 'Provider',
  POSTGRES_RUNTIME_CATALOG_INCOMPLETE: 'Catalog',
  POSTGRES_ADDON_PLAN_UNAVAILABLE: 'Catalog',
  POSTGRES_NAMESPACE_UNAVAILABLE: 'Infrastructure',
  DYNAMIC_STORAGE_NOT_READY: 'Infrastructure',
  HIS_PREFLIGHT_NOT_READY: 'Infrastructure',
  OPERATION_LEDGER_NOT_READY: 'Governance',
  INDEPENDENT_AAL2_APPROVAL_REQUIRED: 'Governance',
});
const POSTGRES_READINESS_STAGE_ORDER = Object.freeze(['OwnerAPI', 'Contract', 'Provider', 'Catalog', 'Infrastructure', 'Governance', 'Ready']);

function postgresReadinessStage(blockers) {
  if (!blockers.length) return 'Ready';
  return blockers.map((item) => item.stage || 'OwnerAPI')
    .sort((a, b) => POSTGRES_READINESS_STAGE_ORDER.indexOf(a) - POSTGRES_READINESS_STAGE_ORDER.indexOf(b))[0];
}

function postgresReadinessBlocker(code, component, message, affectedOperations, owner, action, automatic = false, evidenceRefs = [component]) {
  return {
    id: `data.sql.postgres/${code}`, code, stage: POSTGRES_READINESS_STAGE_BY_BLOCKER[code] || 'OwnerAPI',
    component, message, affectedOperations, blocksActions: affectedOperations,
    evidenceRefs, remediation: { owner, action, automatic },
  };
}

function postgresCrdReadinessBlocker(result, {
  component, missingCode, unavailableCode, missingMessage, missingAction, affectedOperations,
}) {
  if (result?.ok) return null;
  if (Number(result?.status) === 404) return postgresReadinessBlocker(
    missingCode, component, missingMessage, affectedOperations, 'PFSS', missingAction, false,
  );
  const status = Number(result?.status) || 0;
  return postgresReadinessBlocker(
    unavailableCode,
    component,
    `${component} readiness evidence could not be observed${status ? ` (HTTP ${status})` : ''}.`,
    affectedOperations,
    'PFSS',
    `Restore delegated read access to CustomResourceDefinition/${component}`,
    false,
  );
}

function postgresReadinessProjection(blockers, checks, evidence, observedAt) {
  const planningCodes = new Set(['POSTGRES_CLAIM_CRD_NOT_INSTALLED', 'POSTGRES_CLAIM_CRD_UNOBSERVABLE', 'POSTGRES_RUNTIME_CATALOG_INCOMPLETE', 'POSTGRES_ADDON_PLAN_UNAVAILABLE', 'POSTGRES_NAMESPACE_UNAVAILABLE']);
  const readyToPlan = !blockers.some((item) => planningCodes.has(item.code));
  const actions = postgresOwnerActionDefinitions().filter((item) => !['capability.read', 'readiness.read'].includes(item.actionId));
  const nextActions = actions.map((action) => {
    const blockedBy = blockers.filter((item) => item.blocksActions.includes(action.actionId)).map((item) => item.id);
    const required = [...(action.pathParams || []), ...(action.inputSchema?.required || [])];
    return {
      ...postgresOwnerActionProjection(action), supported: true, available: blockedBy.length === 0, blockedBy,
      missingInputs: { required, schema: action.inputSchema },
    };
  });
  const evidenceRevision = crypto.createHash('sha256')
    .update(evidence.map((item) => `${item.id}:${item.revision}`).join('|')).digest('hex');
  const stale = evidence.some((item) => item.stale);
  return {
    ...postgresOwnerContractProjection('readiness.read'),
    schema: 'foundation.control-readiness/v1', capability: 'data.sql.postgres',
    state: blockers.length ? 'Blocked' : 'Ready', stage: postgresReadinessStage(blockers),
    readyToPlan, readyToExecute: blockers.length === 0 && !stale,
    checks, blockers, evidenceRevision, evidence, observedAt,
    source: { kind: 'FoundationOwnerAPI', name: 'data.sql.postgres', revision: POSTGRES_OWNER_SOURCE_REVISION },
    staleness: {
      ttlSeconds: POSTGRES_OWNER_EVIDENCE_TTL_SECONDS, stale,
      expiresAt: evidence.map((item) => item.expiresAt).sort()[0] || observedAt,
    },
    missingInputs: nextActions.filter((item) => item.missingInputs.required.length)
      .map((item) => ({ actionId: item.actionId, toolId: item.toolId, ...item.missingInputs })),
    nextActions,
  };
}

async function postgresOsaaStatus(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const [runtimeCatalog, planResult, namespaceResult, claimResult, clusterResult] = await Promise.all([
      loadPostgresRuntimeCatalog(actor),
      k8sJson('GET', '/apis/catalog.opensphere.io/v1alpha1/addonplans', undefined, actor),
      k8sJson('GET', '/api/v1/namespaces', undefined, actor),
      k8sJson('GET', '/apis/provisioning.opensphere.io/v1beta1/postgresclaims', undefined, actor),
      k8sJson('GET', '/apis/stackgres.io/v1/sgclusters', undefined, actor),
    ]);
    const required = [planResult, namespaceResult, claimResult];
    const failed = required.find((item) => !item.ok);
    if (failed) throw { code: failed.status, msg: `PostgreSQL owner inventory unavailable: ${k8sFailure(failed)}` };
    if (!clusterResult.ok && clusterResult.status !== 404) {
      throw { code: clusterResult.status, msg: `PostgreSQL runtime inventory unavailable: ${k8sFailure(clusterResult)}` };
    }
    const plans = (planResult.json?.items || []).map(postgresPlanProjection)
      .filter((item) => item.name && item.provider === 'stackgres')
      .sort((a, b) => Number(b.lifecycle === 'Available') - Number(a.lifecycle === 'Available') || a.name.localeCompare(b.name));
    const managedNamespaces = (namespaceResult.json?.items || [])
      .filter((item) => !item?.metadata?.deletionTimestamp
        && (item?.metadata?.labels?.['opensphere.io/managed-by'] === 'foundation'
          || item?.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'foundation-control-plane'))
      .map((item) => String(item?.metadata?.name || '')).filter(Boolean).sort();
    const claims = (claimResult.json?.items || []).map(postgresClaimProjection)
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    const clusters = ((clusterResult.ok ? clusterResult.json?.items : []) || []).map(postgresClusterProjection)
      .sort((a, b) => Number(b.ready) - Number(a.ready) || a.displayName.localeCompare(b.displayName));
    return jsonRes(res, 200, {
      ...postgresOwnerContractProjection('cluster.status'),
      schema: 'foundation.postgres.owner-status/v1alpha1', owner: 'PFSS / data.sql.postgres',
      capabilities: ['status-read', 'claim-plan', 'claim-create'], runtimeCatalog, plans,
      managedNamespaces, claims, clusters, refreshedAt: new Date().toISOString(),
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaPlan(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    // Planning is read-only and remains available while execution readiness is
    // blocked. Execution rechecks the lifecycle gate and current authority.
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['name', 'namespace', 'alias', 'database', 'owner', 'plan', 'postgresVersion', 'deletionPolicy', 'storage', 'extensions', 'profileRefs', 'reason']);
    const postgresResource = postgresClaimResource(body);
    const resource = foundationPostgresClaimResource(body);
    await requireManagedPostgresNamespace(resource.metadata.namespace, actor);
    const [planResult, runtimeCatalog] = await Promise.all([
      k8sJson('GET', `/apis/catalog.opensphere.io/v1alpha1/addonplans/${postgresResource.spec.planRef.name}`, undefined, actor),
      loadPostgresRuntimeCatalog(actor),
    ]);
    if (!planResult.ok) throw { code: planResult.status, msg: `AddOnPlan unavailable: ${k8sFailure(planResult)}` };
    const plan = validatePostgresClaimPlan(planResult.json, runtimeCatalog, postgresResource);
    const path = `${FOUNDATION_API}/namespaces/${resource.metadata.namespace}/foundationclaims`;
    const existing = await k8sJson('GET', `${path}/${resource.metadata.name}`, undefined, actor);
    if (!existing.ok && existing.status !== 404) throw { code: existing.status, msg: k8sFailure(existing) };
    const same = existing.ok && JSON.stringify(existing.json?.spec || {}) === JSON.stringify(resource.spec)
      && existing.json?.metadata?.annotations?.['opensphere.io/display-name'] === resource.metadata.annotations['opensphere.io/display-name'];
    if (existing.ok && !same) throw { code: 409, msg: `FoundationClaim ${resource.metadata.namespace}/${resource.metadata.name} already exists with a different contract` };
    let validated = resource;
    if (!existing.ok) {
      const validation = await k8sJson('POST', `${path}?dryRun=All&fieldManager=opensphere-foundation`, resource, actor);
      if (!validation.ok) throw { code: validation.status, msg: `FoundationClaim dry-run rejected: ${k8sFailure(validation)}` };
      validated = validation.json || resource;
    }
    return jsonRes(res, 200, {
      ...postgresOwnerContractProjection('cluster.plan'),
      schema: 'foundation.postgres.claim-plan/v1alpha1', owner: 'PFSS / data.sql.postgres',
      executionModel: 'FoundationClaim',
      target: `FoundationClaim/${resource.metadata.namespace}/${resource.metadata.name}`,
      action: same ? 'NoChange' : 'Create', expectedConfirmation: postgresClaimConfirmation(postgresResource),
      postconditions: [
        'FoundationClaim Bound and observedGeneration equals metadata.generation',
        'PostgresClaim Ready=True and observedGeneration equals metadata.generation',
        'SGCluster Ready=True',
        'credential Secret issued and referenced without credential projection',
      ],
      targetRevision: [planResult.json?.metadata?.resourceVersion || '', runtimeCatalog.resourceVersion, runtimeCatalog.operatorVersion].join(':'),
      plan, resource: foundationPostgresClaimProjection(validated), request: resource,
      warnings: [
        ...(plan.productionHA ? [] : ['Selected plan is not production HA']),
        ...(postgresResource.spec.deletionPolicy === 'Delete' ? ['DeletionPolicy Delete removes the managed cluster when the claim is released'] : []),
        ...(plan.warning ? [plan.warning] : []),
      ],
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaCapabilities(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    await verifyToken(requestToken(req));
    const requested = new URL(req.url || '/', 'http://localhost').searchParams.get('capability');
    if (requested && requested !== 'data.sql.postgres') return jsonRes(res, 404, { error: `unknown Foundation capability: ${requested}` });
    const actions = postgresOwnerActionDefinitions();
    return jsonRes(res, 200, {
      ...postgresOwnerContractProjection('capability.read'),
      schema: 'foundation.control-capabilities/v1', owner: 'PFSS', capability: 'data.sql.postgres',
      operations: actions.filter((item) => !['capability.read', 'readiness.read'].includes(item.actionId)).map((item) => item.actionId),
      actions: actions.map(postgresOwnerActionProjection), supportedRequestTypes: ['Instance'],
      approvalPolicy: 'exact-confirmation', executionModel: 'PostgresClaim', requestModel: 'FoundationClaim',
      controller: 'foundation-control-plane', provider: 'stackgres',
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 401, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaReadiness(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  const rawToken = requestToken(req);
  try {
    const actor = requireConsoleAdmin(await verifyToken(rawToken));
    const [controller, postgresCRD, stackgresCRD, deployments, runtimeResult, plansResult, namespacesResult, storageResult, lifecycleResult, operationLedgerResult] = await Promise.all([
      k8sJson('GET', '/apis/apps/v1/namespaces/opensphere-system/deployments/foundation-control-plane', undefined, actor),
      k8sJson('GET', '/apis/apiextensions.k8s.io/v1/customresourcedefinitions/postgresclaims.provisioning.opensphere.io', undefined, actor),
      k8sJson('GET', '/apis/apiextensions.k8s.io/v1/customresourcedefinitions/sgclusters.stackgres.io', undefined, actor),
      k8sJson('GET', '/apis/apps/v1/deployments', undefined, actor),
      k8sJson('GET', `/apis/catalog.opensphere.io/v1alpha1/postgresruntimecatalogs/${POSTGRES_RUNTIME_CATALOG}`, undefined, actor),
      k8sJson('GET', '/apis/catalog.opensphere.io/v1alpha1/addonplans', undefined, actor),
      k8sJson('GET', '/api/v1/namespaces', undefined, actor),
      k8sJson('GET', '/apis/storage.k8s.io/v1/storageclasses', undefined, actor),
      platformReadinessAuthority(rawToken).then((body) => ({ ok: true, body })).catch((error) => ({ ok: false, error })),
      consoleAdminRead('/api/osaa/operations?limit=1', rawToken).then((body) => ({ ok: true, body })).catch((error) => ({ ok: false, error })),
    ]);
    const blockers = [];
    const observedAt = new Date().toISOString();
    const desired = Number(controller.json?.spec?.replicas || 0);
    const ready = Number(controller.json?.status?.readyReplicas || 0);
    if (!controller.ok || desired < 1 || ready !== desired) blockers.push(postgresReadinessBlocker(
      'FOUNDATION_CONTROL_PLANE_NOT_READY', 'foundation-control-plane', `foundation-control-plane Ready ${ready}/${desired}`,
      ['cluster.create'], 'PFSS', 'Restore the foundation-control-plane Deployment to Ready', false));
    const postgresCrdBlocker = postgresCrdReadinessBlocker(postgresCRD, {
      component: 'postgresclaims.provisioning.opensphere.io',
      missingCode: 'POSTGRES_CLAIM_CRD_NOT_INSTALLED', unavailableCode: 'POSTGRES_CLAIM_CRD_UNOBSERVABLE',
      missingMessage: 'PostgresClaim CRD is not installed.', missingAction: 'Install the signed PFSS PostgreSQL contract bundle',
      affectedOperations: ['cluster.plan', 'cluster.create'],
    });
    if (postgresCrdBlocker) blockers.push(postgresCrdBlocker);
    const stackgresCrdBlocker = postgresCrdReadinessBlocker(stackgresCRD, {
      component: 'sgclusters.stackgres.io',
      missingCode: 'STACKGRES_CRD_NOT_INSTALLED', unavailableCode: 'STACKGRES_CRD_UNOBSERVABLE',
      missingMessage: 'StackGres SGCluster CRD is not installed.', missingAction: 'Install the approved StackGres operator bundle',
      affectedOperations: ['cluster.create'],
    });
    if (stackgresCrdBlocker) blockers.push(stackgresCrdBlocker);
    const stackgresOperators = (deployments.json?.items || []).filter((item) => String(item?.metadata?.name || '').includes('stackgres'));
    const stackgresReady = deployments.ok && stackgresOperators.some((item) => Number(item?.status?.readyReplicas || 0) >= Number(item?.spec?.replicas || 1));
    if (!stackgresReady) blockers.push(postgresReadinessBlocker(
      'STACKGRES_OPERATOR_NOT_READY', 'stackgres-operator', 'No Ready StackGres operator Deployment was observed.',
      ['cluster.create'], 'PFSS', 'Restore the StackGres operator Deployment to Ready', false));
    let runtimeCatalog = null;
    if (runtimeResult.ok) runtimeCatalog = postgresRuntimeCatalogProjection(runtimeResult.json);
    if (!runtimeCatalog || runtimeCatalog.provider !== 'stackgres' || !runtimeCatalog.operatorVersion || !runtimeCatalog.versions.length) blockers.push(postgresReadinessBlocker(
      'POSTGRES_RUNTIME_CATALOG_INCOMPLETE', POSTGRES_RUNTIME_CATALOG, 'PostgreSQL runtime catalog is missing or incomplete.',
      ['catalog.read', 'cluster.plan', 'cluster.create'], 'PFSS', 'Publish a complete signed PostgreSQL runtime catalog', false));
    const availablePlans = (plansResult.json?.items || []).map(postgresPlanProjection)
      .filter((item) => item.provider === 'stackgres' && item.lifecycle === 'Available');
    if (!plansResult.ok || availablePlans.length === 0) blockers.push(postgresReadinessBlocker(
      'POSTGRES_ADDON_PLAN_UNAVAILABLE', 'catalog.opensphere.io/AddOnPlan', 'No Available StackGres AddOnPlan exists.',
      ['cluster.plan', 'cluster.create'], 'PFSS', 'Publish at least one Available PostgreSQL AddOnPlan', false));
    const managedNamespaces = (namespacesResult.json?.items || []).filter((item) => !item?.metadata?.deletionTimestamp
      && (item?.metadata?.labels?.['opensphere.io/managed-by'] === 'foundation'
        || item?.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'foundation-control-plane'));
    if (!namespacesResult.ok || managedNamespaces.length === 0) blockers.push(postgresReadinessBlocker(
      'POSTGRES_NAMESPACE_UNAVAILABLE', 'foundation-managed-namespace', 'No admitted Foundation namespace exists.',
      ['cluster.plan', 'cluster.create'], 'PFSS', 'Admit a namespace with the Foundation managed-by label', false));
    const dynamicStorage = (storageResult.json?.items || []).filter((item) => String(item?.provisioner || '').trim());
    if (!storageResult.ok || dynamicStorage.length === 0) blockers.push(postgresReadinessBlocker(
      'DYNAMIC_STORAGE_NOT_READY', 'storage.k8s.io/StorageClass', 'No dynamic StorageClass provisioner is available.',
      ['cluster.create'], 'Cluster Manager / HIS', 'Restore the declared storage provisioner and StorageClass', false));
    const prerequisites = lifecycleResult.ok && Array.isArray(lifecycleResult.body?.prerequisites) ? lifecycleResult.body.prerequisites : [];
    const hisPreflight = prerequisites.find((item) => item.key === 'his-preflight');
    if (!lifecycleResult.ok || !hisPreflight?.ready) blockers.push(postgresReadinessBlocker(
      'HIS_PREFLIGHT_NOT_READY', String(hisPreflight?.component || 'his-preflight'), String(hisPreflight?.message || 'HIS storage/network/DNS preflight is not ready.'),
      ['cluster.create'], 'Cluster Manager / HIS', String(hisPreflight?.remediation || 'Restore HIS storage, network, and DNS preflight readiness'), false, ['his-preflight']));
    if (!operationLedgerResult.ok) blockers.push(postgresReadinessBlocker(
      'OPERATION_LEDGER_NOT_READY', 'console.module_operation', 'Console durable operation ledger is unavailable.',
      ['cluster.create', 'operation.watch'], 'Console', 'Restore the Console module operation API and database ledger', false));
    if (actor.assurance !== 'aal2') blockers.push(postgresReadinessBlocker(
      'INDEPENDENT_AAL2_APPROVAL_REQUIRED', 'console-identity', 'The CLI initiator is AAL1; execution requires an independent AAL2 browser-session approver.',
      ['cluster.create'], 'Console', 'Obtain the operation-bound independent AAL2 approval', false));
    const stackgresRevision = crypto.createHash('sha256').update(JSON.stringify(stackgresOperators.map((item) => ({
      uid: item?.metadata?.uid || '', generation: item?.metadata?.generation || 0,
      observedGeneration: item?.status?.observedGeneration || 0, readyReplicas: item?.status?.readyReplicas || 0,
    })))).digest('hex');
    const evidence = [
      postgresReadinessEvidence('foundation-control-plane', 'Kubernetes Deployment/opensphere-system/foundation-control-plane', controller, observedAt),
      postgresReadinessEvidence('postgresclaims.provisioning.opensphere.io', 'Kubernetes CustomResourceDefinition/postgresclaims.provisioning.opensphere.io', postgresCRD, observedAt),
      postgresReadinessEvidence('sgclusters.stackgres.io', 'Kubernetes CustomResourceDefinition/sgclusters.stackgres.io', stackgresCRD, observedAt),
      postgresReadinessEvidence('stackgres-operator', 'Kubernetes Deployment list/stackgres operator', deployments, observedAt, stackgresRevision),
      postgresReadinessEvidence(POSTGRES_RUNTIME_CATALOG, `Kubernetes PostgresRuntimeCatalog/${POSTGRES_RUNTIME_CATALOG}`, runtimeResult, observedAt),
      postgresReadinessEvidence('catalog.opensphere.io/AddOnPlan', 'Kubernetes AddOnPlan list', plansResult, observedAt),
      postgresReadinessEvidence('foundation-managed-namespace', 'Kubernetes Namespace list/Foundation admission labels', namespacesResult, observedAt),
      postgresReadinessEvidence('storage.k8s.io/StorageClass', 'Kubernetes StorageClass list', storageResult, observedAt),
      postgresReadinessEvidence('his-preflight', 'Cluster Manager platform readiness authority', lifecycleResult, observedAt),
      postgresReadinessEvidence('console.module_operation', 'Console durable operation ledger', operationLedgerResult, observedAt),
      postgresReadinessEvidence('console-identity', 'Console evaluated identity assurance', { ok: Boolean(actor.subject) }, observedAt, `assurance:${actor.assurance || 'aal1'}`),
    ];
    const checks = {
      ownerAPI: true, foundationControlPlane: controller.ok && desired > 0 && ready === desired,
      postgresClaimCRD: postgresCRD.ok, stackgresCRD: stackgresCRD.ok, stackgresOperator: stackgresReady,
      runtimeCatalog: Boolean(runtimeCatalog?.versions?.length), addOnPlans: availablePlans.length,
      namespaces: managedNamespaces.length, storageClasses: dynamicStorage.length,
      delegatedIdentity: Boolean(actor.subject), delegatedAssurance: actor.assurance || 'aal1', operationLedger: operationLedgerResult.ok,
    };
    return jsonRes(res, 200, postgresReadinessProjection(blockers, checks, evidence, observedAt));
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 503, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaCatalog(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const [runtimeCatalog, plansResult, namespacesResult, storageResult] = await Promise.all([
      loadPostgresRuntimeCatalog(actor),
      k8sJson('GET', '/apis/catalog.opensphere.io/v1alpha1/addonplans', undefined, actor),
      k8sJson('GET', '/api/v1/namespaces', undefined, actor),
      k8sJson('GET', '/apis/storage.k8s.io/v1/storageclasses', undefined, actor),
    ]);
    const failed = [plansResult, namespacesResult, storageResult].find((item) => !item.ok);
    if (failed) throw { code: failed.status, msg: k8sFailure(failed) };
    const plans = (plansResult.json?.items || []).map(postgresPlanProjection)
      .filter((item) => item.provider === 'stackgres' && item.lifecycle === 'Available');
    const namespaces = (namespacesResult.json?.items || []).filter((item) => !item?.metadata?.deletionTimestamp
      && (item?.metadata?.labels?.['opensphere.io/managed-by'] === 'foundation'
        || item?.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'foundation-control-plane'))
      .map((item) => String(item.metadata.name)).sort();
    const storageClasses = (storageResult.json?.items || []).filter((item) => String(item?.provisioner || '').trim())
      .map((item) => ({ name: String(item.metadata?.name || ''), provisioner: String(item.provisioner),
        isDefault: item.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' }));
    const observedAt = new Date().toISOString();
    const evidenceRevision = crypto.createHash('sha256').update(JSON.stringify({
      runtime: runtimeCatalog.resourceVersion,
      plans: plans.map((item) => [item.name, item.resourceVersion]),
      namespacesResourceVersion: namespacesResult.json?.metadata?.resourceVersion || '',
      storageResourceVersion: storageResult.json?.metadata?.resourceVersion || '',
    })).digest('hex');
    return jsonRes(res, 200, {
      ...postgresOwnerContractProjection('catalog.read'),
      schema: 'foundation.postgres.catalog/v1', owner: 'PFSS', capability: 'data.sql.postgres',
      namespaces, plans, runtimeCatalog, storageClasses,
      defaults: { postgresVersion: runtimeCatalog.defaultVersion, authority: 'PostgresRuntimeCatalog', source: POSTGRES_RUNTIME_CATALOG },
      evidenceRevision, observedAt, refreshedAt: observedAt,
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaApply(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try {
    actor = await foundationOwnerActor(req);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['name', 'namespace', 'alias', 'database', 'owner', 'plan', 'postgresVersion', 'deletionPolicy', 'storage', 'extensions', 'profileRefs', 'reason', 'confirm']);
    const reason = requireOwnerReason(body.reason);
    const idempotencyKey = String(req.headers['x-idempotency-key'] || '').trim();
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) throw { code: 400, msg: 'X-Idempotency-Key is required' };
    const postgresResource = postgresClaimResource(body);
    const resource = foundationPostgresClaimResource(body);
    requirePostgresClaimConfirm(body.confirm, postgresResource);
    await requireManagedPostgresNamespace(resource.metadata.namespace, actor);
    const [planResult, runtimeCatalog] = await Promise.all([
      k8sJson('GET', `/apis/catalog.opensphere.io/v1alpha1/addonplans/${postgresResource.spec.planRef.name}`, undefined, actor),
      loadPostgresRuntimeCatalog(actor),
    ]);
    if (!planResult.ok) throw { code: planResult.status, msg: `AddOnPlan unavailable: ${k8sFailure(planResult)}` };
    validatePostgresClaimPlan(planResult.json, runtimeCatalog, postgresResource);
    const path = `${FOUNDATION_API}/namespaces/${resource.metadata.namespace}/foundationclaims`;
    const existing = await k8sJson('GET', `${path}/${resource.metadata.name}`, undefined, actor);
    if (existing.ok) {
      const same = JSON.stringify(existing.json?.spec || {}) === JSON.stringify(resource.spec)
        && existing.json?.metadata?.annotations?.['opensphere.io/display-name'] === resource.metadata.annotations['opensphere.io/display-name'];
      if (!same) throw { code: 409, msg: `FoundationClaim ${resource.metadata.namespace}/${resource.metadata.name} already exists with a different contract` };
      return jsonRes(res, 200, {
        ...postgresOwnerContractProjection('cluster.create'),
        accepted: true, created: false, idempotencyKey, operationId: null, operationLineage: 'legacy-direct',
        claim: foundationPostgresClaimProjection(existing.json),
      });
    }
    if (existing.status !== 404) throw { code: existing.status, msg: k8sFailure(existing) };
    const validation = await k8sJson('POST', `${path}?dryRun=All&fieldManager=opensphere-foundation-osaa`, resource, actor);
    if (!validation.ok) throw { code: validation.status, msg: `FoundationClaim dry-run rejected: ${k8sFailure(validation)}` };
    const target = `FoundationClaim/${resource.metadata.namespace}/${resource.metadata.name}`;
    await publishFoundationAudit(actor, 'foundation-postgres-create', target, 'attempt', `${reason}; idempotency=${idempotencyKey}`);
    const created = await k8sJson('POST', path, resource, actor);
    if (!created.ok) throw { code: created.status, msg: k8sFailure(created) };
    await publishFoundationAudit(actor, 'foundation-postgres-create', target, 'accepted', reason);
    return jsonRes(res, 202, {
      ...postgresOwnerContractProjection('cluster.create'),
      accepted: true, created: true, idempotencyKey, owner: 'PFSS',
      operationId: null, operationLineage: 'legacy-direct',
      target: { kind: 'FoundationClaim', namespace: resource.metadata.namespace, name: resource.metadata.name,
        uid: created.json?.metadata?.uid || '', generation: created.json?.metadata?.generation || 1 },
      claim: foundationPostgresClaimProjection(created.json),
    });
  } catch (e) {
    if (actor) await publishFoundationAudit(actor, 'foundation-postgres-create', 'FoundationClaim', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaClaimStatus(req, res, namespace, name) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    namespace = requireK8sName(namespace, 'namespace');
    name = requireK8sName(name, 'claim name');
    const [foundation, postgres] = await Promise.all([
      k8sJson('GET', `${FOUNDATION_API}/namespaces/${namespace}/foundationclaims/${name}`, undefined, actor),
      k8sJson('GET', `/apis/provisioning.opensphere.io/v1beta1/namespaces/${namespace}/postgresclaims/${name}`, undefined, actor),
    ]);
    if (!foundation.ok) throw { code: foundation.status, msg: k8sFailure(foundation) };
    const foundationClaim = foundationPostgresClaimProjection(foundation.json);
    const postgresClaim = postgres.ok ? postgresClaimProjection(postgres.json) : null;
    let stage = 'ClaimCreated';
    if (postgresClaim) stage = postgresClaim.phase === 'Ready' ? 'Verifying' : 'RuntimeProvisioning';
    if (postgresClaim?.conditions?.some((item) => item.reason === 'DatabaseRequestReconciling')) stage = 'DatabaseBootstrapping';
    if (postgresClaim?.ready && !foundationClaim.ready) stage = 'BindingIssuing';
    if (foundationClaim.ready && postgresClaim?.ready) stage = 'Ready';
    return jsonRes(res, 200, {
      ...postgresOwnerContractProjection('cluster.status'),
      schema: 'foundation.postgres.operation-status/v1', stage,
      foundationClaim, postgresClaim,
      ready: stage === 'Ready', owner: stage === 'Ready' ? null : 'PFSS', observedAt: new Date().toISOString(),
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}

function foundationCliManifest() {
  const actions = postgresOwnerActionDefinitions();
  return {
    kind: 'OpenSphereCLICommandManifest', schemaVersion: 'v1',
    contractVersion: POSTGRES_OWNER_CONTRACT_VERSION, sourceRevision: POSTGRES_OWNER_SOURCE_REVISION,
    capabilityId: 'data.sql.postgres', requestTypes: ['Instance'],
    compatibility: { additiveResponses: true, unknownResponseFields: 'ignore', unknownRequestFields: 'reject' },
    cli: { commandPrefix: 'os foundation' },
    tools: actions.map((action) => ({
      ...postgresOwnerContractProjection(action.actionId),
      id: action.toolId, actionId: action.actionId,
      contractVersion: POSTGRES_OWNER_CONTRACT_VERSION, sourceRevision: POSTGRES_OWNER_SOURCE_REVISION,
      capabilityId: 'data.sql.postgres', requestType: action.requestType,
      command: action.command, method: action.method, path: action.path,
      executionClass: action.executionClass, risk: action.risk, riskClass: action.riskClass, scope: action.scope,
      ...(action.supportsFile ? { supportsFile: true } : {}),
      ...(action.explicitAction ? { explicitAction: true } : {}),
      ...(action.pathParams?.length ? { pathParams: [...action.pathParams] } : {}),
      inputSchema: action.inputSchema, webShell: { ...action.webShell },
      actionBinding: postgresOwnerActionBinding(action), description: action.description,
    })),
  };
}

async function forwardConsoleDurable(req, res, method, pathname, payload, project = (value) => value) {
  try {
    const rawToken = requestToken(req);
    await verifyToken(rawToken);
    const response = await fetch(`${CONSOLE_IDENTITY_URL}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${rawToken}`, accept: 'application/json',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(method === 'GET' ? 10000 : 30000),
    });
    const body = await response.json().catch(() => ({ error: `Console durable operation HTTP ${response.status}` }));
    return jsonRes(res, response.status, response.ok ? project(body) : body);
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 503, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaDurablePlan(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['name', 'namespace', 'alias', 'database', 'owner', 'plan', 'postgresVersion', 'deletionPolicy', 'storage', 'extensions', 'profileRefs', 'reason']);
    return forwardConsoleDurable(req, res, 'POST', '/api/osaa/operations/plan', {
      action: 'create-postgres-cluster', target: body, reason: body.reason,
    }, (plan) => ({
      ...plan, ...postgresOwnerContractProjection('cluster.plan'),
      operationAction: plan.action, action: 'Create', risk: 'medium', riskClass: 'R2', requestType: 'Instance',
    }));
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}

async function postgresOsaaDurableApply(req, res, planId) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    if (!/^pgplan-[0-9a-f-]{36}$/i.test(planId)) throw { code: 400, msg: 'invalid PostgreSQL plan ID' };
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['confirm']);
    return forwardConsoleDurable(req, res, 'POST', '/api/osaa/operations', { planId, confirmation: String(body.confirm || '') },
      (operation) => ({ ...operation, ...postgresOwnerContractProjection('cluster.create') }));
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}

function postgresOperationOwnerEvidence(foundationResult, postgresResult, observedAt = new Date().toISOString()) {
  const foundationClaim = foundationResult?.ok ? foundationPostgresClaimProjection(foundationResult.json) : null;
  const postgresClaim = postgresResult?.ok ? postgresClaimProjection(postgresResult.json) : null;
  const sources = [
    foundationClaim ? {
      kind: 'FoundationClaim', namespace: foundationClaim.namespace, name: foundationClaim.name,
      uid: foundationClaim.uid, resourceVersion: foundationClaim.resourceVersion,
      generation: foundationClaim.generation, observedGeneration: foundationClaim.observedGeneration,
      ready: foundationClaim.ready,
    } : null,
    postgresClaim ? {
      kind: 'PostgresClaim', namespace: postgresClaim.namespace, name: postgresClaim.name,
      uid: postgresClaim.uid, resourceVersion: postgresClaim.resourceVersion,
      generation: postgresClaim.generation, observedGeneration: postgresClaim.observedGeneration,
      ready: postgresClaim.ready,
    } : null,
  ].filter(Boolean);
  const missing = !foundationClaim || !postgresClaim;
  const generationStale = sources.some((item) => item.generation <= 0
    || item.observedGeneration !== item.generation);
  const expiresAt = new Date(Date.parse(observedAt) + POSTGRES_OWNER_EVIDENCE_TTL_SECONDS * 1000).toISOString();
  const ttlExpired = Date.now() > Date.parse(expiresAt);
  const stale = missing || generationStale || ttlExpired;
  const evidenceRevision = missing ? null : crypto.createHash('sha256').update(JSON.stringify({
    contractVersion: POSTGRES_OWNER_CONTRACT_VERSION,
    sourceRevision: POSTGRES_OWNER_SOURCE_REVISION,
    sources,
  })).digest('hex');
  return {
    evidenceRevision, observedAt, source: 'kubernetes-api',
    ttlSeconds: POSTGRES_OWNER_EVIDENCE_TTL_SECONDS, expiresAt,
    missing, stale,
    reasons: [
      ...(missing ? ['OwnerEvidenceMissing'] : []),
      ...(generationStale ? ['ObservedGenerationStale'] : []),
      ...(ttlExpired ? ['EvidenceTTLExpired'] : []),
    ],
    sources,
  };
}

function postgresOperationCompletion(operation, ownerStatus, ownerEvidence, operationId = operation?.operationId) {
  const operationPhase = String(operation?.phase || '');
  const verificationState = String(operation?.verificationState || '');
  const verifierId = String(operation?.verifierId || '').trim();
  const ownerRequired = operation?.action === 'create-postgres-cluster';
  const ownerReady = !ownerRequired || ownerStatus?.stage === 'Ready';
  const evidenceReady = !ownerRequired || Boolean(ownerEvidence?.evidenceRevision)
    && ownerEvidence?.missing !== true && ownerEvidence?.stale !== true;
  const durableVerified = verificationState === 'succeeded' && verifierId.length > 0;
  const success = operationPhase === 'Succeeded' && durableVerified && ownerReady && evidenceReady;
  const terminalFailurePhases = new Set([
    'Failed', 'VerificationFailed', 'Inconclusive', 'TimedOut', 'RolledBack', 'Cancelled',
    'AuthorizationExpired', 'PreflightBlocked',
  ]);
  const terminal = success || terminalFailurePhases.has(operationPhase);
  let state = operationPhase || 'Unknown';
  if (success) state = 'Succeeded';
  else if (operationPhase === 'Succeeded' && !durableVerified) state = 'VerificationPending';
  else if (operationPhase === 'Succeeded' && !evidenceReady) state = 'OwnerEvidencePending';
  else if (operationPhase === 'Succeeded' && !ownerReady) state = 'OwnerReadinessPending';

  const completion = {
    terminal,
    success,
    verified: success,
    state,
    stale: ownerRequired ? ownerEvidence?.stale !== false : false,
    evidenceRevision: ownerRequired ? ownerEvidence?.evidenceRevision || null : null,
  };
  if (success) {
    const actionContract = postgresOwnerContractProjection('cluster.create');
    completion.receipt = {
      operationId: String(operation?.operationId || operationId || ''),
      verifierId,
      verificationState,
      verifiedAt: operation?.verifiedAt || operation?.updatedAt || null,
      updatedAt: operation?.updatedAt || null,
      semanticIdentity: actionContract.semanticIdentity,
      actionBinding: actionContract.actionBinding,
      ownerEvidenceRevision: ownerEvidence.evidenceRevision,
    };
  }
  return completion;
}

function postgresOperationWatchStage(operation, ownerStatus, completion) {
  const acceptedPhases = new Set(['AwaitingApproval', 'Queued', 'Claimed', 'Preflighting', 'Executing']);
  const resourceStage = ownerStatus?.stage || (acceptedPhases.has(operation?.phase) ? 'Accepted' : operation?.phase);
  // Keep ownerStatus.stage as the resource reconciliation stage, but never expose
  // top-level Ready until the durable operation has also been independently verified.
  return resourceStage === 'Ready' && !completion?.success ? completion?.state : resourceStage;
}

async function postgresOsaaOperationWatch(req, res, operationId) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return jsonRes(res, 400, { error: 'invalid operation ID' });
  try {
    const rawToken = requestToken(req);
    const actor = requireConsoleAdmin(await verifyToken(rawToken));
    const operationResponse = await fetch(`${CONSOLE_IDENTITY_URL}/api/osaa/operations/${operationId}`, {
      headers: { authorization: `Bearer ${rawToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    });
    const operation = await operationResponse.json().catch(() => ({}));
    if (!operationResponse.ok) return jsonRes(res, operationResponse.status, operation);
    const target = operation.target || {};
    let ownerStatus = null;
    let ownerEvidence = null;
    if (operation.action === 'create-postgres-cluster' && target.namespace && target.name) {
      const observedAt = new Date().toISOString();
      const [foundation, postgres] = await Promise.all([
        k8sJson('GET', `${FOUNDATION_API}/namespaces/${target.namespace}/foundationclaims/${target.name}`, undefined, actor),
        k8sJson('GET', `/apis/provisioning.opensphere.io/v1beta1/namespaces/${target.namespace}/postgresclaims/${target.name}`, undefined, actor),
      ]);
      ownerEvidence = postgresOperationOwnerEvidence(foundation, postgres, observedAt);
      if (foundation.ok) {
        const foundationClaim = foundationPostgresClaimProjection(foundation.json);
        const postgresClaim = postgres.ok ? postgresClaimProjection(postgres.json) : null;
        let stage = 'ClaimCreated';
        if (postgresClaim) stage = postgresClaim.phase === 'Ready' ? 'Verifying' : 'RuntimeProvisioning';
        if (postgresClaim?.conditions?.some((item) => item.reason === 'DatabaseRequestReconciling')) stage = 'DatabaseBootstrapping';
        if (postgresClaim?.ready && !foundationClaim.ready) stage = 'BindingIssuing';
        if (foundationClaim.ready && postgresClaim?.ready) stage = 'Ready';
        ownerStatus = { stage, foundationClaim, postgresClaim, evidence: ownerEvidence, owner: stage === 'Ready' ? null : 'PFSS' };
      }
    }
    const completion = postgresOperationCompletion(operation, ownerStatus, ownerEvidence, operationId);
    const stage = postgresOperationWatchStage(operation, ownerStatus, completion);
    return jsonRes(res, 200, { ...operation, ...postgresOwnerContractProjection('operation.watch'), stage, operationPhase: operation.phase,
      owner: ownerStatus?.owner ?? (stage === 'Accepted' ? 'Console' : null), ownerStatus, completion });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 503, { error: e.msg || e.message || String(e) });
  }
}

async function postgresRuntimes(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const catalog = await loadPostgresRuntimeCatalog(actor);
    return jsonRes(res, 200, { schema: 'foundation.postgres.runtimes/v1alpha1', catalog, refreshedAt: new Date().toISOString() });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}

function postgresProfileKind(value) {
  const kind = String(value || '').trim();
  if (!Object.hasOwn(POSTGRES_PROFILE_KINDS, kind)) throw { code: 400, msg: 'profile kind must be instance, postgres, pooling, or objectStorage' };
  return { kind, ...POSTGRES_PROFILE_KINDS[kind] };
}
function profileObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw { code: 400, msg: `${field} must be an object` };
  return value;
}
function profileOnlyKeys(value, allowed, field) {
  const extra = Object.keys(profileObject(value, field)).filter((key) => !allowed.includes(key));
  if (extra.length) throw { code: 400, msg: `${field} has unsupported fields: ${extra.join(', ')}` };
}
function resourceQuantity(value, field) {
  const quantity = String(value || '').trim();
  if (!/^[0-9]+(?:\.[0-9]+)?(?:m|Ki|Mi|Gi|Ti|Pi|Ei)?$/.test(quantity)) throw { code: 400, msg: `${field} must be a Kubernetes resource quantity` };
  return quantity;
}
function sanitizeResourceLimit(value, field) {
  profileOnlyKeys(value, ['cpu', 'memory', 'hugePages'], field);
  const result = {};
  if (value.cpu !== undefined) result.cpu = resourceQuantity(value.cpu, `${field}.cpu`);
  if (value.memory !== undefined) result.memory = resourceQuantity(value.memory, `${field}.memory`);
  if (value.hugePages !== undefined) {
    profileOnlyKeys(value.hugePages, ['hugepages-1Gi', 'hugepages-2Mi'], `${field}.hugePages`);
    result.hugePages = {};
    for (const key of Object.keys(value.hugePages)) result.hugePages[key] = resourceQuantity(value.hugePages[key], `${field}.hugePages.${key}`);
  }
  return result;
}
function sanitizeNamedResourceLimits(value, field, requestsOnly = false) {
  const input = profileObject(value, field);
  const result = {};
  for (const [name, item] of Object.entries(input)) {
    requireK8sName(name, `${field} name`);
    if (requestsOnly) {
      profileOnlyKeys(item, ['cpu', 'memory'], `${field}.${name}`);
      result[name] = {};
      if (item.cpu !== undefined) result[name].cpu = resourceQuantity(item.cpu, `${field}.${name}.cpu`);
      if (item.memory !== undefined) result[name].memory = resourceQuantity(item.memory, `${field}.${name}.memory`);
    } else result[name] = sanitizeResourceLimit(item, `${field}.${name}`);
  }
  return result;
}
function sanitizeInstanceProfileSpec(value) {
  profileOnlyKeys(value, ['cpu', 'memory', 'hugePages', 'requests', 'containers', 'initContainers'], 'instance profile spec');
  const input = profileObject(value, 'instance profile spec');
  const spec = sanitizeResourceLimit({ cpu: input.cpu, memory: input.memory, hugePages: input.hugePages }, 'instance profile spec');
  if (input.requests !== undefined) {
    profileOnlyKeys(input.requests, ['cpu', 'memory', 'containers', 'initContainers'], 'instance profile spec.requests');
    spec.requests = {};
    if (input.requests.cpu !== undefined) spec.requests.cpu = resourceQuantity(input.requests.cpu, 'instance profile spec.requests.cpu');
    if (input.requests.memory !== undefined) spec.requests.memory = resourceQuantity(input.requests.memory, 'instance profile spec.requests.memory');
    if (input.requests.containers !== undefined) spec.requests.containers = sanitizeNamedResourceLimits(input.requests.containers, 'instance profile spec.requests.containers', true);
    if (input.requests.initContainers !== undefined) spec.requests.initContainers = sanitizeNamedResourceLimits(input.requests.initContainers, 'instance profile spec.requests.initContainers', true);
  }
  if (input.containers !== undefined) spec.containers = sanitizeNamedResourceLimits(input.containers, 'instance profile spec.containers');
  if (input.initContainers !== undefined) spec.initContainers = sanitizeNamedResourceLimits(input.initContainers, 'instance profile spec.initContainers');
  if (!spec.cpu && !spec.memory) throw { code: 400, msg: 'instance profile requires cpu or memory limit' };
  return spec;
}
function sanitizePostgresConfigSpec(value) {
  profileOnlyKeys(value, ['postgresVersion', 'postgresql.conf'], 'PostgreSQL configuration spec');
  const input = profileObject(value, 'PostgreSQL configuration spec');
  const postgresVersion = String(input.postgresVersion || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(postgresVersion)) throw { code: 400, msg: 'postgresVersion must be a supported major or minor version' };
  const config = profileObject(input['postgresql.conf'], 'postgresql.conf');
  if (Object.keys(config).length > 200) throw { code: 400, msg: 'postgresql.conf supports up to 200 parameters per profile' };
  const sanitized = {};
  for (const [key, raw] of Object.entries(config)) {
    if (!/^[a-z][a-z0-9_.-]{0,62}$/i.test(key)) throw { code: 400, msg: `unsupported PostgreSQL parameter: ${key}` };
    const parameter = String(raw ?? '').trim();
    if (!parameter || parameter.length > 1024) throw { code: 400, msg: `invalid PostgreSQL parameter value: ${key}` };
    sanitized[key] = parameter;
  }
  return { postgresVersion, 'postgresql.conf': sanitized };
}
function sanitizeScalarTree(value, field, depth = 0) {
  if (depth > 6 || !value || typeof value !== 'object' || Array.isArray(value)) throw { code: 400, msg: `${field} must be a nested object` };
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw { code: 400, msg: `unsupported ${field} key: ${key}` };
    if (item !== null && typeof item === 'object') output[key] = sanitizeScalarTree(item, `${field}.${key}`, depth + 1);
    else if (['string', 'number', 'boolean'].includes(typeof item) && String(item).length <= 1024) output[key] = item;
    else throw { code: 400, msg: `invalid ${field}.${key}` };
  }
  return output;
}
function sanitizePoolingConfigSpec(value) {
  profileOnlyKeys(value, ['pgBouncer'], 'pooling configuration spec');
  const pgBouncer = profileObject(value.pgBouncer, 'pgBouncer');
  profileOnlyKeys(pgBouncer, ['pgbouncer.ini'], 'pgBouncer');
  return { pgBouncer: { 'pgbouncer.ini': sanitizeScalarTree(pgBouncer['pgbouncer.ini'], 'pgbouncer.ini') } };
}
function sanitizeSecretKeyRef(value, field) {
  profileOnlyKeys(value, ['name', 'key'], field);
  const input = profileObject(value, field);
  return { name: requireK8sName(input.name, `${field}.name`), key: String(input.key || '').trim() || (() => { throw { code: 400, msg: `${field}.key is required` }; })() };
}
function sanitizeS3Credentials(value, field) {
  profileOnlyKeys(value, ['secretKeySelectors'], field);
  const selectors = profileObject(value.secretKeySelectors, `${field}.secretKeySelectors`);
  profileOnlyKeys(selectors, ['accessKeyId', 'secretAccessKey'], `${field}.secretKeySelectors`);
  return { secretKeySelectors: {
    accessKeyId: sanitizeSecretKeyRef(selectors.accessKeyId, `${field}.secretKeySelectors.accessKeyId`),
    secretAccessKey: sanitizeSecretKeyRef(selectors.secretAccessKey, `${field}.secretKeySelectors.secretAccessKey`),
  } };
}
function sanitizeObjectStorageSpec(value) {
  profileOnlyKeys(value, ['type', 's3', 's3Compatible'], 'object storage spec');
  const input = profileObject(value, 'object storage spec');
  const type = String(input.type || '').trim();
  if (!['s3', 's3Compatible'].includes(type)) throw { code: 400, msg: 'object storage type must be s3 or s3Compatible' };
  const config = profileObject(input[type], `object storage ${type}`);
  const allowed = type === 's3'
    ? ['bucket', 'region', 'storageClass', 'awsCredentials']
    : ['bucket', 'endpoint', 'region', 'storageClass', 'enablePathStyleAddressing', 'awsCredentials'];
  profileOnlyKeys(config, allowed, `object storage ${type}`);
  const bucket = String(config.bucket || '').trim();
  if (!bucket || bucket.length > 255) throw { code: 400, msg: `object storage ${type}.bucket is required` };
  const output = { bucket, awsCredentials: sanitizeS3Credentials(config.awsCredentials, `object storage ${type}.awsCredentials`) };
  for (const field of ['region', 'storageClass']) {
    if (config[field] !== undefined && String(config[field]).trim()) output[field] = String(config[field]).trim();
  }
  if (type === 's3Compatible') {
    if (config.endpoint !== undefined && String(config.endpoint).trim()) output.endpoint = String(config.endpoint).trim();
    if (config.enablePathStyleAddressing !== undefined) output.enablePathStyleAddressing = !!config.enablePathStyleAddressing;
  }
  return { type, [type]: output };
}
function sanitizePostgresProfileSpec(kind, spec) {
  if (kind === 'instance') return sanitizeInstanceProfileSpec(spec);
  if (kind === 'postgres') return sanitizePostgresConfigSpec(spec);
  if (kind === 'pooling') return sanitizePoolingConfigSpec(spec);
  return sanitizeObjectStorageSpec(spec);
}
function profileReferenceCounts(clusters) {
  const counts = new Map();
  for (const cluster of clusters || []) {
    const namespace = cluster?.metadata?.namespace || '';
    const references = [
      ['instance', cluster?.spec?.sgInstanceProfile],
      ['postgres', cluster?.spec?.configurations?.sgPostgresConfig],
      ['pooling', cluster?.spec?.configurations?.sgPoolingConfig],
      ...((cluster?.spec?.configurations?.backups || []).map((backup) => ['objectStorage', backup?.sgObjectStorage])),
    ];
    for (const [kind, name] of references) {
      if (!name) continue;
      const key = `${namespace}/${kind}/${name}`;
      const rows = counts.get(key) || [];
      rows.push(cluster?.metadata?.name || '');
      counts.set(key, rows);
    }
  }
  return counts;
}
function profileSpecDiff(before, after, path = '', changes = []) {
  const previous = before && typeof before === 'object' ? before : {};
  const next = after && typeof after === 'object' ? after : {};
  for (const key of [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort()) {
    const target = path ? `${path}.${key}` : key;
    const a = previous[key]; const b = next[key];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      profileSpecDiff(a, b, target, changes);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: target, before: a ?? null, after: b ?? null });
  }
  return changes.slice(0, 100);
}
async function postgresBackupTargets(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    const token = requestToken(req);
    requireConsoleAdmin(await verifyToken(token));
    const response = await fetch(`${CONSOLE_IDENTITY_URL}/api/external-channels/backup-targets`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw { code: response.status, msg: body.error || 'external backup target catalog unavailable' };
    const items = (Array.isArray(body.items) ? body.items : []).map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      provider: String(item.provider || 's3'),
      vendor: String(item.vendor || ''),
      endpoint: String(item.endpoint || ''),
      region: String(item.region || ''),
      bucketName: String(item.bucketName || ''),
      pathPrefix: String(item.pathPrefix || ''),
      enabled: item.enabled === true,
      healthState: String(item.healthState || 'Unknown'),
      credential: {
        configured: item.credential?.configured === true,
        version: Number(item.credential?.version || 0),
      },
      lastTest: item.lastTest ? {
        status: String(item.lastTest.status || ''),
        at: String(item.lastTest.at || ''),
        errorCode: item.lastTest.errorCode ? String(item.lastTest.errorCode) : null,
      } : null,
    })).filter((item) => item.id && item.name);
    return jsonRes(res, 200, {
      schema: 'foundation.postgres.external-backup-targets/v1alpha1',
      items,
      refreshedAt: new Date().toISOString(),
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}
async function postgresProfiles(req, res, url) {
  const namespace = requireK8sName(url.searchParams.get('namespace') || FND_NS, 'namespace');
  if (req.method === 'GET') {
    try {
      const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
      const [clusters, ...lists] = await Promise.all([
        k8sJson('GET', `/apis/stackgres.io/v1/namespaces/${namespace}/sgclusters`, undefined, actor),
        ...Object.entries(POSTGRES_PROFILE_KINDS).map(([, descriptor]) => k8sJson('GET', `/apis/${descriptor.apiVersion}/namespaces/${namespace}/${descriptor.resource}`, undefined, actor)),
      ]);
      if (!clusters.ok) throw { code: clusters.status, msg: 'StackGres cluster inventory unavailable: ' + k8sFailure(clusters) };
      const counts = profileReferenceCounts(clusters.json?.items || []);
      const profiles = [];
      for (const [[kind, descriptor], result] of Object.entries(POSTGRES_PROFILE_KINDS).map((entry, index) => [entry, lists[index]])) {
        if (!result.ok && result.status !== 404) throw { code: result.status, msg: `${descriptor.apiKind} inventory unavailable: ${k8sFailure(result)}` };
        for (const item of result.json?.items || []) {
          const name = item?.metadata?.name || '';
          const consumers = counts.get(`${namespace}/${kind}/${name}`) || [];
          profiles.push({ kind, apiKind: descriptor.apiKind, name, namespace, spec: item?.spec || {},
            managed: item?.metadata?.labels?.['opensphere.io/managed-by'] === 'foundation-control-plane',
            claimOwned: !!item?.metadata?.labels?.['provisioning.opensphere.io/postgres-claim'],
            consumers, updatedAt: item?.metadata?.generation || 0, resourceVersion: item?.metadata?.resourceVersion || '' });
        }
      }
      profiles.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
      return jsonRes(res, 200, { schema: 'foundation.postgres.profiles/v1alpha1', namespace, profiles, refreshedAt: new Date().toISOString() });
    } catch (e) {
      return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
    }
  }
  let actor;
  let body;
  try {
    actor = await foundationOwnerActor(req);
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, req.method === 'DELETE'
      ? ['namespace', 'kind', 'name', 'reason', 'confirm']
      : ['namespace', 'kind', 'name', 'spec', 'reason', 'dryRun']);
    const requestedNamespace = requireK8sName(body.namespace || namespace, 'namespace');
    if (requestedNamespace !== namespace) throw { code: 400, msg: 'namespace query and request body must match' };
    const descriptor = postgresProfileKind(body.kind);
    const name = requireK8sName(body.name, 'profile name');
    const target = `${descriptor.apiKind}/${requestedNamespace}/${name}`;
    const reason = requireOwnerReason(body.reason);
    const path = `/apis/${descriptor.apiVersion}/namespaces/${requestedNamespace}/${descriptor.resource}/${name}`;
    const existing = await k8sJson('GET', path, undefined, actor);
    if (existing.ok && existing.json?.metadata?.labels?.['provisioning.opensphere.io/postgres-claim']) {
      throw { code: 409, msg: 'claim-owned profiles are reconciled with their PostgresClaim and cannot be edited in the Profile Catalog' };
    }
    if (req.method === 'DELETE') {
      requireOwnerConfirm(body.confirm, name);
      const clusterList = await k8sJson('GET', `/apis/stackgres.io/v1/namespaces/${requestedNamespace}/sgclusters`, undefined, actor);
      if (!clusterList.ok) throw { code: clusterList.status, msg: 'StackGres cluster inventory unavailable: ' + k8sFailure(clusterList) };
      const consumers = profileReferenceCounts(clusterList.json?.items || []).get(`${requestedNamespace}/${descriptor.kind}/${name}`) || [];
      if (consumers.length) throw { code: 409, msg: `profile is referenced by: ${consumers.join(', ')}` };
      if (!existing.ok) throw { code: existing.status, msg: k8sFailure(existing) };
      await publishFoundationAudit(actor, 'postgres-profile-delete', target, 'attempt', reason);
      const removed = await k8sJson('DELETE', path, undefined, actor);
      if (!removed.ok) throw { code: removed.status, msg: k8sFailure(removed) };
      await publishFoundationAudit(actor, 'postgres-profile-delete', target, 'accepted', reason);
      return jsonRes(res, 200, { accepted: true, deleted: true, kind: descriptor.kind, namespace: requestedNamespace, name });
    }
    if (!['POST', 'PUT'].includes(req.method || '')) return jsonRes(res, 405, { error: 'method not allowed' });
    const spec = sanitizePostgresProfileSpec(descriptor.kind, body.spec);
    const object = { apiVersion: descriptor.apiVersion, kind: descriptor.apiKind, metadata: { name, namespace: requestedNamespace,
      labels: { 'opensphere.io/managed-by': 'foundation-control-plane', 'opensphere.io/component': 'postgres-profile-catalog' } }, spec };
    if (body.dryRun === true) {
      const clusterList = await k8sJson('GET', `/apis/stackgres.io/v1/namespaces/${requestedNamespace}/sgclusters`, undefined, actor);
      if (!clusterList.ok) throw { code: clusterList.status, msg: 'StackGres cluster inventory unavailable: ' + k8sFailure(clusterList) };
      const consumers = profileReferenceCounts(clusterList.json?.items || []).get(`${requestedNamespace}/${descriptor.kind}/${name}`) || [];
      return jsonRes(res, 200, {
        accepted: true, dryRun: true, operation: existing.ok ? 'update' : 'create', resource: object,
        changes: profileSpecDiff(existing.json?.spec || {}, spec),
        impact: { consumers, restartReviewRequired: consumers.length > 0,
          classification: descriptor.kind === 'postgres' ? 'PostgreSQL parameter별 reload 또는 restart 검토'
            : descriptor.kind === 'instance' ? 'Pod resource 변경 · rolling restart 검토' : 'connection pool rolling update 검토', message: consumers.length
          ? '참조 중인 클러스터에 영향을 줄 수 있습니다. 적용 후 StackGres 상태와 재시작 요구사항을 확인하세요.'
          : '현재 참조하는 클러스터가 없습니다.' },
      });
    }
    await publishFoundationAudit(actor, 'postgres-profile-apply', target, 'attempt', reason);
    let saved;
    if (existing.status === 404) saved = await k8sJson('POST', `/apis/${descriptor.apiVersion}/namespaces/${requestedNamespace}/${descriptor.resource}`, object, actor);
    else if (existing.ok) {
      object.metadata.resourceVersion = existing.json?.metadata?.resourceVersion;
      saved = await k8sJson('PUT', path, object, actor);
    } else throw { code: existing.status, msg: k8sFailure(existing) };
    if (!saved.ok) throw { code: saved.status, msg: k8sFailure(saved) };
    await publishFoundationAudit(actor, 'postgres-profile-apply', target, 'accepted', reason);
    return jsonRes(res, existing.ok ? 200 : 201, { accepted: true, created: existing.status === 404, kind: descriptor.kind, namespace: requestedNamespace, name, resourceVersion: saved.json?.metadata?.resourceVersion || '' });
  } catch (e) {
    if (actor) await publishFoundationAudit(actor, 'postgres-profile-apply', 'StackGresProfile', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}
async function postgresOperator(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const [config, deployment] = await Promise.all([
      k8sJson('GET', '/apis/stackgres.io/v1/namespaces/stackgres/sgconfigs/stackgres-operator', undefined, actor),
      k8sJson('GET', '/apis/apps/v1/namespaces/stackgres/deployments/stackgres-operator', undefined, actor),
    ]);
    if (!config.ok) throw { code: config.status, msg: 'StackGres operator configuration unavailable: ' + k8sFailure(config) };
    return jsonRes(res, 200, { schema: 'foundation.postgres.operator/v1alpha1', config: config.json,
      deployment: deployment.ok ? deployment.json : null, refreshedAt: new Date().toISOString() });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}
function postgresOperationPlan(body) {
  const target = parsePostgresClusterId(body.cluster || POSTGRES_DEFAULT_ID);
  const operation = String(body.operation || '').trim();
  const nameSuffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const metadata = { name: `os-${target.name.slice(0, 42)}-${operation}-${nameSuffix}`.slice(0, 63), namespace: target.namespace,
    labels: { 'opensphere.io/managed-by': 'foundation-control-plane', 'opensphere.io/component': 'postgres-operations' } };
  if (operation === 'restart') return { target, operation, resource: { apiVersion: 'stackgres.io/v1', kind: 'SGDbOps', metadata,
    spec: { sgCluster: target.name, op: 'restart', restart: { onlyPendingRestart: body.onlyPendingRestart === true } } } };
  if (operation === 'vacuum') return { target, operation, resource: { apiVersion: 'stackgres.io/v1', kind: 'SGDbOps', metadata,
    spec: { sgCluster: target.name, op: 'vacuum', vacuum: { analyze: body.analyze !== false, full: body.full === true, freeze: body.freeze === true } } } };
  if (operation === 'repack') return { target, operation, resource: { apiVersion: 'stackgres.io/v1', kind: 'SGDbOps', metadata,
    spec: { sgCluster: target.name, op: 'repack', repack: { noAnalyze: body.analyze === false, noKillBackend: body.noKillBackend === true } } } };
  throw { code: 400, msg: 'operation must be restart, vacuum, or repack' };
}
async function postgresOperations(req, res, url) {
  if (req.method === 'GET') {
    try {
      const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
      const target = parsePostgresClusterId(url.searchParams.get('cluster') || POSTGRES_DEFAULT_ID);
      const result = await k8sJson('GET', `/apis/stackgres.io/v1/namespaces/${target.namespace}/sgdbops`, undefined, actor);
      if (!result.ok) throw { code: result.status, msg: 'StackGres operation inventory unavailable: ' + k8sFailure(result) };
      const operations = (result.json?.items || []).filter((item) => item?.spec?.sgCluster === target.name).map((item) => ({
        name: item?.metadata?.name || '', operation: item?.spec?.op || '', createdAt: item?.metadata?.creationTimestamp || '',
        phase: item?.status?.opResult || item?.status?.phase || item?.status?.conditions?.find((condition) => condition.status === 'True')?.type || 'Pending',
        status: item?.status || {},
      })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return jsonRes(res, 200, { schema: 'foundation.postgres.operations/v1alpha1', cluster: target.id, operations });
    } catch (e) { return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) }); }
  }
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try {
    actor = await foundationOwnerActor(req);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['cluster', 'operation', 'onlyPendingRestart', 'analyze', 'full', 'freeze', 'noKillBackend', 'reason', 'confirm', 'dryRun']);
    const reason = requireOwnerReason(body.reason);
    const plan = postgresOperationPlan(body);
    requireOwnerConfirm(body.confirm, plan.target.name);
    if (body.dryRun === true) return jsonRes(res, 200, { accepted: true, dryRun: true, resource: plan.resource,
      impact: { classification: plan.operation === 'restart' ? '롤링 재시작' : '데이터 유지보수 작업', cluster: plan.target.id } });
    await publishFoundationAudit(actor, 'postgres-operation', `${plan.target.namespace}/${plan.target.name}:${plan.operation}`, 'attempt', reason);
    const created = await k8sJson('POST', `/apis/stackgres.io/v1/namespaces/${plan.target.namespace}/sgdbops`, plan.resource, actor);
    if (!created.ok) throw { code: created.status, msg: k8sFailure(created) };
    await publishFoundationAudit(actor, 'postgres-operation', `${plan.target.namespace}/${plan.target.name}:${plan.operation}`, 'accepted', reason);
    return jsonRes(res, 201, { accepted: true, operation: plan.operation, name: created.json?.metadata?.name || plan.resource.metadata.name });
  } catch (e) {
    if (actor) await publishFoundationAudit(actor, 'postgres-operation', 'StackGres/SGDbOps', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}
function postgresBackupPlan(body) {
  const target = parsePostgresClusterId(body.cluster || POSTGRES_DEFAULT_ID);
  const requested = String(body.name || '').trim();
  const name = requested ? requireK8sName(requested, 'backup name') : `os-${target.name.slice(0, 42)}-backup-${Date.now().toString(36)}`.slice(0, 63);
  return { target, resource: { apiVersion: 'stackgres.io/v1', kind: 'SGBackup', metadata: { name, namespace: target.namespace,
    labels: { 'opensphere.io/managed-by': 'foundation-control-plane', 'opensphere.io/component': 'postgres-backup' } }, spec: { sgCluster: target.name } } };
}
async function postgresBackups(req, res, url) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try {
    actor = await foundationOwnerActor(req);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['cluster', 'name', 'reason', 'confirm', 'dryRun']);
    const reason = requireOwnerReason(body.reason);
    const plan = postgresBackupPlan(body);
    requireOwnerConfirm(body.confirm, plan.target.name);
    if (body.dryRun === true) return jsonRes(res, 200, { accepted: true, dryRun: true, resource: plan.resource, impact: { classification: '즉시 백업 생성', cluster: plan.target.id } });
    await publishFoundationAudit(actor, 'postgres-backup-create', `${plan.target.namespace}/${plan.target.name}`, 'attempt', reason);
    const created = await k8sJson('POST', `/apis/stackgres.io/v1/namespaces/${plan.target.namespace}/sgbackups`, plan.resource, actor);
    if (!created.ok) throw { code: created.status, msg: k8sFailure(created) };
    await publishFoundationAudit(actor, 'postgres-backup-create', `${plan.target.namespace}/${plan.target.name}`, 'accepted', reason);
    return jsonRes(res, 201, { accepted: true, name: created.json?.metadata?.name || plan.resource.metadata.name });
  } catch (e) {
    if (actor) await publishFoundationAudit(actor, 'postgres-backup-create', 'StackGres/SGBackup', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}
async function postgresCredentials(clusterId, actor) {
  const target = parsePostgresClusterId(clusterId);
  const cluster = await k8sJson('GET', '/apis/stackgres.io/v1/namespaces/' + target.namespace + '/sgclusters/' + target.name, undefined, actor);
  if (!cluster.ok) throw { code: cluster.status, msg: 'StackGres cluster unavailable: ' + k8sFailure(cluster) };
  const secretName = cluster.json?.status?.binding?.name || target.name + '-binding';
  const clusterUID = cluster.json?.metadata?.uid || target.id;
  const result = await k8sJson('GET', '/api/v1/namespaces/' + target.namespace + '/secrets/' + secretName, undefined, actor);
  if (!result.ok) throw { code: result.status, msg: 'PostgreSQL connection Secret unavailable: ' + k8sFailure(result) };
  const resourceVersion = result.json?.metadata?.resourceVersion || '';
  const cacheKey = actor.username + '|' + target.id + '|' + resourceVersion;
  if (pgCredentialCache.has(cacheKey)) return pgCredentialCache.get(cacheKey);
  const data = result.json?.data || {};
  const bindingHost = decodeSecretValue(data, 'host');
  if (!bindingHost) {
    throw { code: 503, msg: 'StackGres binding Secret ' + target.namespace + '/' + secretName + ' has no host' };
  }
  const value = {
    clusterId: target.id, clusterUID, resourceVersion, secretName, namespace: target.namespace,
    host: postgresServiceHost(bindingHost, target.namespace),
    port: Number(decodeSecretValue(data, 'port') || POSTGRES_ADMIN.port),
    database: postgresBindingDatabase(data, target.provider),
    user: decodeSecretValue(data, 'username') || 'app',
    password: decodeSecretValue(data, 'password'),
  };
  if (!value.password) throw { code: 503, msg: 'PostgreSQL Secret ' + target.namespace + '/' + secretName + ' has no password' };
  if (pgCredentialCache.size >= 256) pgCredentialCache.delete(pgCredentialCache.keys().next().value);
  pgCredentialCache.set(cacheKey, value);
  return value;
}

function postgresBindingDatabase(data) {
  const explicit = decodeSecretValue(data, 'database') || decodeSecretValue(data, 'dbname');
  if (explicit) return pgName(explicit, 'database');
  const bindingUri = decodeSecretValue(data, 'uri');
  if (bindingUri) {
    try {
      const pathname = new URL(bindingUri).pathname.replace(/^\/+/, '');
      const database = decodeURIComponent(pathname);
      if (database && !database.includes('/')) return pgName(database, 'database');
    } catch {
      // Fall through to the required StackGres binding validation below.
    }
  }
  throw { code: 503, msg: 'StackGres binding Secret has no database key or valid database URI' };
}
async function postgresPool(clusterId, database, actor) {
  const credentials = await postgresCredentials(clusterId, actor);
  const db = database ? pgName(database, 'database') : credentials.database;
  const key = credentials.clusterUID + ':' + credentials.resourceVersion + '/' + db + '/' + credentials.user;
  if (!pgPools.has(key)) {
    const pool = new Pool({
      ...credentials, database: db, max: 4, idleTimeoutMillis: 30000,
      // StackGres exposes PostgreSQL through PgBouncer.  node-postgres serializes
      // statement_timeout as a startup parameter, but PgBouncer rejects it.
      // Query Tool applies the same bound transaction-locally after BEGIN below.
      connectionTimeoutMillis: 5000,
      application_name: 'opensphere-foundation-db-admin',
    });
    pool.on('error', (error) => console.warn(`[postgres-admin] idle pool error database=${db}: ${error.message}`));
    pgPools.set(key, pool);
  }
  return pgPools.get(key);
}
async function pgRows(client, text, values = []) {
  const result = await client.query({ text, values });
  return result.rows;
}
async function postgresAdminCatalog(req, res, url) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const clusterId = url.searchParams.get('cluster') || POSTGRES_DEFAULT_ID;
    const requestedDatabase = url.searchParams.get('database') || '';
    const basePool = await postgresPool(clusterId, undefined, actor);
    const databases = await pgRows(basePool, `
      SELECT datname AS name, pg_get_userbyid(datdba) AS owner,
             pg_encoding_to_char(encoding) AS encoding,
             datcollate AS collation, datconnlimit AS connection_limit,
             pg_database_size(datname)::bigint AS size_bytes
      FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname`);
    const credentials = await postgresCredentials(clusterId, actor);
    const selected = requestedDatabase || databases.find((item) => item.name === credentials.database)?.name || databases[0]?.name;
    if (!selected || !databases.some((item) => item.name === selected)) throw { code: 404, msg: `database not found: ${selected || requestedDatabase}` };
    const pool = await postgresPool(clusterId, selected, actor);
    const [schemas, objects, columns, indexes, constraints, functions, extensions, roles, activity, dependencies, settings] = await Promise.all([
      pgRows(pool, `SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner
        FROM pg_namespace WHERE nspname NOT LIKE 'pg_toast%' ORDER BY CASE WHEN nspname='public' THEN 0 ELSE 1 END, nspname`),
      pgRows(pool, `SELECT n.nspname AS schema, c.relname AS name,
        CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table' WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized view' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'foreign table' ELSE c.relkind::text END AS kind,
        pg_get_userbyid(c.relowner) AS owner, c.reltuples::bigint AS estimated_rows,
        pg_total_relation_size(c.oid)::bigint AS size_bytes,
        obj_description(c.oid, 'pg_class') AS comment,
        CASE c.relpersistence WHEN 'p' THEN 'permanent' WHEN 'u' THEN 'unlogged' WHEN 't' THEN 'temporary' ELSE c.relpersistence::text END AS persistence,
        COALESCE(t.spcname, 'pg_default') AS tablespace,
        CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) ELSE NULL END AS definition
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_tablespace t ON t.oid=c.reltablespace
        WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
        ORDER BY n.nspname, kind, c.relname`),
      pgRows(pool, `SELECT table_schema AS schema, table_name AS table, ordinal_position, column_name AS name,
        data_type, udt_name, is_nullable='YES' AS nullable, column_default
        FROM information_schema.columns
        WHERE table_schema NOT LIKE 'pg_%' AND table_schema <> 'information_schema'
        ORDER BY table_schema, table_name, ordinal_position`),
      pgRows(pool, `SELECT schemaname AS schema, tablename AS table, indexname AS name, indexdef AS definition
        FROM pg_indexes WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'
        ORDER BY schemaname, tablename, indexname`),
      pgRows(pool, `SELECT n.nspname AS schema, c.relname AS table, con.conname AS name,
        CASE con.contype WHEN 'p' THEN 'primary key' WHEN 'f' THEN 'foreign key' WHEN 'u' THEN 'unique'
          WHEN 'c' THEN 'check' WHEN 'x' THEN 'exclusion' ELSE con.contype::text END AS kind,
        pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND con.contype <> 'n'
        ORDER BY n.nspname, c.relname, con.conname`),
      pgRows(pool, `SELECT n.nspname AS schema, p.proname AS name,
        pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_get_function_result(p.oid) AS result, l.lanname AS language,
        pg_get_userbyid(p.proowner) AS owner, obj_description(p.oid, 'pg_proc') AS comment,
        CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ELSE NULL END AS definition,
        CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window' ELSE p.prokind::text END AS kind
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
        ORDER BY n.nspname, p.proname LIMIT 500`),
      pgRows(pool, `SELECT extname AS name, extversion AS version, n.nspname AS schema
        FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY extname`),
      pgRows(pool, `SELECT rolname AS name, rolsuper AS superuser, rolcreatedb AS create_database,
        rolcreaterole AS create_role, rolcanlogin AS login, rolreplication AS replication,
        rolconnlimit AS connection_limit FROM pg_roles ORDER BY rolname`),
      pgRows(pool, `SELECT datname AS database, COALESCE(state,'unknown') AS state, count(*)::int AS sessions
        FROM pg_stat_activity GROUP BY datname, state ORDER BY datname, state`),
      pgRows(pool, `SELECT n.nspname AS schema, c.relname AS object,
        rn.nspname AS referenced_schema, rc.relname AS referenced_object,
        CASE rc.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table' WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized view' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'foreign table' ELSE rc.relkind::text END AS referenced_kind,
        d.deptype AS dependency_type
        FROM pg_depend d
        JOIN pg_class c ON c.oid=d.objid JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_class rc ON rc.oid=d.refobjid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
          AND rn.nspname NOT LIKE 'pg_%' AND rn.nspname <> 'information_schema'
          AND c.oid <> rc.oid ORDER BY n.nspname, c.relname, rn.nspname, rc.relname LIMIT 1000`),
      pgRows(pool, `SELECT current_setting('server_version') AS server_version,
        current_setting('server_encoding') AS server_encoding,
        current_setting('TimeZone') AS timezone,
        pg_postmaster_start_time() AS started_at,
        current_database() AS database, current_user AS username`),
    ]);
    return jsonRes(res, 200, {
      schema: 'foundation.postgres.database-admin/v1alpha1', actor: actor.username,
      cluster: clusterId, selectedDatabase: selected, rowLimit: POSTGRES_ADMIN.rowLimit,
      databases, schemas, objects, columns, indexes, constraints, functions, extensions, roles, activity,
      dependencies, settings: settings[0] || {},
      refreshedAt: new Date().toISOString(),
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 502, { error: e.msg || e.message || String(e) });
  }
}
function postgresReadOnlySql(sql) {
  const normalized = String(sql || '').trim().replace(/^\/\*[\s\S]*?\*\//, '').replace(/^--[^\n]*\n/, '').trim();
  if (!/^(select|with|explain|show|values|table)\b/i.test(normalized)) {
    throw { code: 400, msg: 'Query Tool is read-only. Use a typed management action for DDL.' };
  }
  if (normalized.length > 20000) throw { code: 400, msg: 'SQL exceeds 20,000 characters' };
  return normalized;
}
async function postgresAdminQuery(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = requireConsoleAdmin(await verifyToken(requestToken(req)));
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['cluster', 'database', 'sql']);
    const clusterId = body.cluster || POSTGRES_DEFAULT_ID;
    const database = pgName(body.database, 'database');
    const sql = postgresReadOnlySql(body.sql);
    const pool = await postgresPool(clusterId, database, actor);
    const client = await pool.connect();
    const started = Date.now();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${POSTGRES_ADMIN.statementTimeoutMs}`);
      const result = await client.query(sql);
      await client.query('ROLLBACK');
      const rows = result.rows.slice(0, POSTGRES_ADMIN.rowLimit);
      console.log(`[audit] user=${actor.username} action=postgres-read-query database=${database} rows=${result.rowCount || rows.length} durationMs=${Date.now()-started} ${new Date().toISOString()}`);
      return jsonRes(res, 200, {
        command: result.command, rowCount: result.rowCount ?? rows.length, truncated: result.rows.length > rows.length,
        fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })), rows,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}
function postgresActionPlan(body) {
  const action = String(body.action || '');
  const database = pgName(body.database, 'database');
  const schema = body.schema ? pgName(body.schema, 'schema') : 'public';
  const name = body.name ? pgName(body.name, 'name') : '';
  if (action === 'create-schema') return { database, target: `schema/${schema}`, sql: `CREATE SCHEMA ${pgIdentifier(schema, 'schema')}` };
  if (action === 'drop-schema') return { database, target: `schema/${schema}`, sql: `DROP SCHEMA ${pgIdentifier(schema, 'schema')} RESTRICT` };
  if (action === 'create-table') {
    if (!name) throw { code: 400, msg: 'table name is required' };
    if (!Array.isArray(body.columns) || body.columns.length < 1 || body.columns.length > 32) throw { code: 400, msg: 'table requires 1..32 columns' };
    const columns = body.columns.map((column, index) => {
      const columnName = pgIdentifier(column?.name, `columns[${index}].name`);
      const type = String(column?.type || '').toLowerCase();
      if (!PG_COLUMN_TYPES.has(type)) throw { code: 400, msg: `unsupported column type: ${type}` };
      const defaultValue = String(column?.default || '').trim();
      if (!PG_DEFAULTS.has(defaultValue)) throw { code: 400, msg: `unsupported column default: ${defaultValue}` };
      return `${columnName} ${type}${column?.nullable === false ? ' NOT NULL' : ''}${defaultValue ? ` DEFAULT ${defaultValue}` : ''}`;
    });
    return { database, target: `table/${schema}.${name}`, sql: `CREATE TABLE ${pgIdentifier(schema)}.${pgIdentifier(name)} (${columns.join(', ')})` };
  }
  if (action === 'drop-table') {
    if (!name) throw { code: 400, msg: 'table name is required' };
    return { database, target: `table/${schema}.${name}`, sql: `DROP TABLE ${pgIdentifier(schema)}.${pgIdentifier(name)} RESTRICT` };
  }
  if (action === 'drop-view') {
    if (!name) throw { code: 400, msg: 'view name is required' };
    return { database, target: `view/${schema}.${name}`, sql: `DROP VIEW ${pgIdentifier(schema)}.${pgIdentifier(name)} RESTRICT` };
  }
  if (action === 'drop-materialized-view') {
    if (!name) throw { code: 400, msg: 'materialized view name is required' };
    return { database, target: `materialized-view/${schema}.${name}`, sql: `DROP MATERIALIZED VIEW ${pgIdentifier(schema)}.${pgIdentifier(name)} RESTRICT` };
  }
  if (action === 'drop-sequence') {
    if (!name) throw { code: 400, msg: 'sequence name is required' };
    return { database, target: `sequence/${schema}.${name}`, sql: `DROP SEQUENCE ${pgIdentifier(schema)}.${pgIdentifier(name)} RESTRICT` };
  }
  if (action === 'drop-foreign-table') {
    if (!name) throw { code: 400, msg: 'foreign table name is required' };
    return { database, target: `foreign-table/${schema}.${name}`, sql: `DROP FOREIGN TABLE ${pgIdentifier(schema)}.${pgIdentifier(name)} RESTRICT` };
  }
  if (action === 'create-index') {
    if (!name || !body.table) throw { code: 400, msg: 'index name and table are required' };
    if (!Array.isArray(body.indexColumns) || !body.indexColumns.length || body.indexColumns.length > 16) throw { code: 400, msg: 'index requires 1..16 columns' };
    const cols = body.indexColumns.map((column, index) => pgIdentifier(column, `indexColumns[${index}]`)).join(', ');
    return { database, target: `index/${schema}.${name}`, sql: `CREATE${body.unique ? ' UNIQUE' : ''} INDEX ${pgIdentifier(name)} ON ${pgIdentifier(schema)}.${pgIdentifier(body.table, 'table')} (${cols})` };
  }
  if (action === 'drop-index') {
    if (!name) throw { code: 400, msg: 'index name is required' };
    return { database, target: `index/${schema}.${name}`, sql: `DROP INDEX ${pgIdentifier(schema)}.${pgIdentifier(name)} RESTRICT` };
  }
  throw { code: 400, msg: `unsupported PostgreSQL management action: ${action}` };
}
async function postgresAdminAction(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try {
    actor = await foundationOwnerActor(req);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['cluster', 'action', 'database', 'schema', 'name', 'table', 'columns', 'indexColumns', 'unique', 'reason']);
    const clusterId = body.cluster || POSTGRES_DEFAULT_ID;
    const reason = requireOwnerReason(body.reason);
    const plan = postgresActionPlan(body);
    await publishFoundationAudit(actor, 'postgres-object-management', `${plan.database}/${plan.target}`, 'attempt', `${reason}; action=${body.action}`);
    const pool = await postgresPool(clusterId, plan.database, actor);
    await pool.query(plan.sql);
    await publishFoundationAudit(actor, 'postgres-object-management', `${plan.database}/${plan.target}`, 'accepted', `${reason}; action=${body.action}`);
    return jsonRes(res, 200, { accepted: true, action: body.action, database: plan.database, target: plan.target, sql: plan.sql });
  } catch (e) {
    if (actor) await publishFoundationAudit(actor, 'postgres-object-management', 'postgres', 'failed', e.msg || e.message || String(e)).catch(() => {});
    return jsonRes(res, typeof e.code === 'number' ? e.code : 400, { error: e.msg || e.message || String(e) });
  }
}

function requireClosedOwnerBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw { code: 400, msg: 'JSON object required' };
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) throw { code: 400, msg: `unsupported Foundation owner inputs: ${extra.join(', ')}` };
}
function requireOwnerReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 8 || reason.length > 500) throw { code: 400, msg: 'management reason must be 8..500 characters' };
  return reason;
}
function requireOwnerConfirm(actual, expected) {
  if (String(actual || '').trim() !== expected) throw { code: 409, msg: `confirmation must exactly equal: ${expected}` };
}
function requireK8sName(value, field = 'name') {
  const name = String(value || '').trim();
  if (!K8S_NAME_RE.test(name) || name.length > 63) throw { code: 400, msg: `${field} is not a valid Kubernetes name` };
  return name;
}
function k8sFailure(result) {
  return result.json?.message || result.json?.error || `Kubernetes HTTP ${result.status}`;
}
function foundationModelProjection(model) {
  const engines = model?.spec?.parameters?.engines || {};
  return {
    name: model?.metadata?.name || '',
    model: model?.spec?.model || '',
    desiredState: model?.spec?.desiredState || '',
    engines: Object.fromEntries(Object.entries(engines).filter(([id]) => FOUNDATION_ENGINE_MODEL[id]).map(([id, state]) => [id, state])),
    phase: model?.status?.phase || 'Unknown',
    observedAt: model?.status?.observedAt || null,
    observed: Array.isArray(model?.status?.observed) ? model.status.observed.slice(0, 64) : [],
  };
}
function foundationClaimProjection(item) {
  return {
    name: item?.metadata?.name || '', namespace: item?.metadata?.namespace || '',
    model: item?.spec?.model || '', phase: item?.status?.phase || 'Pending',
    bindingRef: item?.status?.bindingRef || null,
    deletionTimestamp: item?.metadata?.deletionTimestamp || null,
  };
}
function foundationBindingProjection(item) {
  return {
    name: item?.metadata?.name || '', namespace: item?.metadata?.namespace || '',
    claimRef: item?.spec?.claimRef || null, endpoint: item?.spec?.endpoint || '',
    phase: item?.status?.phase || 'Unknown', connection: item?.status?.connection || null,
  };
}
function identityDirectoryClaimProjection(item) {
  return {
    name: item?.metadata?.name || '', namespace: item?.metadata?.namespace || '',
    provider: item?.spec?.provider || 'samba-ad', phase: item?.status?.phase || 'Pending',
    reason: item?.status?.reason || '', bindingRef: item?.status?.bindingRef || null,
    deletionTimestamp: item?.metadata?.deletionTimestamp || null,
  };
}
function identityDirectoryBindingProjection(item) {
  return {
    name: item?.metadata?.name || '', namespace: item?.metadata?.namespace || '',
    claimRef: item?.spec?.claimRef || null,
    endpointRef: item?.spec?.endpointRef || null,
    credentialAvailable: Boolean(item?.spec?.secretRef?.name),
    policyRef: item?.spec?.policyRef || null,
    phase: item?.status?.phase || 'Unknown', connection: item?.status?.connection || null,
  };
}
async function publishFoundationAudit(actor, action, target, result, reason) {
  let response;
  try {
    response = await fetch(`${FOUNDATION_AUDIT_URL}/api/admin/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tok()}`,
        'content-type': 'application/json',
        'x-opensphere-source': 'foundation',
      },
      body: JSON.stringify({
        source: 'foundation', userActor: actor.username, action, target, result, reason,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw { code: 503, msg: 'Foundation durable audit authority unavailable' };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw { code: 503, msg: body.error || `Foundation durable audit HTTP ${response.status}` };
  }
}
async function requireFoundationLifecycle(rawToken) {
  const body = await platformReadinessAuthority(rawToken);
  const prerequisites = Array.isArray(body.prerequisites) ? body.prerequisites : [];
  const clusterManager = prerequisites.find((item) => item.key === 'cluster-manager');
  const hisPreflight = prerequisites.find((item) => item.key === 'his-preflight');
  if (!clusterManager?.ready || !hisPreflight?.ready) {
    const reason = clusterManager?.ready ? 'his_preflight_not_ready' : 'cluster_manager_not_activated';
    throw { code: 409, msg: `Foundation mutation gate closed: ${reason}` };
  }
}
async function platformReadinessAuthority(rawToken) {
  let response;
  try {
    response = await fetch(`${FOUNDATION_AUDIT_URL}/api/admin/platform-readiness/status`, {
      headers: { authorization: `Bearer ${rawToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(FOUNDATION_READINESS_TIMEOUT_MS),
    });
  } catch {
    throw { code: 503, msg: 'Foundation lifecycle authority unavailable' };
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw { code: response.status, msg: body.error || `Foundation lifecycle HTTP ${response.status}` };
  return body;
}
function foundationEstablishmentView(body) {
  if (!body || body.kind !== 'PlatformReadinessStatus') {
    throw { code: 502, msg: 'Platform lifecycle authority returned an invalid kind' };
  }
  if (body.pfs?.schema !== 'foundation-establishment.opensphere.io/v1alpha1') {
    throw { code: 502, msg: 'Platform lifecycle authority did not return the canonical PFS establishment contract' };
  }
  if (!['NotEstablished', 'Establishing', 'Established', 'Blocked'].includes(body.pfs.phase)) {
    throw { code: 502, msg: 'Platform lifecycle authority returned an invalid PFS phase' };
  }
  return {
    schema: 'foundation-lifecycle-view.opensphere.io/v1alpha1',
    observedAt: body.observedAt || '',
    supportProfile: {
      phase: body.phase || 'Unknown',
      ready: body.ready === true,
      declared: body.profile?.declared === true,
      name: body.profile?.name || '',
    },
    extension: {
      phase: body.pfs.extensionPhase || 'NotInstalled',
      desiredState: body.pfs.extensionDesiredState || 'Absent',
    },
    pfs: body.pfs,
    prerequisites: Array.isArray(body.prerequisites) ? body.prerequisites : [],
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
    admission: {
      foundationActivationAllowed: body.admission?.foundationActivationAllowed === true,
      pfsPluginActivationAllowed: body.admission?.pfsPluginActivationAllowed === true,
      reason: body.admission?.reason || '',
    },
  };
}
async function foundationEstablishmentStatus(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'method not allowed' });
  const rawToken = requestToken(req);
  try {
    await verifyToken(rawToken);
    return jsonRes(res, 200, foundationEstablishmentView(await platformReadinessAuthority(rawToken)));
  } catch (e) {
    return jsonRes(res, e.code || 503, { error: e.msg || e.message || 'Foundation lifecycle authority unavailable' });
  }
}
async function consoleAdminRead(pathname, rawToken) {
  let response;
  try {
    response = await fetch(`${CONSOLE_IDENTITY_URL}${pathname}`, {
      headers: { authorization: `Bearer ${rawToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw { code: 503, msg: 'Console governed change authority unavailable' };
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw { code: response.status, msg: body.error || `Console change authority HTTP ${response.status}` };
  return body;
}
function foundationBootstrapPlanView(lifecycle, template, requestStatus) {
  if (lifecycle?.schema !== 'foundation-lifecycle-view.opensphere.io/v1alpha1') {
    throw { code: 502, msg: 'Foundation lifecycle view is unavailable' };
  }
  if (template?.id !== FOUNDATION_BOOTSTRAP_TEMPLATE_ID
    || template?.consumerId !== 'foundation-bootstrap'
    || template?.action !== 'apply'
    || template?.target !== 'foundation-control-plane/v1alpha1') {
    throw { code: 502, msg: 'Foundation bootstrap template does not match the closed release contract' };
  }
  const current = requestStatus?.current || null;
  const requestActive = Boolean(current && !['Completed', 'Failed', 'NeedsAttention'].includes(current.phase));
  const established = lifecycle.pfs?.established === true;
  const supportReady = lifecycle.supportProfile?.ready === true;
  return {
    schema: 'foundation-bootstrap-plan.opensphere.io/v1alpha1',
    checkedAt: requestStatus?.checkedAt || new Date().toISOString(),
    readyToRequest: supportReady && !established && !requestActive,
    changeControlUrl: `/manage/change-control?template=${FOUNDATION_BOOTSTRAP_TEMPLATE_ID}&returnTo=${encodeURIComponent('/pfss/foundation')}`,
    gate: {
      supportProfileReady: supportReady,
      pfsEstablished: established,
      reason: established ? 'PFSAlreadyEstablished'
        : !supportReady ? 'PlatformSupportProfileRequired'
          : requestActive ? 'BootstrapRequestInProgress' : '',
    },
    template: {
      id: template.id,
      displayName: template.displayName,
      target: template.target,
      reasonPlaceholder: template.reasonPlaceholder,
      desiredState: template.desiredState,
    },
    request: current,
    blockers: Array.isArray(lifecycle.pfs?.blockers) ? lifecycle.pfs.blockers : [],
  };
}
async function foundationBootstrapPlan(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'method not allowed' });
  const rawToken = requestToken(req);
  try {
    await verifyToken(rawToken);
    const [readiness, template, requestStatus] = await Promise.all([
      platformReadinessAuthority(rawToken),
      consoleAdminRead(`/api/platform/change-templates/${FOUNDATION_BOOTSTRAP_TEMPLATE_ID}`, rawToken),
      consoleAdminRead(`/api/platform/change-templates/${FOUNDATION_BOOTSTRAP_TEMPLATE_ID}/status`, rawToken),
    ]);
    return jsonRes(res, 200, foundationBootstrapPlanView(
      foundationEstablishmentView(readiness),
      template,
      requestStatus,
    ));
  } catch (e) {
    return jsonRes(res, e.code || 503, { error: e.msg || e.message || 'Foundation bootstrap plan unavailable' });
  }
}
async function foundationOwnerActor(req) {
  const rawToken = requestToken(req);
  const actor = requireFoundationOwner(await verifyToken(rawToken));
  await requireFoundationLifecycle(rawToken);
  return actor;
}
async function foundationStatus(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'method not allowed' });
  try { await verifyToken(requestToken(req)); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  const [contractResults, controller] = await Promise.all([
    Promise.all(FOUNDATION_CORE_CRDS.map((name) =>
      k8sJson('GET', `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${name}`))),
    k8sJson('GET', '/apis/apps/v1/namespaces/opensphere-system/deployments/foundation-control-plane'),
  ]);
  const bootstrap = foundationBootstrapState(contractResults, controller);
  if (bootstrap.readError) {
    return jsonRes(res, bootstrap.readError.status, { error: bootstrap.readError.message });
  }
  const base = {
    schema: 'foundation-owner-status.opensphere.io/v1alpha1',
    owner: 'Foundation control plane',
    namespace: FND_NS,
    phase: bootstrap.phase,
    ready: bootstrap.ready,
    controller: bootstrap.controller,
    contracts: bootstrap.contracts,
    blockers: bootstrap.blockers,
    catalog: { engines: Object.keys(FOUNDATION_ENGINE_MODEL), claimModels: FOUNDATION_CLAIM_MODELS },
  };
  if (!bootstrap.contractsReady) {
    return jsonRes(res, 200, {
      ...base,
      models: [], claims: [], bindings: [], identityDirectoryClaims: [], identityDirectoryBindings: [],
    });
  }
  const [models, claims, bindings, identityClaims, identityBindings] = await Promise.all([
    k8sJson('GET', `${FOUNDATION_API}/foundationmodels`),
    k8sJson('GET', `${FOUNDATION_API}/namespaces/${FND_NS}/foundationclaims`),
    k8sJson('GET', `${FOUNDATION_API}/namespaces/${FND_NS}/foundationbindings`),
    k8sJson('GET', `${FOUNDATION_API}/namespaces/${FND_NS}/identitydirectoryclaims`),
    k8sJson('GET', `${FOUNDATION_API}/namespaces/${FND_NS}/identitydirectorybindings`),
  ]);
  const failed = [models, claims, bindings, identityClaims, identityBindings].find((item) => !item.ok);
  if (failed) return jsonRes(res, failed.status, { error: k8sFailure(failed) });
  return jsonRes(res, 200, {
    ...base,
    models: (models.json?.items || []).map(foundationModelProjection),
    claims: (claims.json?.items || []).map(foundationClaimProjection),
    bindings: (bindings.json?.items || []).map(foundationBindingProjection),
    identityDirectoryClaims: (identityClaims.json?.items || []).map(identityDirectoryClaimProjection),
    identityDirectoryBindings: (identityBindings.json?.items || []).map(identityDirectoryBindingProjection),
  });
}

function foundationBootstrapState(contractResults, controllerResult) {
  const contracts = FOUNDATION_CORE_CRDS.map((name, index) => {
    const result = contractResults[index] || { ok: false, status: 0, json: null };
    return {
      name,
      ready: Boolean(result.ok),
      status: Number(result.status || 0),
      reason: result.ok ? 'Installed' : result.status === 404 ? 'NotInstalled' : 'ReadFailed',
    };
  });
  const readFailure = [...contractResults, controllerResult]
    .find((result) => !result?.ok && Number(result?.status || 0) !== 404);
  if (readFailure) {
    return {
      readError: { status: Number(readFailure.status || 503), message: k8sFailure(readFailure) },
      contracts, contractsReady: false, ready: false, phase: 'Blocked',
      controller: { name: 'foundation-control-plane', desired: 0, ready: 0, available: 0, state: 'ReadFailed' },
      blockers: ['Foundation bootstrap state could not be read'],
    };
  }
  const desired = Number(controllerResult?.json?.spec?.replicas || 0);
  const readyReplicas = Number(controllerResult?.json?.status?.readyReplicas || 0);
  const available = Number(controllerResult?.json?.status?.availableReplicas || 0);
  const contractsReady = contracts.every((item) => item.ready);
  const controllerReady = Boolean(controllerResult?.ok) && desired > 0 && readyReplicas === desired && available === desired;
  const blockers = [
    ...contracts.filter((item) => !item.ready).map((item) => `CRD ${item.name} is not installed`),
    ...(!controllerResult?.ok ? ['Deployment opensphere-system/foundation-control-plane is not installed']
      : !controllerReady ? [`foundation-control-plane is not Ready (${readyReplicas}/${desired})`] : []),
  ];
  return {
    readError: null,
    contracts,
    contractsReady,
    ready: contractsReady && controllerReady,
    phase: contractsReady && controllerReady ? 'Establishing' : 'NotEstablished',
    controller: {
      name: 'foundation-control-plane',
      desired,
      ready: readyReplicas,
      available,
      state: !controllerResult?.ok ? 'NotInstalled' : controllerReady ? 'Ready' : 'NotReady',
    },
    blockers,
  };
}
async function foundationEngineLifecycle(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try { actor = await foundationOwnerActor(req); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return jsonRes(res, 400, { error: 'invalid json' }); }
  try {
    requireClosedOwnerBody(body, ['engine', 'action', 'confirm', 'reason']);
    const engine = requireK8sName(body.engine, 'engine');
    const model = FOUNDATION_ENGINE_MODEL[engine];
    if (!model) throw { code: 400, msg: 'engine is outside the Foundation owner catalog' };
    const action = String(body.action || '').trim().toLowerCase();
    if (!['enable', 'disable'].includes(action)) throw { code: 400, msg: 'Foundation engine action must be enable or disable' };
    const reason = requireOwnerReason(body.reason);
    const expected = `${action} Foundation engine ${engine}`;
    requireOwnerConfirm(body.confirm, expected);
    const target = `FoundationModel/${model}/engine/${engine}`;
    await publishFoundationAudit(actor, 'foundation-engine-lifecycle', target, 'attempt', reason);
    const current = await k8sJson('GET', `${FOUNDATION_API}/foundationmodels/${model}`);
    if (!current.ok) throw { code: current.status, msg: k8sFailure(current) };
    const previous = current.json?.spec?.parameters?.engines?.[engine] || 'disabled';
    const desired = action === 'enable' ? 'enabled' : 'disabled';
    const result = await k8sJson('PATCH', `${FOUNDATION_API}/foundationmodels/${model}`, {
      spec: { desiredState: 'Installed', parameters: { engines: { [engine]: desired } } },
    });
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'foundation-engine-lifecycle', target, 'accepted', `${reason}; ${previous}->${desired}`);
    return jsonRes(res, 202, {
      accepted: true, owner: 'Foundation control plane', target, model, engine,
      previous, desired, generation: result.json?.metadata?.generation || null,
    });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 500, { error: e.msg || e.message || String(e) });
  }
}
async function foundationClaimCreate(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try { actor = await foundationOwnerActor(req); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return jsonRes(res, 400, { error: 'invalid json' }); }
  try {
    requireClosedOwnerBody(body, ['name', 'model', 'confirm', 'reason']);
    const name = requireK8sName(body.name);
    const model = String(body.model || '').trim().toLowerCase();
    if (!FOUNDATION_CLAIM_MODELS.includes(model)) throw { code: 400, msg: 'model is outside the Foundation claim catalog' };
    const reason = requireOwnerReason(body.reason);
    requireOwnerConfirm(body.confirm, `create Foundation claim ${name} for ${model}`);
    const target = `FoundationClaim/${FND_NS}/${name}`;
    await publishFoundationAudit(actor, 'foundation-claim-create', target, 'attempt', reason);
    const modelState = await k8sJson('GET', `${FOUNDATION_API}/foundationmodels/${model}`);
    if (!modelState.ok) throw { code: modelState.status, msg: k8sFailure(modelState) };
    if (modelState.json?.status?.phase !== 'Installed') throw { code: 409, msg: `Foundation model ${model} is not Installed` };
    const result = await k8sJson('POST', `${FOUNDATION_API}/namespaces/${FND_NS}/foundationclaims`, {
      apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'FoundationClaim',
      metadata: {
        name, namespace: FND_NS,
        labels: { 'opensphere.io/managed-by': 'foundation-osaa', 'foundation.opensphere.io/model': model },
      },
      spec: { model },
    });
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'foundation-claim-create', target, 'accepted', reason);
    return jsonRes(res, 202, { accepted: true, owner: 'Foundation control plane', target, claim: foundationClaimProjection(result.json) });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 500, { error: e.msg || e.message || String(e) });
  }
}
async function foundationClaimRelease(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try { actor = await foundationOwnerActor(req); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return jsonRes(res, 400, { error: 'invalid json' }); }
  try {
    requireClosedOwnerBody(body, ['name', 'confirm', 'reason']);
    const name = requireK8sName(body.name);
    const reason = requireOwnerReason(body.reason);
    requireOwnerConfirm(body.confirm, `release Foundation claim ${name}`);
    const target = `FoundationClaim/${FND_NS}/${name}`;
    const existing = await k8sJson('GET', `${FOUNDATION_API}/namespaces/${FND_NS}/foundationclaims/${name}`);
    if (!existing.ok) throw { code: existing.status, msg: k8sFailure(existing) };
    await publishFoundationAudit(actor, 'foundation-claim-release', target, 'attempt', reason);
    const result = await k8sJson('DELETE', `${FOUNDATION_API}/namespaces/${FND_NS}/foundationclaims/${name}`);
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'foundation-claim-release', target, 'accepted', reason);
    return jsonRes(res, 202, { accepted: true, owner: 'Foundation control plane', target, phase: 'Releasing' });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 500, { error: e.msg || e.message || String(e) });
  }
}
async function identityDirectoryClaimCreate(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try { actor = await foundationOwnerActor(req); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return jsonRes(res, 400, { error: 'invalid json' }); }
  try {
    requireClosedOwnerBody(body, ['name', 'confirm', 'reason']);
    const name = requireK8sName(body.name);
    const reason = requireOwnerReason(body.reason);
    requireOwnerConfirm(body.confirm, `create IdentityDirectory claim ${name}`);
    const target = `IdentityDirectoryClaim/${FND_NS}/${name}`;
    await publishFoundationAudit(actor, 'identity-directory-claim-create', target, 'attempt', reason);
    const identity = await k8sJson('GET', `${FOUNDATION_API}/foundationmodels/identity`);
    if (!identity.ok) throw { code: identity.status, msg: k8sFailure(identity) };
    if (identity.json?.status?.phase !== 'Installed' || identity.json?.spec?.parameters?.engines?.samba !== 'enabled') {
      throw { code: 409, msg: 'Foundation Samba-AD engine is not enabled and Installed' };
    }
    const result = await k8sJson('POST', `${FOUNDATION_API}/namespaces/${FND_NS}/identitydirectoryclaims`, {
      apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'IdentityDirectoryClaim',
      metadata: {
        name, namespace: FND_NS,
        labels: { 'opensphere.io/managed-by': 'foundation-osaa', 'foundation.opensphere.io/provider': 'samba-ad' },
      },
      spec: { provider: 'samba-ad' },
    });
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'identity-directory-claim-create', target, 'accepted', reason);
    return jsonRes(res, 202, { accepted: true, owner: 'Foundation control plane', target, claim: identityDirectoryClaimProjection(result.json) });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 500, { error: e.msg || e.message || String(e) });
  }
}
async function identityDirectoryClaimRelease(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let actor;
  try { actor = await foundationOwnerActor(req); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return jsonRes(res, 400, { error: 'invalid json' }); }
  try {
    requireClosedOwnerBody(body, ['name', 'confirm', 'reason']);
    const name = requireK8sName(body.name);
    const reason = requireOwnerReason(body.reason);
    requireOwnerConfirm(body.confirm, `release IdentityDirectory claim ${name}`);
    const target = `IdentityDirectoryClaim/${FND_NS}/${name}`;
    const existing = await k8sJson('GET', `${FOUNDATION_API}/namespaces/${FND_NS}/identitydirectoryclaims/${name}`);
    if (!existing.ok) throw { code: existing.status, msg: k8sFailure(existing) };
    await publishFoundationAudit(actor, 'identity-directory-claim-release', target, 'attempt', reason);
    const result = await k8sJson('DELETE', `${FOUNDATION_API}/namespaces/${FND_NS}/identitydirectoryclaims/${name}`);
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'identity-directory-claim-release', target, 'accepted', reason);
    return jsonRes(res, 202, { accepted: true, owner: 'Foundation control plane', target, phase: 'Releasing' });
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 500, { error: e.msg || e.message || String(e) });
  }
}

function sambaBootstrapSecretEvidence(result) {
  const secretRef = { namespace: FND_NS, name: SAMBA_BOOTSTRAP_SECRET, key: SAMBA_BOOTSTRAP_SECRET_KEY };
  if (result.status === 404) return { exists: false, secretRef };
  if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
  return { exists: true, secretRef };
}

function sambaReadinessProjection(modelResult, secretResult) {
  const bootstrapSecret = sambaBootstrapSecretEvidence(secretResult);
  if (modelResult.status === 404) {
    return {
      authority: 'foundation',
      model: { found: false, status: 404, phase: 'Missing', engineOpt: 'disabled' },
      config: { domain: 'OPENSPHERE.LOCAL', replicas: 1, storageClass: 'standard', dnsForwarder: '8.8.8.8' },
      backup: {},
      bootstrapSecret,
    };
  }
  if (!modelResult.ok) throw { code: modelResult.status, msg: k8sFailure(modelResult) };
  const fm = modelResult.json || {};
  const samba = fm.spec?.parameters?.samba || {};
  return {
    authority: 'foundation',
    model: {
      found: true,
      status: 200,
      phase: fm.status?.phase || 'Unknown',
      observed: Array.isArray(fm.status?.observed) ? fm.status.observed.slice(0, 64) : [],
      ldapURL: fm.status?.ldapURL || `ldap://foundation-identity-samba.${FND_NS}.svc:389`,
      directoryRealm: fm.status?.directoryRealm || '',
      controlPlane: fm.status?.controlPlane || '',
      observedAt: fm.status?.observedAt || '',
      engineOpt: fm.spec?.parameters?.engines?.samba || 'enabled',
    },
    config: {
      domain: samba.domain || 'OPENSPHERE.LOCAL',
      domainSource: samba.domain ? 'FoundationModel.spec.parameters.samba' : 'plugin default',
      replicas: 1,
      replicasSource: samba.replicas ? 'FoundationModel.spec.parameters.samba' : 'plugin default',
      storageClass: samba.storageClass || 'standard',
      storageClassSource: samba.storageClass ? 'FoundationModel.spec.parameters.samba' : 'plugin default',
      dnsForwarder: samba.dnsForwarder || '8.8.8.8',
      dnsForwarderSource: samba.dnsForwarder ? 'FoundationModel.spec.parameters.samba' : 'plugin default',
    },
    backup: samba.backup || {},
    bootstrapSecret,
  };
}

async function sambaReadiness(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  let actor;
  try { actor = await verifyToken(requestToken(req)); requireConsoleAdmin(actor); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  try {
    const [modelResult, secretResult] = await Promise.all([
      k8sJson('GET', `${FOUNDATION_API}/foundationmodels/identity`),
      k8sJson('GET', `/api/v1/namespaces/${FND_NS}/secrets/${SAMBA_BOOTSTRAP_SECRET}`, undefined, actor),
    ]);
    return jsonRes(res, 200, sambaReadinessProjection(modelResult, secretResult));
  } catch (e) {
    return jsonRes(res, typeof e.code === 'number' ? e.code : 500, { error: e.msg || e.message || String(e) });
  }
}

async function saveSambaBootstrapSecret(req, res) {
  let actor;
  try { actor = await verifyToken(requestToken(req)); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  try { requireConsoleAdmin(actor); }
  catch (e) { return jsonRes(res, e.code || 403, { error: e.msg || 'forbidden' }); }
  const path = `/api/v1/namespaces/${FND_NS}/secrets`;
  if (req.method === 'GET') {
    try {
      const evidence = sambaBootstrapSecretEvidence(await k8sJson('GET', `${path}/${SAMBA_BOOTSTRAP_SECRET}`, undefined, actor));
      return jsonRes(res, 200, evidence);
    } catch (e) {
      return jsonRes(res, typeof e.code === 'number' ? e.code : 500, { error: e.msg || e.message || String(e) });
    }
  }
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return jsonRes(res, 400, { error: 'invalid json' }); }
  const password = String(body.password || '');
  if (password.length < 12) return jsonRes(res, 400, { error: 'bootstrap domain password must be at least 12 characters' });
  const obj = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: SAMBA_BOOTSTRAP_SECRET,
      namespace: FND_NS,
      labels: { 'opensphere.io/plugin': 'samba-ad', 'opensphere.io/managed-by': 'foundation' },
    },
    type: 'Opaque',
    stringData: { [SAMBA_BOOTSTRAP_SECRET_KEY]: password },
  };
  let r = await k8sJson('POST', path, obj, actor);
  if (r.status === 409) {
    r = await k8sJson('PATCH', `${path}/${SAMBA_BOOTSTRAP_SECRET}`, {
      metadata: { labels: obj.metadata.labels },
      stringData: obj.stringData,
    }, actor);
  }
  console.log(`[audit] user=${actor.username} action=samba-bootstrap-secret-upsert target=${FND_NS}/${SAMBA_BOOTSTRAP_SECRET} status=${r.status} ${new Date().toISOString()}`);
  if (!r.ok) return jsonRes(res, r.status, { error: r.json?.message || r.json?.error || `kubernetes HTTP ${r.status}` });
  return jsonRes(res, 200, { ok: true, ...sambaBootstrapSecretEvidence(r) });
}

// HIS의 운영·판정 소유자는 Cluster Manager다. Foundation은 자신의 승인된 API base 안에서
// 이 read-only projection만 제공하고, 브라우저가 다른 subShell API를 직접 호출하지 않게 한다.
// 신원 토큰은 Main Shell hostFetch → Foundation → Cluster Manager로 전달되며 최종 검증은
// HIS 정본 API가 수행한다. 쓰기·임의 경로·무인증 SA 폴백은 허용하지 않는다.
async function hisStatusProxy(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only proxy' });
  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/i.test(authorization)) return jsonRes(res, 401, { error: 'authorization required' });
  try {
    const r = await fetch(`${CLUSTER_MANAGER_URL.replace(/\/$/, '')}/api/his/status`, {
      headers: { authorization, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    if (r.ok) {
      let body;
      try { body = JSON.parse(text); }
      catch { return jsonRes(res, 502, { error: 'Cluster Manager HIS status returned invalid JSON' }); }
      const contractError = validateHisStatusContract(body);
      if (contractError) {
        return jsonRes(res, 502, {
          error: `Cluster Manager HIS status contract mismatch: ${contractError}`,
          expectedSchema: HIS_STATUS_SCHEMA,
          observedSchema: body?.schema || null,
          observedStack: body?.stack || null,
        });
      }
    }
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    });
    res.end(text);
  } catch (e) {
    jsonRes(res, 502, { error: `Cluster Manager HIS status unavailable: ${String(e && (e.message || e))}` });
  }
}

function validateHisStatusContract(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'JSON object required';
  if (body.schema !== HIS_STATUS_SCHEMA) return `schema must be ${HIS_STATUS_SCHEMA}`;
  if (body.stack !== 'HIS') return 'stack must be HIS';
  if (!['Ready', 'Blocked', 'Degraded'].includes(body.state)) return 'state is invalid';
  if (!Array.isArray(body.items)) return 'items must be an array';
  if (!body.summary || typeof body.summary !== 'object') return 'summary is required';
  for (const key of ['coreReady', 'coreTotal', 'selectedProfilesReady', 'selectedProfilesTotal']) {
    if (!Number.isInteger(body.summary[key]) || body.summary[key] < 0) return `summary.${key} must be a non-negative integer`;
  }
  return '';
}

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.ico': 'image/x-icon',
};

async function nodes() {
  const r = await fetch(`${APISERVER}/api/v1/nodes`, { headers: { Authorization: `Bearer ${tok()}` } });
  if (!r.ok) throw new Error(`nodes HTTP ${r.status}`);
  const items = (await r.json()).items || [];
  return items.map((n) => {
    const cond = (n.status?.conditions || []).find((c) => c.type === 'Ready');
    const roles = Object.keys(n.metadata?.labels || {})
      .filter((k) => k.startsWith('node-role.kubernetes.io/'))
      .map((k) => k.split('/')[1]).filter(Boolean);
    const addr = (n.status?.addresses || []).find((a) => a.type === 'InternalIP');
    const ni = n.status?.nodeInfo || {};
    return {
      name: n.metadata?.name, ready: cond?.status === 'True',
      roles: roles.length ? roles : ['<none>'], version: ni.kubeletVersion || '',
      os: ni.osImage || '', arch: ni.architecture || '',
      cpu: n.status?.capacity?.cpu || '', memory: n.status?.capacity?.memory || '',
      internalIP: addr?.address || '', created: n.metadata?.creationTimestamp || '',
      schedulable: !n.spec?.unschedulable,
    };
  });
}

// ── 콘솔 통합 알림 연동 (ADR-UI-003 P1 발행 백본) ──
// foundation 백엔드 → 콘솔 audit bus(/api/admin/events) → 셸 단일 인박스.
// 시작/노드 경고를 콘솔 인박스에 발행 = subShell이 콘솔 알림 core와 '유기적' 작동.
// best-effort: 발행 실패해도 foundation 본 기능엔 영향 없음. (manifest 권한 불요 — 백엔드 in-cluster 호출)
// 발행 입구는 projected ServiceAccount token을 Controller가 TokenReview하여 source와 대조한다.
const CONTROLLER = process.env.OSP_CONTROLLER || 'http://opensphere-console-dupa-controller.opensphere-console.svc.cluster.local:8080';
let _notifyWarned = false;
function warnNotifyOnce(msg) {
  if (_notifyWarned) return;
  _notifyWarned = true;
  console.warn(`[notify] 콘솔 이벤트 발행 실패 — ${msg} (ServiceAccount TokenReview 배선 확인; 이후 동일 경고 억제)`);
}
async function publishNotify(ev) {
  let workloadToken = '';
  try { workloadToken = tok(); } catch { /* handled by response path */ }
  if (!workloadToken) return warnNotifyOnce('ServiceAccount token 없음');
  try {
    const res = await fetch(`${CONTROLLER}/api/admin/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-opensphere-source': 'foundation',
        authorization: `Bearer ${workloadToken}`,
      },
      body: JSON.stringify({ source: 'foundation', ...ev }),
    });
    if (!res.ok) warnNotifyOnce(`http=${res.status}`);
  } catch (e) { warnNotifyOnce(String((e && (e.code || e.message)) || e)); }
}
const _notifiedNodes = new Set();
async function nodeHealthPublish() {
  try {
    for (const n of await nodes()) {
      if (!n.ready && !_notifiedNodes.has(n.name)) {
        _notifiedNodes.add(n.name);
        await publishNotify({ action: 'NodeNotReady', target: `Node/${n.name}`, result: 'warning', reason: `노드 ${n.name} NotReady (foundation 감지)` });
      } else if (n.ready) {
        _notifiedNodes.delete(n.name); // 복구 시 재경고 허용
      }
    }
  } catch (e) { /* best-effort */ }
}

// ── FoundationModel 수명주기 전이 → 콘솔 인박스 (메시지 통합, 2026-07-06) ──
// plugin(엔진) 설치/회수/Ready 전이를 콘솔 audit bus에 발행 — Samba-AD 등 내부 plugin이
// "설치되면서 메시지 통합에 등록"되는 배선. 전이 시에만 발행(dedup — 폴링 스팸 금지, 위조 0: 실측 status만).
const _fmLast = new Map(); // model → { phase, engines: 'samba=1,keycloak=0' }
async function fmTransitionPublish() {
  try {
    const r = await fetch(`${APISERVER}/apis/foundation.opensphere.io/v1alpha1/foundationmodels`, { headers: { Authorization: `Bearer ${tok()}` } });
    if (!r.ok) return;
    for (const fm of (await r.json()).items || []) {
      const name = fm.metadata?.name || '';
      const phase = fm.status?.phase || '';
      const engines = (fm.status?.observed || [])
        .filter((o) => typeof o?.id === 'string' && o.id.endsWith('_up'))
        .map((o) => `${o.id.replace(/_up$/, '')}=${o.value}`)
        .sort().join(',');
      const cur = `${phase}|${engines}`;
      const prev = _fmLast.get(name);
      _fmLast.set(name, cur);
      if (prev === undefined || prev === cur || !phase) continue; // 첫 관측은 기준선만(재기동 스팸 방지)
      const sev = phase === 'Installed' ? 'info' : (phase === 'Failed' || phase === 'Blocked') ? 'error' : 'warning';
      await publishNotify({
        action: 'ModelTransition', target: `FoundationModel/${name}`, result: sev,
        reason: `${name} 모델 ${phase}${engines ? ` (${engines})` : ''}`,
      });
    }
  } catch (e) { /* best-effort */ }
}

function serveFrom(root, rel, res) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { res.writeHead(400); return res.end('bad path'); }
  if (decoded.includes('\0')) { res.writeHead(400); return res.end('bad path'); }
  const fp = path.resolve(root, decoded);
  const relative = path.relative(root, fp);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const mime = MIME[path.extname(fp)] || 'application/octet-stream';
    // PoC: 재배포 시 셸 브라우저가 구 번들을 캐시해 변경이 안 보이는 문제 회피
    fs.createReadStream(fp).once('open', () => res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' })).pipe(res);
  });
}

// ── Valkey PFSS management boundary ───────────────────────────────────────
// Browser가 pods/exec나 raw TCP를 직접 사용하지 않는다. 이 경계는 Console 신원을
// 검증하고 exact Secret 하나만 읽은 뒤 allowlisted RESP 명령만 수행한다.
class RespNeedMore extends Error {}
class RespServerError extends Error {}
function respLine(buffer, offset) {
  const end = buffer.indexOf('\r\n', offset);
  if (end < 0) throw new RespNeedMore();
  return [buffer.subarray(offset, end).toString('utf8'), end + 2];
}
function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) throw new RespNeedMore();
  const type = String.fromCharCode(buffer[offset]);
  let line, next;
  if (['+', '-', ':', '$', '*'].includes(type)) [line, next] = respLine(buffer, offset + 1);
  if (type === '+') return { value: line, next };
  if (type === '-') return { value: new RespServerError(line), next };
  if (type === ':') return { value: Number(line), next };
  if (type === '$') {
    const length = Number(line);
    if (length === -1) return { value: null, next };
    if (!Number.isInteger(length) || length < 0 || buffer.length < next + length + 2) throw new RespNeedMore();
    if (buffer[next + length] !== 13 || buffer[next + length + 1] !== 10) throw new RespServerError('invalid RESP bulk terminator');
    return { value: buffer.subarray(next, next + length), next: next + length + 2 };
  }
  if (type === '*') {
    const count = Number(line);
    if (count === -1) return { value: null, next };
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new RespServerError('invalid RESP array length');
    const values = [];
    let cursor = next;
    for (let i = 0; i < count; i++) {
      const item = parseResp(buffer, cursor);
      values.push(item.value);
      cursor = item.next;
    }
    return { value: values, next: cursor };
  }
  throw new RespServerError(`unsupported RESP type ${type}`);
}
function encodeRespCommand(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const value = Buffer.isBuffer(arg) ? arg : Buffer.from(String(arg), 'utf8');
    parts.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}
function valkeyRun(password, db, commands, socketFactory = () => net.createConnection({ host: VALKEY_SERVICE, port: VALKEY_PORT })) {
  const all = [['AUTH', password], ...(db === undefined || db === null ? [] : [['SELECT', String(db)]]), ...commands];
  return new Promise((resolve, reject) => {
    const socket = socketFactory();
    let pending = Buffer.alloc(0);
    let offset = 0;
    const results = [];
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err); else resolve(value);
    };
    socket.setTimeout(5000, () => finish(new Error('Valkey command timeout')));
    socket.on('error', (error) => finish(error));
    socket.on('connect', () => socket.write(Buffer.concat(all.map(encodeRespCommand))));
    socket.on('data', (chunk) => {
      pending = offset ? Buffer.concat([pending.subarray(offset), chunk]) : Buffer.concat([pending, chunk]);
      offset = 0;
      try {
        while (results.length < all.length) {
          const item = parseResp(pending, offset);
          offset = item.next;
          if (item.value instanceof RespServerError) return finish(item.value);
          results.push(item.value);
        }
        finish(null, results.slice(all.length - commands.length));
      } catch (error) {
        if (!(error instanceof RespNeedMore)) finish(error);
      }
    });
  });
}
function respText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return value.map(respText);
  return value;
}
function parseInfo(value) {
  const out = {};
  for (const line of String(respText(value) || '').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}
function sanitizeAclLine(value) {
  return String(respText(value) || '').replace(/#[a-f0-9]{64}/gi, '#<password-hash>');
}
function requireValkeyDb(value) {
  const db = Number(value ?? 0);
  if (!Number.isInteger(db) || db < 0 || db > 15) throw { code: 400, msg: 'database must be an integer in range 0..15' };
  return db;
}
function requireValkeyKey(value) {
  const key = String(value ?? '');
  if (!key || Buffer.byteLength(key, 'utf8') > 512 || key.includes('\0')) throw { code: 400, msg: 'key must be 1..512 UTF-8 bytes without NUL' };
  return key;
}
async function valkeyContext(actor) {
  const model = await k8sJson('GET', `${FOUNDATION_API}/foundationmodels/data`);
  if (!model.ok) throw { code: model.status, msg: k8sFailure(model) };
  if (model.json?.spec?.parameters?.engines?.valkey !== 'enabled') throw { code: 409, msg: 'Valkey engine is not enabled' };
  const cfg = model.json?.spec?.parameters?.dataEngines?.valkey || {};
  const secretName = requireK8sName(cfg.authSecret || VALKEY_DEFAULT_SECRET);
  // This endpoint already authenticates the Console actor. Secret values are
  // consumed only inside the Foundation backend and never returned to the
  // browser. Use the workload identity so Kubernetes can enforce an exact
  // Secret resourceNames allowlist without granting human users Secret read.
  const secret = await k8sJson('GET', `/api/v1/namespaces/${FND_NS}/secrets/${secretName}`);
  if (!secret.ok) throw { code: secret.status, msg: `Valkey credential unavailable: ${k8sFailure(secret)}` };
  const encoded = secret.json?.data?.password;
  if (!encoded) throw { code: 409, msg: `Secret/${secretName} has no password key` };
  return { model: model.json, config: cfg, secretName, password: Buffer.from(encoded, 'base64').toString('utf8') };
}
async function valkeyAdminActor(req, aal2 = false) {
  const actor = await verifyToken(requestToken(req));
  return aal2 ? requireFoundationOwner(actor) : requireConsoleAdmin(actor);
}
async function valkeySummary(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    const actor = await valkeyAdminActor(req);
    const ctx = await valkeyContext(actor);
    const [server, clients, memory, stats, replication, persistence, keyspace, dbsize, config, acl, aclLog] = await valkeyRun(ctx.password, 0, [
      ['INFO', 'server'], ['INFO', 'clients'], ['INFO', 'memory'], ['INFO', 'stats'], ['INFO', 'replication'], ['INFO', 'persistence'], ['INFO', 'keyspace'],
      ['DBSIZE'], ['CONFIG', 'GET', 'maxmemory', 'maxmemory-policy', 'appendonly', 'appendfsync'], ['ACL', 'LIST'], ['ACL', 'LOG', '20'],
    ]);
    const sections = { ...parseInfo(server), ...parseInfo(clients), ...parseInfo(memory), ...parseInfo(stats), ...parseInfo(replication), ...parseInfo(persistence), ...parseInfo(keyspace) };
    const configPairs = respText(config) || [];
    const configView = {};
    for (let i = 0; i < configPairs.length; i += 2) configView[configPairs[i]] = configPairs[i + 1];
    const databases = Object.entries(sections).filter(([key]) => /^db\d+$/.test(key)).map(([name, raw]) => ({ name, raw, ...Object.fromEntries(String(raw).split(',').map((item) => item.split('='))) }));
    return jsonRes(res, 200, {
      authority: 'Valkey RESP allowlist', observedAt: new Date().toISOString(), version: sections.valkey_version || sections.redis_version || ctx.config.version || 'unknown',
      role: sections.role || 'unknown', uptimeSeconds: Number(sections.uptime_in_seconds || 0), clients: Number(sections.connected_clients || 0), blockedClients: Number(sections.blocked_clients || 0),
      usedMemory: Number(sections.used_memory || 0), usedMemoryHuman: sections.used_memory_human || '—', peakMemoryHuman: sections.used_memory_peak_human || '—', maxmemoryPolicy: configView['maxmemory-policy'] || ctx.config.maxmemoryPolicy || 'unknown',
      commandsProcessed: Number(sections.total_commands_processed || 0), opsPerSec: Number(sections.instantaneous_ops_per_sec || 0), hits: Number(sections.keyspace_hits || 0), misses: Number(sections.keyspace_misses || 0), evictedKeys: Number(sections.evicted_keys || 0), expiredKeys: Number(sections.expired_keys || 0),
      connectedReplicas: Number(sections.connected_slaves || 0), masterLinkStatus: sections.master_link_status || (sections.role === 'master' ? 'self' : 'unknown'), masterReplicationOffset: Number(sections.master_repl_offset || 0), replicaReplicationOffset: Number(sections.slave_repl_offset || 0),
      persistence: { aofEnabled: sections.aof_enabled === '1', aofRewriteStatus: sections.aof_last_bgrewrite_status || 'n/a', rdbSaveStatus: sections.rdb_last_bgsave_status || 'n/a', loading: sections.loading === '1' },
      dbsize: Number(dbsize || 0), databases, config: configView, acl: (respText(acl) || []).map(sanitizeAclLine), aclLog: respText(aclLog) || [],
      desired: ctx.config, secretRef: { namespace: FND_NS, name: ctx.secretName, key: 'password' },
    });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function valkeyScan(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await valkeyAdminActor(req);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['db', 'cursor', 'pattern', 'count', 'type']);
    const ctx = await valkeyContext(actor);
    const db = requireValkeyDb(body.db);
    const cursor = /^\d+$/.test(String(body.cursor ?? '0')) ? String(body.cursor ?? '0') : '0';
    const pattern = String(body.pattern || '*');
    if (Buffer.byteLength(pattern, 'utf8') > 128) throw { code: 400, msg: 'pattern is limited to 128 bytes' };
    const count = Math.max(1, Math.min(200, Number(body.count || 50)));
    const type = String(body.type || '');
    if (type && !['string', 'list', 'set', 'zset', 'hash', 'stream'].includes(type)) throw { code: 400, msg: 'unsupported key type filter' };
    const command = ['SCAN', cursor, 'MATCH', pattern, 'COUNT', String(count), ...(type ? ['TYPE', type] : [])];
    const [scan] = await valkeyRun(ctx.password, db, [command]);
    const next = String(respText(scan?.[0]) || '0');
    const names = (scan?.[1] || []).map(respText);
    const probes = names.flatMap((name) => [['TYPE', name], ['PTTL', name], ['MEMORY', 'USAGE', name]]);
    const probeValues = probes.length ? await valkeyRun(ctx.password, db, probes) : [];
    const keys = names.map((name, index) => ({ name, type: respText(probeValues[index * 3]) || 'unknown', ttlMs: Number(probeValues[index * 3 + 1] ?? -2), memoryBytes: probeValues[index * 3 + 2] == null ? null : Number(probeValues[index * 3 + 2]) }));
    return jsonRes(res, 200, { db, cursor: next, complete: next === '0', count: keys.length, keys });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function valkeyKey(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await valkeyAdminActor(req);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['db', 'key']);
    const ctx = await valkeyContext(actor);
    const db = requireValkeyDb(body.db), key = requireValkeyKey(body.key);
    const [typeRaw, ttl, memory, encoding] = await valkeyRun(ctx.password, db, [['TYPE', key], ['PTTL', key], ['MEMORY', 'USAGE', key], ['OBJECT', 'ENCODING', key]]);
    const type = String(respText(typeRaw) || 'none');
    let command;
    if (type === 'string') command = ['GETRANGE', key, '0', '65535'];
    if (type === 'hash') command = ['HSCAN', key, '0', 'COUNT', '100'];
    if (type === 'list') command = ['LRANGE', key, '0', '99'];
    if (type === 'set') command = ['SSCAN', key, '0', 'COUNT', '100'];
    if (type === 'zset') command = ['ZRANGE', key, '0', '99', 'WITHSCORES'];
    if (type === 'stream') command = ['XRANGE', key, '-', '+', 'COUNT', '50'];
    const value = command ? (await valkeyRun(ctx.password, db, [command]))[0] : null;
    return jsonRes(res, 200, { db, key, type, ttlMs: Number(ttl ?? -2), memoryBytes: memory == null ? null : Number(memory), encoding: respText(encoding), value: respText(value), truncated: type === 'string' && Buffer.isBuffer(value) && value.length >= 65536 });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function valkeyMutation(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await valkeyAdminActor(req, true);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['action', 'db', 'key', 'value', 'ttlSeconds', 'reason']);
    const reason = requireOwnerReason(body.reason), action = String(body.action || '');
    const ctx = await valkeyContext(actor), db = requireValkeyDb(body.db), key = requireValkeyKey(body.key);
    let command;
    if (action === 'set') {
      const value = String(body.value ?? '');
      if (Buffer.byteLength(value, 'utf8') > 65536) throw { code: 400, msg: 'value is limited to 64 KiB' };
      const ttl = Number(body.ttlSeconds || 0);
      command = ['SET', key, value, ...(ttl > 0 ? ['EX', String(Math.floor(ttl))] : [])];
    } else if (action === 'delete') command = ['DEL', key];
    else if (action === 'expire') command = ['EXPIRE', key, String(Math.max(1, Math.floor(Number(body.ttlSeconds || 0))))];
    else if (action === 'persist') command = ['PERSIST', key];
    else throw { code: 400, msg: 'unsupported mutation action' };
    await publishFoundationAudit(actor, `valkey-key-${action}`, `Valkey/db${db}/${key}`, 'attempt', reason);
    const [result] = await valkeyRun(ctx.password, db, [command]);
    await publishFoundationAudit(actor, `valkey-key-${action}`, `Valkey/db${db}/${key}`, 'accepted', reason);
    return jsonRes(res, 200, { ok: true, action, result: respText(result) });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function valkeyAcl(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await valkeyAdminActor(req, true);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['action', 'username', 'password', 'keyPattern', 'profile', 'reason']);
    const reason = requireOwnerReason(body.reason), action = String(body.action || ''), username = String(body.username || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username) || username === 'default') throw { code: 400, msg: 'managed ACL username is invalid or protected' };
    const ctx = await valkeyContext(actor);
    let commands;
    if (action === 'setuser') {
      const password = String(body.password || '');
      if (password.length < 12 || password.length > 128 || /\s/.test(password)) throw { code: 400, msg: 'ACL password must be 12..128 non-space characters' };
      const pattern = String(body.keyPattern || '*');
      if (!pattern || pattern.length > 128 || /\s/.test(pattern)) throw { code: 400, msg: 'ACL key pattern is invalid' };
      const profile = String(body.profile || 'readonly');
      const categories = profile === 'readwrite' ? ['+@read', '+@write', '+@connection', '-@dangerous'] : profile === 'readonly' ? ['+@read', '+@connection'] : null;
      if (!categories) throw { code: 400, msg: 'ACL profile must be readonly or readwrite' };
      commands = [['ACL', 'SETUSER', username, 'reset', 'on', `>${password}`, `~${pattern}`, '&*', '-@all', ...categories], ['ACL', 'SAVE']];
    } else if (action === 'deluser') commands = [['ACL', 'DELUSER', username], ['ACL', 'SAVE']];
    else throw { code: 400, msg: 'unsupported ACL action' };
    await publishFoundationAudit(actor, `valkey-acl-${action}`, `Valkey/ACL/${username}`, 'attempt', reason);
    const results = await valkeyRun(ctx.password, 0, commands);
    await publishFoundationAudit(actor, `valkey-acl-${action}`, `Valkey/ACL/${username}`, 'accepted', reason);
    return jsonRes(res, 200, { ok: true, action, username, results: respText(results) });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function valkeyCredential(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await valkeyAdminActor(req, true);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['name', 'reason']);
    const name = requireK8sName(body.name || VALKEY_DEFAULT_SECRET), reason = requireOwnerReason(body.reason);
    if (name !== VALKEY_DEFAULT_SECRET) throw { code: 400, msg: `credential name must be ${VALKEY_DEFAULT_SECRET}` };
    const password = crypto.randomBytes(24).toString('base64url');
    const secretPath = `/api/v1/namespaces/${FND_NS}/secrets/${name}?fieldManager=foundation-console&force=true`;
    const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace: FND_NS, labels: { 'foundation.opensphere.io/engine': 'valkey', 'opensphere.io/managed-by': 'foundation' } }, type: 'Opaque', stringData: { password } };
    await publishFoundationAudit(actor, 'valkey-credential-create', `Secret/${FND_NS}/${name}`, 'attempt', reason);
    // Server-side apply addresses the fixed Secret by name, so the ServiceAccount
    // requires only get/patch on that exact resource (no namespace-wide create).
    const result = await k8sJson('PATCH', secretPath, secret, undefined, 'application/apply-patch+yaml');
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'valkey-credential-create', `Secret/${FND_NS}/${name}`, 'accepted', reason);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, secretRef: { namespace: FND_NS, name, key: 'password' }, password, oneTime: true }));
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}

function rustfsXmlText(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : '';
}
function rustfsBuckets(xml) {
  return [...String(xml || '').matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g)].map((match) => ({
    name: rustfsXmlText(match[1], 'Name'),
    createdAt: rustfsXmlText(match[1], 'CreationDate'),
  })).filter((bucket) => bucket.name);
}
function rustfsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function rustfsSigningKey(secret, date, region = 'us-east-1') {
  const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request');
}
async function rustfsRequest(ctx, method, objectPath = '/', query = {}, body = '') {
  const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), shortDate = amzDate.slice(0, 8);
  const canonicalPath = objectPath.split('/').map(rustfsEncode).join('/') || '/';
  const canonicalQuery = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${rustfsEncode(key)}=${rustfsEncode(value)}`).join('&');
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalHeaders = `host:${RUSTFS_SERVICE}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${shortDate}/us-east-1/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signature = crypto.createHmac('sha256', rustfsSigningKey(ctx.secretKey, shortDate)).update(stringToSign).digest('hex');
  const url = `http://${RUSTFS_SERVICE}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${ctx.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : payload,
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  if (!response.ok) {
    const code = rustfsXmlText(text, 'Code') || `HTTP ${response.status}`;
    const message = rustfsXmlText(text, 'Message') || text.slice(0, 300) || response.statusText;
    throw { code: response.status >= 400 && response.status < 500 ? response.status : 502, msg: `RustFS ${code}: ${message}` };
  }
  return { status: response.status, headers: response.headers, text };
}
async function rustfsContext() {
  const model = await k8sJson('GET', `${FOUNDATION_API}/foundationmodels/data`);
  if (!model.ok) throw { code: model.status, msg: k8sFailure(model) };
  if (model.json?.spec?.parameters?.engines?.rustfs !== 'enabled') throw { code: 409, msg: 'RustFS engine is not enabled' };
  const config = model.json?.spec?.parameters?.dataEngines?.rustfs || {};
  const secretName = requireK8sName(config.authSecret || RUSTFS_DEFAULT_SECRET);
  if (secretName !== RUSTFS_DEFAULT_SECRET) throw { code: 409, msg: `RustFS credential must be Secret/${RUSTFS_DEFAULT_SECRET}` };
  const secret = await k8sJson('GET', `/api/v1/namespaces/${FND_NS}/secrets/${secretName}`);
  if (!secret.ok) throw { code: secret.status, msg: `RustFS credential unavailable: ${k8sFailure(secret)}` };
  const access = secret.json?.data?.access_key, secretKey = secret.json?.data?.secret_key;
  if (!access || !secretKey) throw { code: 409, msg: `Secret/${secretName} requires access_key and secret_key` };
  return { model: model.json, config, secretName, accessKey: Buffer.from(access, 'base64').toString('utf8'), secretKey: Buffer.from(secretKey, 'base64').toString('utf8') };
}
async function rustfsAdminActor(req, aal2 = false) {
  const actor = await verifyToken(requestToken(req));
  return aal2 ? requireFoundationOwner(actor) : requireConsoleAdmin(actor);
}
async function rustfsSummary(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    await rustfsAdminActor(req);
    const ctx = await rustfsContext();
    const result = await rustfsRequest(ctx, 'GET');
    const buckets = rustfsBuckets(result.text);
    return jsonRes(res, 200, {
      authority: 'RustFS S3 SigV4 allowlist', observedAt: new Date().toISOString(), version: ctx.config.version || '1.0.0-beta.10',
      endpoint: RUSTFS_SERVICE, bucketCount: buckets.length, buckets,
      desired: ctx.config, secretRef: { namespace: FND_NS, name: ctx.secretName, keys: ['access_key', 'secret_key'] },
    });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
function requireRustFSBucket(value) {
  const name = String(value || '').trim();
  if (name.length < 3 || name.length > 63 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name) || name.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    throw { code: 400, msg: 'bucket name must be 3..63 lowercase DNS-compatible characters' };
  }
  return name;
}
async function rustfsBucket(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await rustfsAdminActor(req, true);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['action', 'name', 'reason']);
    const action = String(body.action || ''), name = requireRustFSBucket(body.name), reason = requireOwnerReason(body.reason);
    if (!['create', 'delete'].includes(action)) throw { code: 400, msg: 'bucket action must be create or delete' };
    const ctx = await rustfsContext();
    await publishFoundationAudit(actor, `rustfs-bucket-${action}`, `RustFS/Bucket/${name}`, 'attempt', reason);
    await rustfsRequest(ctx, action === 'create' ? 'PUT' : 'DELETE', `/${name}`);
    await publishFoundationAudit(actor, `rustfs-bucket-${action}`, `RustFS/Bucket/${name}`, 'accepted', reason);
    return jsonRes(res, 200, { ok: true, action, name });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function rustfsCredential(req, res) {
  if (req.method === 'GET') {
    try {
      await rustfsAdminActor(req);
      const result = await k8sJson('GET', `/api/v1/namespaces/${FND_NS}/secrets/${RUSTFS_DEFAULT_SECRET}`);
      if (result.status === 404) return jsonRes(res, 200, { present: false, validKeys: false, name: RUSTFS_DEFAULT_SECRET });
      if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
      const data = result.json?.data || {};
      return jsonRes(res, 200, { present: true, validKeys: Boolean(data.access_key && data.secret_key), name: RUSTFS_DEFAULT_SECRET });
    } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
  }
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await rustfsAdminActor(req, true);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['name', 'reason']);
    const name = requireK8sName(body.name || RUSTFS_DEFAULT_SECRET), reason = requireOwnerReason(body.reason);
    if (name !== RUSTFS_DEFAULT_SECRET) throw { code: 400, msg: `credential name must be ${RUSTFS_DEFAULT_SECRET}` };
    const accessKey = `opensphere-${crypto.randomBytes(9).toString('hex')}`;
    const secretKey = crypto.randomBytes(32).toString('base64url');
    const secretPath = `/api/v1/namespaces/${FND_NS}/secrets/${name}?fieldManager=foundation-console&force=true`;
    const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace: FND_NS, labels: { 'foundation.opensphere.io/engine': 'rustfs', 'opensphere.io/managed-by': 'foundation' } }, type: 'Opaque', stringData: { access_key: accessKey, secret_key: secretKey } };
    await publishFoundationAudit(actor, 'rustfs-credential-create', `Secret/${FND_NS}/${name}`, 'attempt', reason);
    const result = await k8sJson('PATCH', secretPath, secret, undefined, 'application/apply-patch+yaml');
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'rustfs-credential-create', `Secret/${FND_NS}/${name}`, 'accepted', reason);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, secretRef: { namespace: FND_NS, name, keys: ['access_key', 'secret_key'] }, accessKey, secretKey, oneTime: true }));
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}

// ── Percona Server for MongoDB PFSS management boundary ──────────────────
// Connection URI와 mTLS material은 exact Secret allowlist 안에서만 소비하고 브라우저에
// 반환하지 않는다. 데이터 작업은 database/collection과 declarative user 계약으로
// 제한하며 raw MongoDB command 실행기는 제공하지 않는다.
function requireMongoIdentifier(value, field) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(name) || ['admin', 'local', 'config'].includes(name) && field === 'database') {
    throw { code: 400, msg: `${field} must be 1..63 safe characters and cannot be a protected database` };
  }
  return name;
}
async function psmdbAdminActor(req, aal2 = false) {
  const actor = await verifyToken(requestToken(req));
  return aal2 ? requireFoundationOwner(actor) : requireConsoleAdmin(actor);
}
async function psmdbContext() {
  const model = await k8sJson('GET', `${FOUNDATION_API}/foundationmodels/data`);
  if (!model.ok) throw { code: model.status, msg: k8sFailure(model) };
  if (model.json?.spec?.parameters?.engines?.psmdb !== 'enabled') throw { code: 409, msg: 'Percona PSMDB engine is not enabled' };
  const resource = await k8sJson('GET', `/apis/psmdb.percona.com/v1/namespaces/${FND_NS}/perconaservermongodbs/${PSMDB_NAME}`);
  if (!resource.ok) throw { code: resource.status, msg: `PerconaServerMongoDB unavailable: ${k8sFailure(resource)}` };
  const secret = await k8sJson('GET', `/api/v1/namespaces/${FND_NS}/secrets/${PSMDB_CONNECTION_SECRET}`);
  if (!secret.ok) throw { code: secret.status, msg: `PSMDB connection Secret/${PSMDB_CONNECTION_SECRET} unavailable: ${k8sFailure(secret)}` };
  const data = secret.json?.data || {};
  const encoded = data.databaseAdmin_rs0_connectionString || Object.entries(data).find(([key]) => /connectionString$/i.test(key))?.[1];
  if (!encoded) throw { code: 409, msg: `Secret/${PSMDB_CONNECTION_SECRET} has no databaseAdmin rs0 connection string` };
  const tls = await k8sJson('GET', `/api/v1/namespaces/${FND_NS}/secrets/${PSMDB_TLS_SECRET}`);
  if (!tls.ok) throw { code: tls.status, msg: `PSMDB mTLS Secret/${PSMDB_TLS_SECRET} unavailable: ${k8sFailure(tls)}` };
  const tlsData = tls.json?.data || {};
  const caEncoded = tlsData['ca.crt'] || tlsData.ca;
  const certEncoded = tlsData['tls.crt'];
  const keyEncoded = tlsData['tls.key'];
  if (!caEncoded || !certEncoded || !keyEncoded) {
    throw { code: 409, msg: `Secret/${PSMDB_TLS_SECRET} must contain ca.crt, tls.crt, and tls.key for MongoDB mTLS` };
  }
  return {
    model: model.json, resource: resource.json,
    uri: Buffer.from(String(encoded), 'base64').toString('utf8'),
    ca: Buffer.from(String(caEncoded), 'base64'),
    cert: Buffer.from(String(certEncoded), 'base64'),
    key: Buffer.from(String(keyEncoded), 'base64'),
  };
}
async function withPsmdb(fn) {
  const ctx = await psmdbContext();
  const client = new MongoClient(ctx.uri, {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000,
    ca: ctx.ca, cert: ctx.cert, key: ctx.key,
  });
  try {
    await client.connect();
    return await fn(client, ctx);
  } finally {
    await client.close().catch(() => {});
  }
}
async function psmdbSummary(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only endpoint' });
  try {
    await psmdbAdminActor(req);
    const result = await withPsmdb(async (client, ctx) => {
      const admin = client.db('admin');
      const [server, repl, list] = await Promise.all([
        admin.command({ serverStatus: 1 }),
        admin.command({ replSetGetStatus: 1 }).catch(() => null),
        admin.admin().listDatabases({ authorizedDatabases: true }),
      ]);
      const databases = [];
      for (const row of (list.databases || []).slice(0, 100)) {
        const db = client.db(row.name);
        const [collections, users] = await Promise.all([
          db.listCollections({}, { nameOnly: true }).toArray().catch(() => []),
          db.command({ usersInfo: 1, showCredentials: false }).then((value) => value.users || []).catch(() => []),
        ]);
        databases.push({
          name: row.name, sizeOnDisk: Number(row.sizeOnDisk || 0), empty: Boolean(row.empty),
          collections: collections.slice(0, 500).map((item) => ({ name: item.name, type: item.type || 'collection' })),
          users: users.slice(0, 200).map((item) => ({ user: item.user, db: item.db, roles: item.roles || [] })),
        });
      }
      const members = (repl?.members || []).map((member) => ({ name: member.name, state: member.stateStr, health: member.health, uptime: member.uptime, optimeDate: member.optimeDate }));
      const desiredUsers = Array.isArray(ctx.resource?.spec?.users) ? ctx.resource.spec.users.map((user) => ({ name: user.name, db: user.db, roles: user.roles || [] })) : [];
      return {
        authority: 'MongoDB Node.js driver 7.5.0 allowlist', observedAt: new Date().toISOString(),
        version: server.version || 'unknown', process: server.process || 'mongod', uptimeSeconds: Number(server.uptime || 0),
        connections: { current: Number(server.connections?.current || 0), available: Number(server.connections?.available || 0), active: Number(server.connections?.active || 0) },
        opcounters: server.opcounters || {}, memory: server.mem || {}, network: server.network || {},
        replicaSet: repl ? { set: repl.set, state: repl.myState, members } : null,
        databaseCount: databases.length, databases, desiredUsers,
        image: ctx.resource?.spec?.image || '', crVersion: ctx.resource?.spec?.crVersion || '',
      };
    });
    return jsonRes(res, 200, result);
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function psmdbCollection(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await psmdbAdminActor(req, true);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['action', 'database', 'collection', 'reason']);
    const action = String(body.action || ''), database = requireMongoIdentifier(body.database, 'database'), collection = requireMongoIdentifier(body.collection, 'collection'), reason = requireOwnerReason(body.reason);
    if (!['create', 'drop'].includes(action)) throw { code: 400, msg: 'collection action must be create or drop' };
    const target = `PSMDB/${database}/${collection}`;
    await publishFoundationAudit(actor, `psmdb-collection-${action}`, target, 'attempt', reason);
    await withPsmdb(async (client) => action === 'create' ? client.db(database).createCollection(collection) : client.db(database).dropCollection(collection));
    await publishFoundationAudit(actor, `psmdb-collection-${action}`, target, 'accepted', reason);
    return jsonRes(res, 200, { ok: true, action, database, collection });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}
async function psmdbUser(req, res) {
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  try {
    const actor = await psmdbAdminActor(req, true);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    requireClosedOwnerBody(body, ['action', 'username', 'database', 'role', 'reason']);
    const action = String(body.action || ''), username = requireMongoIdentifier(body.username, 'username'), database = requireMongoIdentifier(body.database, 'database'), role = String(body.role || 'readWrite'), reason = requireOwnerReason(body.reason);
    if (!['set', 'delete'].includes(action)) throw { code: 400, msg: 'user action must be set or delete' };
    if (!['read', 'readWrite', 'dbAdmin'].includes(role)) throw { code: 400, msg: 'role must be read, readWrite, or dbAdmin' };
    const current = await k8sJson('GET', `/apis/psmdb.percona.com/v1/namespaces/${FND_NS}/perconaservermongodbs/${PSMDB_NAME}`);
    if (!current.ok) throw { code: current.status, msg: k8sFailure(current) };
    const users = Array.isArray(current.json?.spec?.users) ? current.json.spec.users.filter((item) => item?.name !== username) : [];
    if (action === 'set') users.push({ name: username, db: database, roles: [{ name: role, db: database }] });
    const patch = { metadata: { resourceVersion: current.json?.metadata?.resourceVersion }, spec: { users } };
    const target = `PerconaServerMongoDB/${PSMDB_NAME}/spec.users/${username}`;
    await publishFoundationAudit(actor, `psmdb-user-${action}`, target, 'attempt', reason);
    const updated = await k8sJson('PATCH', `/apis/psmdb.percona.com/v1/namespaces/${FND_NS}/perconaservermongodbs/${PSMDB_NAME}`, patch, undefined, 'application/merge-patch+json');
    if (!updated.ok) throw { code: updated.status, msg: k8sFailure(updated) };
    await publishFoundationAudit(actor, `psmdb-user-${action}`, target, 'accepted', reason);
    return jsonRes(res, 200, { ok: true, action, username, database, role, generatedSecret: action === 'set' ? `${PSMDB_NAME}-custom-user-secret` : null });
  } catch (error) { return jsonRes(res, error.code || 502, { error: error.msg || error.message || String(error) }); }
}

// 제네릭 K8s API 프록시: /api/k8s/<표준 K8s 경로> → APISERVER.
// 모든 요청은 Supabase session을 먼저 검증한다. 읽기는 제한된 ServiceAccount 권한으로,
// 쓰기는 평가된 Console role을 제한된 Kubernetes group으로 매핑해 Impersonate-User로 수행한다.
// secrets 전면 차단, 쓰기는 감사 로그를 남긴다.
async function k8sProxy(req, res, rawUrl) {
  // 보안: 원시 경로 정규식 매칭은 URL 인코딩(sec%72ets)으로 우회됨 → 디코드 후 세그먼트 정확 매칭.
  const qIdx = rawUrl.indexOf('?');
  const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx) : ''; // 쿼리는 원형 유지(labelSelector 등)
  let pathOnly;
  try { pathOnly = decodeURIComponent(rawUrl.slice('/api/k8s'.length).split('?')[0]); }
  catch { return jsonRes(res, 400, { error: 'bad path encoding' }); }
  if (!/^\/(api|apis)\//.test(pathOnly)) return jsonRes(res, 400, { error: 'only /api or /apis paths allowed' });
  const segs = pathOnly.split('/').filter(Boolean);
  // 이중 인코딩 거부(%xx가 디코드 후에도 남아있으면 차단)
  if (segs.some((s) => s.includes('%'))) return jsonRes(res, 400, { error: 'encoded path segments not allowed' });
  // 시크릿: 어느 세그먼트든 'secrets'면 차단(denylist)
  if (segs.includes('secrets')) return jsonRes(res, 403, { error: 'secrets are blocked by policy' });
  // 고위험 서브리소스(마지막 세그먼트) 차단: exec/attach/portforward/proxy, serviceaccounts/*/token
  const last = segs[segs.length - 1];
  if (['exec', 'attach', 'portforward', 'proxy'].includes(last)) return jsonRes(res, 403, { error: 'subresource blocked by policy' });
  if (segs.includes('serviceaccounts') && last === 'token') return jsonRes(res, 403, { error: 'token subresource blocked by policy' });

  const isWrite = WRITE_METHODS.has(req.method);
  if (isWrite && pathOnly === '/api/v1/namespaces') {
    return jsonRes(res, 403, { error: 'Namespace creation must use /api/foundation/postgres/namespaces' });
  }
  const idToken = requestToken(req); // Main Shell host-mediated fetch가 주입한 Supabase access token
  // 헤더는 새로 구성 — 클라이언트의 Impersonate-*/Authorization은 절대 전달하지 않음(위조 차단)
  const headers = { Authorization: `Bearer ${tok()}`, Accept: 'application/json' };
  let actor;
  try { actor = await verifyToken(idToken); }
  catch (e) {
    const status = (typeof e.code === 'number') ? e.code : 502;
    return jsonRes(res, status, { error: e.msg || e.message || 'unauthorized' });
  }

  if (isWrite) {
    headers['Impersonate-User'] = actor.username;
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = ct;
  }

  const body = isWrite ? await readBody(req) : undefined;
  // 업스트림은 검증된 디코드 경로 + 원형 쿼리로 재구성(원시 sub 그대로 전달 금지)
  // 쓰기에 한해 검증된 Console role을 고정된 Kubernetes group으로만 임퍼소네이션한다.
  const fetchHeaders = new Headers(headers);
  const sentGroups = [];
  if (isWrite && actor) {
    for (const g of k8sGroups(actor.groups)) {
      fetchHeaders.append('Impersonate-Group', g);
      sentGroups.push(g);
    }
  }
  const r = await fetch(`${APISERVER}${pathOnly}${rawQuery}`, { method: req.method, headers: fetchHeaders, body });
  const text = await r.text();
  if (isWrite) console.log(`[audit] user=${actor && actor.username} groups=[${sentGroups.join(',')}] verb=${req.method} path=${pathOnly} status=${r.status} ${new Date().toISOString()}`);
  if (isWrite && r.status >= 400) { console.log(`[audit-body] status=${r.status} sentGroupHdr=${JSON.stringify(fetchHeaders.get('Impersonate-Group'))} body=${text.slice(0, 400)}`); }
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

// ── Foundation 모듈: OpenSearch 읽기 프록시 ──
// /api/opensearch/<진단경로> → opensphere-search.opensphere-foundation.svc:9200 (dev, security 비활성, 읽기 전용).
async function opensearchProxy(req, res, rawUrl) {
  const OS = process.env.OPENSEARCH_URL || 'http://opensphere-search.opensphere-foundation.svc:9200';
  if (req.method !== 'GET' && req.method !== 'HEAD') return jsonRes(res, 405, { error: 'read-only proxy' });
  let path;
  try { path = decodeURIComponent(rawUrl.slice('/api/opensearch'.length).split('?')[0]); }
  catch { return jsonRes(res, 400, { error: 'bad path' }); }
  // 화이트리스트: 진단/조회 경로만(_cluster·_cat·_nodes·_stats·_aliases·루트). 쓰기·임의 인덱스 조작 차단.
  const okPath = path === '' || path === '/' || /^\/_(cluster|cat|nodes|stats|aliases)/.test(path);
  if (!okPath) return jsonRes(res, 403, { error: 'only diagnostic GET paths allowed' });
  const qIdx = rawUrl.indexOf('?');
  const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  try {
    const r = await fetch(`${OS}${path || '/'}${rawQuery}`, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(text);
  } catch (e) { jsonRes(res, 502, { error: 'opensearch unreachable: ' + String(e) }); }
}

// ── Foundation 모듈: Prometheus(kube-prometheus-stack) 읽기 프록시 ──
// /api/prometheus/<질의경로> → kube-prometheus-stack Prometheus (읽기 전용, query/query_range/targets만 허용).
async function prometheusProxy(req, res, rawUrl) {
  const PROM = process.env.PROMETHEUS_URL || 'http://kube-prometheus-stack-prometheus.monitoring.svc:9090';
  if (req.method !== 'GET' && req.method !== 'HEAD') return jsonRes(res, 405, { error: 'read-only proxy' });
  let path;
  try { path = decodeURIComponent(rawUrl.slice('/api/prometheus'.length).split('?')[0]); }
  catch { return jsonRes(res, 400, { error: 'bad path' }); }
  // 화이트리스트: 즉석 질의/타깃 상태만(관리 API·설정 리로드 등 차단).
  const okPath = /^\/api\/v1\/(query|query_range|targets)$/.test(path);
  if (!okPath) return jsonRes(res, 403, { error: 'only query/query_range/targets allowed' });
  const qIdx = rawUrl.indexOf('?');
  const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  try {
    const r = await fetch(`${PROM}${path}${rawQuery}`, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(text);
  } catch (e) { jsonRes(res, 502, { error: 'prometheus unreachable: ' + String(e) }); }
}

const server = http.createServer(async (req, res) => {
  let p;
  try { p = new URL(req.url || '/', 'http://localhost').pathname; }
  catch { return jsonRes(res, 400, { error: 'bad request target' }); }
  try {
    if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (p === '/api/session') {
      // WS(exec/터미널)용 신원 쿠키 발급 — 토큰 JWKS 검증 후 HttpOnly 쿠키로(브라우저 WS가 보낼 수 있게)
      let actor;
      try { actor = await verifyToken(requestToken(req)); }
      catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
      const secure = req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : '';
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': `${COOKIE}=${encodeURIComponent(requestToken(req))}; HttpOnly; SameSite=Strict; Path=/api/plugins/foundation;${secure} Max-Age=600`,
      });
      return res.end(JSON.stringify({ user: actor.username }));
    }
    if (p === '/cli/manifest') return jsonRes(res, req.method === 'GET' ? 200 : 405, req.method === 'GET' ? foundationCliManifest() : { error: 'read-only endpoint' });
    if (p === '/api/foundation/samba/readiness') return sambaReadiness(req, res);
    if (p === '/api/foundation/samba/bootstrap-secret') return saveSambaBootstrapSecret(req, res);
    if (p === '/api/foundation/valkey/summary') return valkeySummary(req, res);
    if (p === '/api/foundation/valkey/scan') return valkeyScan(req, res);
    if (p === '/api/foundation/valkey/key') return valkeyKey(req, res);
    if (p === '/api/foundation/valkey/mutation') return valkeyMutation(req, res);
    if (p === '/api/foundation/valkey/acl') return valkeyAcl(req, res);
    if (p === '/api/foundation/valkey/credential') return valkeyCredential(req, res);
    if (p === '/api/foundation/rustfs/summary') return rustfsSummary(req, res);
    if (p === '/api/foundation/rustfs/bucket') return rustfsBucket(req, res);
    if (p === '/api/foundation/rustfs/credential') return rustfsCredential(req, res);
    if (p === '/api/foundation/psmdb/summary') return psmdbSummary(req, res);
    if (p === '/api/foundation/psmdb/collection') return psmdbCollection(req, res);
    if (p === '/api/foundation/psmdb/user') return psmdbUser(req, res);
    if (p === '/api/foundation/postgres/clusters') return postgresFleetClusters(req, res);
    if (p === '/api/foundation/postgres/extensions') return postgresExtensions(req, res, new URL(req.url || '/', 'http://localhost'));
    if (p === '/api/foundation/postgres/runtimes') return postgresRuntimes(req, res);
    if (p === '/api/foundation/postgres/namespaces') return postgresFleetNamespaces(req, res);
    if (p === '/api/foundation/postgres/claims') return postgresClaims(req, res);
    if (p === '/api/foundation/postgres/backup-targets') return postgresBackupTargets(req, res);
    if (p === '/api/foundation/postgres/profiles') return postgresProfiles(req, res, new URL(req.url || '/', 'http://localhost'));
    if (p === '/api/foundation/postgres/operator') return postgresOperator(req, res);
    if (p === '/api/foundation/postgres/operations') return postgresOperations(req, res, new URL(req.url || '/', 'http://localhost'));
    if (p === '/api/foundation/postgres/backups') return postgresBackups(req, res, new URL(req.url || '/', 'http://localhost'));
    if (p === '/api/foundation/postgres/admin/catalog') return postgresAdminCatalog(req, res, new URL(req.url || '/', 'http://localhost'));
    if (p === '/api/foundation/postgres/admin/query') return postgresAdminQuery(req, res);
    if (p === '/api/foundation/postgres/admin/action') return postgresAdminAction(req, res);
    if (p === '/api/foundation/his-status') return hisStatusProxy(req, res);
    if (p === '/api/foundation/establishment/status') return foundationEstablishmentStatus(req, res);
    if (p === '/api/foundation/bootstrap/plan') return foundationBootstrapPlan(req, res);
    if (p === '/api/foundation/osaa/status') return foundationStatus(req, res);
    if (p === '/api/foundation/osaa/postgres/status') return postgresOsaaStatus(req, res);
    if (p === '/api/foundation/osaa/postgres/capabilities') return postgresOsaaCapabilities(req, res);
    if (p === '/api/foundation/osaa/postgres/readiness') return postgresOsaaReadiness(req, res);
    if (p === '/api/foundation/osaa/postgres/catalog') return postgresOsaaCatalog(req, res);
    if (p === '/api/foundation/osaa/postgres/plan') return postgresOsaaPlan(req, res);
    if (p === '/api/foundation/osaa/postgres/apply') return postgresOsaaApply(req, res);
    if (p === '/api/foundation/osaa/postgres/durable-plan') return postgresOsaaDurablePlan(req, res);
    const postgresDurableApplyPath = p.match(/^\/api\/foundation\/osaa\/postgres\/durable-apply\/(pgplan-[0-9a-f-]{36})$/i);
    if (postgresDurableApplyPath) return postgresOsaaDurableApply(req, res, postgresDurableApplyPath[1]);
    const postgresOperationPath = p.match(/^\/api\/foundation\/osaa\/operations\/([0-9a-f-]{36})$/i);
    if (postgresOperationPath) return postgresOsaaOperationWatch(req, res, postgresOperationPath[1]);
    const postgresClaimStatusPath = p.match(/^\/api\/foundation\/osaa\/postgres\/claims\/([^/]+)\/([^/]+)$/);
    if (postgresClaimStatusPath) return postgresOsaaClaimStatus(req, res, decodeURIComponent(postgresClaimStatusPath[1]), decodeURIComponent(postgresClaimStatusPath[2]));
    if (p === '/api/foundation/osaa/engines/lifecycle') return foundationEngineLifecycle(req, res);
    if (p === '/api/foundation/osaa/claims/create') return foundationClaimCreate(req, res);
    if (p === '/api/foundation/osaa/claims/release') return foundationClaimRelease(req, res);
    if (p === '/api/foundation/osaa/identity-directory/claims/create') return identityDirectoryClaimCreate(req, res);
    if (p === '/api/foundation/osaa/identity-directory/claims/release') return identityDirectoryClaimRelease(req, res);
    if (FOUNDATION_OWNER_ONLY) return jsonRes(res, 404, { error: 'Foundation owner endpoint not found' });
    if (p.startsWith('/api/k8s/')) return k8sProxy(req, res, req.url);
    if (p.startsWith('/api/opensearch')) return opensearchProxy(req, res, req.url);
    if (p.startsWith('/api/prometheus')) return prometheusProxy(req, res, req.url);
    if (p === '/api/nodes') {
      const list = await nodes();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        meta: { service: 'foundation', version: VERSION, servedBy: process.env.HOSTNAME, time: new Date().toISOString() },
        nodes: list,
      }));
    }
    if (p === '/plugins' || p === '/plugins/') {
      const files = fs.existsSync(PLUGINS) ? fs.readdirSync(PLUGINS).filter((f) => !f.startsWith('.')) : [];
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ plugins: files }));
    }
    if (p.startsWith('/plugins/')) return serveFrom(PLUGINS, p.slice('/plugins/'.length), res);
    if (p.startsWith('/app/')) return serveFrom(WWW, p.slice('/app/'.length), res);
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e) }));
  }
});
// ── WS exec/터미널 게이트웨이 ──────────────────────────────────────────────
// 브라우저 WS(/api/k8s-exec/<ns>/<pod>?container=&command=) → 쿠키 토큰 JWKS 검증 → apiserver exec
// 채널(v4.channel.k8s.io)로 투명 릴레이. SA 토큰 + Impersonate-User로 사용자 본인 RBAC(create pods/exec) 인가.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  const m = u.pathname.match(/^\/api\/k8s-exec\/([^/]+)\/([^/]+)$/);
  if (!m) { socket.destroy(); return; }
  let actor;
  try { actor = await verifyToken(tokenFromCookie(req.headers.cookie)); }
  catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  const ns = decodeURIComponent(m[1]);
  const pod = decodeURIComponent(m[2]);
  const container = u.searchParams.get('container') || '';
  const commands = u.searchParams.getAll('command');
  const cmds = commands.length ? commands : ['/bin/sh'];
  wss.handleUpgrade(req, socket, head, (browserWs) => {
    const qs = new URLSearchParams();
    if (container) qs.set('container', container);
    qs.set('stdin', 'true'); qs.set('stdout', 'true'); qs.set('stderr', 'true'); qs.set('tty', 'true');
    for (const c of cmds) qs.append('command', c);
    const upUrl = `${APISERVER.replace(/^https/, 'wss')}/api/v1/namespaces/${ns}/pods/${pod}/exec?${qs.toString()}`;
    const headers = { Authorization: `Bearer ${tok()}`, 'Impersonate-User': actor.username };
    const groups = k8sGroups(actor.groups);
    if (groups.length) headers['Impersonate-Group'] = groups;
    const up = new WebSocket(upUrl, ['v4.channel.k8s.io'], { headers });
    console.log(`[audit] exec user=${actor.username} pod=${ns}/${pod} container=${container} ${new Date().toISOString()}`);
    const closeBoth = () => { try { browserWs.close(); } catch {} try { up.close(); } catch {} };
    up.on('message', (data) => { if (browserWs.readyState === 1) browserWs.send(data, { binary: true }); });
    browserWs.on('message', (data) => { if (up.readyState === 1) up.send(data); });
    up.on('close', closeBoth);
    up.on('error', (e) => { try { browserWs.send(Buffer.from([3, ...Buffer.from(String(e))])); } catch {} closeBoth(); });
    browserWs.on('close', closeBoth);
    browserWs.on('error', closeBoth);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`foundation v${VERSION} on :${PORT}${FOUNDATION_OWNER_ONLY ? ' (owner-only)' : ''}`);
    if (FOUNDATION_OWNER_ONLY) return;
    // 콘솔 인박스에 시작 이벤트 발행 + 주기적 노드 헬스 + FoundationModel 수명주기 전이(유기적 연동)
    publishNotify({ action: 'started', target: 'foundation', result: 'info', reason: `Foundation 백엔드 v${VERSION} 시작` });
    nodeHealthPublish();
    fmTransitionPublish(); // 첫 호출 = 기준선 수립(발행 없음), 이후 전이만 발행
    setInterval(nodeHealthPublish, 60000);
    setInterval(fmTransitionPublish, 30000);
  });
} else {
  module.exports = {
    verifySupabaseToken, k8sGroups, requireConsoleAdmin, requireFoundationOwner,
    requireClosedOwnerBody, requireOwnerReason, requireOwnerConfirm, requireK8sName,
    requireFoundationLifecycle, platformReadinessAuthority, foundationEstablishmentView,
    foundationBootstrapPlanView, sambaBootstrapSecretEvidence, sambaReadinessProjection,
    validateHisStatusContract,
    parseResp, encodeRespCommand, parseInfo, sanitizeAclLine, requireValkeyDb, requireValkeyKey,
    postgresReadOnlySql, postgresActionPlan, pgName, postgresServiceHost, postgresBindingDatabase,
    parsePostgresClusterId, postgresClusterProjection, postgresRuntimeCatalogProjection,
    postgresPlanProjection, postgresClaimProjection, validatePostgresClaimPlan,
    postgresClaimConfirmation, requirePostgresClaimConfirm,
    postgresExtensionName, postgresExtensionVersion, sanitizePostgresExtensions, postgresExtensionSpecDiff,
    stackGresExtensionVersions, stackGresExtensionCatalog, postgresClaimResource,
    foundationPostgresClaimResource, foundationPostgresClaimProjection, foundationCliManifest,
    postgresInstanceRequestSchema, postgresOwnerActionDefinitions, postgresOwnerContractProjection,
    postgresReadinessEvidence, postgresReadinessBlocker, postgresCrdReadinessBlocker,
    postgresReadinessStage, postgresReadinessProjection,
    postgresOperationOwnerEvidence, postgresOperationCompletion, postgresOperationWatchStage,
    postgresProfileKind, sanitizePostgresProfileSpec, profileReferenceCounts, profileSpecDiff,
    postgresOperationPlan, postgresBackupPlan,
    foundationBootstrapState,
    HIS_STATUS_SCHEMA, FOUNDATION_CORE_CRDS,
    FOUNDATION_ENGINE_MODEL, FOUNDATION_CLAIM_MODELS, POSTGRES_ADMIN, POSTGRES_DEFAULT_ID,
    POSTGRES_OWNER_CONTRACT_VERSION, POSTGRES_OWNER_SOURCE_REVISION, POSTGRES_OWNER_EVIDENCE_TTL_SECONDS,
  };
}
