const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { postgresReadOnlySql, postgresActionPlan, pgName, postgresServiceHost, POSTGRES_ADMIN } = require('../server.js');

function throwsMessage(fn, pattern) {
  assert.throws(fn, (error) => pattern.test(String(error?.msg || error?.message || error)));
}

test('PostgreSQL admin accepts only supported identifiers', () => {
  assert.equal(pgName('app_data'), 'app_data');
  throwsMessage(() => pgName('public; DROP SCHEMA public'), /supported PostgreSQL identifier/);
  throwsMessage(() => pgName('quoted"name'), /supported PostgreSQL identifier/);
});

test('Query Tool is read-only by contract', () => {
  assert.equal(postgresReadOnlySql('SELECT 1'), 'SELECT 1');
  assert.equal(postgresReadOnlySql('EXPLAIN SELECT * FROM app'), 'EXPLAIN SELECT * FROM app');
  throwsMessage(() => postgresReadOnlySql('UPDATE app SET enabled = false'), /read-only/);
  throwsMessage(() => postgresReadOnlySql('DROP TABLE app'), /read-only/);
});

test('typed table plan quotes identifiers and allowlists column types/defaults', () => {
  const plan = postgresActionPlan({
    action: 'create-table', database: 'app', schema: 'public', name: 'audit_event',
    columns: [
      { name: 'id', type: 'bigserial', nullable: false, default: '' },
      { name: 'created_at', type: 'timestamp with time zone', nullable: false, default: 'now()' },
    ],
  });
  assert.equal(plan.target, 'table/public.audit_event');
  assert.equal(plan.sql, 'CREATE TABLE "public"."audit_event" ("id" bigserial NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now())');
  throwsMessage(() => postgresActionPlan({
    action: 'create-table', database: 'app', schema: 'public', name: 'unsafe',
    columns: [{ name: 'x', type: 'text); DROP TABLE users; --', nullable: true, default: '' }],
  }), /unsupported column type/);
});

test('drop plans are RESTRICT-only and index columns are identifier-checked', () => {
  assert.equal(postgresActionPlan({ action: 'drop-table', database: 'app', schema: 'public', name: 'old_data' }).sql,
    'DROP TABLE "public"."old_data" RESTRICT');
  assert.equal(postgresActionPlan({ action: 'drop-schema', database: 'app', schema: 'staging' }).sql,
    'DROP SCHEMA "staging" RESTRICT');
  throwsMessage(() => postgresActionPlan({
    action: 'create-index', database: 'app', schema: 'public', table: 'event', name: 'event_idx',
    indexColumns: ['created_at DESC'],
  }), /supported PostgreSQL identifier/);
  assert.equal(postgresActionPlan({ action: 'drop-view', database: 'app', schema: 'public', name: 'active_users' }).sql,
    'DROP VIEW "public"."active_users" RESTRICT');
  assert.equal(postgresActionPlan({ action: 'drop-sequence', database: 'app', schema: 'public', name: 'event_id_seq' }).sql,
    'DROP SEQUENCE "public"."event_id_seq" RESTRICT');
});

test('PostgreSQL admin contract pins one cluster and bounded query execution', () => {
  assert.equal(POSTGRES_ADMIN.cluster, 'foundation-data-pg');
  assert.equal(POSTGRES_ADMIN.secret, 'foundation-data-pg-app');
  assert.equal(POSTGRES_ADMIN.rowLimit, 500);
  assert.equal(POSTGRES_ADMIN.statementTimeoutMs, 10000);
});

test('PostgreSQL Secret short service hosts are qualified for the target namespace', () => {
  assert.equal(postgresServiceHost('foundation-data-pg-rw'),
    'foundation-data-pg-rw.opensphere-foundation.svc');
  assert.equal(postgresServiceHost('foundation-data-pg-rw.opensphere-foundation.svc'),
    'foundation-data-pg-rw.opensphere-foundation.svc');
  assert.equal(postgresServiceHost(''), POSTGRES_ADMIN.service);
  assert.equal(postgresServiceHost('10.96.154.32'), '10.96.154.32');
  assert.equal(postgresServiceHost('localhost'), 'localhost');
});

test('PostgreSQL administration surface separates Data View from Query Tool and exposes a collapsible explorer', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/admin/pg-admin.tab.ts'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/admin/pg-admin.service.ts'), 'utf8');
  for (const contract of ['Object Explorer', 'Dashboard', 'Properties', 'SQL', 'Statistics', 'Dependencies', 'Dependents', 'Data View', 'Query Tool', 'Data Output', 'Query History']) {
    assert.match(source, new RegExp(contract));
  }
  assert.match(source, /Servers[\s\S]*Databases[\s\S]*Schemas/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /groupKey\(db\.name,schema\.name,group\.label\)/);
  assert.match(source, /activeTab\(\)==='data'[\s\S]*activeTab\(\)==='query'/);
  assert.match(service, /dataResult = signal<PgQueryResult \| null>/);
  assert.match(service, /queryResult = signal<PgQueryResult \| null>/);
  assert.match(service, /async loadData\(object: PgAdminObject, limit = 100\)/);
  assert.doesNotMatch(source, /pga-lower/);
});

test('PostgreSQL Cluster plan offers an explicit compact two-instance profile', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/postgres-plugin.component.ts'), 'utf8');
  assert.match(source, /Compact HA · 2 instances/);
  assert.match(source, /profile === 'compact'/);
  assert.match(source, /profile, instances: 2/);
  assert.match(source, /Primary 1개와 Standby 1개/);
});

test('PostgreSQL 19 not-null constraint rows are not duplicated in generated table DDL', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /con\.contype <> 'n'/);
});
