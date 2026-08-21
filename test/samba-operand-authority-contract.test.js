const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'control-plane', 'identity_bundle.go'), 'utf8');

test('Foundation control-plane passes non-secret Samba model values to plugin renderer', () => {
  assert.match(source, /func sambaOperandURL\(service string, fm \*unstructured\.Unstructured\) string/);
  assert.match(source, /q\.Set\("domain", configuredSambaRealm\(fm\)\)/);
  assert.match(source, /q\.Set\("storageClass", configuredSambaValue\(fm, "storageClass", "standard"\)\)/);
  assert.match(source, /q\.Set\("dnsForwarder", configuredSambaValue\(fm, "dnsForwarder", "8\.8\.8\.8"\)\)/);
  assert.match(source, /fetchPluginOperand\(sambaOperandURL\(cfg\.sambaPluginSvc, fm\)\)/);
  assert.doesNotMatch(source, /domainPass|domain-password|SAMBA_CREDS/);
});

test('Directory plugin service default points at the signed extension namespace', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'backend', 'control-plane', 'main.go'), 'utf8');
  assert.match(main, /directory\.opensphere-console\.svc:8080/);
  assert.doesNotMatch(main, /directory\.opensphere-system\.svc:8080/);
});
