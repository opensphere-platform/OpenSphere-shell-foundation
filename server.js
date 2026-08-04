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
const SAMBA_BOOTSTRAP_SECRET = process.env.SAMBA_BOOTSTRAP_SECRET || 'foundation-identity-samba-creds';
const SAMBA_BOOTSTRAP_SECRET_KEY = 'domain-password';
const VALKEY_SERVICE = process.env.VALKEY_SERVICE || `foundation-data-valkey.${FND_NS}.svc`;
const VALKEY_PORT = Number(process.env.VALKEY_PORT || 6379);
const VALKEY_DEFAULT_SECRET = 'foundation-data-valkey-auth';
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
const k8sJson = async (method, path, body, actor) => {
  const headers = new Headers({
    Authorization: `Bearer ${tok()}`,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': method === 'PATCH' ? 'application/merge-patch+json' : 'application/json' } : {}),
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
  const hisBinding = prerequisites.find((item) => item.key === 'his-binding');
  if (!clusterManager?.ready || !hisBinding?.ready) {
    const reason = clusterManager?.ready ? 'his_preflight_not_ready' : 'cluster_manager_not_activated';
    throw { code: 409, msg: `Foundation mutation gate closed: ${reason}` };
  }
}
async function platformReadinessAuthority(rawToken) {
  let response;
  try {
    response = await fetch(`${FOUNDATION_AUDIT_URL}/api/admin/platform-readiness/status`, {
      headers: { authorization: `Bearer ${rawToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
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
    changeControlUrl: `/manage/change-control?template=${FOUNDATION_BOOTSTRAP_TEMPLATE_ID}&returnTo=${encodeURIComponent('/p/foundation')}`,
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
        labels: { 'opensphere.io/managed-by': 'foundation-oaa', 'foundation.opensphere.io/model': model },
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
        labels: { 'opensphere.io/managed-by': 'foundation-oaa', 'foundation.opensphere.io/provider': 'samba-ad' },
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
  const secret = await k8sJson('GET', `/api/v1/namespaces/${FND_NS}/secrets/${secretName}`, undefined, actor);
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
    const password = crypto.randomBytes(24).toString('base64url');
    const secretPath = `/api/v1/namespaces/${FND_NS}/secrets`;
    const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace: FND_NS, labels: { 'foundation.opensphere.io/engine': 'valkey', 'opensphere.io/managed-by': 'foundation' } }, type: 'Opaque', stringData: { password } };
    await publishFoundationAudit(actor, 'valkey-credential-create', `Secret/${FND_NS}/${name}`, 'attempt', reason);
    let result = await k8sJson('POST', secretPath, secret, actor);
    if (result.status === 409) result = await k8sJson('PATCH', `${secretPath}/${name}`, { metadata: { labels: secret.metadata.labels }, stringData: secret.stringData }, actor);
    if (!result.ok) throw { code: result.status, msg: k8sFailure(result) };
    await publishFoundationAudit(actor, 'valkey-credential-create', `Secret/${FND_NS}/${name}`, 'accepted', reason);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, secretRef: { namespace: FND_NS, name, key: 'password' }, password, oneTime: true }));
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
    if (p === '/api/foundation/samba/readiness') return sambaReadiness(req, res);
    if (p === '/api/foundation/samba/bootstrap-secret') return saveSambaBootstrapSecret(req, res);
    if (p === '/api/foundation/valkey/summary') return valkeySummary(req, res);
    if (p === '/api/foundation/valkey/scan') return valkeyScan(req, res);
    if (p === '/api/foundation/valkey/key') return valkeyKey(req, res);
    if (p === '/api/foundation/valkey/mutation') return valkeyMutation(req, res);
    if (p === '/api/foundation/valkey/acl') return valkeyAcl(req, res);
    if (p === '/api/foundation/valkey/credential') return valkeyCredential(req, res);
    if (p === '/api/foundation/his-status') return hisStatusProxy(req, res);
    if (p === '/api/foundation/establishment/status') return foundationEstablishmentStatus(req, res);
    if (p === '/api/foundation/bootstrap/plan') return foundationBootstrapPlan(req, res);
    if (p === '/api/foundation/oaa/status') return foundationStatus(req, res);
    if (p === '/api/foundation/oaa/engines/lifecycle') return foundationEngineLifecycle(req, res);
    if (p === '/api/foundation/oaa/claims/create') return foundationClaimCreate(req, res);
    if (p === '/api/foundation/oaa/claims/release') return foundationClaimRelease(req, res);
    if (p === '/api/foundation/oaa/identity-directory/claims/create') return identityDirectoryClaimCreate(req, res);
    if (p === '/api/foundation/oaa/identity-directory/claims/release') return identityDirectoryClaimRelease(req, res);
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
    foundationBootstrapState,
    HIS_STATUS_SCHEMA, FOUNDATION_CORE_CRDS,
    FOUNDATION_ENGINE_MODEL, FOUNDATION_CLAIM_MODELS,
  };
}
