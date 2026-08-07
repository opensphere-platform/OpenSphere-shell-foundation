'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('OpenSearch UI is exclusively hosted as an independent child plugin', () => {
  const app = read('src/app/app.component.ts');
  const registry = read('src/app/registry/plugins.registry.ts');
  assert.match(registry, /activation: \{ packageId: 'opensearch', element: 'osp-foundation-opensearch' \}/);
  assert.match(registry, /id: 'opensearch'[\s\S]*healthRef: 'declared'/);
  assert.doesNotMatch(app, /DataEnginePluginComponent|app-data-engine-plugin/);
  assert.equal(fs.existsSync(path.join(root, 'src/app/modules/opensearch')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/app/modules/data-engine/data-engine-plugin.component.ts')), false);
});

test('Foundation retains only the governed OpenSearch control and diagnostic boundaries', () => {
  const contracts = JSON.parse(read('plugins/control-contracts.json'));
  const server = read('server.js');
  assert.equal(contracts.contracts.opensearch.model, 'data');
  assert.equal(contracts.contracts.opensearch.parameterPath, 'dataEngines.opensearch');
  assert.match(server, /only diagnostic GET paths allowed/);
  assert.ok(server.includes('cluster|cat|nodes|stats|aliases'));
});
