const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  requireClosedOwnerBody,
  foundationCliManifest,
  postgresOwnerActionDefinitions,
  postgresOwnerContractProjection,
  postgresReadinessEvidence,
  postgresReadinessBlocker,
  postgresCrdReadinessBlocker,
  postgresReadinessProjection,
  postgresOperationCompletion,
  postgresOperationWatchStage,
  POSTGRES_OWNER_CONTRACT_VERSION,
  POSTGRES_OWNER_SOURCE_REVISION,
  POSTGRES_OWNER_EVIDENCE_TTL_SECONDS,
} = require('../server.js');
const yaml = require('js-yaml');

const IMPLEMENTED_ACTIONS = [
  'capability.read',
  'readiness.read',
  'catalog.read',
  'cluster.plan',
  'cluster.create',
  'cluster.status',
  'operation.watch',
];

test('PostgreSQL owner publishes one additive v1 semantic action catalog', () => {
  const actions = postgresOwnerActionDefinitions();
  assert.deepEqual(actions.map((item) => item.actionId), IMPLEMENTED_ACTIONS);
  assert.equal(new Set(actions.map((item) => item.toolId)).size, actions.length);
  assert.ok(actions.every((item) => item.requestType === 'Instance'));
  assert.ok(actions.every((item) => item.executionClass === 'console-api'));
  assert.ok(actions.every((item) => typeof item.webShell.available === 'boolean' && item.webShell.reason));
  assert.ok(actions.every((item) => item.webShell.available === true), 'all canonical Owner actions must be available to the attested Web Shell channel');
  assert.equal(actions.some((item) => /database|access|backup|restore|scale|extension/i.test(item.actionId)), false);

  const manifest = foundationCliManifest();
  assert.equal(manifest.schemaVersion, 'v1');
  assert.equal(manifest.contractVersion, POSTGRES_OWNER_CONTRACT_VERSION);
  assert.equal(manifest.sourceRevision, POSTGRES_OWNER_SOURCE_REVISION);
  assert.deepEqual(manifest.requestTypes, ['Instance']);
  assert.equal(manifest.compatibility.unknownResponseFields, 'ignore');
  assert.equal(manifest.compatibility.unknownRequestFields, 'reject');
  assert.deepEqual(manifest.tools.map((item) => item.actionId), IMPLEMENTED_ACTIONS);

  for (const tool of manifest.tools) {
    const action = actions.find((item) => item.actionId === tool.actionId);
    assert.ok(action);
    assert.equal(tool.id, action.toolId);
    assert.equal(tool.requestType, action.requestType);
    assert.equal(tool.executionClass, action.executionClass);
    assert.equal(tool.risk, action.risk);
    assert.equal(tool.riskClass, action.riskClass);
    assert.equal(tool.semanticIdentity.actionId, action.actionId);
    assert.equal(tool.semanticIdentity.toolId, action.toolId);
    assert.deepEqual(tool.actionBinding, {
      method: action.method,
      path: action.path,
      ...(action.pathParams?.length ? { pathParams: action.pathParams } : {}),
      ...(action.approval ? { approval: action.approval } : {}),
    });
  }
});

test('Foundation image build fails closed without the exact source revision used by both owner manifests', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /ARG OS_SOURCE_REVISION/);
  assert.match(dockerfile, /test -n "\$\{OS_SOURCE_REVISION\}"/);
  assert.match(dockerfile, /grep -Eq '\^\[a-f0-9\]\{40\}\$'/);
  assert.match(dockerfile, /OS_SOURCE_REVISION=\$OS_SOURCE_REVISION/);
  const exactSourceRevision = /^[a-f0-9]{40}$/;
  assert.equal(exactSourceRevision.test('a'.repeat(40)), true, 'full canonical revision is accepted');
  for (const invalid of ['', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41), `../${'a'.repeat(40)}`]) {
    assert.equal(exactSourceRevision.test(invalid), false, `noncanonical revision must fail: ${invalid}`);
  }
});

