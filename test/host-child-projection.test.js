import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Foundation reports Registry-approved child management surfaces', () => {
  const main = read('src', 'main.ts');
  const entry = read('ui-shell', 'ui-shell.plugin.js');
  const registry = read('src', 'app', 'registry', 'plugins.registry.ts');

  assert.match(main, /FOUNDATION_PLUGINS/);
  assert.match(main, /plugin\.lifecycle === 'registry-backed' && plugin\.activation/);
  assert.match(main, /route: `\/pfss\/\$\{plugin\.view\.module\}`/);
  assert.match(entry, /new Set\(ctx\.host\?\.children\?\.\(\) \?\? \[\]\)/);
  assert.match(entry, /registry: \{ activeChildren: Object\.freeze\(\[\.\.\.activeChildren\]\) \}/);
  assert.match(entry, /reportProjections\?\.\(supportedProjections\.filter/);
  assert.match(registry, /packageId: 'keycloak', element: 'osp-foundation-keycloak'/);
  assert.match(registry, /view: \{ module: 'keycloak' \}/);
});

test('responsive layout preserves Host navigation while child UI remains route scoped', () => {
  const component = read('src', 'app', 'app.component.ts');
  const entry = read('ui-shell', 'ui-shell.plugin.js');
  const router = read('src', 'app', 'view-router.ts');

  assert.match(component, /@media \(max-width: 760px\)[\s\S]*\.cm-nav \{ display: block; width: 100%; min-height: auto;/);
  assert.doesNotMatch(component, /@media \(max-width: 760px\)[\s\S]{0,180}\.cm-nav \{ display: none;/);
  assert.match(component, /goChild\(child: NavChild\)[\s\S]*this\.vr\.setModule/);
  assert.match(component, /this\.reg\.moduleAvailable\(x\.id\)/);
  assert.match(component, /p\.lifecycle === 'registry-backed' && this\.reg\.moduleAvailable\(p\.id\)/);
  assert.match(entry, /routing: ctx\.routing/);
  assert.match(router, /foundationHostRouting\(\)/);
  assert.match(router, /routing\.navigate\(target\)/);
  assert.match(router, /routing\.subscribe\(\(\) => this\.read\(\)\)/);
});

test('module activation and Foundation service state remain separate authorities', () => {
  const registryService = read('src', 'app', 'registry', 'foundation-registry.service.ts');
  const component = read('src', 'app', 'app.component.ts');
  const outlet = read('src', 'app', 'foundation', 'plugin-outlet.component.ts');

  assert.match(registryService, /moduleAvailable\(id: string\)[\s\S]*activeChildPackages\.has\(packageId\)/);
  assert.match(registryService, /modelOf\(id: string\)[\s\S]*d\.engines\[id\] === 'enabled'/);
  assert.match(component, /activePlugin\(\)[\s\S]*moduleAvailable\(x\.id\)/);
  assert.doesNotMatch(component, /activePlugin\(\)[\s\S]{0,500}modelOf\(/);
  assert.match(outlet, /서비스의 설치·실행 상태는 모듈 상태와 별도로/);
});
