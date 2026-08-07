import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const entry = read('ui-shell/ui-shell.plugin.js');
const manifest = JSON.parse(read('ui-shell/ui-shell.manifest.source.json'));
const manualFiles = readdirSync(resolve(root, 'ui-shell/manual')).filter((name) => name.endsWith('.ko.md')).sort();

assert.ok(manifest.permissions.includes('manual:contribute'));
assert.deepEqual(manifest.contributions.manual, {
  enabled: true,
  sourceId: 'plugin:foundation',
  mode: 'runtime',
});
assert.match(entry, /ctx\.extensions\.manual\.contribute/);
assert.match(entry, /path: `plugins\/manual\/\$\{file\}`/);
assert.equal(manualFiles.length, 19, 'Foundation이 직접 제공하는 module은 자체 한글 안내서를 가져야 합니다.');
for (const file of manualFiles) {
  assert.match(entry, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file}가 runtime contribution 목록에 없습니다.`);
  const content = read(`ui-shell/manual/${file}`);
  assert.match(content, /^# OpenSphere /m, `${file} 제목이 OpenSphere manual 계약을 따르지 않습니다.`);
  assert.match(content, /## 1\./, `${file}에 역할/상태 섹션이 없습니다.`);
  assert.match(content, /## 6\./, `${file}에 참고 섹션이 없습니다.`);
}
console.log(`Foundation Manual contribution contract: passed (${manualFiles.length} documents)`);
