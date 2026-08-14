import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Foundation reports only compiled and active child management surfaces', () => {
  const main = read('src', 'main.ts');
  const entry = read('ui-shell', 'ui-shell.plugin.js');
  const registry = read('src', 'app', 'registry', 'plugins.registry.ts');

  assert.match(main, /FOUNDATION_PLUGINS/);
  assert.match(main, /plugin\.lifecycle === 'registry-backed' && plugin\.activation/);
  assert.match(main, /route: `\/pfss\/\$\{plugin\.view\.module\}`/);
  assert.match(entry, /new Set\(ctx\.host\?\.children\?\.\(\) \?\? \[\]\)/);
  assert.match(entry, /reportProjections\?\.\(supportedProjections\.filter/);
  assert.match(registry, /packageId: 'keycloak', element: 'osp-foundation-keycloak'/);
  assert.match(registry, /view: \{ module: 'keycloak' \}/);
});