test('capability endpoints and manifest share stable semantic identity', () => {
  const manifest = foundationCliManifest();
  for (const actionId of IMPLEMENTED_ACTIONS) {
    const contract = postgresOwnerContractProjection(actionId);
    const tool = manifest.tools.find((item) => item.actionId === actionId);
    assert.ok(tool);
    assert.equal(contract.contractVersion, manifest.contractVersion);
    assert.equal(contract.sourceRevision, manifest.sourceRevision);
    assert.equal(contract.semanticIdentity.capabilityId, manifest.capabilityId);
    assert.equal(contract.semanticIdentity.requestType, tool.requestType);
    assert.equal(contract.semanticIdentity.actionId, tool.actionId);
    assert.equal(contract.semanticIdentity.toolId, tool.id);
    assert.deepEqual(contract.actionBinding, tool.actionBinding);
  }

  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const functionBody = (name, nextName) => server.slice(server.indexOf(`async function ${name}`), server.indexOf(`async function ${nextName}`));
  assert.match(functionBody('postgresOsaaCapabilities', 'postgresOsaaReadiness'), /postgresOwnerContractProjection\('capability\.read'\)/);
  assert.match(functionBody('postgresOsaaReadiness', 'postgresOsaaCatalog'), /postgresReadinessProjection/);
  assert.match(functionBody('postgresOsaaCatalog', 'postgresOsaaApply'), /postgresOwnerContractProjection\('catalog\.read'\)/);
  assert.match(functionBody('postgresOsaaPlan', 'postgresOsaaCapabilities'), /postgresOwnerContractProjection\('cluster\.plan'\)/);
  assert.match(functionBody('postgresOsaaApply', 'postgresOsaaClaimStatus'), /postgresOwnerContractProjection\('cluster\.create'\)/);
  assert.match(functionBody('postgresOsaaOperationWatch', 'postgresRuntimes'), /postgresOwnerContractProjection\('operation\.watch'\)/);
});

test('readiness v1 adds stage, evidence freshness, blockers, missing inputs and next actions', () => {
  const observedAt = new Date().toISOString();
  const evidence = [
    postgresReadinessEvidence('postgresclaims.provisioning.opensphere.io', 'test/CRD', { ok: false, status: 404 }, observedAt, 'http:404'),
    postgresReadinessEvidence('console-identity', 'test/identity', { ok: true }, observedAt, 'assurance:aal2'),
  ];
  const blocker = postgresReadinessBlocker(
    'POSTGRES_CLAIM_CRD_NOT_INSTALLED',
    'postgresclaims.provisioning.opensphere.io',
    'PostgresClaim CRD is not installed.',
    ['cluster.plan', 'cluster.create'],
    'PFSS',
    'Install the signed PFSS PostgreSQL contract bundle',
  );
  const readiness = postgresReadinessProjection([blocker], { ownerAPI: true }, evidence, observedAt);

  assert.equal(readiness.schema, 'foundation.control-readiness/v1');
  assert.equal(readiness.stage, 'Contract');
  assert.equal(readiness.readyToPlan, false);
  assert.equal(readiness.readyToExecute, false);
  assert.match(readiness.evidenceRevision, /^[a-f0-9]{64}$/);
  assert.equal(readiness.observedAt, observedAt);
  assert.equal(readiness.source.revision, POSTGRES_OWNER_SOURCE_REVISION);
  assert.equal(readiness.staleness.ttlSeconds, POSTGRES_OWNER_EVIDENCE_TTL_SECONDS);
  assert.equal(readiness.staleness.stale, false);
  assert.equal(readiness.blockers[0].id, 'data.sql.postgres/POSTGRES_CLAIM_CRD_NOT_INSTALLED');
  assert.equal(readiness.blockers[0].stage, 'Contract');
  assert.deepEqual(readiness.blockers[0].evidenceRefs, ['postgresclaims.provisioning.opensphere.io']);
  assert.equal(readiness.blockers[0].remediation.owner, 'PFSS');

  const plan = readiness.nextActions.find((item) => item.actionId === 'cluster.plan');
  assert.equal(plan.supported, true);
  assert.equal(plan.available, false);
  assert.deepEqual(plan.blockedBy, ['data.sql.postgres/POSTGRES_CLAIM_CRD_NOT_INSTALLED']);
  assert.ok(plan.missingInputs.required.includes('postgresVersion'));
  assert.equal(plan.missingInputs.schema.additionalProperties, false);
  assert.ok(readiness.missingInputs.some((item) => item.actionId === 'cluster.create'
    && item.required.includes('planId') && item.required.includes('confirm')));
});

