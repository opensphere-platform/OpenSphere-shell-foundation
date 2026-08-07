import { accessSync, constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'plugins/catalog.json'), 'utf8'));
const mirrors = JSON.parse(readFileSync(resolve(root, 'oci/mirrors.json'), 'utf8'));
if (catalog.schemaVersion !== 1 || catalog.hostRef !== 'foundation') throw new Error('invalid Foundation plugin catalog header');
if (!Array.isArray(catalog.plugins) || catalog.plugins.length !== 19) throw new Error(`expected 19 Foundation-bundled plugins; PostgreSQL and directory are separately governed, got ${catalog.plugins?.length}`);
const ids = new Set();
const elements = new Set();
const referencedMirrors = new Set();
const expectedRoutes = new Map([
  ['percona-psmdb', '/pfss/psmdb'],
  ['valkey', '/pfss/valkey'],
  ['opensearch', '/pfss/opensearch'],
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
process.stdout.write(`verified ${catalog.plugins.length} Foundation-bundled plugins and ${referencedMirrors.size} operand mirrors; PostgreSQL and directory are separately governed\n`);
