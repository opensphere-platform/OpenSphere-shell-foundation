const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  postgresReadOnlySql, postgresActionPlan, pgName, postgresServiceHost, POSTGRES_ADMIN,
  POSTGRES_DEFAULT_ID, parsePostgresClusterId, postgresClusterProjection, postgresBindingDatabase,
} = require('../server.js');

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

test('PostgreSQL admin defaults to the canonical StackGres target and bounded query execution', () => {
  assert.equal(POSTGRES_DEFAULT_ID, 'stackgres:opensphere-foundation:pgc-foundation-data-pg');
  assert.equal(POSTGRES_ADMIN.rowLimit, 500);
  assert.equal(POSTGRES_ADMIN.statementTimeoutMs, 10000);
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const poolOptions = server.match(/const pool = new Pool\(\{([\s\S]*?)\n    \}\);/)?.[1] || '';
  assert.doesNotMatch(poolOptions, /statement_timeout\s*:/,
    'PgBouncer must not receive statement_timeout as a startup parameter');
  assert.match(server, /BEGIN TRANSACTION READ ONLY[\s\S]*SET LOCAL statement_timeout/,
    'read-only queries must retain a transaction-local execution timeout');
});

test('PostgreSQL fleet accepts only provider-qualified cluster identities', () => {
  assert.deepEqual(parsePostgresClusterId('stackgres:tenant-a:orders'), {
    id: 'stackgres:tenant-a:orders', provider: 'stackgres', namespace: 'tenant-a', name: 'orders',
  });
  throwsMessage(() => parsePostgresClusterId('tenant-a/orders'), /stackgres:namespace:name/);
  throwsMessage(() => parsePostgresClusterId('stackgres:tenant_a:orders'), /stackgres:namespace:name/);
  throwsMessage(() => parsePostgresClusterId('other:tenant-a:orders'), /stackgres:namespace:name/);
});

test('StackGres fleet projection is dedicated and uses status binding', () => {
  const projected = postgresClusterProjection({
    metadata: { name: 'orders', namespace: 'tenant-a', uid: 'u1' },
    spec: { instances: 2, postgres: { version: '18' }, pods: { persistentVolume: { size: '20Gi' } } },
    status: { binding: { name: 'orders-binding' }, conditions: [{ type: 'ClusterReady', status: 'True' }] },
  });
  assert.equal(projected.id, 'stackgres:tenant-a:orders');
  assert.equal(projected.mode, 'Dedicated');
  assert.equal(projected.ready, true);
  assert.equal(projected.bindingSecret, 'orders-binding');
});

test('StackGres 1.19 native conditions project a ready dedicated cluster', () => {
  const projected = postgresClusterProjection({
    metadata: { name: 'orders', namespace: 'tenant-a', uid: 'u1' },
    spec: { instances: 1, postgres: { version: '18' } },
    status: {
      binding: { name: 'orders-binding' },
      conditions: [
        { type: 'Bootstrapped', status: 'True' },
        { type: 'ComponentsUpdated', status: 'True' },
        { type: 'Failed', status: 'False' },
      ],
    },
  });
  assert.equal(projected.ready, true);
  assert.equal(projected.phase, 'Ready');
});

test('PostgreSQL Secret short service hosts are qualified for the target namespace', () => {
  assert.equal(postgresServiceHost('pgc-foundation-data-pg'),
    'pgc-foundation-data-pg.opensphere-foundation.svc');
  assert.equal(postgresServiceHost('pgc-foundation-data-pg.opensphere-foundation.svc'),
    'pgc-foundation-data-pg.opensphere-foundation.svc');
  assert.equal(postgresServiceHost(''), POSTGRES_ADMIN.service);
  assert.equal(postgresServiceHost('10.96.154.32'), '10.96.154.32');
  assert.equal(postgresServiceHost('localhost'), 'localhost');
});

test('StackGres service binding resolves the application database from its URI', () => {
  const data = {
    uri: Buffer.from('postgresql://app:secret@pgc-orders/tenant%2Dorders?sslmode=require').toString('base64'),
  };
  assert.equal(postgresBindingDatabase(data), 'tenant-orders');
  throwsMessage(() => postgresBindingDatabase({}), /no database key or valid database URI/);
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
  assert.match(service, /selectedCluster/);
  assert.match(service, /cluster: this\.selectedCluster\(\)/);
});

