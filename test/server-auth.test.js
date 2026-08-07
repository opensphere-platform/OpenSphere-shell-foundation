'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  verifySupabaseToken, k8sGroups, requireConsoleAdmin, requireFoundationOwner,
  requireClosedOwnerBody, requireOwnerReason, requireOwnerConfirm, requireK8sName,
  requireFoundationLifecycle, foundationEstablishmentView, foundationBootstrapPlanView,
  validateHisStatusContract, foundationBootstrapState,
  parseResp, encodeRespCommand, parseInfo, sanitizeAclLine, requireValkeyDb, requireValkeyKey,
  HIS_STATUS_SCHEMA, FOUNDATION_CORE_CRDS,
  FOUNDATION_ENGINE_MODEL, FOUNDATION_CLAIM_MODELS,
} = require('../server');

test('Valkey RESP boundary parses bounded protocol values and rejects malformed inputs', () => {
  assert.deepEqual(encodeRespCommand(['SET', 'hello', 'world']).toString('utf8'), '*3\r\n$3\r\nSET\r\n$5\r\nhello\r\n$5\r\nworld\r\n');
  assert.equal(parseResp(Buffer.from('+PONG\r\n')).value, 'PONG');
  assert.equal(parseResp(Buffer.from(':42\r\n')).value, 42);
  assert.deepEqual(parseResp(Buffer.from('*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n')).value.map((value) => value.toString()), ['foo', 'bar']);
  assert.throws(() => parseResp(Buffer.from('$3\r\nfooXX')), /invalid RESP bulk terminator/);
  assert.deepEqual(parseInfo('# Server\r\nvalkey_version:9.1.0\r\nrole:master\r\n'), { valkey_version: '9.1.0', role: 'master' });
  assert.equal(sanitizeAclLine('user app on #0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef ~* +@read'), 'user app on #<password-hash> ~* +@read');
  assert.equal(requireValkeyDb(15), 15);
  assert.throws(() => requireValkeyDb(16), (error) => error.code === 400);
  assert.equal(requireValkeyKey('app:key'), 'app:key');
  assert.throws(() => requireValkeyKey(''), (error) => error.code === 400);
});

test('Valkey management surface exposes typed allowlists and no raw command terminal', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('// ── Valkey PFSS management boundary');
  const end = source.indexOf('// 제네릭 K8s API 프록시', start);
  const boundary = source.slice(start, end);
  assert.match(boundary, /\['SCAN'/);
  assert.match(boundary, /\['ACL', 'SETUSER'/);
  assert.match(boundary, /requireFoundationOwner/);
  assert.match(boundary, /requireOwnerReason/);
  assert.doesNotMatch(boundary, /\['FLUSH(?:ALL|DB)'/);
  assert.doesNotMatch(boundary, /\['EVAL(?:SHA)?'/);
  assert.doesNotMatch(boundary, /\['CONFIG', 'SET'/);
  const component = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'modules', 'valkey', 'valkey-plugin.component.ts'), 'utf8');
  assert.match(component, /No raw commands/);
  assert.doesNotMatch(component, /xterm|valkey-cli|pods\/exec/i);
});

test('Foundation control plane preserves deployed CLI compatibility while adding Valkey exporter', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'control-plane', 'main.go'), 'utf8');
  for (const flag of ['keycloak-pg-image', 'pg-image', 'pgbouncer-image', 'velero-namespace', 'valkey-exporter-image']) {
    assert.match(source, new RegExp(`flag\\.StringVar\\([^\\n]+\"${flag}\"`), `missing deployed flag compatibility: ${flag}`);
  }
});

test('Foundation delegates Console identity validation to the Supabase authority', async () => {
  let call;
  const actor = await verifySupabaseToken('supabase-access-token', async (url, init) => {
    call = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ subject: 'subject-1', username: 'cmars', groups: ['console-admins'], permissions: ['oaa.system.read'], assurance: 'aal2' }),
    };
  });
  assert.match(call.url, /\/api\/identity\/session$/);
  assert.equal(call.init.headers.authorization, 'Bearer supabase-access-token');
  assert.deepEqual(actor, {
    username: 'cmars', subject: 'subject-1', groups: ['console-admins'],
    permissions: ['oaa.system.read'], assurance: 'aal2', provider: 'supabase',
  });
});

