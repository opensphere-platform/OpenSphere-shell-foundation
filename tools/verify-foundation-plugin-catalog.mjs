import { accessSync, constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'plugins/catalog.json'), 'utf8'));
const mirrors = JSON.parse(readFileSync(resolve(root, 'oci/mirrors.json'), 'utf8'));
if (catalog.schemaVersion !== 1 || catalog.hostRef !== 'foundation') throw new Error('invalid Foundation plugin catalog header');
if (!Array.isArray(catalog.plugins) || catalog.plugins.length !== 20) throw new Error(`expected 20 catalog plugins excluding separately governed samba-ad, got ${catalog.plugins?.length}`);
const ids = new Set();
const elements = new Set();
const referencedMirrors = new Set();
const expectedRoutes = new Map([
  ['postgres', '/p/foundation/postgres'],
  ['percona-psmdb', '/p/foundation/psmdb'],
  ['valkey', '/p/foundation/valkey'],
  ['opensearch', '/p/foundation/opensearch'],
  ['rustfs', '/p/foundation/rustfs'],
  ['keycloak', '/p/foundation/keycloak'],
  ['apache-syncope', '/p/foundation/syncope'],
  ['opa', '/p/foundation/opa'],
  ['litellm', '/p/foundation/litellm'],
  ['langfuse', '/p/foundation/langfuse'],
  ['stalwart', '/p/foundation/stalwart'],
  ['novu', '/p/foundation/novu'],
  ['mattermost', '/p/foundation/mattermost'],
  ['opentelemetry', '/p/foundation/otel'],
  ['grafana-tempo', '/p/foundation/tempo'],
  ['grafana-loki', '/p/foundation/loki'],
  ['grafana-operator', '/p/foundation/grafana-operator'],
  ['ptm', '/p/foundation/ptm'],
  ['argocd', '/p/foundation/delivery/argocd'],
  ['crossplane', '/p/foundation/delivery/crossplane'],
]);
for (const plugin of catalog.plugins) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(plugin.id)) throw new Error(`invalid plugin id ${plugin.id}`);
  if (ids.has(plugin.id)) throw new Error(`duplicate plugin id ${plugin.id}`);
  ids.add(plugin.id);
  if (!/^osp-foundation-[a-z0-9-]+$/.test(plugin.element) || elements.has(plugin.element)) throw new Error(`invalid or duplicate element ${plugin.element}`);
  elements.add(plugin.element);
  if (!plugin.logo.startsWith('https://logos.opl.io.kr/i/')) throw new Error(`${plugin.id} violates the logo authority policy`);
  if (plugin.route !== expectedRoutes.get(plugin.id)) {
    throw new Error(`${plugin.id} must use canonical route ${expectedRoutes.get(plugin.id)}, got ${plugin.route}`);
  }
  if (plugin.route.includes('/modules/')) throw new Error(`${plugin.id} uses the retired /modules/ route namespace`);
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
process.stdout.write(`verified ${catalog.plugins.length} independent Foundation plugins, ${referencedMirrors.size} operand mirrors, plus separately governed samba-ad\n`);
