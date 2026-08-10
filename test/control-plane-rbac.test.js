const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const documents = [];
yaml.loadAll(
  fs.readFileSync(path.join(__dirname, '..', 'deploy', 'control-plane-rbac.yaml'), 'utf8'),
  (document) => document && documents.push(document),
);

test('managed namespace RBAC permits full ServiceMonitor reconciliation', () => {
  const role = documents.find(
    (document) => document.kind === 'Role'
      && document.metadata?.name === 'foundation-control-plane-deployer',
  );
  assert.ok(role, 'foundation-control-plane-deployer Role must exist');

  const monitoringRule = role.rules.find(
    (rule) => rule.apiGroups?.includes('monitoring.coreos.com')
      && rule.resources?.includes('servicemonitors'),
  );
  assert.ok(monitoringRule, 'ServiceMonitor rule must exist');
  for (const verb of ['get', 'list', 'watch', 'create', 'patch', 'delete', 'deletecollection']) {
    assert.ok(monitoringRule.verbs.includes(verb), `ServiceMonitor rule must permit ${verb}`);
  }
});

test('control-plane RBAC permits label-scoped collection cleanup', () => {
  const role = documents.find(
    (document) => document.kind === 'ClusterRole'
      && document.metadata?.name === 'foundation-control-plane-core',
  );
  assert.ok(role, 'foundation-control-plane-core ClusterRole must exist');

  for (const [apiGroup, resource] of [
    ['foundation.opensphere.io', 'foundationclaims'],
    ['backup.opensphere.io', 'backuppolicies'],
  ]) {
    const rule = role.rules.find(
      (candidate) => candidate.apiGroups?.includes(apiGroup)
        && candidate.resources?.includes(resource),
    );
    assert.ok(rule, `${apiGroup}/${resource} rule must exist`);
    assert.ok(rule.verbs.includes('deletecollection'), `${apiGroup}/${resource} must permit deletecollection`);
  }
});

test('PostgreSQL runtime catalog remains declared and readable by the control plane', () => {
  const role = documents.find(
    (document) => document.kind === 'ClusterRole'
      && document.metadata?.name === 'foundation-control-plane-core',
  );
  const catalogRule = role.rules.find(
    (rule) => rule.apiGroups?.includes('catalog.opensphere.io')
      && rule.resources?.includes('postgresruntimecatalogs'),
  );
  assert.ok(catalogRule, 'PostgresRuntimeCatalog read rule must exist');
  for (const verb of ['get', 'list', 'watch']) assert.ok(catalogRule.verbs.includes(verb));

  const runtimeCatalog = yaml.load(
    fs.readFileSync(path.join(__dirname, '..', 'deploy', 'postgres-runtime-catalog.yaml'), 'utf8'),
  );
  assert.equal(runtimeCatalog.kind, 'PostgresRuntimeCatalog');
  assert.equal(runtimeCatalog.metadata.name, 'opensphere-stackgres');
  assert.match(runtimeCatalog.spec.versions[0].image, /@sha256:[a-f0-9]{64}$/);
});