test('Foundation fails closed and only projects known Console roles into Kubernetes groups', async () => {
  await assert.rejects(
    verifySupabaseToken('revoked', async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid Supabase session' }) })),
    (error) => error.code === 401 && error.msg === 'invalid Supabase session',
  );
  await assert.rejects(
    verifySupabaseToken('token', async () => { throw new Error('offline'); }),
    (error) => error.code === 503 && error.msg === 'Supabase identity authority unavailable',
  );
  assert.deepEqual(k8sGroups(['console-admins', 'system:masters', 'untrusted']), ['opensphere-console-admins']);
  assert.doesNotThrow(() => requireConsoleAdmin({ groups: ['console-admins'] }));
  assert.throws(() => requireConsoleAdmin({ groups: ['console-viewers'] }), (error) => error.code === 403);
});

test('Foundation owner actions require admin AAL2 and closed inputs', () => {
  assert.doesNotThrow(() => requireFoundationOwner({ groups: ['console-admins'], assurance: 'aal2' }));
  assert.throws(() => requireFoundationOwner({ groups: ['console-admins'], assurance: 'aal1' }), (error) => error.code === 403);
  assert.throws(() => requireFoundationOwner({ groups: ['console-viewers'], assurance: 'aal2' }), (error) => error.code === 403);
  assert.doesNotThrow(() => requireClosedOwnerBody({ engine: 'postgres' }, ['engine']));
  assert.throws(() => requireClosedOwnerBody({ engine: 'postgres', path: '/api/v1/secrets' }, ['engine']), (error) => error.code === 400);
  assert.equal(requireOwnerReason('approved maintenance'), 'approved maintenance');
  assert.throws(() => requireOwnerReason('short'), (error) => error.code === 400);
  assert.doesNotThrow(() => requireOwnerConfirm('enable Foundation engine postgres', 'enable Foundation engine postgres'));
  assert.throws(() => requireOwnerConfirm('yes', 'enable Foundation engine postgres'), (error) => error.code === 409);
  assert.equal(requireK8sName('consumer-a'), 'consumer-a');
  assert.throws(() => requireK8sName('../secret'), (error) => error.code === 400);
});

test('Foundation owner catalog is finite and does not accept arbitrary models or parameters', () => {
  assert.deepEqual(FOUNDATION_CLAIM_MODELS, ['identity', 'data']);
  assert.equal(FOUNDATION_ENGINE_MODEL.postgres, 'data');
  assert.equal(FOUNDATION_ENGINE_MODEL.keycloak, 'identity');
  assert.equal(FOUNDATION_ENGINE_MODEL.shell, undefined);
});

test('Foundation accepts only the versioned canonical HIS status contract', () => {
  const body = {
    schema: HIS_STATUS_SCHEMA,
    stack: 'HIS',
    state: 'Blocked',
    items: [],
    summary: { coreReady: 2, coreTotal: 8, selectedProfilesReady: 0, selectedProfilesTotal: 0 },
  };
  assert.equal(validateHisStatusContract(body), '');
  assert.match(validateHisStatusContract({ ...body, stack: 'HISS' }), /stack must be HIS/);
  assert.match(validateHisStatusContract({ ...body, schema: 'legacy' }), /schema must be/);
  assert.match(validateHisStatusContract({ ...body, summary: { ...body.summary, coreReady: -1 } }), /coreReady/);
});

test('Foundation bootstrap status distinguishes missing contracts from controller readiness', () => {
  const missing = foundationBootstrapState(
    FOUNDATION_CORE_CRDS.map(() => ({ ok: false, status: 404, json: { message: 'not found' } })),
    { ok: false, status: 404, json: { message: 'not found' } },
  );
  assert.equal(missing.phase, 'NotEstablished');
  assert.equal(missing.ready, false);
  assert.equal(missing.contractsReady, false);
  assert.equal(missing.controller.state, 'NotInstalled');
  assert.equal(missing.blockers.length, FOUNDATION_CORE_CRDS.length + 1);

  const ready = foundationBootstrapState(
    FOUNDATION_CORE_CRDS.map(() => ({ ok: true, status: 200, json: {} })),
    { ok: true, status: 200, json: { spec: { replicas: 2 }, status: { readyReplicas: 2, availableReplicas: 2 } } },
  );
  assert.equal(ready.phase, 'Establishing');
  assert.equal(ready.ready, true);
  assert.equal(ready.contractsReady, true);
  assert.deepEqual(ready.blockers, []);
});

test('Foundation owner mutations independently enforce the platform lifecycle gate', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ prerequisites: [{ key: 'cluster-manager', ready: true }, { key: 'his-binding', ready: false }] }),
    });
    await assert.rejects(requireFoundationLifecycle('token'), (error) => error.code === 409 && /his_preflight_not_ready/.test(error.msg));
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ prerequisites: [{ key: 'cluster-manager', ready: true }, { key: 'his-binding', ready: true }] }),
    });
    await assert.doesNotReject(requireFoundationLifecycle('token'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Foundation projects the canonical PFS establishment authority without deriving it from Extension activation', () => {
  const view = foundationEstablishmentView({
    kind: 'PlatformReadinessStatus',
    observedAt: '2026-07-28T00:00:00.000Z',
    phase: 'Blocked',
    ready: false,
    profile: { declared: false, name: 'platform-support' },
    prerequisites: [{ key: 'cluster-manager', ready: true }],
    capabilities: [],
    admission: { foundationActivationAllowed: false, pfsPluginActivationAllowed: false, reason: 'PlatformSupportProfileRequired' },
    pfs: {
      schema: 'foundation-establishment.opensphere.io/v1alpha1',
      phase: 'NotEstablished',
      established: false,
      extensionPhase: 'Activated',
      extensionDesiredState: 'Enabled',
      blockers: [{ key: 'support-profile', state: 'Blocked', detail: 'support evidence required' }],
    },
  });
  assert.equal(view.schema, 'foundation-lifecycle-view.opensphere.io/v1alpha1');
  assert.equal(view.extension.phase, 'Activated');
  assert.equal(view.pfs.phase, 'NotEstablished');
  assert.equal(view.pfs.established, false);
  assert.equal(view.supportProfile.ready, false);
});

