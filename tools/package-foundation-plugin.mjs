import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'plugins/catalog.json'), 'utf8'));
const arg = process.argv.indexOf('--id');
const id = arg >= 0 ? process.argv[arg + 1] : '';
const spec = catalog.plugins.find((item) => item.id === id);
if (!spec) throw new Error(`unknown Foundation plugin id: ${id || '(empty)'}`);
const keyPath = process.env.DUPA_SIGNING_KEY;
if (!keyPath) throw new Error('DUPA_SIGNING_KEY must point to the approved P-256 signing key');
const keyId = process.env.DUPA_SIGNING_KEY_ID || 'opensphere-plugins-v4';
const key = createPrivateKey(readFileSync(keyPath));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const signature = (text) => sign('sha256', Buffer.from(text), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
const sdkRoot = resolve(process.env.OPENSPHERE_SDK || resolve(root, '../OpenSphere-SDK'));
const sdkPackage = JSON.parse(readFileSync(resolve(sdkRoot, 'package.json'), 'utf8'));
const out = resolve(root, 'plugins/generated', id);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const manual = readFileSync(resolve(root, 'ui-shell/manual', spec.manual), 'utf8');
const runtimeSpec = {
  ...spec,
  version: catalog.version,
  hostRef: catalog.hostRef,
  channel: 'edge',
  namespace: 'opensphere-foundation',
  cliNamespace: id.replace(/^apache-/, '').replace(/^grafana-/, ''),
};
writeFileSync(resolve(out, 'plugin.json'), `${JSON.stringify(runtimeSpec, null, 2)}\n`);
writeFileSync(resolve(out, 'manual.ko.md'), manual.endsWith('\n') ? manual : `${manual}\n`);

const template = readFileSync(resolve(root, 'plugins/runtime/ui-shell.plugin.template.js'), 'utf8');
const entry = template
  .replace('__PLUGIN_SPEC__', JSON.stringify(runtimeSpec))
  .replace('__MANUAL_CONTENT__', JSON.stringify(manual));
writeFileSync(resolve(out, 'ui-shell.plugin.js'), entry);

const contributions = {
  page: { enabled: false, reason: 'Mounted inside the Foundation subShell' },
  navigation: { enabled: false, mode: 'none', reason: 'Foundation owns child navigation' },
  api: { enabled: true, basePath: `/api/plugins/${id}` },
  cli: { enabled: true, namespace: runtimeSpec.cliNamespace, manifestPath: '/cli/manifest' },
  manual: { enabled: true, sourceId: `plugin:foundation/${id}`, mode: 'runtime' },
  search: { enabled: true, mode: 'index' },
  notification: { enabled: false, frontend: false, backend: false, reason: 'This plugin does not publish notifications directly' },
  observability: { enabled: true, logs: true, metrics: true, traces: false },
};
const manifest = {
  manifestVersion: 3,
  kind: 'plugin',
  id,
  hostRef: catalog.hostRef,
  hostApiVersion: '1.0.0',
  hostCompat: '>=1.0.0 <2.0.0',
  version: catalog.version,
  title: spec.displayName,
  description: spec.description,
  entry: 'ui-shell.plugin.js',
  entrySha256: hash(entry),
  shellCompat: '>=0.2.0 <0.9.0',
  sdkVersion: sdkPackage.version,
  permissions: ['api:proxy', 'manual:contribute', 'search:contribute'],
  nav: { band: 'Foundation', label: spec.displayName },
  designSystem: 'clarity',
  apiBase: `/api/plugins/${id}`,
  renderMode: 'esm',
  contributions,
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(resolve(out, 'ui-shell.manifest.json'), manifestText);
writeFileSync(resolve(out, 'ui-shell.manifest.json.sig'), `${signature(manifestText)}\n`);

const descriptor = {
  schemaVersion: 1,
  id,
  kind: 'plugin',
  displayName: spec.displayName,
  version: catalog.version,
  owner: 'opensphere-platform',
  description: spec.description,
  hostRef: catalog.hostRef,
  hostApiVersion: '1.0.0',
  hostCompat: '>=1.0.0 <2.0.0',
  shellCompat: '>=0.2.0 <0.9.0',
  sdkVersion: sdkPackage.version,
  permissions: manifest.permissions,
  permissionProfile: 'none',
  runtime: {
    port: 8080,
    healthPath: '/healthz',
    serviceAccountName: `opensphere-plugin-${id}`,
    resources: { cpuRequest: '10m', memoryRequest: '32Mi', cpuLimit: '100m', memoryLimit: '128Mi' },
  },
  manifest: {
    path: '/plugins/ui-shell.manifest.json',
    sha256: hash(manifestText),
    signaturePath: '/plugins/ui-shell.manifest.json.sig',
  },
  trust: { keyId },
  api: { basePath: `/api/plugins/${id}` },
  contributions,
};
const sdkEntry = resolve(sdkRoot, 'dist/index.js');
const { validateModulePackage } = await import(pathToFileURL(sdkEntry));
const issues = validateModulePackage(descriptor);
if (issues.length) throw new Error(`OpenSphere SDK rejected ${id}: ${JSON.stringify(issues)}`);
const descriptorText = JSON.stringify(descriptor);
writeFileSync(resolve(out, 'module-package.json'), descriptorText);
writeFileSync(resolve(out, 'module-package.json.sig'), `${signature(descriptorText)}\n`);
process.stdout.write(`${id}\topensphere-plugin-${id}\t${spec.element}\n`);
