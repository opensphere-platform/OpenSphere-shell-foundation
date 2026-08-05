const test = require('node:test');
const assert = require('node:assert/strict');

const { postgresReadOnlySql, postgresActionPlan, pgName, POSTGRES_ADMIN } = require('../server.js');

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
});

test('PostgreSQL admin contract pins one cluster and bounded query execution', () => {
  assert.equal(POSTGRES_ADMIN.cluster, 'foundation-data-pg');
  assert.equal(POSTGRES_ADMIN.secret, 'foundation-data-pg-app');
  assert.equal(POSTGRES_ADMIN.rowLimit, 500);
  assert.equal(POSTGRES_ADMIN.statementTimeoutMs, 10000);
});