test('Foundation establishment projection rejects missing or malformed authority contracts', () => {
  assert.throws(
    () => foundationEstablishmentView({ kind: 'PlatformReadinessStatus', pfs: { phase: 'Established' } }),
    (error) => error.code === 502 && /canonical PFS establishment contract/.test(error.msg),
  );
  assert.throws(
    () => foundationEstablishmentView({
      kind: 'PlatformReadinessStatus',
      pfs: { schema: 'foundation-establishment.opensphere.io/v1alpha1', phase: 'Activated' },
    }),
    (error) => error.code === 502 && /invalid PFS phase/.test(error.msg),
  );
});

test('Foundation bootstrap plan opens only after support readiness and never bypasses reviewed Change Control', () => {
  const template = {
    id: 'foundation-control-plane-bootstrap',
    consumerId: 'foundation-bootstrap',
    action: 'apply',
    target: 'foundation-control-plane/v1alpha1',
    displayName: 'Foundation bootstrap',
    reasonPlaceholder: 'approved reason',
    desiredState: { contract: 'opensphere.foundation.bootstrap/v1' },
  };
  const lifecycle = {
    schema: 'foundation-lifecycle-view.opensphere.io/v1alpha1',
    supportProfile: { ready: true },
    pfs: { established: false, blockers: [{ key: 'foundation-control-plane', detail: 'missing' }] },
  };
  const plan = foundationBootstrapPlanView(lifecycle, template, { current: null, checkedAt: '2026-07-28T00:00:00Z' });
  assert.equal(plan.readyToRequest, true);
  assert.match(plan.changeControlUrl, /^\/manage\/change-control\?template=foundation-control-plane-bootstrap/);
  assert.equal(plan.gate.reason, '');
  assert.equal(foundationBootstrapPlanView(
    { ...lifecycle, supportProfile: { ready: false } },
    template,
    { current: null },
  ).gate.reason, 'PlatformSupportProfileRequired');
  assert.equal(foundationBootstrapPlanView(
    lifecycle,
    template,
    { current: { phase: 'Applying' } },
  ).gate.reason, 'BootstrapRequestInProgress');
  assert.equal(foundationBootstrapPlanView(
    { ...lifecycle, pfs: { established: true, blockers: [] } },
    template,
    { current: null },
  ).gate.reason, 'PFSAlreadyEstablished');
});

