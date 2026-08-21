import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('PFSS owns the canonical Directory Services route', () => {
  const router = read('src', 'app', 'view-router.ts');
  const shell = read('src', 'app', 'app.component.ts');
  const manual = read('ui-shell', 'ui-shell.plugin.js');

  assert.match(router, /const pfss = parts\[0\] === 'pfss'/);
  assert.match(router, /const canonicalPath = route\.length \? `\/pfss\/\$\{route\.join\('\/'\)\}` : '\/pfss\/foundation'/);
  assert.match(router, /history\.replaceState\(history\.state, '', canonicalPath \+ location\.search \+ location\.hash\)/);
  assert.match(router, /`\/pfss\/\$\{m\}`/);
  assert.match(manual, /'\/pfss\/directory'/);
  assert.doesNotMatch(manual, /\/pfss\/foundation\/directory/);
  assert.match(shell, /pluginId === 'samba' \? 'directory' : pluginId/);
  assert.match(shell, /routeId === 'directory' \? 'samba' : routeId/);
  assert.match(shell, /PFSS MODULE MANAGEMENT/);
});
