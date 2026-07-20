const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = process.env.PLUGIN_DIR || '/plugins';
const FOUNDATION_API_URL = (process.env.FOUNDATION_API_URL || 'http://foundation.opensphere-console.svc:8080').replace(/\/$/, '');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
const MODEL_PATH = '/api/k8s/apis/foundation.opensphere.io/v1alpha1/foundationmodels';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeRequestHeaders(req, method, contentType = '') {
  const headers = { accept: 'application/json' };
  for (const name of ['authorization', 'x-os-correlation-id', 'x-os-idempotency-key']) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) headers[name] = value;
  }
  if (WRITE_METHODS.has(method) && contentType) headers['content-type'] = contentType;
  return headers;
}

async function foundationRequest(req, pathname, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(`${FOUNDATION_API_URL}${pathname}`, {
      ...init,
      method,
      signal: controller.signal,
      headers: safeRequestHeaders(req, method, init.contentType || ''),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function nestedValue(value, dottedPath) {
  return String(dottedPath || '').split('.').filter(Boolean).reduce((current, key) => current && current[key], value);
}

function nestedObject(dottedPath, value) {
  const keys = String(dottedPath || '').split('.').filter(Boolean);
  if (!keys.length) return value;
  const root = {};
  let cursor = root;
  keys.forEach((key, index) => {
    cursor[key] = index === keys.length - 1 ? value : {};
    cursor = cursor[key];
  });
  return root;
}

function mergeObject(left, right) {
  const output = { ...(left || {}) };
  for (const [key, value] of Object.entries(right || {})) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeObject(output[key], value)
      : value;
  }
  return output;
}

function validateConfiguration(value, pathName = 'configuration') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('configuration must be an object'), { status: 400 });
  const secretLiteral = /(^|\.)(password|secret|token|credential|privateKey|accessKey)$/i;
  const visit = (item, currentPath) => {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      if (typeof item === 'string' && item.length > 2048) throw Object.assign(new Error(`${currentPath} is too long`), { status: 400 });
      return;
    }
    if (Array.isArray(item)) {
      if (item.length > 64) throw Object.assign(new Error(`${currentPath} has too many values`), { status: 400 });
      item.forEach((entry, index) => visit(entry, `${currentPath}.${index}`));
      return;
    }
    if (typeof item !== 'object') throw Object.assign(new Error(`${currentPath} has an unsupported value`), { status: 400 });
    for (const [key, child] of Object.entries(item)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)) throw Object.assign(new Error(`${currentPath}.${key} has an invalid key`), { status: 400 });
      if (secretLiteral.test(`${currentPath}.${key}`) && typeof child === 'string' && child) {
        throw Object.assign(new Error(`${currentPath}.${key} cannot contain a credential literal; use a SecretRef/SecretName field`), { status: 400 });
      }
      visit(child, `${currentPath}.${key}`);
    }
  };
  visit(value, pathName);
}

async function runtimeStatus(req, res) {
  const control = spec.control;
  const upstream = await foundationRequest(req, `${MODEL_PATH}/${encodeURIComponent(control.model)}`);
  if (upstream.status === 404) {
    return json(res, 200, {
      plugin: spec.id, package: 'Ready', model: control.model, desiredState: 'Missing', engineState: 'Disabled',
      phase: 'NotInstalled', reconciler: control.reconciler, blocker: control.blocker || '', configuration: {}, observed: [],
    });
  }
  const text = await upstream.text();
  if (!upstream.ok) return json(res, upstream.status, parseJson(text, { error: `Foundation host HTTP ${upstream.status}` }));
  const model = parseJson(text);
  const desiredState = String(model?.spec?.desiredState || '');
  const engineState = control.singletonModel
    ? (desiredState === 'Installed' ? 'Enabled' : 'Disabled')
    : (model?.spec?.parameters?.engines?.[control.engineId] === 'enabled' ? 'Enabled' : 'Disabled');
  return json(res, 200, {
    plugin: spec.id,
    package: 'Ready',
    model: control.model,
    desiredState,
    engineState,
    phase: String(model?.status?.phase || (engineState === 'Enabled' ? 'Declared' : 'Disabled')),
    note: String(model?.status?.note || ''),
    reconciler: control.reconciler,
    blocker: control.blocker || '',
    configuration: nestedValue(model?.spec?.parameters || {}, control.parameterPath) || {},
    observed: Array.isArray(model?.status?.observed) ? model.status.observed : [],
    observedAt: String(model?.status?.observedAt || ''),
  });
}