test('Foundation owner workload is isolated from the generic proxy and uses least privilege', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const deploy = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'oaa-owner.yaml'), 'utf8');
  const rbac = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'oaa-owner-rbac.yaml'), 'utf8');
  assert.ok(source.indexOf('if (FOUNDATION_OWNER_ONLY)') < source.indexOf("if (p.startsWith('/api/k8s/'))"));
  assert.match(deploy, /FOUNDATION_OWNER_ONLY, value: "true"/);
  assert.match(deploy, /podSelector: \{ matchLabels: \{ app: opensphere-console-oaa-gateway \} \}/);
  assert.match(rbac, /resourceNames: \[identity, data\][\s\S]*verbs: \[patch\]/);
  assert.match(rbac, /resources: \[identitydirectoryclaims\][\s\S]*verbs: \[get, list, watch, create, delete\]/);
  assert.doesNotMatch(rbac, /resources: \[secrets\]/);
});

test('Foundation Control Plane UI is read-only and cannot create cluster-scoped contracts', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'foundation', 'control-plane.service.ts'), 'utf8');
  const component = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'foundation', 'control-plane.component.ts'), 'utf8');
  assert.doesNotMatch(service, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(service, /writeHeaders|repairIdentityDirectoryContracts|customresourcedefinitions'\),\s*\{/);
  assert.doesNotMatch(component, /Repair Contract Pack|repairIdentityDirectoryContracts/);
  assert.match(component, /브라우저 직접 쓰기 금지/);
});

test('Foundation overview consumes the canonical PFS establishment status instead of locally equating activation with establishment', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'foundation', 'control-plane.service.ts'), 'utf8');
  const overview = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'foundation', 'overview.component.ts'), 'utf8');
  assert.match(service, /\/api\/foundation\/establishment\/status/);
  assert.match(service, /\/api\/foundation\/bootstrap\/plan/);
  assert.match(service, /foundation-establishment\.opensphere\.io\/v1alpha1/);
  assert.match(overview, /cp\.establishment\(\)\?\.pfs\?\.phase/);
  assert.doesNotMatch(overview, /return 'Establishing · 설립 증거 확인 필요'/);
  assert.match(overview, /Extension 상태이며 PFS 설립 상태와 별도/);
  assert.match(overview, /설립 변경 요청/);
  assert.match(overview, /\/manage\/platform-control\?tab=readiness/);
  assert.match(overview, /\/manage\/change-control\?template=foundation-control-plane-bootstrap/);
  assert.doesNotMatch(overview, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
});

test('typed IdentityDirectory owner input cannot carry parameters or credential material', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const create = source.slice(source.indexOf('async function identityDirectoryClaimCreate'), source.indexOf('async function identityDirectoryClaimRelease'));
  assert.match(create, /requireClosedOwnerBody\(body, \['name', 'confirm', 'reason'\]\)/);
  assert.match(create, /spec: \{ provider: 'samba-ad' \}/);
  assert.doesNotMatch(create, /body\.(?:parameters|consumerRef|realm|secret|credential)/);
});

test('Valkey credential path is exact-name and ServiceAccount scoped', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const rbac = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'valkey-console-exact-secret-rbac.yaml'), 'utf8');
  const start = source.indexOf('async function valkeyCredential');
  const end = source.indexOf('// 제네릭 K8s API 프록시', start);
  const handler = source.slice(start, end);
  assert.match(handler, /name !== VALKEY_DEFAULT_SECRET/);
  assert.match(handler, /application\/apply-patch\+yaml/);
  assert.match(handler, /k8sJson\('PATCH', secretPath, secret, undefined/);
  assert.match(rbac, /name: foundation-console-valkey-secret-manager[\s\S]*resourceNames: \["foundation-data-valkey-auth", "rustfs-credentials"\][\s\S]*verbs: \["get", "patch"\]/);
  assert.match(rbac, /kind: ServiceAccount[\s\S]*name: opensphere-foundation[\s\S]*namespace: opensphere-console/);
});

