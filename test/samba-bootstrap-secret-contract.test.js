const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { sambaBootstrapSecretEvidence, sambaReadinessProjection } = require('../server');

test('Samba bootstrap Secret evidence exposes existence and reference but never Secret data', () => {
  const evidence = sambaBootstrapSecretEvidence({
    ok: true,
    status: 200,
    json: { data: { 'domain-password': 'must-not-leak' }, metadata: { name: 'foundation-identity-samba-creds' } },
  });
  assert.deepEqual(evidence, {
    exists: true,
    secretRef: {
      namespace: 'opensphere-foundation',
      name: 'foundation-identity-samba-creds',
      key: 'domain-password',
    },
  });
  assert.equal(JSON.stringify(evidence).includes('must-not-leak'), false);
});

test('Samba bootstrap Secret absence is a normal exists=false evidence response', () => {
  assert.equal(sambaBootstrapSecretEvidence({ ok: false, status: 404, json: {} }).exists, false);
  assert.throws(
    () => sambaBootstrapSecretEvidence({ ok: false, status: 403, json: { message: 'forbidden' } }),
    (error) => error.code === 403 && error.msg === 'forbidden',
  );
});

test('Samba bootstrap endpoint supports authenticated GET projection and keeps writes on POST', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('async function saveSambaBootstrapSecret');
  const end = source.indexOf('// HIS의 운영', start);
  const handler = source.slice(start, end);
  assert.match(handler, /requireConsoleAdmin\(actor\)/);
  assert.match(handler, /req\.method === 'GET'/);
  assert.match(handler, /sambaBootstrapSecretEvidence/);
  assert.match(handler, /req\.method !== 'POST'/);
  assert.doesNotMatch(handler, /result\.json\.data/);
});

test('Samba readiness projection returns model/config and exists-only Secret evidence', () => {
  const readiness = sambaReadinessProjection({
    ok: true,
    status: 200,
    json: {
      spec: {
        parameters: {
          engines: { samba: 'enabled' },
          samba: { domain: 'EXAMPLE.LOCAL', storageClass: 'ceph-rbd', dnsForwarder: '10.0.0.2' },
        },
      },
      status: { phase: 'Installed', directoryRealm: 'EXAMPLE.LOCAL' },
    },
  }, {
    ok: true,
    status: 200,
    json: { data: { 'domain-password': 'must-not-leak' } },
  });
  assert.equal(readiness.authority, 'foundation');
  assert.equal(readiness.model.found, true);
  assert.equal(readiness.model.engineOpt, 'enabled');
  assert.equal(readiness.config.domain, 'EXAMPLE.LOCAL');
  assert.equal(readiness.config.storageClass, 'ceph-rbd');
  assert.equal(readiness.bootstrapSecret.exists, true);
  assert.equal(JSON.stringify(readiness).includes('must-not-leak'), false);
});

test('Samba readiness endpoint requires Console admin and impersonates only for Secret existence read', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('async function sambaReadiness');
  const end = source.indexOf('async function saveSambaBootstrapSecret', start);
  const handler = source.slice(start, end);
  assert.match(handler, /verifyToken\(requestToken\(req\)\)/);
  assert.match(handler, /requireConsoleAdmin\(actor\)/);
  assert.match(handler, /foundationmodels\/identity/);
  assert.match(handler, /secrets\/\$\{SAMBA_BOOTSTRAP_SECRET\}`\s*,\s*undefined\s*,\s*actor/);
  assert.doesNotMatch(handler, /\.data\b/);
});
