const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  postgresReadOnlySql, postgresActionPlan, pgName, postgresServiceHost, POSTGRES_ADMIN,
  POSTGRES_DEFAULT_ID, parsePostgresClusterId, postgresClusterProjection, postgresBindingDatabase,
  postgresProfileKind, sanitizePostgresProfileSpec, profileReferenceCounts, profileSpecDiff, postgresOperationPlan, postgresBackupPlan,
} = require('../server.js');

function throwsMessage(fn, pattern) {
  assert.throws(fn, (error) => pattern.test(String(error?.msg || error?.message || error)));
}

test('Foundation PostgreSQL admin validates identifiers and keeps Query Tool read-only', () => {
  assert.equal(pgName('app_data'), 'app_data');
  throwsMessage(() => pgName('public; DROP SCHEMA public'), /supported PostgreSQL identifier/);
  assert.equal(postgresReadOnlySql('SELECT 1'), 'SELECT 1');
  throwsMessage(() => postgresReadOnlySql('UPDATE app SET enabled = false'), /read-only/);
});

test('typed PostgreSQL actions are allowlisted and destructive plans use RESTRICT', () => {
  const plan = postgresActionPlan({
    action: 'create-table', database: 'app', schema: 'public', name: 'audit_event',
    columns: [
      { name: 'id', type: 'bigserial', nullable: false, default: '' },
      { name: 'created_at', type: 'timestamp with time zone', nullable: false, default: 'now()' },
    ],
  });
  assert.equal(plan.sql, 'CREATE TABLE "public"."audit_event" ("id" bigserial NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now())');
  assert.equal(postgresActionPlan({ action: 'drop-table', database: 'app', schema: 'public', name: 'old_data' }).sql,
    'DROP TABLE "public"."old_data" RESTRICT');
  throwsMessage(() => postgresActionPlan({
    action: 'create-index', database: 'app', schema: 'public', table: 'event', name: 'event_idx',
    indexColumns: ['created_at DESC'],
  }), /supported PostgreSQL identifier/);
});

test('Foundation uses the canonical bounded StackGres target', () => {
  assert.equal(POSTGRES_DEFAULT_ID, 'stackgres:opensphere-foundation:pgc-foundation-data-pg');
  assert.equal(POSTGRES_ADMIN.rowLimit, 500);
  assert.equal(POSTGRES_ADMIN.statementTimeoutMs, 10000);
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /BEGIN TRANSACTION READ ONLY[\s\S]*SET LOCAL statement_timeout/);
  assert.match(server, /con\.contype <> 'n'/);
});

test('StackGres fleet identities and projections are provider-qualified', () => {
  assert.deepEqual(parsePostgresClusterId('stackgres:tenant-a:orders'), {
    id: 'stackgres:tenant-a:orders', provider: 'stackgres', namespace: 'tenant-a', name: 'orders',
  });
  throwsMessage(() => parsePostgresClusterId('tenant-a/orders'), /stackgres:namespace:name/);
  const projected = postgresClusterProjection({
    metadata: { name: 'orders', namespace: 'tenant-a', uid: 'u1' },
    spec: { instances: 2, postgres: { version: '18' }, pods: { persistentVolume: { size: '20Gi' } } },
    status: { binding: { name: 'orders-binding' }, conditions: [{ type: 'ClusterReady', status: 'True' }] },
  });
  assert.equal(projected.id, 'stackgres:tenant-a:orders');
  assert.equal(projected.mode, 'Dedicated');
  assert.equal(projected.ready, true);
});

test('PostgreSQL binding hosts and database URI stay namespace scoped', () => {
  assert.equal(postgresServiceHost('pgc-foundation-data-pg'), 'pgc-foundation-data-pg.opensphere-foundation.svc');
  assert.equal(postgresServiceHost(''), POSTGRES_ADMIN.service);
  const data = { uri: Buffer.from('postgresql://app:secret@pgc-orders/tenant%2Dorders?sslmode=require').toString('base64') };
  assert.equal(postgresBindingDatabase(data), 'tenant-orders');
});

test('Foundation retains PostgreSQL governed endpoints but no longer compiles its UI', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app/app.component.ts'), 'utf8');
  assert.match(server, /postgresFleetNamespaces/);
  assert.match(server, /postgresProfiles/);
  assert.match(server, /postgresBackupTargets/);
  assert.match(server, /foundation\.postgres\.external-backup-targets\/v1alpha1/);
  assert.doesNotMatch(server, /postgresBackupTargets[\s\S]{0,2500}(applicationKey|accessKeyId)/);
  assert.match(server, /postgresOperator/);
  assert.match(server, /postgres-namespace-create/);
  assert.match(server, /postgresAdminAction/);
  assert.doesNotMatch(app, /PostgresPluginComponent|app-postgres-plugin/);
  assert.doesNotMatch(app, /if \(id === 'postgres'\) return undefined/);
  assert.match(app, /<app-plugin-outlet \*ngIf="activePlugin\(\) as p"/);
  assert.match(app, /\['samba', 'postgres'\]\.includes\(id\)/);
});

