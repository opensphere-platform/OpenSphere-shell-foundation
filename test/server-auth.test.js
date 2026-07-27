'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  verifySupabaseToken, k8sGroups, requireConsoleAdmin, requireFoundationOwner,
  requireClosedOwnerBody, requireOwnerReason, requireOwnerConfirm, requireK8sName,
  requireFoundationLifecycle, validateHisStatusContract, foundationBootstrapState,
  HIS_STATUS_SCHEMA, FOUNDATION_CORE_CRDS,
  FOUNDATION_ENGINE_MODEL, FOUNDATION_CLAIM_MODELS,
} = require('../server');

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

test('typed IdentityDirectory owner input cannot carry parameters or credential material', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const create = source.slice(source.indexOf('async function identityDirectoryClaimCreate'), source.indexOf('async function identityDirectoryClaimRelease'));
  assert.match(create, /requireClosedOwnerBody\(body, \['name', 'confirm', 'reason'\]\)/);
  assert.match(create, /spec: \{ provider: 'samba-ad' \}/);
  assert.doesNotMatch(create, /body\.(?:parameters|consumerRef|realm|secret|credential)/);
});
