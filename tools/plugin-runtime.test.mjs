import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const freePort = async () => {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

const waitFor = async (url, child) => {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`plugin runtime exited early with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError || new Error(`timeout waiting for ${url}`);
};

test('Foundation child runtime exposes an authenticated, fail-closed control boundary', async (t) => {
  const received = [];
  const foundation = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      idempotencyKey: req.headers['x-os-idempotency-key'],
      body: Buffer.concat(chunks).toString('utf8'),
    });
    if (req.method === 'GET') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));
  });
  const foundationPort = await listen(foundation);
  t.after(() => new Promise((resolve) => foundation.close(resolve)));

  const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'opensphere-foundation-plugin-'));
  t.after(() => rm(pluginRoot, { recursive: true, force: true }));
  await writeFile(path.join(pluginRoot, 'manual.ko.md'), '# Test manual\n');
  await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({
    id: 'test-plugin', displayName: 'Test Plugin', cliNamespace: 'test', version: '0.1.0-edge.1', channel: 'edge',
    installer: 'foundation-model', namespace: 'opensphere-foundation', capability: 'test.capability',
    operands: ['mirror/test:edge'],
    operandPlan: [{ name: 'test', channel: 'edge', version: '1.2.3', image: 'ghcr.io/opensphere-platform/mirror/test:1.2.3' }],
    control: { model: 'test', engineId: 'test', parameterPath: 'dataEngines.test', reconciler: 'implemented' },
  }));

  const pluginPort = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'plugins', 'runtime', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(pluginPort),
      PLUGIN_DIR: pluginRoot,
      FOUNDATION_API_URL: `http://127.0.0.1:${foundationPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childStderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { childStderr += chunk; });
  const request = async (label, ...args) => {
    try {
      return await fetch(...args);
    } catch (error) {
      throw new Error(`${label} failed (runtime exit=${child.exitCode}): ${error}; stderr=${childStderr}`);
    }
  };
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) await once(child, 'exit');
  });
  await waitFor(`http://127.0.0.1:${pluginPort}/healthz`, child);

  const planResponse = await request('plan', `http://127.0.0.1:${pluginPort}/api/plan`);
  assert.equal(planResponse.status, 200);
  const plan = await planResponse.json();
  assert.equal(plan.mutableTagsAllowedAtApply, false);
  assert.deepEqual(plan.operands, [{
    name: 'test', channel: 'edge', version: '1.2.3', image: 'ghcr.io/opensphere-platform/mirror/test:1.2.3',
  }]);

  const statusResponse = await request('status', `http://127.0.0.1:${pluginPort}/api/runtime/status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    plugin: 'test-plugin', package: 'Ready', model: 'test', desiredState: 'Missing', engineState: 'Disabled',
    phase: 'NotInstalled', reconciler: 'implemented', blocker: '', configuration: {}, observed: [],
  });

  const anonymousApply = await request('anonymous apply', `http://127.0.0.1:${pluginPort}/api/runtime/apply`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, reason: 'approved change' }),
  });
  assert.equal(anonymousApply.status, 401);

  const missingIdempotency = await request('missing idempotency apply', `http://127.0.0.1:${pluginPort}/api/runtime/apply`, {
    method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, reason: 'approved change' }),
  });
  assert.equal(missingIdempotency.status, 400);

  const literalSecret = await request('literal secret apply', `http://127.0.0.1:${pluginPort}/api/runtime/apply`, {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json', 'x-os-idempotency-key': 'test-secret-rejection' },
    body: JSON.stringify({ enabled: true, reason: 'approved change', configuration: { password: 'must-not-pass' } }),
  });
  assert.equal(literalSecret.status, 400);
  assert.match((await literalSecret.json()).error, /credential literal/);

  const accepted = await request('accepted apply', `http://127.0.0.1:${pluginPort}/api/runtime/apply`, {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json', 'x-os-idempotency-key': 'test-apply-1' },
    body: JSON.stringify({ enabled: true, reason: 'approved change', configuration: { replicas: 2, credentialSecretName: 'test-secret' } }),
  });
  assert.equal(accepted.status, 202);
  const write = received.find((entry) => entry.method === 'PATCH');
  assert.ok(write, 'runtime must issue a FoundationModel merge patch');
  assert.equal(write.authorization, 'Bearer test');
  assert.equal(write.idempotencyKey, 'test-apply-1');
  const patch = JSON.parse(write.body);
  assert.equal(patch.spec.desiredState, 'Installed');
  assert.equal(patch.spec.parameters.engines.test, 'enabled');
  assert.equal(patch.spec.parameters.dataEngines.test.replicas, 2);
  assert.equal(patch.spec.parameters.dataEngines.test.credentialSecretName, 'test-secret');
});