test('StackGres profile catalog accepts only typed, safe native profile specs', () => {
  assert.deepEqual(postgresProfileKind('instance'), {
    kind: 'instance', apiVersion: 'stackgres.io/v1', apiKind: 'SGInstanceProfile', resource: 'sginstanceprofiles',
  });
  assert.deepEqual(postgresProfileKind('objectStorage'), {
    kind: 'objectStorage', apiVersion: 'stackgres.io/v1beta1', apiKind: 'SGObjectStorage', resource: 'sgobjectstorages',
  });
  assert.deepEqual(sanitizePostgresProfileSpec('instance', {
    cpu: '1', memory: '2Gi', requests: { cpu: '500m', memory: '1Gi' },
    containers: { postgres: { cpu: '1', memory: '2Gi' } },
  }), {
    cpu: '1', memory: '2Gi', requests: { cpu: '500m', memory: '1Gi' },
    containers: { postgres: { cpu: '1', memory: '2Gi' } },
  });
  assert.deepEqual(sanitizePostgresProfileSpec('postgres', {
    postgresVersion: '18', 'postgresql.conf': { max_connections: '200', wal_compression: 'on' },
  }), {
    postgresVersion: '18', 'postgresql.conf': { max_connections: '200', wal_compression: 'on' },
  });
  throwsMessage(() => sanitizePostgresProfileSpec('postgres', {
    postgresVersion: '18', 'postgresql.conf': { 'max_connections; DROP DATABASE postgres': '200' },
  }), /unsupported PostgreSQL parameter/);
  assert.deepEqual(sanitizePostgresProfileSpec('objectStorage', {
    type: 's3Compatible',
    s3Compatible: { bucket: 'postgres-backups', endpoint: 'https://minio.example.test', enablePathStyleAddressing: true,
      awsCredentials: { secretKeySelectors: { accessKeyId: { name: 'backup-credentials', key: 'accessKeyId' }, secretAccessKey: { name: 'backup-credentials', key: 'secretAccessKey' } } } },
  }), {
    type: 's3Compatible',
    s3Compatible: { bucket: 'postgres-backups', endpoint: 'https://minio.example.test', enablePathStyleAddressing: true,
      awsCredentials: { secretKeySelectors: { accessKeyId: { name: 'backup-credentials', key: 'accessKeyId' }, secretAccessKey: { name: 'backup-credentials', key: 'secretAccessKey' } } } },
  });
});

test('profile reference inventory keeps deletion protection namespace scoped', () => {
  const counts = profileReferenceCounts([
    { metadata: { namespace: 'team-a', name: 'orders' }, spec: { sgInstanceProfile: 'medium', configurations: { sgPostgresConfig: 'pg18', sgPoolingConfig: 'pool', backups: [{ sgObjectStorage: 'backups' }] } } },
    { metadata: { namespace: 'team-b', name: 'ledger' }, spec: { sgInstanceProfile: 'medium', configurations: { sgPostgresConfig: 'pg18' } } },
  ]);
  assert.deepEqual(counts.get('team-a/instance/medium'), ['orders']);
  assert.deepEqual(counts.get('team-b/instance/medium'), ['ledger']);
  assert.deepEqual(counts.get('team-a/pooling/pool'), ['orders']);
  assert.deepEqual(counts.get('team-a/objectStorage/backups'), ['orders']);
});

test('profile preview reports the precise fields that would affect consumers', () => {
  assert.deepEqual(profileSpecDiff(
    { cpu: '1', requests: { cpu: '500m', memory: '1Gi' } },
    { cpu: '2', requests: { cpu: '1', memory: '1Gi' } },
  ), [
    { path: 'cpu', before: '1', after: '2' },
    { path: 'requests.cpu', before: '500m', after: '1' },
  ]);
});

test('StackGres maintenance and backup requests are typed and cluster bound', () => {
  const restart = postgresOperationPlan({ cluster: 'stackgres:team-a:orders', operation: 'restart', onlyPendingRestart: true });
  assert.equal(restart.resource.kind, 'SGDbOps');
  assert.equal(restart.resource.spec.sgCluster, 'orders');
  assert.deepEqual(restart.resource.spec.restart, { onlyPendingRestart: true });
  const vacuum = postgresOperationPlan({ cluster: 'stackgres:team-a:orders', operation: 'vacuum', full: true, freeze: true });
  assert.deepEqual(vacuum.resource.spec.vacuum, { analyze: true, full: true, freeze: true });
  const backup = postgresBackupPlan({ cluster: 'stackgres:team-a:orders', name: 'orders-pre-upgrade' });
  assert.equal(backup.resource.kind, 'SGBackup');
  assert.equal(backup.resource.metadata.name, 'orders-pre-upgrade');
  throwsMessage(() => postgresOperationPlan({ cluster: 'stackgres:team-a:orders', operation: 'shell' }), /operation must be/);
});