test('additive response fields are ignored by a v1 client while request schemas remain closed', () => {
  const manifest = foundationCliManifest();
  const futureManifest = JSON.parse(JSON.stringify(manifest));
  futureManifest.futureOwnerProjection = { revision: 'vNext' };
  futureManifest.tools[0].futureActionHint = true;

  const legacyProjection = (value) => ({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    cli: value.cli,
    tools: value.tools.map((tool) => ({
      id: tool.id, command: tool.command, method: tool.method, path: tool.path,
      risk: tool.risk, scope: tool.scope, inputSchema: tool.inputSchema,
    })),
  });
  assert.deepEqual(legacyProjection(futureManifest), legacyProjection(manifest));
  assert.throws(
    () => requireClosedOwnerBody({ name: 'orders', unknownFutureRequestField: true }, ['name']),
    (error) => /unsupported Foundation owner inputs/.test(String(error?.msg || error?.message || error)),
  );
});

const OPERATION_ID = '8a3f9d41-1b4e-4d71-9d36-71c0cb73af52';
const READY_OWNER_STATUS = { stage: 'Ready' };
const FRESH_OWNER_EVIDENCE = {
  evidenceRevision: 'a'.repeat(64),
  observedAt: '2026-08-14T01:00:00.000Z',
  source: 'kubernetes-api',
  missing: false,
  stale: false,
};

test('operation completion does not succeed when owner resource is Ready but operation is Reconciling', () => {
  const completion = postgresOperationCompletion({
    operationId: OPERATION_ID,
    action: 'create-postgres-cluster',
    phase: 'Reconciling',
    verificationState: 'pending',
    verifierId: 'owner.foundation.postgres.ready',
  }, READY_OWNER_STATUS, FRESH_OWNER_EVIDENCE);

  assert.deepEqual({
    terminal: completion.terminal,
    success: completion.success,
    verified: completion.verified,
    state: completion.state,
  }, { terminal: false, success: false, verified: false, state: 'Reconciling' });
  assert.equal(postgresOperationWatchStage({ phase: 'Reconciling' }, READY_OWNER_STATUS, completion), 'Reconciling');
  assert.equal(Object.hasOwn(completion, 'receipt'), false);
});

test('operation completion remains non-terminal when phase succeeded but verification is pending', () => {
  const completion = postgresOperationCompletion({
    operationId: OPERATION_ID,
    action: 'create-postgres-cluster',
    phase: 'Succeeded',
    verificationState: 'pending',
    verifierId: 'owner.foundation.postgres.ready',
  }, READY_OWNER_STATUS, FRESH_OWNER_EVIDENCE);

  assert.equal(completion.terminal, false);
  assert.equal(completion.success, false);
  assert.equal(completion.verified, false);
  assert.equal(completion.state, 'VerificationPending');
  assert.equal(Object.hasOwn(completion, 'receipt'), false);
});

test('verified durable success emits the canonical completion receipt', () => {
  const updatedAt = '2026-08-14T01:02:03.000Z';
  const completion = postgresOperationCompletion({
    operationId: OPERATION_ID,
    action: 'create-postgres-cluster',
    phase: 'Succeeded',
    verificationState: 'succeeded',
    verifierId: 'owner.foundation.postgres.ready',
    updatedAt,
  }, READY_OWNER_STATUS, FRESH_OWNER_EVIDENCE);

  assert.equal(completion.terminal, true);
  assert.equal(completion.success, true);
  assert.equal(completion.verified, true);
  assert.equal(completion.state, 'Succeeded');
  assert.equal(postgresOperationWatchStage({ phase: 'Succeeded' }, READY_OWNER_STATUS, completion), 'Ready');
  assert.equal(completion.stale, false);
  assert.equal(completion.evidenceRevision, FRESH_OWNER_EVIDENCE.evidenceRevision);
  assert.deepEqual(completion.receipt, {
    operationId: OPERATION_ID,
    verifierId: 'owner.foundation.postgres.ready',
    verificationState: 'succeeded',
    verifiedAt: updatedAt,
    updatedAt,
    semanticIdentity: {
      capabilityId: 'data.sql.postgres',
      requestType: 'Instance',
      actionId: 'cluster.create',
      toolId: 'foundation.postgres.apply',
    },
    actionBinding: {
      method: 'POST',
      path: '/api/foundation/osaa/postgres/durable-apply/{planId}',
      pathParams: ['planId'],
      approval: 'exact-confirmation',
    },
    ownerEvidenceRevision: FRESH_OWNER_EVIDENCE.evidenceRevision,
  });
});

