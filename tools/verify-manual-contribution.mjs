import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const entry = read('ui-shell/ui-shell.plugin.js');
const manifest = JSON.parse(read('ui-shell/ui-shell.manifest.source.json'));
const manual = read('ui-shell/manual/postgresql-operations.ko.md');
const page = read('src/app/modules/postgres/postgres-plugin.component.ts');
const manualFiles = readdirSync(resolve(root, 'ui-shell/manual')).filter((name) => name.endsWith('.ko.md')).sort();

assert.ok(manifest.permissions.includes('manual:contribute'));
assert.deepEqual(manifest.contributions.manual, {
  enabled: true,
  sourceId: 'plugin:foundation',
  mode: 'runtime',
});
assert.match(entry, /ctx\.extensions\.manual\.contribute/);
assert.match(entry, /path: `plugins\/manual\/\$\{file\}`/);
assert.equal(manualFiles.length, 21, 'Foundation의 모든 plugin/module은 자체 한글 안내서를 가져야 합니다.');
for (const file of manualFiles) {
  assert.match(entry, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file}가 runtime contribution 목록에 없습니다.`);
  const content = read(`ui-shell/manual/${file}`);
  assert.match(content, /^# OpenSphere /m, `${file} 제목이 OpenSphere manual 계약을 따르지 않습니다.`);
  assert.match(content, /## 1\./, `${file}에 역할/상태 섹션이 없습니다.`);
  assert.match(content, /## 6\./, `${file}에 참고 섹션이 없습니다.`);
}
assert.match(manual, /^# OpenSphere PostgreSQL 멀티 인스턴스 설치 및 운영 안내서/m);
assert.match(manual, /StackGres/);
assert.doesNotMatch(manual, /CloudNativePG|cloudnative-pg/);
assert.match(manual, /## 6\. 백업과 복구/);
assert.match(manual, /https:\/\/www\.postgresql\.org\/docs\/current\//);
assert.match(manual, /https:\/\/stackgres\.io\/doc\/latest\//);
assert.match(page, /\/manual\?doc=/);
assert.match(page, /StackGres SGCluster/);
assert.match(page, /OpenSphere PostgreSQL 멀티 인스턴스 운영 안내서 \(한글\)/);

console.log(`Foundation Manual contribution contract: passed (${manualFiles.length} documents)`);
