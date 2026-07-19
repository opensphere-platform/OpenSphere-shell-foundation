import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readWorkspace = (path) => readFileSync(resolve(root, '..', path), 'utf8');

const surfaces = [
  ['PostgreSQL', 'src/app/modules/postgres/postgres-plugin.component.ts'],
  ['Data engines', 'src/app/modules/data-engine/data-engine-plugin.component.ts'],
  ['Keycloak', 'src/app/modules/identity/keycloak.component.ts'],
  ['Roadmap modules', 'src/app/foundation/roadmap-module.component.ts'],
  ['OpenTelemetry', 'src/app/foundation/otel/otel.component.ts'],
  ['Crossplane', 'src/app/foundation/crossplane/crossplane.component.ts'],
];

for (const [name, file] of surfaces) {
  const source = read(file);
  assert.match(source, /pgp-page-frame/, `${name}: PostgreSQL 공통 page frame 누락`);
  assert.match(source, /osp-plugin-page-header/, `${name}: 공통 header 누락`);
  assert.match(source, /osp-plugin-tabs/, `${name}: 공통 tabs 누락`);
  for (const capability of ['overview', 'topology', 'events', 'upgrade', 'documentation']) {
    assert.match(source, new RegExp(`['\"]${capability}['\"]`), `${name}: ${capability} surface 누락`);
  }
}

// Samba-AD는 Foundation 안층에 마운트되지만 독립 서명 plugin이므로 Angular 공통
// component 대신 동일 CSS 계약과 동일한 capability tab 집합을 light DOM으로 구현한다.
const samba = readWorkspace('OpenSphere-plugin-samba-ad/ui-shell/ui-shell.plugin.js');
assert.match(samba, /pgp-page-frame/, 'Samba-AD: PostgreSQL 공통 page frame 누락');
assert.match(samba, /pfs-plugin-head/, 'Samba-AD: 공통 header 누락');
assert.match(samba, /pfs-plugin-tabs/, 'Samba-AD: 공통 tabs 누락');
for (const capability of ['overview', 'dependency', 'plan', 'topology', 'consumers', 'protection', 'events', 'upgrade', 'documentation']) {
  assert.match(samba, new RegExp(`['"]${capability}['"]`), `Samba-AD: ${capability} surface 누락`);
}

const registry = read('src/app/registry/plugins.registry.ts');
const registryIds = [
  'postgres', 'psmdb', 'valkey', 'opensearch', 'rustfs', 'keycloak', 'samba',
  'syncope', 'opa', 'litellm', 'langfuse', 'stalwart', 'novu', 'mattermost',
  'otel', 'tempo', 'loki', 'grafana-operator', 'ptm', 'argocd', 'crossplane',
];
for (const id of registryIds) {
  assert.match(registry, new RegExp(`id: ['\"]${id}['\"]`), `registry plugin ${id} 누락`);
}
assert.equal((registry.match(/surface: PG_SURFACE/g) || []).length, registryIds.length, `registry plugin ${registryIds.length}종 모두 PostgreSQL surface 계약을 선언해야 합니다.`);

const css = read('src/app/app.component.css');
assert.match(css, /\.pgp-page-frame \.pfs-plugin-logo \{ border: 0; border-radius: 0;/, '장식 없는 공통 logo header 규칙 누락');
assert.match(css, /\.pgp-page-frame \.pfs-plugin-tabs/, 'header와 tabs의 단일 frame 규칙 누락');

const entry = read('ui-shell/ui-shell.plugin.js');
const manualCount = (entry.match(/\['[^']+-operations-ko'/g) || []).length;
assert.equal(manualCount, 21, '모든 Foundation plugin/module의 Manual 등록이 필요합니다.');

// Foundation membership is also a namespace ownership contract. Operators and
// delivery control planes may retain their own namespaces, but every PFS member
// operand must converge on opensphere-foundation.
const roadmap = read('src/app/foundation/roadmap-module.component.ts');
assert.doesNotMatch(roadmap, /opensphere-foundation-(identity|policy|ai|comm|observability|backup)/, 'Roadmap PFS member가 분리 namespace를 사용합니다.');
assert.match(roadmap, /const FOUNDATION_NAMESPACE = 'opensphere-foundation'/, 'Foundation namespace 정본 상수 누락');
const otelService = read('src/app/foundation/otel/otel.service.ts');
const otelComponent = read('src/app/foundation/otel/otel.component.ts');
const engineService = read('src/app/foundation/engines.service.ts');
assert.match(otelService, /const NS = 'opensphere-foundation'/, 'OpenTelemetry operand namespace가 Foundation에 수렴하지 않았습니다.');
assert.doesNotMatch(`${otelService}\n${otelComponent}\n${engineService}`, /opensphere-otel-collector/, '폐기된 OpenTelemetry 전용 namespace 참조가 남아 있습니다.');
for (const file of ['src/app/modules/data-engine/data-engine.spec.ts', 'src/app/modules/postgres/postgres-plugin.component.ts']) {
  assert.match(read(file), /opensphere-foundation/, `${file}: Foundation member namespace 누락`);
}
assert.match(read('src/app/api-base.ts'), /FND_NS = 'opensphere-foundation'/, 'Foundation API namespace 정본 누락');
assert.match(read('src/app/modules/identity/identity.services.ts'), /readonly ns = FND_NS/, 'Identity member가 Foundation namespace 정본을 사용하지 않습니다.');
assert.match(readWorkspace('OpenSphere-plugin-samba-ad/server.js'), /FOUNDATION_NS \|\| 'opensphere-foundation'/, 'Samba-AD operand namespace가 Foundation에 수렴하지 않았습니다.');

console.log(`Foundation PostgreSQL-level surface contract: passed (${surfaces.length + 1} implementations, ${manualCount} manuals)`);
