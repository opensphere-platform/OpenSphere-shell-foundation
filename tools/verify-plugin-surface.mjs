import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sambaRoot = process.env.SAMBA_PLUGIN_ROOT
  ? resolve(root, process.env.SAMBA_PLUGIN_ROOT)
  : resolve(root, '..', 'OpenSphere-plugin-samba-ad');
const readSamba = (path) => readFileSync(resolve(sambaRoot, path), 'utf8');

// The OCI label, signed module descriptor source, and install package must
// expose one release version. A split version makes the channel digest look
// newer while the Extension Host still reconciles the previous release.
const packageVersion = JSON.parse(read('package.json')).version;
const manifestVersion = JSON.parse(read('ui-shell/ui-shell.manifest.json')).version;
const packageYaml = read('uipluginpackage.yaml');
const dockerfile = read('Dockerfile');
assert.equal(manifestVersion, packageVersion, 'ui-shell manifest와 package.json 버전이 다릅니다.');
assert.match(packageYaml, new RegExp(`\\n  version: ${packageVersion.replaceAll('.', '\\.')}(?:\\r?\\n)`), 'UIPluginPackage 버전이 package.json과 다릅니다.');
assert.match(dockerfile, new RegExp(`org\\.opencontainers\\.image\\.version="${packageVersion.replaceAll('.', '\\.')}"`), 'OCI label 버전이 package.json과 다릅니다.');

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

const sharedShell = read('src/app/shared/plugin-page-shell.component.ts');
const canonicalTabs = ['overview', 'operator', 'cluster', 'topology', 'config', 'domain', 'backups', 'events', 'claims', 'upgrade', 'documentation'];
for (const tab of canonicalTabs) {
  assert.match(sharedShell, new RegExp(`id: ['\"]${tab}['\"]`), `공통 11탭 계약: ${tab} 누락`);
}
for (const label of ['Operator', 'Cluster plan', 'Configuration', 'Backups', 'Claims']) {
  assert.match(sharedShell, new RegExp(`label: ['\"]${label}['\"]`), `공통 11탭 계약: ${label} 라벨 누락`);
}
for (const contract of [/role="tablist"/, /role="tab"/, /aria-selected/, /tabindex/, /ArrowRight/, /ArrowLeft/, /Home/, /End/]) {
  assert.match(sharedShell, contract, `공통 탭 접근성·키보드 계약 누락: ${contract}`);
}
for (const file of ['src/app/foundation/otel/otel.component.ts', 'src/app/foundation/crossplane/crossplane.component.ts']) {
  assert.match(read(file), /pgp-steps/, `${file}: PostgreSQL 3단계 진행 영역 누락`);
  assert.match(read(file), /pgp-dashboard/, `${file}: PostgreSQL overview dashboard 누락`);
}
const surfaceContract = read('src/app/registry/plugin-surface.contract.ts');
for (const tab of canonicalTabs) {
  assert.match(surfaceContract, new RegExp(`['\"]${tab}['\"]`), `Registry surface contract: ${tab} 누락`);
}

// 독립 서명 child plugin은 활성화 뒤 Foundation의 계획 표면을 대체한다.
// 따라서 runtime template도 설치 전 Angular 표면과 같은 11탭 계약을 유지해야 하며,
// Extension Host 재로드 후 stale context를 잡지 않도록 공유 runtime slot을 사용한다.
const runtimeTemplate = read('plugins/runtime/ui-shell.plugin.template.js');
for (const tab of canonicalTabs) {
  assert.match(runtimeTemplate, new RegExp(`\\['${tab}',`), `독립 plugin runtime 11탭 계약: ${tab} 누락`);
}
for (const contract of [/pgp-page-frame/, /pfs-plugin-head/, /pfs-plugin-tabs/, /pgp-steps/, /pgp-dashboard/]) {
  assert.match(runtimeTemplate, contract, `독립 plugin runtime PostgreSQL surface 누락: ${contract}`);
}
assert.match(runtimeTemplate, /Symbol\.for\(`opensphere\.plugin\.foundation\.\$\{SPEC\.id\}\.runtime`\)/, '독립 plugin runtime 재활성화 context slot 누락');
assert.match(runtimeTemplate, /RUNTIME\.apiFetch/, '독립 plugin runtime Host API capability 배선 누락');
assert.match(runtimeTemplate, /apiFetch\('\/api\/info'/, '독립 plugin package live info probe 누락');
assert.match(runtimeTemplate, /apiFetch\('\/api\/plan'/, '독립 plugin operand plan probe 누락');

const outlet = read('src/app/foundation/plugin-outlet.component.ts');
assert.match(outlet, /Installed\/Ready라면 별도의 활성화가 필요/, 'child plugin Installed와 Activated 상태 안내가 구분되지 않습니다.');
assert.match(outlet, /href="\/manage\/extensions"/, 'child plugin 실패 복구 경로가 없습니다.');
for (const [, file] of surfaces.slice(1)) {
  assert.match(read(file), /pfsPluginTabs/, `${file}: 공통 11탭 helper 미사용`);
}

// Samba-AD는 Foundation 안층에 마운트되지만 독립 서명 plugin이므로 Angular 공통
// component 대신 동일 CSS 계약과 동일한 capability tab 집합을 light DOM으로 구현한다.
const samba = readSamba('ui-shell/ui-shell.plugin.js');
assert.match(samba, /pgp-page-frame/, 'Samba-AD: PostgreSQL 공통 page frame 누락');
assert.match(samba, /pfs-plugin-head/, 'Samba-AD: 공통 header 누락');
assert.match(samba, /pfs-plugin-tabs/, 'Samba-AD: 공통 tabs 누락');
for (const capability of ['overview', 'operator', 'cluster', 'topology', 'configuration', 'directory', 'backups', 'events', 'claims', 'upgrade', 'documentation']) {
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

// PFS 모듈 카탈로그는 목록 화면일 뿐 URL 부모가 아니다. 각 plugin은 PostgreSQL과
// 동일하게 /p/foundation/<plugin>을 정식 주소로 소유한다.
const directRouteIds = ['syncope', 'opa', 'litellm', 'langfuse', 'stalwart', 'novu', 'mattermost', 'otel', 'tempo', 'loki', 'grafana-operator', 'ptm'];
const routerSource = read('src/app/view-router.ts');
const appSource = read('src/app/app.component.ts');
const manualEntry = read('ui-shell/ui-shell.plugin.js');
for (const id of directRouteIds) {
  assert.match(routerSource, new RegExp(`['\"]${id}['\"]`), `정식 Foundation route ${id} 누락`);
  assert.match(registry, new RegExp(`view: \\{ module: ['\"]${id}['\"] \\}`), `registry view route ${id}가 직접 경로가 아닙니다.`);
  assert.match(manualEntry, new RegExp(`/p/foundation/${id}`), `Manual route ${id}가 직접 경로가 아닙니다.`);
}
assert.doesNotMatch(`${appSource}\n${routerSource}\n${registry}\n${manualEntry}`, /\/p\/foundation\/modules\//, '폐기된 /p/foundation/modules/<plugin> 경로가 남아 있습니다.');

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
assert.match(readSamba('server.js'), /FOUNDATION_NS \|\| 'opensphere-foundation'/, 'Samba-AD operand namespace가 Foundation에 수렴하지 않았습니다.');

console.log(`Foundation PostgreSQL-level surface contract: passed (${surfaces.length + 1} implementations, ${manualCount} manuals)`);
