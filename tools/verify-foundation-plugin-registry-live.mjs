import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const namespace = process.env.OPENSPHERE_REGISTRY_NAMESPACE || 'opensphere-console';
const catalog = JSON.parse(readFileSync(resolve(root, 'plugins/catalog.json'), 'utf8'));
const separatelyGoverned = [
  { id: 'postgres', sourceRepository: 'OpenSphere-plugin-postgres' },
  { id: 'opensearch', sourceRepository: 'OpenSphere-plugin-opensearch' },
  { id: 'directory', sourceRepository: 'OpenSphere-plugin-directory' },
];
const expected = new Map([
  ...catalog.plugins
    .filter((item) => item.lifecycle === 'registry-backed')
    .map((item) => [item.packageId, item]),
  ...separatelyGoverned.map((item) => [item.id, item]),
]);

const kubectlJSON = (resource) => JSON.parse(execFileSync('kubectl', ['get', resource, '-n', namespace, '-o', 'json'], { encoding: 'utf8' }));
const packages = new Map(kubectlJSON('uipkg').items.map((item) => [item.metadata.name, item]));
const registrations = new Map(kubectlJSON('uireg').items.map((item) => [item.metadata.name, item]));
const problems = [];

for (const [id] of expected) {
  const pkg = packages.get(id);
  const registration = registrations.get(id);
  if (!pkg) { problems.push(`${id}: UIPluginPackage missing`); continue; }
  if (pkg.spec?.kind !== 'plugin') problems.push(`${id}: kind=${pkg.spec?.kind ?? '(missing)'}`);
  if (pkg.spec?.hostRef !== 'foundation') problems.push(`${id}: hostRef=${pkg.spec?.hostRef ?? '(missing)'}`);
  if (!registration) { problems.push(`${id}: UIPluginRegistration missing`); continue; }
  if (registration.spec?.packageRef?.name !== id) problems.push(`${id}: registration packageRef mismatch`);
}

for (const [id, pkg] of packages) {
  if (pkg.spec?.kind !== 'plugin' || pkg.spec?.hostRef !== 'foundation') continue;
  if (!expected.has(id)) problems.push(`${id}: orphan/stale foundation plugin Package`);
}
for (const item of catalog.plugins.filter((entry) => entry.lifecycle === 'planned')) {
  if (packages.has(item.id) || registrations.has(item.id)) problems.push(`${item.id}: planned entry leaked into runtime Registry`);
}
if (packages.has('samba-ad')) problems.push('samba-ad: Directory operand/provider must not be a standalone plugin');

if (problems.length) throw new Error(`Foundation live Registry conformance failed:\n- ${problems.join('\n- ')}`);
process.stdout.write(`verified ${expected.size} PFSS plugins in live Registry; no planned/provider leakage\n`);