async function applyRuntime(req, res) {
  const control = spec.control;
  if (control.reconciler !== 'implemented') {
    return json(res, 409, { error: 'ReconcilerUnavailable', plugin: spec.id, blocker: control.blocker || '전용 reconciler가 준비되지 않았습니다.' });
  }
  if (typeof req.headers.authorization !== 'string' || !req.headers.authorization.startsWith('Bearer ')) {
    return json(res, 401, { error: 'authenticated Console identity is required' });
  }
  if (typeof req.headers['x-os-idempotency-key'] !== 'string' || !req.headers['x-os-idempotency-key']) {
    return json(res, 400, { error: 'X-OS-Idempotency-Key is required' });
  }
  const input = parseJson(await readBody(req), null);
  if (!input || typeof input.enabled !== 'boolean') return json(res, 400, { error: 'enabled(boolean) is required' });
  if (typeof input.reason !== 'string' || input.reason.trim().length < 8) return json(res, 400, { error: 'approval reason must contain at least 8 characters' });
  const configuration = input.configuration || {};
  validateConfiguration(configuration);
  const enginePatch = control.singletonModel ? {} : { engines: { [control.engineId]: input.enabled ? 'enabled' : 'disabled' } };
  const configurationPatch = input.enabled ? nestedObject(control.parameterPath, configuration) : {};
  const parameters = mergeObject(enginePatch, configurationPatch);
  const specPatch = { desiredState: control.singletonModel && !input.enabled ? 'Disabled' : 'Installed', parameters };
  const modelPath = `${MODEL_PATH}/${encodeURIComponent(control.model)}`;
  let upstream = await foundationRequest(req, modelPath, {
    method: 'PATCH', contentType: 'application/merge-patch+json', body: JSON.stringify({ spec: specPatch }),
  });
  if (upstream.status === 404 && input.enabled) {
    upstream = await foundationRequest(req, MODEL_PATH, {
      method: 'POST', contentType: 'application/json',
      body: JSON.stringify({
        apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'FoundationModel',
        metadata: { name: control.model, annotations: { 'opensphere.io/approval-reason': input.reason.trim() } },
        spec: { model: control.model, ...specPatch },
      }),
    });
  }
  if (upstream.status === 404 && !input.enabled) return json(res, 200, { accepted: true, plugin: spec.id, state: 'AlreadyDisabled' });
  const text = await upstream.text();
  if (!upstream.ok) return json(res, upstream.status, parseJson(text, { error: `Foundation host HTTP ${upstream.status}` }));
  return json(res, 202, { accepted: true, plugin: spec.id, model: control.model, engine: control.engineId, enabled: input.enabled });
}

function staticFile(res, pathname) {
  const relative = pathname.replace(/^\/plugins\/?/, '');
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(path.resolve(ROOT) + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return json(res, 404, { error: 'not found' });
  }
  const ext = path.extname(target);
  const type = ext === '.js' ? 'text/javascript; charset=utf-8'
    : ext === '.json' ? 'application/json; charset=utf-8'
      : ext === '.md' ? 'text/markdown; charset=utf-8' : 'application/octet-stream';
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function cliManifest() {
  const prefix = `os ${spec.cliNamespace}`;
  const tool = (id, verb, endpoint, description) => ({
    id: `${spec.id}.${id}`,
    command: `${prefix} ${verb}`,
    method: 'GET',
    path: endpoint,
    params: [],
    risk: 'low',
    scope: 'read',
    description,
  });
  return {
    kind: 'OpenSphereCLICommandManifest',
    cli: { commandPrefix: prefix },
    tools: [
      tool('status', 'status', '/cli/status', `${spec.displayName} plugin package and operand plan status`),
      tool('describe', 'describe', '/cli/describe', `${spec.displayName} signed package description`),
      tool('plan', 'plan', '/cli/plan', `${spec.displayName} declared operand installation plan`),
    ],
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  void (async () => {
    try {
      if (url.pathname === '/healthz' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end('ok');
      }
      if ((url.pathname === '/api/info' || url.pathname === '/cli/describe') && req.method === 'GET') return json(res, 200, spec);
      if ((url.pathname === '/api/plan' || url.pathname === '/cli/plan') && req.method === 'GET') {
        return json(res, 200, {
          plugin: spec.id,
          installer: spec.installer,
          namespace: spec.namespace,
          model: spec.control.model,
          engine: spec.control.engineId,
          reconciler: spec.control.reconciler,
          blocker: spec.control.blocker || '',
          operands: spec.operandPlan,
          writePath: 'authenticated plugin backend → Foundation host API → FoundationModel → control-plane SSA',
          mutableTagsAllowedAtApply: false,
        });
      }
      // Await async handlers inside this request boundary so validation and
      // upstream failures are converted into explicit HTTP responses instead
      // of becoming unhandled rejections that terminate the plugin process.
      if (url.pathname === '/api/runtime/status' && req.method === 'GET') return await runtimeStatus(req, res);
      if (url.pathname === '/api/runtime/apply' && req.method === 'POST') return await applyRuntime(req, res);
      if (url.pathname === '/cli/manifest' && req.method === 'GET') return json(res, 200, cliManifest());
      if (url.pathname === '/cli/status' && req.method === 'GET') return await runtimeStatus(req, res);
      if (url.pathname === '/manual' && req.method === 'GET') {
        return json(res, 200, { sourceId: `plugin:foundation/${spec.id}`, language: 'ko', content: fs.readFileSync(path.join(ROOT, 'manual.ko.md'), 'utf8') });
      }
      if (url.pathname === '/metrics' && req.method === 'GET') {
        const body = `# HELP opensphere_foundation_plugin_info Signed Foundation plugin package metadata.\n# TYPE opensphere_foundation_plugin_info gauge\nopensphere_foundation_plugin_info{plugin="${spec.id}",version="${spec.version}",channel="${spec.channel}",reconciler="${spec.control.reconciler}"} 1\n`;
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'content-length': Buffer.byteLength(body) });
        return res.end(body);
      }
      if (url.pathname.startsWith('/plugins/') && req.method === 'GET') return staticFile(res, url.pathname);
      if (WRITE_METHODS.has(req.method)) return json(res, 404, { error: 'write endpoint not found' });
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      const status = Number(error?.status) || (error?.name === 'AbortError' ? 504 : 502);
      return json(res, status, { error: String(error?.message || error) });
    }
  })();
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`${spec.id} Foundation plugin listening on ${PORT}\n`);
});
