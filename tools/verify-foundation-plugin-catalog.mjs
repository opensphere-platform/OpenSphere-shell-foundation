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
for (const plugin of catalog.plugins) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(plugin.id)) throw new Error(`invalid plugin id ${plugin.id}`);
  if (ids.has(plugin.id)) throw new Error(`duplicate plugin id ${plugin.id}`);
  ids.add(plugin.id);
  if (!/^osp-foundation-[a-z0-9-]+$/.test(plugin.element) || elements.has(plugin.element)) throw new Error(`invalid or duplicate element ${plugin.element}`);
  elements.add(plugin.element);
  if (!plugin.logo.startsWith('https://logos.opl.io.kr/i/')) throw new Error(`${plugin.id} violates the logo authority policy`);
  if (!plugin.route.startsWith('/p/foundation/')) throw new Error(`${plugin.id} route is outside Foundation`);
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
