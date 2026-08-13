import { accessSync, constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(root, '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'plugins/catalog.json'), 'utf8'));
const repositoryInventory = JSON.parse(readFileSync(resolve(workspaceRoot, 'repository-inventory.json'), 'utf8'));
const mirrors = JSON.parse(readFileSync(resolve(root, 'oci/mirrors.json'), 'utf8'));
const controls = JSON.parse(readFileSync(resolve(root, 'plugins/control-contracts.json'), 'utf8'));
const engineSurface = readFileSync(resolve(root, 'src/app/foundation/engines.component.ts'), 'utf8');
const operatorSurface = readFileSync(resolve(root, 'src/app/foundation/roadmap-module.component.ts'), 'utf8');
const overviewSurface = readFileSync(resolve(root, 'src/app/foundation/overview.component.ts'), 'utf8');
const engineAuthority = readFileSync(resolve(root, 'src/app/foundation/engines.service.ts'), 'utf8');
const hostSurface = readFileSync(resolve(root, 'src/app/app.component.ts'), 'utf8');
if (catalog.schemaVersion !== 2 || catalog.hostRef !== 'foundation') throw new Error('invalid Foundation PFSS catalog header');
if (!Array.isArray(catalog.plugins) || catalog.plugins.length !== 18) throw new Error(`expected 18 classified Foundation catalog entries, got ${catalog.plugins?.length}`);
const lifecycleValues = new Set(['registry-backed', 'migration-required', 'planned', 'host-integration']);
const activeRepositories = new Set((repositoryInventory.repositories ?? []).filter((item) => item.status === 'active').map((item) => item.path));
const ids = new Set();
const elements = new Set();
const referencedMirrors = new Set();
const expectedRoutes = new Map([
  ['percona-psmdb', '/pfss/psmdb'],
  ['valkey', '/pfss/valkey'],
  ['rustfs', '/pfss/rustfs'],
  ['keycloak', '/pfss/keycloak'],
  ['apache-syncope', '/pfss/syncope'],
  ['opa', '/pfss/opa'],
  ['litellm', '/pfss/litellm'],
  ['langfuse', '/pfss/langfuse'],
  ['stalwart', '/pfss/stalwart'],
  ['novu', '/pfss/novu'],
  ['mattermost', '/pfss/mattermost'],
  ['opentelemetry', '/pfss/otel'],
  ['grafana-tempo', '/pfss/tempo'],
  ['grafana-loki', '/pfss/loki'],
  ['grafana-operator', '/pfss/grafana-operator'],
  ['ptm', '/pfss/ptm'],
  ['argocd', '/pfss/delivery/argocd'],
  ['crossplane', '/pfss/delivery/crossplane'],
]);
for (const plugin of catalog.plugins) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(plugin.id)) throw new Error(`invalid plugin id ${plugin.id}`);
  if (ids.has(plugin.id)) throw new Error(`duplicate plugin id ${plugin.id}`);
  ids.add(plugin.id);
  if (!lifecycleValues.has(plugin.lifecycle)) throw new Error(`${plugin.id} has invalid lifecycle ${plugin.lifecycle}`);
  if (plugin.lifecycle === 'registry-backed') {
    if (plugin.packageId !== plugin.id) throw new Error(`${plugin.id} packageId must equal its canonical id`);
    if (!activeRepositories.has(plugin.sourceRepository)) throw new Error(`${plugin.id} has no active canonical source repository ${plugin.sourceRepository}`);
  } else if (plugin.packageId || plugin.sourceRepository) {
    throw new Error(`${plugin.id} may not publish package/source authority while ${plugin.lifecycle}`);
  }
  if (plugin.lifecycle === 'migration-required' && (!plugin.targetRepository || !plugin.blocker)) {
    throw new Error(`${plugin.id} migration-required entry must publish targetRepository and blocker`);
  }
  const element = plugin.lifecycle === 'registry-backed' ? plugin.element : plugin.targetElement;
  if (element) {
    if (!/^osp-foundation-[a-z0-9-]+$/.test(element) || elements.has(element)) throw new Error(`invalid or duplicate element ${element}`);
    elements.add(element);
  }
  if (!plugin.logo.startsWith('https://logos.opl.io.kr/i/')) throw new Error(`${plugin.id} violates the logo authority policy`);
  const declaredRoute = plugin.route ?? plugin.targetRoute ?? plugin.managementRoute;
  if (declaredRoute !== expectedRoutes.get(plugin.id)) {
    throw new Error(`${plugin.id} must use canonical/target route ${expectedRoutes.get(plugin.id)}, got ${declaredRoute}`);
  }
  if (declaredRoute.includes('/modules/')) throw new Error(`${plugin.id} uses the retired /modules/ route namespace`);
  if (plugin.lifecycle === 'planned' && (plugin.route || plugin.element)) throw new Error(`${plugin.id} planned entry may only declare targetRoute/targetElement`);
  if (plugin.lifecycle === 'host-integration' && (plugin.route || plugin.element || plugin.targetElement)) throw new Error(`${plugin.id} host integration may only declare managementRoute`);
  if (!Array.isArray(plugin.operands) || plugin.operands.length < 1 || plugin.operands.some((x) => !/^mirror\/[a-z0-9-]+:edge$/.test(x))) throw new Error(`${plugin.id} has an invalid operand mirror plan`);
  plugin.operands.forEach((operand) => referencedMirrors.add(operand.slice('mirror/'.length, -':edge'.length)));
  accessSync(resolve(root, 'ui-shell/manual', plugin.manual), constants.R_OK);
}
if (mirrors.schemaVersion !== 1 || mirrors.registry !== 'ghcr.io/opensphere-platform/mirror') throw new Error('invalid Foundation mirror catalog header');
const mirrorNames = new Set();
for (const mirror of mirrors.images ?? []) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(mirror.name) || mirrorNames.has(mirror.name)) throw new Error(`invalid or duplicate mirror ${mirror.name}`);
  mirrorNames.add(mirror.name);
  if (!Array.isArray(mirror.versions) || mirror.versions.length < 1) throw new Error(`${mirror.name} has no immutable upstream version`);
  if (!mirror.versions.some((item) => item.version === mirror.edgeVersion)) throw new Error(`${mirror.name} edgeVersion is not present in versions`);
  for (const version of mirror.versions) {
    if (typeof version.source !== 'string' || !version.source.includes(':') || /@(sha256)?:?$/.test(version.source)) throw new Error(`${mirror.name} has an invalid upstream source`);
  }
}
const missing = [...referencedMirrors].filter((name) => !mirrorNames.has(name));
if (missing.length) throw new Error(`Foundation plugin operands missing from mirror catalog: ${missing.join(', ')}`);
if (controls.schemaVersion !== 2) throw new Error(`expected PFSS control contract schemaVersion 2, got ${controls.schemaVersion}`);
const separatelyGoverned = ['postgres', 'opensearch', 'directory'];
const allPFSS = [...catalog.plugins.map((item) => item.id), ...separatelyGoverned].sort();
const controlIDs = Object.keys(controls.contracts ?? {}).sort();
if (JSON.stringify(allPFSS) !== JSON.stringify(controlIDs)) {
  throw new Error(`PFSS control contracts must cover exactly ${allPFSS.length} modules: catalog=${allPFSS.join(',')} controls=${controlIDs.join(',')}`);
}
const allowedRequestTypes = new Set([
  'Instance', 'Database', 'Access', 'Bucket', 'Index', 'Realm', 'Client', 'Directory',
  'Policy', 'Route', 'Project', 'MailDomain', 'Mailbox', 'Workflow', 'Workspace',
  'Pipeline', 'Tenant', 'Dashboard', 'DataSource', 'BackupPolicy', 'Restore', 'Application', 'Provider',
]);
const allowedRequestModes = new Set(['managed', 'shared', 'bind-existing', 'bind-shared', 'pending']);
for (const id of allPFSS) {
  const control = controls.contracts[id];
  if (!control.model || !control.engineId || !control.parameterPath || !control.reconciler || !control.operatorDriver || !control.nativeResource) {
    throw new Error(`${id} has an incomplete Operator control contract`);
  }
  if (!Array.isArray(control.requestTypes) || control.requestTypes.length < 1 || control.requestTypes.some((item) => !allowedRequestTypes.has(item))) {
    throw new Error(`${id} has invalid requestTypes`);
  }
  if (!control.requestModes || Object.keys(control.requestModes).sort().join(',') !== [...control.requestTypes].sort().join(',')) {
    throw new Error(`${id} requestModes must cover every requestType exactly once`);
  }
  for (const [requestType, mode] of Object.entries(control.requestModes)) {
    if (!allowedRequestModes.has(mode)) throw new Error(`${id}/${requestType} has invalid request mode ${mode}`);
  }
  if (control.reconciler === 'pending' && Object.values(control.requestModes).some((mode) => mode !== 'pending')) {
    throw new Error(`${id} cannot publish available requestModes while its reconciler is pending`);
  }
  if (!Array.isArray(control.capabilities) || control.capabilities.length < 1) throw new Error(`${id} has no binding capabilities`);
  for (const dependency of control.dependencies ?? []) {
    if (!dependency || typeof dependency.module !== 'string' || typeof dependency.purpose !== 'string' || typeof dependency.required !== 'boolean') {
      throw new Error(`${id} has an incomplete dependency contract`);
    }
    if (!allPFSS.includes(dependency.module) && !dependency.module.startsWith('external:')) {
      throw new Error(`${id} depends on unknown module ${dependency.module}`);
    }
    if (!allowedRequestTypes.has(dependency.requestType)) throw new Error(`${id} dependency ${dependency.module} has invalid requestType`);
  }
  if (control.reconciler === 'pending' && !control.blocker) throw new Error(`${id} pending reconciler must publish an honest blocker`);
}
const expectedEngineCards = [
  'keycloak', 'syncope', 'samba', 'opa', 'postgres', 'psmdb', 'valkey', 'rustfs', 'opensearch',
  'litellm', 'langfuse', 'stalwart', 'novu', 'mattermost', 'otel', 'tempo', 'loki', 'grafana-operator', 'ptm',
];
const expectedCardLifecycle = new Map([
  ['keycloak', 'migration-required'],
  ...['syncope', 'samba', 'opa', 'postgres', 'psmdb', 'valkey', 'rustfs', 'opensearch'].map((id) => [id, 'registry-backed']),
  ...['litellm', 'langfuse', 'stalwart', 'novu', 'mattermost', 'otel', 'tempo', 'loki', 'grafana-operator', 'ptm'].map((id) => [id, 'planned']),
]);
for (const id of expectedEngineCards) {
  const card = engineSurface.match(new RegExp(`id:\\s*'${id}'[\\s\\S]*?category:\\s*'[^']+'[\\s\\S]*?impl:\\s*'([^']+)'[\\s\\S]*?liveKey:\\s*'([^']*)'`));
  if (!card) throw new Error(`${id} is missing from the PFS module surface`);
  if (card[1] !== expectedCardLifecycle.get(id)) throw new Error(`${id} card lifecycle must be ${expectedCardLifecycle.get(id)}, got ${card[1]}`);
  if (card[1] !== 'planned' && !card[2]) throw new Error(`${id} must expose a FoundationModel runtime authority key`);
  if (card[2] && !engineAuthority.includes(`${card[2]}: { model:`)) throw new Error(`${id} runtime authority ${card[2]} is not wired`);
}
for (const forbidden of ['PsmdbPluginComponent', 'ValkeyPluginComponent', 'RustFSPluginComponent', 'KeycloakComponent']) {
  if (hostSurface.includes(forbidden)) throw new Error(`Foundation host must not directly import plugin runtime ${forbidden}`);
}
for (const planned of catalog.plugins.filter((item) => item.lifecycle === 'planned')) {
  if (hostSurface.includes(`catalog('${planned.id}'`) || hostSurface.includes(`CATALOG_MODULES`)) {
    throw new Error(`${planned.id} planned catalog entry leaked into operational navigation/route handling`);
  }
}
if (!engineAuthority.includes('FoundationRegistryService')) throw new Error('PFS runtime state must consume the FoundationModel registry authority');
if (!engineAuthority.includes('domain.observed.find')) throw new Error('PFS runtime state must consume reconciler observations');
if (/existsState|this\.probe\(|api\/k8s/.test(engineAuthority)) throw new Error('PFS catalog must not derive Live from Kubernetes object existence');
for (const retired of ['Phase 1 관리 표면', 'reconciler 구현 후 활성화', '아직 설치되지 않았습니다']) {
  if (operatorSurface.includes(retired)) throw new Error(`operator surface regressed to retired placeholder copy: ${retired}`);
}
if (overviewSurface.includes('const PLANNED:')) throw new Error('PFS overview regressed to the retired roadmap-only domain model');
const registryBacked = catalog.plugins.filter((item) => item.lifecycle === 'registry-backed').length + separatelyGoverned.length;
process.stdout.write(`verified ${allPFSS.length} PFSS contracts: ${registryBacked} registry-backed plugins, 1 migration, ${catalog.plugins.filter((item) => item.lifecycle === 'planned').length} planned entries and ${referencedMirrors.size} operand mirrors\n`);
