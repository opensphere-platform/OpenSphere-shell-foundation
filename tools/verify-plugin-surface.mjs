import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const directoryRoot = process.env.DIRECTORY_PLUGIN_ROOT || process.env.SAMBA_PLUGIN_ROOT
  ? resolve(root, process.env.DIRECTORY_PLUGIN_ROOT || process.env.SAMBA_PLUGIN_ROOT)
  : resolve(root, '..', 'OpenSphere-plugin-directory');
const readDirectory = (path) => readFileSync(resolve(directoryRoot, path), 'utf8');

// Compatibility SemVer is shared by the signed module sources. The official
// image version is injected separately as a KST release tag at build time.
const packageVersion = JSON.parse(read('package.json')).version;
const lockVersion = JSON.parse(read('package-lock.json')).version;
const manifestVersion = JSON.parse(read('ui-shell/ui-shell.manifest.source.json')).version;
const packageYaml = read('uipluginpackage.yaml');
const dockerfile = read('Dockerfile');
const packageFoundationPlugin = read('tools/package-foundation-plugin.mjs');
const appStyles = read('src/app/app.component.css');
assert.equal(manifestVersion, packageVersion, 'ui-shell manifest와 package.json 버전이 다릅니다.');
assert.equal(lockVersion, packageVersion, 'package-lock.json과 package.json 버전이 다릅니다.');
assert.match(packageYaml, new RegExp(`\\n  version: ${packageVersion.replaceAll('.', '\\.')}(?:\\r?\\n)`), 'UIPluginPackage 버전이 package.json과 다릅니다.');
assert.match(packageVersion, /^\d+\.\d+\.\d+$/, '호환 버전에는 channel suffix를 사용할 수 없습니다.');
assert.match(dockerfile, /org\.opencontainers\.image\.version=\$OS_RELEASE_TAG/, 'OCI 공식 버전은 KST release tag build arg를 사용해야 합니다.');
assert.match(dockerfile, new RegExp(`io\\.opensphere\\.compatibility-version="${packageVersion.replaceAll('.', '\\.')}"`), 'OCI 호환 버전이 package.json과 다릅니다.');
assert.match(
  packageFoundationPlugin,
  /observability:\s*\{[\s\S]*reason:\s*'Runtime health and load metrics only'/,
  '독립 plugin manifest와 UIPluginPackage의 observability 계약이 달라 ContributionDrift가 발생할 수 있습니다.',
);
assert.doesNotMatch(
  appStyles,
  /\.pgp-page-frame \.pfs-plugin-release \{ grid-template-columns: repeat\(3,[^}]*minmax\(24rem/,
  '반응형 PFSS 릴리스 메타가 Namespace 최소 폭 때문에 헤더 밖으로 밀려납니다.',
);
assert.match(
  appStyles,
  /@media \(max-width: 1180px\)[\s\S]*\.pgp-page-frame \.pfs-plugin-head \{ grid-template-columns: 1fr;/,
  '반응형 PFSS header가 기본 2열 규칙보다 낮은 우선순위로 선언됐습니다.',
);

const surfaces = [
  ['Keycloak', 'src/app/modules/identity/keycloak.component.ts'],
  ['OPA', 'src/app/modules/identity/opa.component.ts'],
  ['Roadmap modules', 'src/app/foundation/roadmap-module.component.ts'],
  ['OpenTelemetry', 'src/app/foundation/otel/otel.component.ts'],
];

for (const [name, file] of surfaces) {
  const source = read(file);
  assert.match(source, /pgp-page-frame/, `${name}: PostgreSQL 공통 page frame 누락`);
  assert.match(source, /osp-plugin-page-header/, `${name}: 공통 header 누락`);
  assert.match(source, /osp-plugin-tabs/, `${name}: 공통 tabs 누락`);
  for (const capability of ['overview', 'monitoring', 'topology', 'events', 'upgrade', 'documentation']) {
    assert.match(source, new RegExp(`['\"]${capability}['\"]`), `${name}: ${capability} surface 누락`);
  }
}

const keycloakSurface = read('src/app/modules/identity/keycloak.component.ts');
assert.match(keycloakSurface, /pluginHeaderContext[\s\S]*Keycloak 운영 컨텍스트/, 'Keycloak: Namespace·서비스 header context 누락');
assert.match(keycloakSurface, /managedFleet\s*:\s*true/, 'Keycloak: PostgreSQL 기준 Fleet 관리 action 누락');
assert.match(keycloakSurface, /managementActions\s*:\s*false/, 'Keycloak: 공통 legacy 관리 action을 비활성화하지 않았습니다.');
assert.match(keycloakSurface, /class="pgp-header-tools"[\s\S]*class="pgp-management-actions pgp-management-actions--header"/, 'Keycloak: PostgreSQL header tools 구조 누락');
assert.match(keycloakSurface, /ListBoxes16[\s\S]*Catalog16[\s\S]*DataAdd16[\s\S]*Settings16/, 'Keycloak: PostgreSQL과 동일한 관리 action 아이콘 계약 누락');
assert.match(keycloakSurface, /clr-select-container class="pgp-header-context-field"[\s\S]*select clrSelect name="keycloakNamespace"/, 'Keycloak: Namespace가 PostgreSQL 기준 Clarity Select가 아닙니다.');
assert.match(keycloakSurface, /select clrSelect name="keycloakService"/, 'Keycloak: 서비스 선택기가 PostgreSQL 기준 Clarity Select가 아닙니다.');
assert.doesNotMatch(keycloakSurface, /kc-context-field|kc-header-context|kc-refresh/, 'Keycloak: 별도 header/select 구현이 남아 있습니다.');
assert.match(keycloakSurface, /\*ngIf="exists\(\)&&!isManagementView\(\)"/, 'Keycloak: 서비스가 없거나 관리 view일 때 운영 탭을 숨기는 계약 누락');
assert.match(keycloakSurface, /관리 워크스페이스/, 'Keycloak: 관리 view와 운영 view 구분 누락');
assert.match(keycloakSurface, /Profile Catalog/, 'Keycloak: 재사용 Profile 관리 surface 누락');
assert.match(keycloakSurface, /Keycloak 서비스 생성/, 'Keycloak: Provisioning surface 누락');
assert.match(keycloakSurface, /IdentityServiceClaim[\s\S]*Foundation Control Plane[\s\S]*Keycloak/, 'Keycloak: 요청-배정-실행 provisioning bridge 누락');
assert.match(keycloakSurface, /Keycloak Service Fleet/, 'Keycloak: 관리 서비스 Fleet 누락');
assert.match(appStyles, /\.pgp-page-frame\.kc-page-frame \.pgp-header-context \{[^}]*grid-template-columns: repeat\(2, max-content\);[^}]*justify-content: end;/, 'Keycloak: Namespace·서비스 선택기를 좌우·우측 정렬하는 header 계약 누락');
assert.match(appStyles, /\.pgp-page-frame\.kc-page-frame \.pgp-header-context-field \{[^}]*width: 220px;[^}]*min-width: 220px;/, 'Keycloak: Namespace·서비스 선택기 220px 폭 계약 누락');
assert.match(appStyles, /\.pgp-page-frame\.kc-page-frame \.pfs-plugin-head \{ grid-template-columns: minmax\(11\.5rem, 0\.5fr\) minmax\(0, 1\.5fr\); gap: 10px;/, 'Keycloak: PostgreSQL header identity/metadata 비율 누락');
assert.match(appStyles, /\.pgp-page-frame\.kc-page-frame \.pfs-plugin-brand p \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/, 'Keycloak: 긴 설명이 PostgreSQL 기준 header 높이를 확장할 수 있습니다.');
assert.match(appStyles, /\.pgp-page-frame\.kc-page-frame \.pfs-plugin-release > \.pgp-header-tools \{ overflow: visible; \}/, 'Keycloak: scoped release overflow가 header 관리 아이콘을 잘라서는 안 됩니다.');
assert.match(keycloakSurface, /description:'Workforce IAM·SSO와 OIDC realm을 운영합니다\.'/,'Keycloak: header 설명은 한 줄 운영 요약이어야 합니다.');
assert.match(appStyles, /\.pgp-management-actions--header \{ position: absolute; top: -0\.9rem; right: 4px;/, 'Keycloak: PostgreSQL 관리 아이콘 상대 위치 누락');
assert.match(keycloakSurface, /PostgreSQL PFSS 플랜[\s\S]*postgresql-prod-ha-pitr/, 'Keycloak: 설치 단계 PostgreSQL 플랜 선택 계약 누락');
assert.match(keycloakSurface, /openTab\(id:string\)\{this\.vr\.setModule\('keycloak'\)/, 'Keycloak: 관리 action이 다른 PFSS 모듈로 이동할 수 있음');
assert.match(keycloakSurface, /\['operator','cluster','config','claims'\]\.includes\(wanted\)/, 'Keycloak: 관리 workspace 딥링크 복원 계약 누락');
assert.doesNotMatch(keycloakSurface, /embedded[- ]h2|start-dev/i, 'Keycloak: 폐기된 embedded H2 설치 가정이 UI에 재유입됨');

const sharedShell = read('src/app/shared/plugin-page-shell.component.ts');
const canonicalTabs = ['overview', 'monitoring', 'topology', 'domain', 'backups', 'upgrade', 'events', 'documentation'];
for (const tab of canonicalTabs) {
  assert.match(sharedShell, new RegExp(`id: ['\"]${tab}['\"]`), `공통 11탭 계약: ${tab} 누락`);
}
for (const label of ['Overview', 'Monitoring', 'Topology', 'Data Protection', 'Operations', 'Events', 'Documentation']) {
  assert.match(sharedShell, new RegExp(`label: ['\"]${label}['\"]`), `공통 11탭 계약: ${label} 라벨 누락`);
}
for (const action of ['Fleet', 'Profiles', 'Provisioning', 'Operator']) {
  assert.match(sharedShell, new RegExp(`title=['\"]${action}['\"]`), `공통 management action 누락: ${action}`);
}
for (const contract of [/role="tablist"/, /role="tab"/, /aria-selected/, /tabindex/, /ArrowRight/, /ArrowLeft/, /Home/, /End/]) {
  assert.match(sharedShell, contract, `공통 탭 접근성·키보드 계약 누락: ${contract}`);
}
for (const file of ['src/app/foundation/otel/otel.component.ts']) {
  assert.match(read(file), /pgp-steps/, `${file}: PostgreSQL 3단계 진행 영역 누락`);
  assert.match(read(file), /pgp-dashboard/, `${file}: PostgreSQL overview dashboard 누락`);
}
const surfaceContract = read('src/app/registry/plugin-surface.contract.ts');
for (const tab of canonicalTabs) {
  assert.match(surfaceContract, new RegExp(`['\"]${tab}['\"]`), `Registry surface contract: ${tab} 누락`);
}

// 독립 서명 child plugin은 활성화 뒤 Foundation의 계획 표면을 대체한다.
// 따라서 runtime template도 설치 전 Angular 표면과 같은 runtime/management 분리 계약을 유지해야 하며,
// Extension Host 재로드 후 stale context를 잡지 않도록 공유 runtime slot을 사용한다.
const runtimeTemplate = read('plugins/runtime/ui-shell.plugin.template.js');
for (const tab of ['overview', 'monitoring', 'topology', 'domain', 'protection', 'operations', 'events', 'documentation']) {
  assert.match(runtimeTemplate, new RegExp(`\\['${tab}',`), `독립 plugin runtime 탭 계약: ${tab} 누락`);
}
for (const contract of [/pfss-op-shell/, /pfss-op-head/, /pfss-op-tabs/, /pfss-op-actions/, /pgp-dashboard/]) {
  assert.match(runtimeTemplate, contract, `독립 plugin runtime PostgreSQL surface 누락: ${contract}`);
}
const sharedOperatorShell = read('src/app/shared/plugin-page-shell.component.ts');
for (const iconImport of [
  /list--boxes\/16/, /catalog\/16/, /data--add\/16/, /settings\/16/,
]) {
  assert.match(sharedOperatorShell, iconImport, `공통 PFSS 관리 아이콘 계약 누락: ${iconImport}`);
}
for (const binding of [/iFleet = ListBoxes16/, /iCatalog = Catalog16/, /iProvisioning = DataAdd16/, /iOperator = Settings16/]) {
  assert.match(sharedOperatorShell, binding, `공통 PFSS 기능-아이콘 매핑 누락: ${binding}`);
}
assert.doesNotMatch(sharedOperatorShell, /[☷▤⊞⚙]/, '공통 PFSS 헤더에 임의 문자 아이콘이 남아 있습니다.');
assert.match(runtimeTemplate, /PostgreSQL 기준 Carbon 관리 아이콘 계약: ListBoxes16, Catalog16, DataAdd16, Settings16/, '독립 plugin runtime 관리 아이콘 정본 설명 누락');
assert.match(runtimeTemplate, /MANAGEMENT_ICONS\.fleet/, '독립 plugin runtime Fleet 아이콘 매핑 누락');
assert.match(runtimeTemplate, /MANAGEMENT_ICONS\.profiles/, '독립 plugin runtime Profiles 아이콘 매핑 누락');
assert.match(runtimeTemplate, /MANAGEMENT_ICONS\.provisioning/, '독립 plugin runtime Provisioning 아이콘 매핑 누락');
assert.match(runtimeTemplate, /MANAGEMENT_ICONS\.operator/, '독립 plugin runtime Operator 아이콘 매핑 누락');
assert.match(runtimeTemplate, /\.pfss-op-head\{[^}]*grid-template-columns:minmax\(22rem,1fr\) minmax\(0,60%\);[^}]*align-items:center;/, '독립 plugin runtime의 identity/metadata 비율이 PostgreSQL header 계약과 다릅니다.');
assert.match(runtimeTemplate, /\.pfss-op-brand>div\{min-width:0\}/, '독립 plugin runtime의 brand text가 metadata 영역을 침범할 수 있습니다.');
assert.match(runtimeTemplate, /\.pfss-op-brand p\{[^}]*max-width:100%;[^}]*overflow-wrap:anywhere;/, '독립 plugin runtime 설명문 폭 제한이 없습니다.');
assert.match(runtimeTemplate, /\.pfss-op-meta\{display:grid;grid-template-columns:[^}]*justify-self:end;width:100%;/, '독립 plugin runtime 릴리스 메타 우측 정렬 계약 누락');
assert.match(runtimeTemplate, /pfss-op-logo-fallback/, '독립 plugin runtime 제품 로고 fallback 누락');
assert.match(runtimeTemplate, /naturalWidth === 0/, '독립 plugin runtime 제품 로고 실패 판정 누락');
assert.match(runtimeTemplate, /\.pfss-op-shell\{[^}]*container-type:inline-size;/, '독립 plugin runtime이 실제 header container 폭을 관측하지 않습니다.');
assert.match(runtimeTemplate, /@container\(max-width:1180px\)/, '독립 plugin runtime의 container 반응형 규칙 누락');
assert.match(runtimeTemplate, /\.pfss-op-head\{[^}]*height:auto!important;[^}]*background:#fff;[^}]*color:#161616;/, '독립 plugin runtime header가 Host header 색상·높이 규칙에서 격리되지 않았습니다.');
assert.match(runtimeTemplate, /@media\(max-width:1180px\)\{[^}]*[\s\S]{0,500}\.pfss-op-brand\{padding-right:0;padding-top:2\.25rem\}/, '독립 plugin runtime의 관리 아이콘과 브랜드가 좁은 폭에서 겹칩니다.');
assert.match(sharedOperatorShell, /@media \(max-width: 760px\)[\s\S]{0,120}\.pfs-plugin-brand \{ padding-top: 2\.25rem; \}/, '공통 PFSS header의 관리 아이콘과 브랜드가 좁은 폭에서 겹칩니다.');
assert.doesNotMatch(runtimeTemplate, /[☷▤⊞⚙]/, '독립 plugin runtime에 임의 문자 아이콘이 남아 있습니다.');
assert.match(runtimeTemplate, /Symbol\.for\(`opensphere\.plugin\.foundation\.\$\{SPEC\.id\}\.runtime`\)/, '독립 plugin runtime 재활성화 context slot 누락');
assert.match(runtimeTemplate, /RUNTIME\.apiFetch/, '독립 plugin runtime Host API capability 배선 누락');
assert.match(runtimeTemplate, /apiFetch\('\/api\/info'/, '독립 plugin package live info probe 누락');
assert.match(runtimeTemplate, /apiFetch\('\/api\/plan'/, '독립 plugin operand plan probe 누락');

const outlet = read('src/app/foundation/plugin-outlet.component.ts');
assert.match(outlet, /미설치·검증 실패를 의미하지 않습니다/, 'child plugin 적재 지연을 설치·검증 실패로 오인하지 않는 안내가 없습니다.');
assert.match(outlet, /Registry 활성화와 digest·manifest signature·permission의 실제 판정/, 'child plugin의 실제 Activated·검증 판정 확인 경로가 없습니다.');
assert.match(outlet, /href="\/manage\/extensions"/, 'child plugin 실패 복구 경로가 없습니다.');
for (const [, file] of surfaces) {
  assert.match(read(file), /pfsPluginTabs/, `${file}: 공통 11탭 helper 미사용`);
}

// Platform Delivery 엔진은 PFS operand가 아니므로 11탭 PFS 계약을 가장하지 않는다.
// 대신 관리자가 준비조건·설치/복구·실제 리소스·정책·upgrade·감사를 수행할 수 있는
// delivery 전용 관리자 계약을 적용한다.
for (const file of [
  'src/app/foundation/argocd/argocd.component.ts',
  'src/app/foundation/crossplane/crossplane.component.ts',
]) {
  const source = read(file);
  assert.match(source, /pgp-page-frame/, `${file}: 공통 page frame 누락`);
  assert.match(source, /osp-plugin-page-header/, `${file}: 공통 header 누락`);
  assert.match(source, /osp-plugin-tabs/, `${file}: 공통 tabs 누락`);
  assert.match(source, /deliveryAdminTabs/, `${file}: delivery 관리자 탭 helper 미사용`);
  for (const capability of ['overview', 'prerequisites', 'install', 'resources', 'configuration', 'security', 'upgrade', 'events']) {
    assert.match(sharedShell, new RegExp(`['\"]${capability}['\"]`), `${file}: ${capability} 관리자 surface 누락`);
  }
  assert.match(source, /pgp-steps/, `${file}: 관리자 운영 단계 영역 누락`);
  assert.match(source, /pgp-dashboard/, `${file}: 관리자 overview dashboard 누락`);
}

// Samba-AD는 Foundation 안층에 마운트되지만 독립 서명 plugin이므로 Angular 공통
// component 대신 동일 CSS 계약과 동일한 capability tab 집합을 light DOM으로 구현한다.
const samba = readDirectory('ui-shell/ui-shell.plugin.js');
assert.match(samba, /pgp-page-frame/, 'Samba-AD: PostgreSQL 공통 page frame 누락');
assert.match(samba, /pfs-plugin-head/, 'Samba-AD: 공통 header 누락');
assert.match(samba, /pfs-plugin-tabs/, 'Samba-AD: 공통 runtime tabs 누락');
assert.match(samba, /pfss-op-actions/, 'Samba-AD: 관리 action 누락');
for (const capability of ['overview', 'monitoring', 'topology', 'directory', 'backups', 'upgrade', 'events', 'documentation']) {
  assert.match(samba, new RegExp(`['"]${capability}['"]`), `Samba-AD: ${capability} surface 누락`);
}
for (const capability of ['operator', 'cluster', 'configuration', 'claims']) {
  assert.match(samba, new RegExp(`data-sc-tab=['"]${capability}['"]`), `Samba-AD: ${capability} 관리 action 누락`);
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
assert.match(registry, /view: \{ module: 'directory' \}/, 'Directory Services 정식 route 누락');
assert.match(registry, /activation: \{ packageId: 'directory', element: 'osp-directory' \}/, 'Directory Services package activation 계약 누락');

// PFSS 모듈 카탈로그는 목록 화면일 뿐 URL 부모가 아니다. 각 plugin은 PostgreSQL과
// 동일하게 /pfss/<plugin>을 정식 주소로 소유한다.
const directRouteIds = ['syncope', 'opa', 'litellm', 'langfuse', 'stalwart', 'novu', 'mattermost', 'otel', 'tempo', 'loki', 'grafana-operator', 'ptm'];
const routerSource = read('src/app/view-router.ts');
const appSource = read('src/app/app.component.ts');
const manualEntry = read('ui-shell/ui-shell.plugin.js');
for (const id of directRouteIds) {
  assert.match(routerSource, new RegExp(`['\"]${id}['\"]`), `정식 Foundation route ${id} 누락`);
  assert.match(registry, new RegExp(`view: \\{ module: ['\"]${id}['\"] \\}`), `registry view route ${id}가 직접 경로가 아닙니다.`);
  assert.match(manualEntry, new RegExp(`/pfss/${id}`), `Manual route ${id}가 직접 경로가 아닙니다.`);
}
assert.doesNotMatch(`${appSource}\n${routerSource}\n${registry}\n${manualEntry}`, /\/pfss\/foundation\/modules\//, '폐기된 /pfss/modules/<plugin> 경로가 남아 있습니다.');
const enginesSource = read('src/app/foundation/engines.component.ts');
assert.match(appSource, /vr\.module\(\) === 'modules' && vr\.tab\(\) === 'overview'/, '/modules는 PFS catalog root에서만 렌더링해야 합니다.');
assert.doesNotMatch(enginesSource, /vr\.module\(\) === ['"]modules['"]\s*\?\s*this\.vr\.tab\(\)/, '폐기된 /modules/<plugin>을 plugin detail로 해석하고 있습니다.');
assert.match(appSource, /if \(m === 'modules'\) \{ return this\.vr\.tab\(\) !== 'overview'; \}/, '폐기된 /modules/<plugin>을 유효 경로로 허용하고 있습니다.');

const css = read('src/app/app.component.css');
assert.match(css, /\.pgp-page-frame \.pfs-plugin-logo \{ border: 0; border-radius: 0;/, '장식 없는 공통 logo header 규칙 누락');
assert.match(css, /\.pgp-page-frame \.pfs-plugin-tabs/, 'header와 tabs의 단일 frame 규칙 누락');

const opaMonitoring = `${read('src/app/modules/identity/opa.component.ts')}\n${read('src/app/modules/identity/opa.service.ts')}`;
const carbonLineChart = read('src/app/shared/carbon-line-chart.ts');
assert.match(opaMonitoring, /CarbonLineChart/, 'OPA Monitoring: Carbon Charts adapter 누락');
assert.match(opaMonitoring, /os-carbon-line-chart/, 'OPA Monitoring: Carbon line chart surface 누락');
assert.match(opaMonitoring, /step: '60'/, 'OPA Monitoring: PostgreSQL 기준 60초 query_range step 누락');
assert.doesNotMatch(opaMonitoring, /PgChart|pg-chart/, 'OPA Monitoring: Chart.js PgChart 사용 금지');
assert.match(carbonLineChart, /from '@carbon\/charts'/, 'Carbon Charts 공식 package import 누락');
assert.match(carbonLineChart, /new LineChart\(/, 'Carbon Charts LineChart renderer 누락');
assert.match(css, /@import '@carbon\/charts\/styles\.css'/, 'Shadow DOM Carbon Charts stylesheet 누락');

const entry = read('ui-shell/ui-shell.plugin.js');
const manualCount = (entry.match(/\['[^']+-operations-ko'/g) || []).length;
assert.equal(manualCount, 19, 'Foundation이 직접 제공하는 module의 Manual 등록이 필요합니다.');

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
for (const file of ['src/app/modules/data-engine/data-engine.spec.ts']) {
  assert.match(read(file), /opensphere-foundation/, `${file}: Foundation member namespace 누락`);
}
assert.match(read('src/app/api-base.ts'), /FND_NS = 'opensphere-foundation'/, 'Foundation API namespace 정본 누락');
assert.match(read('src/app/modules/identity/identity.services.ts'), /readonly ns = FND_NS/, 'Identity member가 Foundation namespace 정본을 사용하지 않습니다.');
assert.match(readDirectory('server.js'), /FOUNDATION_NS \|\| 'opensphere-foundation'/, 'Samba-AD operand namespace가 Foundation에 수렴하지 않았습니다.');

console.log(`Foundation PostgreSQL-level surface contract: passed (${surfaces.length + 1} implementations, ${manualCount} manuals)`);
