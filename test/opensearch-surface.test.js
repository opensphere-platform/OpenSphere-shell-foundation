'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const surface = fs.readFileSync(path.join(root, 'src/app/modules/data-engine/data-engine-plugin.component.ts'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/app/modules/opensearch/os.service.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('OpenSearch operational data views are mounted in the live Foundation surface', () => {
  for (const selector of ['os-overview', 'os-nodes', 'os-indices', 'os-shards', 'os-templates', 'os-tasks', 'os-claims']) {
    assert.match(surface, new RegExp(`<${selector}\\b`), `${selector} must be rendered by the active data-engine page`);
  }
  for (const label of ['Cluster', 'Nodes', 'Indices', 'Shards', 'Templates & aliases', 'Tasks & settings']) {
    assert.match(surface, new RegExp(`>${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}<`));
  }
  assert.match(surface, /readonly os = inject\(OsService\)/);
  assert.match(surface, /if\(this\.engine==='opensearch'\)this\.os\.start\(\)/);
  assert.match(surface, /Direct API Ready · metrics connector pending/);
});

test('OpenSearch data views remain behind the read-only diagnostic proxy', () => {
  assert.match(server, /req\.method !== 'GET' && req\.method !== 'HEAD'/);
  assert.match(server, /only diagnostic GET paths allowed/);
  assert.ok(server.includes('cluster|cat|nodes|stats|aliases'), 'diagnostic allowlist must remain closed');
});

test('OpenSearch telemetry uses the authenticated Foundation host fetch', () => {
  assert.match(service, /import \{ apiBase, FND_NS, hostFetch \} from '\.\.\/\.\.\/api-base'/);
  assert.match(service, /hostFetch\(this\.url\(path\), \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(service, /await fetch\(this\.url\(path\)\)/);
});