test('RustFS credential and bucket paths use exact Secret and allowlisted S3 operations', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('async function rustfsContext');
  const end = source.indexOf('// 제네릭 K8s API 프록시', start);
  const handlers = source.slice(start, end);
  assert.match(handlers, /secretName !== RUSTFS_DEFAULT_SECRET/);
  assert.match(handlers, /name !== RUSTFS_DEFAULT_SECRET/);
  assert.match(handlers, /application\/apply-patch\+yaml/);
  assert.match(handlers, /\['create', 'delete'\]\.includes\(action\)/);
  assert.doesNotMatch(handlers, /listObjects|putObject|raw command/i);
});

test('PSMDB management uses exact Secrets and bounded database contracts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const rbac = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'valkey-console-exact-secret-rbac.yaml'), 'utf8');
  const start = source.indexOf('// ── Percona Server for MongoDB PFSS management boundary');
  const end = source.indexOf('// 제네릭 K8s API 프록시', start);
  const handlers = source.slice(start, end);
  assert.match(handlers, /PSMDB_CONNECTION_SECRET/);
  assert.match(handlers, /databaseAdmin_rs0_connectionString/);
  assert.match(handlers, /must contain ca\.crt, tls\.crt, and tls\.key for MongoDB mTLS/);
  assert.match(handlers, /ca: ctx\.ca, cert: ctx\.cert, key: ctx\.key/);
  assert.match(handlers, /requireClosedOwnerBody\(body, \['action', 'database', 'collection', 'reason'\]\)/);
  assert.match(handlers, /\['create', 'drop'\]\.includes\(action\)/);
  assert.match(handlers, /\['read', 'readWrite', 'dbAdmin'\]\.includes\(role\)/);
  assert.match(handlers, /publishFoundationAudit\(actor, `psmdb-/);
  assert.doesNotMatch(handlers, /eval\(|raw command|connectionString\s*:/i);
  assert.match(rbac, /foundation-data-mongodb-databaseadmin-conn-str[\s\S]*foundation-data-mongodb-custom-user-secret-conn-str[\s\S]*verbs: \["get"\]/);
  assert.match(rbac, /resources: \["perconaservermongodbs"\][\s\S]*resourceNames: \["foundation-data-mongodb"\][\s\S]*verbs: \["get", "patch"\]/);
});

test('PSMDB operator lifecycle is granted only to the projected Console admin group', () => {
  const rbac = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'psmdb-console-operator-rbac.yaml'), 'utf8');
  assert.match(rbac, /name: foundation-psmdb-operator-admin/);
  assert.match(rbac, /resources: \["releases"\][\s\S]*verbs: \["get", "create"\]/);
  assert.match(rbac, /resourceNames: \["psmdb-operator"\][\s\S]*verbs: \["get", "patch", "update"\]/);
  assert.match(rbac, /kind: Group\s+name: opensphere-console-admins/);
  assert.doesNotMatch(rbac, /verbs: \[[^\]]*"delete"/);
});

test('OpenSearch preparation follows the current Console plugin authority contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'foundation', 'opensearch-engine.component.ts'), 'utf8');
  assert.match(source, /const PLUGIN_NAMESPACE = 'opensphere-console'/);
  assert.match(source, /this\.plugin\('\/api\/plan'\)/);
  assert.match(source, /this\.plugin\('\/api\/runtime\/status'\)/);
  assert.match(source, /opensphere_foundation_plugin_info\{plugin="opensearch"/);
  assert.doesNotMatch(source, /namespaces\/opensphere-system\/uipluginregistrations\/opensearch/);
  assert.doesNotMatch(source, /\/api\/grafana|\/api\/logs|\/operand\/manifests/);
});
