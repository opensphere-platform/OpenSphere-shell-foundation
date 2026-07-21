'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySupabaseToken, k8sGroups, requireConsoleAdmin } = require('../server');

test('Foundation delegates Console identity validation to the Supabase authority', async () => {
  let call;
  const actor = await verifySupabaseToken('supabase-access-token', async (url, init) => {
    call = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ subject: 'subject-1', username: 'cmars', groups: ['console-admins'] }),
    };
  });
  assert.match(call.url, /\/api\/identity\/session$/);
  assert.equal(call.init.headers.authorization, 'Bearer supabase-access-token');
  assert.deepEqual(actor, { username: 'cmars', subject: 'subject-1', groups: ['console-admins'], provider: 'supabase' });
});

test('Foundation fails closed and only projects known Console roles into Kubernetes groups', async () => {
  await assert.rejects(
    verifySupabaseToken('revoked', async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid Supabase session' }) })),
    (error) => error.code === 401 && error.msg === 'invalid Supabase session',
  );
  await assert.rejects(
    verifySupabaseToken('token', async () => { throw new Error('offline'); }),
    (error) => error.code === 503 && error.msg === 'Supabase identity authority unavailable',
  );
  assert.deepEqual(k8sGroups(['console-admins', 'system:masters', 'untrusted']), ['opensphere-console-admins']);
  assert.doesNotThrow(() => requireConsoleAdmin({ groups: ['console-admins'] }));
  assert.throws(() => requireConsoleAdmin({ groups: ['console-viewers'] }), (error) => error.code === 403);
});
