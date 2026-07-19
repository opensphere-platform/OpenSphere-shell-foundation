const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = process.env.PLUGIN_DIR || '/plugins';
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));

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
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end('ok');
  }
  if (url.pathname === '/api/info' || url.pathname === '/cli/describe') return json(res, 200, spec);
  if (url.pathname === '/api/plan' || url.pathname === '/cli/plan') {
    return json(res, 200, {
      plugin: spec.id,
      installer: spec.installer,
      namespace: spec.namespace,
      operands: spec.operands,
      writePath: spec.installer === 'helm' ? 'Foundation Platform Delivery / Helm' : 'FoundationModel declarative reconcile',
      mutableTagsAllowedAtApply: false,
    });
  }
  if (url.pathname === '/cli/manifest') return json(res, 200, cliManifest());
  if (url.pathname === '/cli/status') {
    return json(res, 200, { plugin: spec.id, package: 'Ready', operand: 'InspectThroughFoundationHost', channel: spec.channel });
  }
  if (url.pathname === '/manual') {
    return json(res, 200, { sourceId: `plugin:foundation/${spec.id}`, language: 'ko', content: fs.readFileSync(path.join(ROOT, 'manual.ko.md'), 'utf8') });
  }
  if (url.pathname === '/metrics') {
    const body = `# HELP opensphere_foundation_plugin_info Signed Foundation plugin package metadata.\n# TYPE opensphere_foundation_plugin_info gauge\nopensphere_foundation_plugin_info{plugin="${spec.id}",version="${spec.version}",channel="${spec.channel}"} 1\n`;
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    return res.end(body);
  }
  if (url.pathname.startsWith('/plugins/')) return staticFile(res, url.pathname);
  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`${spec.id} Foundation plugin listening on ${PORT}\n`);
});