test('stale or missing owner evidence blocks success and never emits a receipt', () => {
  const operation = {
    operationId: OPERATION_ID,
    action: 'create-postgres-cluster',
    phase: 'Succeeded',
    verificationState: 'succeeded',
    verifierId: 'owner.foundation.postgres.ready',
    updatedAt: '2026-08-14T01:02:03.000Z',
  };
  const stale = postgresOperationCompletion(operation, READY_OWNER_STATUS, {
    ...FRESH_OWNER_EVIDENCE,
    stale: true,
  });
  const missing = postgresOperationCompletion(operation, READY_OWNER_STATUS, null);

  for (const completion of [stale, missing]) {
    assert.equal(completion.terminal, false);
    assert.equal(completion.success, false);
    assert.equal(completion.verified, false);
    assert.equal(completion.state, 'OwnerEvidencePending');
    assert.equal(completion.stale, true);
    assert.equal(Object.hasOwn(completion, 'receipt'), false);
  }
  assert.equal(stale.evidenceRevision, FRESH_OWNER_EVIDENCE.evidenceRevision);
  assert.equal(missing.evidenceRevision, null);
});

test('PostgreSQL owner catalog consumers have read-only StorageClass discovery', () => {
  const documents = [];
  yaml.loadAll(
    fs.readFileSync(path.join(__dirname, '../deploy/postgres-fleet-console-rbac.yaml'), 'utf8'),
    (document) => document && documents.push(document),
  );
  const role = documents.find((document) => document.kind === 'ClusterRole'
    && document.metadata?.name === 'opensphere-postgres-fleet-read');
  assert.ok(role, 'opensphere-postgres-fleet-read ClusterRole must exist');
  const storageRule = role.rules.find((rule) => rule.apiGroups?.includes('storage.k8s.io')
    && rule.resources?.includes('storageclasses'));
  assert.ok(storageRule, 'PostgreSQL catalog readers must be able to discover StorageClasses');
  assert.deepEqual([...storageRule.verbs].sort(), ['get', 'list', 'watch']);
  const crdRule = role.rules.find((rule) => rule.apiGroups?.includes('apiextensions.k8s.io')
    && rule.resources?.includes('customresourcedefinitions'));
  assert.ok(crdRule, 'PostgreSQL readiness consumers must be able to observe contract CRDs');
  assert.deepEqual([...crdRule.verbs].sort(), ['get', 'list', 'watch']);

  const binding = documents.find((document) => document.kind === 'ClusterRoleBinding'
    && document.roleRef?.name === role.metadata.name);
  assert.ok(binding?.subjects?.some((subject) => subject.kind === 'Group'
    && subject.name === 'opensphere-console-admins'));
});

test('PostgreSQL readiness distinguishes absent CRDs from unobservable CRDs', () => {
  const spec = {
    component: 'postgresclaims.provisioning.opensphere.io',
    missingCode: 'POSTGRES_CLAIM_CRD_NOT_INSTALLED',
    unavailableCode: 'POSTGRES_CLAIM_CRD_UNOBSERVABLE',
    missingMessage: 'PostgresClaim CRD is not installed.',
    missingAction: 'Install the signed PFSS PostgreSQL contract bundle',
    affectedOperations: ['cluster.plan', 'cluster.create'],
  };
  const missing = postgresCrdReadinessBlocker({ ok: false, status: 404 }, spec);
  const forbidden = postgresCrdReadinessBlocker({ ok: false, status: 403 }, spec);
  assert.equal(missing.code, 'POSTGRES_CLAIM_CRD_NOT_INSTALLED');
  assert.equal(missing.remediation.action, spec.missingAction);
  assert.equal(forbidden.code, 'POSTGRES_CLAIM_CRD_UNOBSERVABLE');
  assert.match(forbidden.message, /could not be observed \(HTTP 403\)/);
  assert.match(forbidden.remediation.action, /Restore delegated read access/);
  assert.equal(postgresCrdReadinessBlocker({ ok: true, status: 200 }, spec), null);
});