test('PostgreSQL landing surface is namespace-first and exposes fleet as a secondary view', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/postgres-plugin.component.ts'), 'utf8');
  const overview = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/tabs/pg-overview.tab.ts'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../src/app/app.component.css'), 'utf8');
  const fleet = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/postgres-fleet.service.ts'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app/app.component.ts'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const rbac = fs.readFileSync(path.join(__dirname, '../deploy/postgres-fleet-console-rbac.yaml'), 'utf8');
  assert.match(component, /PFSS PostgreSQL Fleet/);
  assert.match(component, /PostgreSQL 운영 컨텍스트/);
  assert.match(component, /pluginHeaderContext class="pgp-header-context"/);
  assert.match(component, /<clr-select-container class="pgp-header-context-field">/);
  assert.match(component, /<select clrSelect name="postgresNamespace"/);
  assert.match(component, /aria-label="Namespace 선택"/);
  assert.match(component, /\[ngModel\]="selectedNamespace\(\)" \(ngModelChange\)="selectNamespace\(\$event\)"/);
  assert.match(component, /PostgreSQL 인스턴스/);
  assert.match(component, /aria-label="PostgreSQL 인스턴스 선택"/);
  assert.match(component, /namespaceClusters\(\)\.length > 1/);
  assert.match(component, /이 Namespace에는 PostgreSQL이 없습니다/);
  assert.match(component, /\*ngIf="!fleet\.busy\(\) && !selectedContextCluster\(\)"[\s\S]*PostgreSQL 설치/);
  assert.match(component, /Secondary view[\s\S]*PFSS PostgreSQL Fleet/);
  assert.match(component, /Objects & Query/);
  assert.doesNotMatch(component, /LegacyShared|CloudNativePG/);
  assert.match(component, /aria-label="Namespace 추가"[\s\S]*\(click\)="openNamespaceModal\(\)"[^>]*>추가<\/button>/);
  assert.match(component, /aria-label="PostgreSQL 컨텍스트 새로고침"/);
  assert.match(component, /\[icon\]="iRenew"/);
  assert.doesNotMatch(component, /pgp-context-bar/);
  assert.doesNotMatch(component, /Current context/i);
  assert.doesNotMatch(component, /<option value="__new__">/);
  assert.doesNotMatch(component, /PostgreSQL cluster 선택/);
  assert.match(component, /newNamespaceReason/);
  assert.doesNotMatch(component, /claimNamespaceChoice/);
  assert.match(component, /selectedNamespace = signal/);
  assert.match(component, /namespaceClusters = computed/);
  assert.match(component, /compactLifecycle\(cluster\.phase, cluster\.ready\)/);
  assert.match(component, /compactPostgresVersion\(cluster\?\.postgresVersion \|\| ''\)/);
  assert.doesNotMatch(overview, /<pg-metric/);
  assert.match(overview, /@Input\(\) part: 'monitoring' \| 'details'/);
  assert.match(css, /\.pgp-page-frame \.pfs-plugin-release dd \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(fleet, /provisioning\.opensphere\.io\/v1beta1/);
  assert.match(fleet, /PostgresClaim/);
  assert.match(fleet, /api\/foundation\/postgres\/namespaces/);
  assert.match(fleet, /provider: 'stackgres'/);
  assert.doesNotMatch(fleet, /cloudnative|LegacyShared/i);
  assert.match(server, /postgresFleetNamespaces/);
  assert.match(server, /postgres-namespace-create/);
  assert.match(server, /Namespace creation must use \/api\/foundation\/postgres\/namespaces/);
  assert.match(rbac, /resources: \[namespaces\][\s\S]*verbs: \[get, create\]/);
  assert.match(app, /if \(id === 'postgres'\) return undefined/);
});

