'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('Platform Delivery routes Argo CD and Crossplane to dedicated administrator pages', () => {
  const delivery = read('src/app/foundation/delivery.component.ts');
  const argo = read('src/app/foundation/argocd/argocd.component.ts');
  const crossplane = read('src/app/foundation/crossplane/crossplane.component.ts');
  assert.match(delivery, /<app-argocd \*ngIf="vr\.tab\(\)==='argocd'"/);
  assert.doesNotMatch(delivery, /<app-roadmap-module \*ngIf="vr\.tab\(\)==='argocd'"/);
  assert.match(argo, /deliveryAdminTabs\('Applications & Projects'\)/);
  assert.match(crossplane, /deliveryAdminTabs\('Providers & Releases'\)/);
  assert.doesNotMatch(crossplane, /pfsPluginTabs/);
  assert.match(delivery, /logos:\s*\[/);
  assert.match(delivery, /logos\.opl\.io\.kr\/i\/argocd/);
  assert.match(delivery, /logos\.opl\.io\.kr\/i\/crossplane-non-typo/);
  assert.doesNotMatch(delivery, /<section class="stack-inline">/);
});

test('Crossplane core installation is handed to HISS while adapter configuration stays in Foundation', () => {
  const component = read('src/app/foundation/crossplane/crossplane.component.ts');
  const service = read('src/app/foundation/crossplane/crossplane.service.ts');
  assert.match(component, /\/p\/cluster-manager\/his\/his\?focus=crossplane-core/);
  assert.match(component, /svc\.createDefaultProviderConfig\(\)/);
  assert.match(service, /kind:\s*'ProviderConfig'/);
  assert.match(service, /source:\s*'InjectedIdentity'/);
  assert.match(service, /hostFetch\(/);
  assert.doesNotMatch(service, /(?<!host)fetch\(/);
});

test('Platform Delivery mutation RBAC is bounded to Argo Applications and Crossplane ProviderConfigs', () => {
  const rbac = read('rbac-foundation-read.yaml');
  const adminSection = rbac.split('name: foundation-platform-delivery-admin')[1] || '';
  assert.match(adminSection, /resources:\s*\["applications"\]/);
  assert.match(adminSection, /resources:\s*\["providerconfigs"\]/);
  assert.match(rbac, /kind:\s*Group,\s*name:\s*opensphere-console-admins/);
  assert.doesNotMatch(adminSection, /resources:\s*\["providers"/);
  assert.doesNotMatch(adminSection, /customresourcedefinitions/);
  assert.doesNotMatch(adminSection, /resources:\s*\["secrets"\]/);
});