test('PostgreSQL keeps the complete provider-neutral operations menu', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/postgres-plugin.component.ts'), 'utf8');
  const expectedTabs = [
    ['overview', 'Overview'],
    ['monitoring', 'Monitoring'],
    ['operator', 'Operator'],
    ['cluster', 'Cluster plan'],
    ['topology', 'Topology'],
    ['config', 'Configuration'],
    ['databases', 'Databases & Roles'],
    ['backups', 'Backups'],
    ['events', 'Events'],
    ['claims', 'Claims'],
    ['upgrade', 'Upgrade'],
    ['documentation', 'Documentation'],
  ];
  let cursor = -1;
  for (const [id, label] of expectedTabs) {
    const next = component.indexOf(`{ id: '${id}', label: '${label}'`, cursor + 1);
    assert.ok(next > cursor, `${label} should remain in the canonical menu order`);
    cursor = next;
  }
  assert.match(component, /tabs\.filter\(\(t\) => !t\.secondary\)/);
  assert.match(component, /\{ id: 'admin', label: 'Database Objects'.*secondary: true/);
  assert.doesNotMatch(component, /legacyOnly/);
  assert.match(component, /tab\(\) === 'monitoring'/);
  assert.match(component, /tab\(\) === 'operator' && selectedContextCluster\(\)/);
  assert.match(component, /tab\(\) === 'cluster' && selectedContextCluster\(\)/);
  assert.match(component, /<pg-topology \*ngIf="tab\(\) === 'topology' && hasSelectedCluster\(\)"/);
  assert.match(component, /<pg-config \*ngIf="tab\(\) === 'config' && hasSelectedCluster\(\)"/);
  assert.match(component, /<pg-backups \*ngIf="tab\(\) === 'backups' && hasSelectedCluster\(\)"/);
  assert.match(component, /<pg-events \*ngIf="tab\(\) === 'events' && hasSelectedCluster\(\)"/);
  assert.match(component, /<pg-claims \*ngIf="tab\(\) === 'claims' && hasSelectedCluster\(\)"/);
});

test('PostgreSQL restores the detailed Overview and Prometheus monitoring workspaces', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/postgres-plugin.component.ts'), 'utf8');
  const overview = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/tabs/pg-overview.tab.ts'), 'utf8');
  const monitoring = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/tabs/pg-monitoring.tab.ts'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/cnpg.service.ts'), 'utf8');
  for (const marker of ['pgp-steps', 'Package readiness', 'Cluster health', 'Operations policy', 'pgp-description', '<pg-overview']) assert.match(component, new RegExp(marker));
  for (const marker of ['LIVE MONITORING', 'Persistent volumes', 'writeService', 'readService', 'conditions']) assert.match(overview, new RegExp(marker));
  assert.match(overview, /@Input\(\) part: 'monitoring' \| 'details'/);
  assert.match(overview, /\*ngIf="part === 'monitoring'"/);
  assert.match(overview, /\*ngIf="part === 'details'"/);
  const monitoringPosition = component.indexOf('<pg-overview part="monitoring"');
  const dashboardPosition = component.indexOf('<section class="pgp-dashboard">');
  const detailsPosition = component.indexOf('<pg-overview part="details"');
  const descriptionPosition = component.indexOf('<section class="pgp-description">');
  assert.ok(monitoringPosition > -1 && monitoringPosition < dashboardPosition);
  assert.ok(dashboardPosition < detailsPosition && detailsPosition < descriptionPosition);
  for (const marker of ['OPERATIONS · PROMETHEUS', '활성 연결', 'WAL 생성량', '복제 지연', 'CPU 사용량', '메모리 사용량']) assert.match(monitoring, new RegExp(marker));
  assert.match(service, /selectTarget\(provider: 'stackgres'/);
  assert.doesNotMatch(service, /postgresql\.cnpg\.io|cnpg\.io\/cluster|cnpg_/);
  assert.match(service, /stackgres\.io\/cluster-name/);
  assert.match(service, /sgpgconfigs/);
  assert.match(service, /sginstanceprofiles/);
  assert.match(service, /targetGeneration/);
  assert.match(service, /generation !== this\.targetGeneration/);
});

test('PostgreSQL Claims use the authenticated host API path', () => {
  const list = fs.readFileSync(path.join(__dirname, '../src/app/modules/claims-list.component.ts'), 'utf8');
  const form = fs.readFileSync(path.join(__dirname, '../src/app/modules/new-claim-form.component.ts'), 'utf8');
  assert.match(list, /hostFetch\(`/);
  assert.match(form, /hostFetch\(`/);
  assert.doesNotMatch(list, /await fetch\(`/);
  assert.doesNotMatch(form, /await fetch\(`/);
});

test('PostgreSQL documentation follows the selected StackGres runtime and major version', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/app/modules/postgres/postgres-plugin.component.ts'), 'utf8');
  assert.match(component, /documentationVersion/);
  assert.match(component, /providerDocsUrl/);
  assert.match(component, /StackGres 공식 문서/);
  assert.match(component, /PostgreSQL \{\{documentationVersion\(\)\}\}/);
  assert.doesNotMatch(component, /PostgreSQL 19 한글 설치·운영 안내서/);
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
