// operands-catalog.ts — 21 operand 제품급 카탈로그(패널/필드/관계/액션). 표현 메타(계약 CRD 불변).
// 값 출처: RL=real-live(status), RE=realm-export(배포 구성), SC=scrape(control-plane 스크레이프 필요), P('D-x')=정의만.
import { FieldSource, OperandCatalog, OperandField } from './operands';

const RL: FieldSource = 'real-live';
const RE: FieldSource = 'realm-export';
const SC: FieldSource = 'scrape';
const P = (s: string): FieldSource => ({ planned: s });
// field shorthand
const F = (label: string, source: FieldSource, x: Partial<OperandField> = {}): OperandField => ({ label, source, ...x });
const T = (text: string): OperandField => ({ label: '', source: 'realm-export', text });

export const CATALOGS: Record<string, Record<string, OperandCatalog>> = {
  // ═══════════ IDENTITY ═══════════
  identity: {
    keycloak: {
      type: 'idp',
      panels: [
        { title: '발급자 & Discovery', kpi: true, fields: [
          F('issuer', RL, { statusPath: 'issuerURL', liveToday: true, slo: 'status.issuerURL' }),
          F('jwks_uri', RL, { statusPath: 'jwksURL', liveToday: true }),
          F('keycloak image tag', RL, { observedId: '', statusPath: 'operator.version', liveToday: false, hint: '이미지 태그(operator.version)' }),
          F('jwks_key_count', SC, { unit: 'count', slo: '>=1', scrapeKey: 'jwks_key_count' }),
          F('authorization_endpoint', SC, { scrapeKey: 'authorization_endpoint' }),
          F('token_endpoint', SC, { scrapeKey: 'token_endpoint' }),
          F('userinfo_endpoint', SC, { scrapeKey: 'userinfo_endpoint' }),
          F('introspection_endpoint', SC, { scrapeKey: 'introspection_endpoint' }),
          F('end_session_endpoint', SC, { scrapeKey: 'end_session_endpoint' }),
          F('grant_types_supported', SC, { slo: 'authorization_code 포함', scrapeKey: 'grant_types_supported' }),
          F('response_types_supported', SC, { slo: 'code 포함', scrapeKey: 'response_types_supported' }),
          F('scopes_supported', SC, { slo: 'openid 포함', scrapeKey: 'scopes_supported' }),
          F('code_challenge_methods_supported', SC, { slo: 'S256(PKCE)', scrapeKey: 'pkce_methods' }),
          F('id_token_signing_alg_values', SC, { slo: 'RS256', scrapeKey: 'id_token_signing_alg' }),
          F('claims_supported', SC, { slo: 'sub,preferred_username,email,groups', scrapeKey: 'claims_supported' }),
        ], note: 'discovery/JWKS는 백엔드(control-plane) 스크레이프로 취득 — 브라우저 직접 아님(내부 DNS+CSP).' },
        { title: '서명 키 (JWKS)', fields: [
          F('active_signing_keys', SC, { unit: 'count', slo: '>=1', scrapeKey: 'jwks_key_count' }),
          F('key alg', SC, { slo: 'RS256', scrapeKey: 'jwks_alg' }),
          F('key use', SC, { slo: 'sig', scrapeKey: 'jwks_use' }),
          F('key_rotation_age', P('D-7'), { unit: 'h', slo: '<2160h 권고', hint: '회전 이력 미보관' }),
        ] },
        { title: 'Realm: opensphere-workforce', fields: [
          F('realm', RE, { realmKey: 'realm', liveToday: true }),
          F('enabled', RE, { realmKey: 'enabled', liveToday: true }),
          F('registrationAllowed', RE, { realmKey: 'registrationAllowed', slo: '=false (INV-2 JIT금지)', liveToday: true }),
          F('identityProviders', RE, { realmKey: 'identityProviders', slo: '=0 → first-broker-login 경로 구조적 부재', liveToday: true }),
          F('seeded users', RE, { realmKey: 'seededUsers', slo: '=0 (권위=Syncope D-7)', liveToday: true }),
          F('resetPasswordAllowed', RE, { realmKey: 'resetPasswordAllowed', liveToday: true }),
          F('loginWithEmailAllowed', RE, { realmKey: 'loginWithEmailAllowed', liveToday: true }),
          F('ssoSessionIdleTimeout', P('D-7'), { unit: 's', slo: 'def 1800' }),
          F('accessTokenLifespan', P('D-7'), { unit: 's', slo: 'def 300' }),
        ], note: '배포 구성 기준(realm-export ConfigMap 정본) — 라이브 admin 호출 없이 확정.' },
        { title: 'Clients', kind: 'table', fields: [
          F('clientId', RE), F('protocol', RE), F('public', RE), F('standardFlow', RE), F('directGrant', RE), F('serviceAcct', RE), F('PKCE', RE), F('redirectUris', RE), F('webOrigins', RE),
        ], tableRows: [[
          T('workforce-oidc'), T('openid-connect'), T('true'), T('on'), T('off'), T('off'), T('S256'),
          F('', RE, { realmKey: 'redirectUris', liveToday: true }), F('', RE, { realmKey: 'webOrigins', liveToday: true }),
        ]], note: 'D-7 실 소비자 온보딩 시 행 증가 → 그때 admin clients API 스크레이프.' },
        { title: '인증 흐름', fields: [
          F('first-broker-login', RE, { realmKey: 'identityProviders', slo: 'identityProviders=0 → 경로 부재', liveToday: true, text: 'DISABLED' }),
          F('direct grant', RE, { realmKey: 'clientDirectAccess', slo: '=off', liveToday: true }),
          F('browser flow', P('D-7')), F('required actions', P('D-7')), F('password policy', P('D-7')),
        ] },
        { title: '데이터스토어', fields: [
          F('datastore_engine', RE, { realmKey: 'datastore', slo: 'PostgreSQL(D-7) 전환 목표', liveToday: true }),
          F('mode', RE, { realmKey: 'mode', slo: 'start(prod) 목표', liveToday: true }),
          F('JDBC datasource', P('D-7'), { slo: 'Pg JDBC(D-2 Postgres 배포 후)' }),
        ], note: '현재 Keycloak는 개발모드(H2, start-dev) — Postgres 영속화는 D-2 배포+D-7 전환. 재시작 시 비-realm 상태 비영속.' },
        { title: '토큰/세션 · Health', kpi: true, fields: [
          F('keycloak_up', RL, { unit: 'bool', slo: '=1', observedId: 'keycloak_up', contract: true, liveToday: true }),
          F('oidc_login_success_ratio', RL, { unit: 'ratio', slo: '>=0.99', observedId: 'oidc_login_success_ratio', contract: true }),
          F('active_sessions', P('D-7'), { unit: 'count', hint: 'admin API' }),
          F('token_issuance_rate', P('D-7'), { unit: '/s', hint: 'metrics SPI' }),
          F('failed_logins_5m', P('D-7'), { unit: 'count', hint: 'events' }),
        ] },
        { title: '진단 · 정직', fields: [
          F('server.js realm', RL, { text: 'opensphere-admin (기본) ↔ 배포 realm=opensphere-workforce', slo: '환경별 불일치(은폐 금지)' }),
        ], note: 'foundation-shell server.js 기본 REALM=opensphere-admin이나 배포 realm=opensphere-workforce — 환경별 불일치. 정직 표기.' },
      ],
      consumes: [
        { ref: 'samba-ad', via: 'LDAP federation (389/636)', mode: 'planned', slice: 'D-7', external: true, contract: false },
        { ref: 'postgresql', via: 'JDBC datastore (5432)', mode: 'planned', slice: 'D-2', contract: false },
        { ref: 'syncope', via: 'admin REST (user/role propagation)', mode: 'planned', slice: 'D-7' },
        { ref: 'opentelemetry', via: 'OTLP', mode: 'planned', slice: 'D-7', contract: true },
        { ref: 'host', display: 'host (PVC/StorageClass)', via: 'StorageClass', mode: 'declared', external: true },
      ],
      provides: [
        { ref: 'foundation-shell-server', display: 'Shell server.js', via: 'JWKS RS256 verify', mode: 'live' },
        { ref: 'svc-*', via: 'OIDC', mode: 'declared', contract: true },
        { ref: 'opensphere-edge', via: 'OIDC authcode+PKCE', mode: 'declared', external: true, contract: true },
        { ref: 'console', via: 'OIDC', mode: 'declared', external: true },
        { ref: 'RHDH', via: 'OIDC', mode: 'declared', external: true },
        { ref: 'scim-gw', via: 'SCIM', mode: 'planned', slice: 'D-7' },
        { ref: 'svc-erp', via: 'SCIM via SCIM-GW', mode: 'planned', slice: 'D-7' },
      ],
      actions: [
        { label: 'OIDC Discovery 보기', kind: 'reveal', target: 'discovery', liveOnly: true },
        { label: 'JWKS 키 보기', kind: 'reveal', target: 'jwks', liveOnly: true },
        { label: 'realm-export 보기', kind: 'reveal', target: 'realm' },
        { label: 'issuer 복사', kind: 'copy', target: 'issuerURL' },
        { label: 'jwks_uri 복사', kind: 'copy', target: 'jwksURL' },
      ],
    },
    'samba-ad': {
      type: 'directory',
      panels: [
        { title: '디렉터리 상태', kpi: true, fields: [F('samba_ad_up', P('D-7'), { unit: 'bool', slo: '=1' }), F('domain', P('D-7'), { hint: 'NetBIOS/FQDN' }), F('functional_level', P('D-7'), { slo: '2016+' }), F('FSMO_roles_holder', P('D-7')), F('DC_replication_health', P('D-7'), { unit: 'bool' })] },
        { title: '디렉터리 인벤토리', fields: [F('user_objects', P('D-7'), { unit: 'count' }), F('group_objects', P('D-7'), { unit: 'count' }), F('OU_count', P('D-7'), { unit: 'count' }), F('disabled_accounts', P('D-7'), { unit: 'count' }), F('stale_accounts >90d', P('D-7'), { unit: 'count' })] },
        { title: 'LDAP 서비스', fields: [F('LDAPS_endpoint', P('D-7'), { slo: '636 TLS 권고' }), F('bind_RTT', P('D-7'), { unit: 'ms', slo: '<100' }), F('Kerberos_KDC_up', P('D-7'), { unit: 'bool', slo: '=1' }), F('TLS_cert_expiry', P('D-7'), { unit: 'days', slo: '>30' }), F('federation_target', P('D-7'), { slo: 'Azure AD/Entra 옵션' })] },
        { title: 'Keycloak LDAP federation', fields: [F('federation_provider_enabled', P('D-7'), { unit: 'bool', slo: '=1' }), F('edit_mode', P('D-7'), { slo: 'READ_ONLY(권위=Syncope)' }), F('sync_period', P('D-7'), { unit: 's' }), F('last_sync_lag', P('D-7'), { unit: 's', slo: '<60' }), F('users_mapped', P('D-7'), { unit: 'count' })] },
      ],
      consumes: [{ ref: 'kerberos-kdc/dns', via: 'Kerberos 88 / DNS 53', mode: 'declared', external: true }, { ref: 'azure-ad-entra', via: 'Graph/HTTPS (outbound federation)', mode: 'planned', slice: 'D-7', external: true }],
      provides: [{ ref: 'keycloak', via: 'LDAP User Federation 디렉터리 소스 (389/636)', mode: 'planned', slice: 'D-7' }, { ref: 'syncope', via: 'LDAP connector 관리리소스', mode: 'planned', slice: 'D-7' }],
    },
    syncope: {
      type: 'iga',
      panels: [
        { title: 'IGA 코어', kpi: true, fields: [F('syncope_core_up', P('D-7'), { unit: 'bool', slo: '=1' }), F('managed_users', P('D-7'), { unit: 'count', hint: '권위 원장' }), F('roles_realms', P('D-7'), { unit: 'count' }), F('JIT_provisioning', RL, { text: 'DISABLED', slo: '=DISABLED (INV-2)', liveToday: true })] },
        { title: '프로비저닝/리소스', fields: [F('connected_resources', P('D-7'), { unit: 'count' }), F('pending_tasks', P('D-7'), { unit: 'count' }), F('failed_propagations_24h', P('D-7'), { unit: 'count', slo: '=0' }), F('reconciliation_drift', P('D-7'), { unit: 'count', slo: '=0' }), F('last_full_recon', P('D-7'))] },
        { title: '거버넌스', fields: [F('access_requests_pending', P('D-7'), { unit: 'count' }), F('approval_workflows_active', P('D-7'), { unit: 'count' }), F('certification_campaigns', P('D-7'), { unit: 'count' }), F('SoD_violations', P('D-7'), { unit: 'count', slo: '=0' })] },
        { title: '감사·정책', fields: [F('audit_events', P('D-7'), { hint: 'stream' }), F('password_policy', P('D-7')), F('account_lifecycle_states', P('D-7'))] },
      ],
      consumes: [{ ref: 'samba-ad', via: 'LDAP connector', mode: 'planned', slice: 'D-7' }, { ref: 'postgresql', via: 'JDBC internal persistence (5432)', mode: 'planned', slice: 'D-7' }],
      provides: [{ ref: 'keycloak', via: 'admin REST (provisioning, JIT금지)', mode: 'planned', slice: 'D-7' }, { ref: 'scim-gw', via: 'SCIM/REST propagation', mode: 'planned', slice: 'D-7' }, { ref: 'svc-erp', via: 'propagation', mode: 'planned', slice: 'D-7' }],
    },
    opa: {
      type: 'policy',
      panels: [
        { title: '엔진', kpi: true, fields: [F('opa_up', P('D-7'), { unit: 'bool', slo: '=1' }), F('bundle_revision', P('D-7')), F('bundle_last_activation', P('D-7')), F('bundle_download_errors', P('D-7'), { unit: 'count', slo: '=0' })] },
        { title: '정책 인벤토리', fields: [F('loaded_policies', P('D-7'), { unit: 'count' }), F('rules_count', P('D-7'), { unit: 'count' }), F('data_documents', P('D-7'), { unit: 'count' })] },
        { title: '결정', fields: [F('decision_rate', P('D-7'), { unit: '/s' }), F('allow_deny_ratio', P('D-7'), { unit: 'ratio' }), F('decision_latency_p95', P('D-7'), { unit: 'ms', slo: '<10' }), F('decision_log_shipped', P('D-7'), { unit: 'bool', slo: '=1' })] },
        { title: '통합', fields: [F('integration_mode', P('D-7'), { slo: 'sidecar/ext_authz' }), F('input_schema', P('D-7'), { slo: 'subject/groups from OIDC' })] },
      ],
      consumes: [{ ref: 'keycloak', via: 'OIDC claims (subject/groups/roles) as decision input', mode: 'planned', slice: 'D-7' }, { ref: 'bundle-server', via: 'bundle download (git/OCI/RustFS)', mode: 'planned', slice: 'D-7', external: true }, { ref: 'opentelemetry', via: 'decision log OTLP', mode: 'planned', slice: 'D-7' }],
      provides: [{ ref: 'svc-*', via: 'authorization allow/deny (ext_authz/REST)', mode: 'planned', slice: 'D-7' }, { ref: 'opensphere-edge', via: 'authz', mode: 'planned', slice: 'D-7' }],
    },
    'scim-gw': {
      type: 'scim',
      panels: [
        { title: '게이트웨이', kpi: true, fields: [F('scim_gw_up', P('D-7'), { unit: 'bool', slo: '=1' }), F('SCIM_version', P('D-7'), { slo: '2.0' }), F('ServiceProviderConfig', P('D-7')), F('supported_resources', P('D-7'), { slo: 'Users,Groups' })] },
        { title: '동기화', fields: [F('scim_sync_lag_s', RL, { unit: 's', slo: '<60', observedId: 'scim_sync_lag_s', contract: true }), F('provisioned_users', P('D-7'), { unit: 'count' }), F('CUD_ops_24h', P('D-7'), { unit: 'count' }), F('failed_ops_24h', P('D-7'), { unit: 'count', slo: '=0' }), F('retry_queue_depth', P('D-7'), { unit: 'count' })] },
        { title: '타깃', fields: [F('target svc-erp', P('D-7')), F('target_RTT', P('D-7'), { unit: 'ms', slo: '<100' }), F('auth_status', P('D-7'), { unit: 'bool', slo: '=1' }), F('filter_PATCH_support', P('D-7'), { unit: 'bool' })] },
      ],
      consumes: [{ ref: 'syncope', via: 'REST/SCIM (provisioning source)', mode: 'planned', slice: 'D-7' }, { ref: 'keycloak', via: 'REST (alt source)', mode: 'planned', slice: 'D-7' }],
      provides: [{ ref: 'svc-erp', via: 'SCIM 2.0/HTTPS (provisioning, JIT아님)', mode: 'planned', slice: 'D-7', contract: true }, { ref: 'opentelemetry', via: 'OTLP (scim_sync_lag_s)', mode: 'planned', slice: 'D-7' }],
    },
  },

  // ═══════════ DATA (전부 D-2 — exporter로 수집할 정의) ═══════════
  data: {
    postgresql: {
      type: 'db',
      panels: [
        { title: '인스턴스', kpi: true, fields: [
          F('up', RL, { unit: 'bool', slo: '=1', observedId: 'pg_up', liveToday: true }),
          F('engine', RL, { text: 'CloudNativePG (CNPG)' }),
          F('PG version', RL, { observedId: 'pg_version', liveToday: true }),
          F('topology', RL, { slo: '설치옵션', observedId: 'pg_topology', liveToday: true }),
          F('phase', RL, { slo: 'healthy state', observedId: 'pg_phase', liveToday: true }),
          F('namespace', RL, { slo: '설치옵션', observedId: 'pg_namespace', liveToday: true }),
          F('instances', RL, { unit: 'count', observedId: 'pg_instances', liveToday: true }),
          F('ready_instances', RL, { unit: 'count', observedId: 'pg_ready_instances', liveToday: true }),
          F('storage', RL, { slo: '설치옵션', observedId: 'pg_storage', liveToday: true }),
          F('resources', RL, { slo: '설치옵션', observedId: 'pg_resources', liveToday: true }),
          F('tuning', RL, { slo: '설치옵션', observedId: 'pg_tuning', liveToday: true }),
          F('pooler', RL, { slo: '설치옵션', observedId: 'pg_pooler', liveToday: true }),
          F('superuser', RL, { unit: 'bool', slo: '설치옵션', observedId: 'pg_superuser', liveToday: true }),
          F('monitoring', RL, { unit: 'bool', slo: '설치옵션', observedId: 'pg_monitoring', liveToday: true }),
          F('extensions', RL, { slo: '설치옵션', observedId: 'pg_extensions', liveToday: true }),
          F('bind_ready_ratio', RL, { unit: 'ratio', slo: '>=0.99', observedId: 'bind_ready_ratio', contract: true, liveToday: true }),
          F('connection_rtt_ms', RL, { unit: 'ms', slo: '<50 (PgClaim 연결 시 측정)', observedId: 'connection_rtt_ms', contract: true, liveToday: true }),
        ] },
        { title: '스토리지', fields: [F('data_disk_total', P('D-2'), { unit: 'GiB' }), F('used', P('D-2'), { unit: 'GiB/%', slo: '<80% warn' }), F('free', P('D-2'), { unit: 'GiB', slo: '>10%' }), F('growth_rate', P('D-2'), { unit: 'GiB/day' }), F('WAL_disk', P('D-2'), { unit: 'GiB' }), F('temp_files', P('D-2'), { unit: 'MB/count' }), F('tablespace_sizes', P('D-2'), { unit: 'GiB' })] },
        { title: '메모리', fields: [F('shared_buffers', P('D-2'), { unit: 'MB', slo: '~25% RAM' }), F('effective_cache_size', P('D-2'), { unit: 'MB', slo: '~50-75%' }), F('work_mem', P('D-2'), { unit: 'MB' }), F('cache_hit_ratio', P('D-2'), { unit: 'ratio', slo: '>=0.99' }), F('RSS_container_mem', P('D-2'), { unit: 'MiB', slo: '<limit' }), F('OOM_risk', P('D-2'), { unit: 'bool', slo: '=0' })] },
        { title: '연결', kpi: true, fields: [F('max_connections', P('D-2'), { unit: 'count' }), F('active', P('D-2'), { unit: 'count' }), F('idle', P('D-2'), { unit: 'count' }), F('idle_in_transaction', P('D-2'), { unit: 'count', slo: '~0 (leak signal)' }), F('waiting_lock_io', P('D-2'), { unit: 'count', slo: '~0' }), F('utilization', P('D-2'), { unit: '%', slo: '<80' }), F('pgbouncer_state', P('D-2'), { slo: 'transaction mode' }), F('rejected_connections', P('D-2'), { unit: 'count', slo: '=0' })] },
        { title: '처리량', fields: [F('TPS', P('D-2'), { unit: 'tx/s' }), F('rollback_ratio', P('D-2'), { unit: 'ratio', slo: '<0.02' }), F('rows ins/upd/del', P('D-2'), { unit: 'rows/s' }), F('slow_query_top_n', P('D-2'), { unit: 'ms/calls', hint: 'pg_stat_statements' }), F('longest_active_query_age', P('D-2'), { unit: 's', slo: '<statement_timeout' })] },
        { title: '복제 · HA', fields: [F('replica_count', P('D-2'), { unit: 'count', slo: '>=1' }), F('replication_lag', P('D-2'), { unit: 'bytes/s', slo: '<few MB/<10s' }), F('slot_state', P('D-2'), { slo: 'active' }), F('sync_async', P('D-2'), { slo: 'sync standby' }), F('WAL_gen_rate', P('D-2'), { unit: 'MB/s' }), F('failover_history', P('D-7'))] },
        { title: '잠금 · Vacuum · Bloat', fields: [F('active_locks', P('D-2'), { unit: 'count' }), F('deadlocks', P('D-2'), { unit: 'count', slo: '0 trend' }), F('blocking_sessions', P('D-2'), { unit: 'count', slo: '=0' }), F('last_autovacuum', P('D-2'), { unit: 'age' }), F('table_bloat', P('D-2'), { unit: '%', slo: '<20%' }), F('XID_wraparound_margin', P('D-2'), { unit: 'xids', slo: '>safe' })] },
        { title: '백업 건전성', fields: [F('last_full_backup', P('D-2'), { unit: 'age', slo: '<24h' }), F('last_WAL_archive', P('D-2'), { unit: 'age', slo: '<5min' }), F('backup_size', P('D-2'), { unit: 'GiB' }), F('backup_success_ratio', P('D-6'), { unit: 'ratio', slo: '>=0.99', hint: 'backup 모델' }), F('RPO', P('D-6'), { unit: 's', slo: '<=5min' }), F('RTO', P('D-6'), { unit: 'min', slo: '<=30min' }), F('last_restore_test', P('D-6'), { unit: 'age', slo: '<30d' }), F('backup_target', P('D-6'), { slo: 'RustFS·MinIO S3 foundation-backups' })] },
        { title: '데이터베이스 목록', kind: 'table', fields: [F('name', RE), F('owner', RE), F('purpose', RE), F('size', RE), F('연결(active/idle)', RE), F('encoding', RE)], tableRows: [
          [T('keycloak'), T('kc_app'), T('Keycloak identity store (D-7 전환 후 — 현재 H2)'), F('', P('D-2'), { unit: 'MiB' }), F('', P('D-2')), T('UTF8')],
          [T('syncope'), T('syncope_app'), T('IGA master persistence (D-7)'), F('', P('D-2'), { unit: 'MiB' }), F('', P('D-2')), T('UTF8')],
          [T('langfuse'), T('langfuse_app'), T('LLM trace/eval store (D-4)'), F('', P('D-2'), { unit: 'MiB' }), F('', P('D-2')), T('UTF8')],
          [T('novu'), T('novu_app'), T('notification workflow/jobs (D-5)'), F('', P('D-2'), { unit: 'MiB' }), F('', P('D-2')), T('UTF8')],
          [T('stalwart'), T('stalwart_app'), T('mail metadata (D-5; blobs→S3)'), F('', P('D-2'), { unit: 'MiB' }), F('', P('D-2')), T('UTF8')],
          [T('svc-app-DBs'), T('via PgClaim'), T('tenant/business app data'), F('', P('D-2'), { unit: 'MiB' }), F('', P('D-2')), T('UTF8')],
        ], note: '목적 매핑은 선언 의도(배포 후 측정 D-2). Keycloak DB는 H2→Pg 전환(D-7) 전까지 미사용.' },
      ],
      consumes: [{ ref: 'rustfs-minio', via: 'S3 WAL/base backup', mode: 'planned', slice: 'D-6' }, { ref: 'host', via: 'StorageClass/CSI PVC', mode: 'declared', contract: true }, { ref: 'opentelemetry', via: 'OTLP/postgres_exporter (4317)', mode: 'declared', contract: true }, { ref: 'opensphere-crossplane', via: 'XRD/Composition (writePath)', mode: 'declared', contract: true }],
      provides: [{ ref: 'keycloak', via: 'JDBC datastore (현재 H2)', mode: 'planned', slice: 'D-2' }, { ref: 'svc-*', via: 'PgClaim→PgBinding (5432)', mode: 'declared', contract: true }, { ref: 'syncope', via: 'JDBC', mode: 'planned', slice: 'D-7' }, { ref: 'langfuse', via: 'JDBC trace/eval', mode: 'planned', slice: 'D-4' }, { ref: 'novu', via: 'JDBC workflow/jobs', mode: 'planned', slice: 'D-5' }, { ref: 'stalwart', via: 'JDBC mail metadata', mode: 'planned', slice: 'D-5' }],
      actions: [{ label: 'DSN/host:5432 복사', kind: 'copy', target: 'endpoint', liveOnly: true }, { label: 'pg_stat_statements Top-N', kind: 'reveal', target: 'config', liveOnly: true }, { label: '데이터베이스 목록 보기', kind: 'reveal', target: 'config' }],
    },
    mongodb: { type: 'docdb', panels: [
      { title: '인스턴스', kpi: true, fields: [F('up', P('D-2'), { unit: 'bool', slo: '=1' }), F('version', P('D-2')), F('storageEngine', P('D-2'), { slo: 'WiredTiger' }), F('uptime', P('D-2'), { unit: 's' })] },
      { title: '레플리카셋', fields: [F('members', P('D-2'), { unit: 'count' }), F('role', P('D-2')), F('oplog_window', P('D-2'), { unit: 'h', slo: '>24h' }), F('repl_lag', P('D-2'), { unit: 's', slo: '<10s' })] },
      { title: '샤딩', fields: [F('mongos', P('D-2'), { unit: 'count' }), F('shards', P('D-2'), { unit: 'count' }), F('balancer', P('D-2')), F('jumbo_chunks', P('D-2'), { unit: 'count', slo: '=0' })] },
      { title: '메모리', fields: [F('WT_cache', P('D-2'), { unit: '%', slo: '<80%' }), F('cache_hit', P('D-2'), { unit: 'ratio' }), F('tickets', P('D-2'), { slo: '>0' })] },
      { title: '연결', fields: [F('current', P('D-2'), { unit: 'count' }), F('available', P('D-2'), { unit: 'count' }), F('active', P('D-2'), { unit: 'count', slo: '<80%' })] },
      { title: '처리량', fields: [F('opcounters', P('D-2'), { unit: '/s' }), F('slow_ops', P('D-2')), F('scanned_vs_returned', P('D-2'))] },
      { title: '백업', fields: [F('PBM_last', P('D-6'), { unit: 'age', slo: '<24h' }), F('PITR_window', P('D-6')), F('restore_test', P('D-6')), F('target', P('D-6'), { slo: 'RustFS' })] },
    ], consumes: [{ ref: 'host', via: 'StorageClass/CSI', mode: 'declared' }, { ref: 'opentelemetry', via: 'OTLP/mongodb_exporter', mode: 'planned', slice: 'D-2' }, { ref: 'rustfs-minio', via: 'PBM S3', mode: 'planned', slice: 'D-6' }], provides: [{ ref: 'svc-*', via: 'mongodb:// (27017, data bind alt backend)', mode: 'declared' }] },
    redis: { type: 'cache', panels: [
      { title: '인스턴스', kpi: true, fields: [F('up', P('D-2'), { unit: 'bool', slo: '=1' }), F('version', P('D-2')), F('mode', P('D-2')), F('role', P('D-2'))] },
      { title: '메모리', fields: [F('used_memory', P('D-2'), { unit: 'MB' }), F('maxmemory', P('D-2'), { unit: 'MB' }), F('maxmemory-policy', P('D-2')), F('mem_fragmentation_ratio', P('D-2'), { slo: '1.0-1.5' })] },
      { title: '축출 · 만료', fields: [F('evicted_keys', P('D-2'), { slo: '>0 alert' }), F('expired_keys', P('D-2')), F('keyspace_hit_ratio', P('D-2'), { unit: 'ratio', slo: '>=0.9' })] },
      { title: '처리량', fields: [F('ops/s', P('D-2'), { unit: '/s' }), F('slowlog', P('D-2')), F('blocked_clients', P('D-2'), { slo: '=0' })] },
      { title: '키스페이스', kind: 'table', fields: [F('db', RE), F('keys', RE), F('avg_TTL', RE), F('purpose pattern', RE)], tableRows: [[T('db0'), F('', P('D-2')), F('', P('D-2')), T('session:* / cache:* / lock:* / queue:*')]] },
      { title: '영속성', fields: [F('RDB_last_save', P('D-2'), { unit: 'age' }), F('AOF_enabled', P('D-2'), { unit: 'bool' }), F('AOF_size', P('D-2'), { unit: 'MB' })] },
      { title: '연결', fields: [F('connected_clients', P('D-2'), { unit: 'count' }), F('maxclients', P('D-2'), { unit: 'count' }), F('rejected', P('D-2'), { slo: '=0' })] },
      { title: '백업', fields: [F('RDB→RustFS', P('D-6'), { slo: '캐시 재생성 가능 — RPO 정책 명시' }), F('last_age', P('D-6'), { unit: 'age' })] },
    ], consumes: [{ ref: 'host', via: 'PVC (AOF/RDB)', mode: 'declared' }, { ref: 'opentelemetry', via: 'OTLP/redis_exporter', mode: 'planned', slice: 'D-2' }, { ref: 'rustfs-minio', via: 'RDB snapshot S3', mode: 'planned', slice: 'D-6' }], provides: [{ ref: 'svc-*', via: 'CacheClaim redis:// (6379)', mode: 'declared', contract: true }, { ref: 'novu', via: 'BullMQ queue backend', mode: 'planned', slice: 'D-5' }, { ref: 'keycloak', via: 'Infinispan↔Redis session (optional)', mode: 'planned', slice: 'D-7' }] },
    'rustfs-minio': { type: 'objstore', panels: [
      { title: '인스턴스/클러스터', kpi: true, fields: [F('online', P('D-2'), { unit: 'bool', slo: '=1' }), F('version', P('D-2')), F('drives_online', P('D-2'), { slo: 'all online' }), F('erasure_set', P('D-2'), { slo: 'EC:4' }), F('heal_in_progress', P('D-2'), { unit: 'bool' })] },
      { title: '용량', fields: [F('raw_total', P('D-2'), { unit: 'TiB' }), F('used', P('D-2'), { unit: 'TiB' }), F('free', P('D-2'), { unit: 'TiB' }), F('util', P('D-2'), { unit: '%', slo: '<80%' }), F('growth', P('D-2'), { unit: 'GiB/day' })] },
      { title: '버킷', kind: 'table', fields: [F('name', RE), F('objects', RE), F('size', RE), F('purpose', RE), F('versioning', RE), F('object-lock', RE)], tableRows: [
        [T('foundation-backups'), F('', P('D-6')), F('', P('D-6'), { unit: 'GiB' }), T('백업 대상(D-6)'), T('on'), T('WORM')],
        [T('observability-chunks'), F('', P('D-2')), F('', P('D-2'), { unit: 'GiB' }), T('loki/tempo chunk(D-2)'), T('off'), T('off')],
        [T('svc-artifacts'), F('', P('D-2')), F('', P('D-2'), { unit: 'GiB' }), T('svc BucketClaim'), T('on'), T('off')],
      ] },
      { title: 'I/O', fields: [F('S3_req_rate', P('D-2'), { unit: 'req/s', hint: 'GET/PUT/LIST/DELETE' }), F('4xx_5xx', P('D-2'), { unit: '%', slo: '<1%' }), F('TTFB_p99', P('D-2'), { unit: 'ms' })] },
      { title: '데이터보호', fields: [F('bitrot_scan', P('D-2')), F('healing_objects', P('D-2'), { slo: '=0' }), F('last_scrub_age', P('D-2'), { unit: 'age' })] },
      { title: '보안', fields: [F('IAM_policies', P('D-2')), F('TLS', P('D-2'), { unit: 'bool' }), F('public_exposure', P('D-2'), { slo: '=0' }), F('KMS_SSE', P('D-2'))] },
    ], consumes: [{ ref: 'host', via: 'StorageClass/CSI (raw drives)', mode: 'declared' }, { ref: 'opentelemetry', via: 'OTLP/minio prometheus', mode: 'planned', slice: 'D-2' }, { ref: 'opensphere-crossplane', via: 'bucket/IAM provisioning', mode: 'declared' }], provides: [{ ref: 'backup', display: 'backup/.ptm', via: 'S3 PutObject foundation-backups', mode: 'planned', slice: 'D-6' }, { ref: 'svc-*', via: 'BucketClaim S3 artifacts', mode: 'declared', contract: true }, { ref: 'grafana-loki', via: 'log/trace chunk S3', mode: 'planned', slice: 'D-2' }] },
    opensearch: { type: 'index', panels: [
      { title: '클러스터 Health', kpi: true, fields: [F('status', P('D-2'), { slo: '=green' }), F('nodes', P('D-2'), { unit: 'count' }), F('unassigned_shards', P('D-2'), { unit: 'count', slo: '=0' })] },
      { title: '인덱스', kind: 'table', fields: [F('index', RE), F('docs', RE), F('store', RE), F('purpose', RE), F('health', RE)], tableRows: [
        [T('vector-embeddings'), F('', P('D-4')), F('', P('D-4'), { unit: 'GiB' }), T('foundation-ai IndexClaim 벡터(D-4)'), F('', P('D-4'))],
        [T('app-search'), F('', P('D-2')), F('', P('D-2'), { unit: 'GiB' }), T('svc-* 전문검색'), F('', P('D-2'))],
      ] },
      { title: '샤드', fields: [F('total', P('D-2'), { unit: 'count' }), F('shard_size', P('D-2'), { slo: '10-50GB' }), F('oversharding_warn', P('D-2'), { unit: 'bool' })] },
      { title: 'JVM/메모리', fields: [F('heap_used', P('D-2'), { unit: '%', slo: '<75%' }), F('GC', P('D-2')), F('disk_watermark', P('D-2'))] },
      { title: '쿼리', fields: [F('latency_p95', P('D-2'), { unit: 'ms' }), F('search_rate', P('D-2'), { unit: 'qps' }), F('cache_hit', P('D-2'), { unit: 'ratio' })] },
      { title: '벡터 k-NN', fields: [F('knn_indices', P('D-4'), { unit: 'count' }), F('HNSW_mem', P('D-4'), { unit: 'GiB' }), F('recall@k', P('D-4'), { unit: 'ratio' }), F('engine', P('D-4'), { slo: 'lucene/faiss' })] },
      { title: '백업', fields: [F('snapshot_repo', P('D-6'), { slo: 'S3=RustFS' }), F('last_age', P('D-6'), { unit: 'age', slo: '<24h' })] },
    ], consumes: [{ ref: 'host', via: 'StorageClass/CSI', mode: 'declared' }, { ref: 'opentelemetry', via: 'OTLP/prometheus-exporter', mode: 'planned', slice: 'D-2' }, { ref: 'rustfs-minio', via: 'snapshot repo S3', mode: 'planned', slice: 'D-6' }], provides: [{ ref: 'foundation-ai', via: 'IndexClaim vector/k-NN (9200)', mode: 'planned', slice: 'D-4', contract: true }, { ref: 'svc-*', via: 'IndexClaim full-text (9200)', mode: 'declared' }] },
  },

  // ═══════════ AI (전부 D-4) ═══════════
  ai: {
    litellm: { type: 'llm-router', panels: [
      { title: '개요', kpi: true, fields: [F('litellm_up', P('D-4'), { unit: 'bool', slo: '=1' }), F('mode', P('D-4'), { slo: 'proxy' }), F('registered_models', P('D-4'), { unit: 'count' }), F('llmroute_p95_ms', P('D-4'), { unit: 'ms', slo: '<2000', contract: true }), F('route_error_ratio', P('D-4'), { unit: 'ratio', slo: '<0.01', contract: true })] },
      { title: '모델 라우트 3-tier', kind: 'table', fields: [F('tier', RE), F('model_aliases', RE), F('provider', RE), F('strategy', RE), F('tier_p95', RE), F('cost', RE)], tableRows: [
        [T('fast'), T('haiku/gpt-4o-mini'), T('anthropic/openai'), T('latency'), F('', P('D-4'), { unit: 'ms', slo: '<800' }), F('', P('D-4'), { unit: '$/1K' })],
        [T('balanced'), T('sonnet/gpt-4o'), T('anthropic/azure'), T('least-busy'), F('', P('D-4'), { unit: 'ms', slo: '<2000' }), F('', P('D-4'), { unit: '$/1K' })],
        [T('frontier'), T('opus/o1'), T('anthropic/openai'), T('cost'), F('', P('D-4'), { unit: 'ms', slo: '<8000' }), F('', P('D-4'), { unit: '$/1K' })],
      ] },
      { title: '트래픽', fields: [F('RPM', P('D-4'), { unit: 'req/min' }), F('TPM in/out', P('D-4'), { unit: 'tok/min' }), F('in-flight', P('D-4'), { unit: 'count' }), F('streaming_ratio', P('D-4'), { unit: 'ratio' })] },
      { title: '지연', fields: [F('e2e_p50', P('D-4'), { unit: 'ms' }), F('e2e_p95', P('D-4'), { unit: 'ms', slo: '<2000', contract: true }), F('e2e_p99', P('D-4'), { unit: 'ms', slo: '<8000' }), F('TTFT', P('D-4'), { unit: 'ms', slo: '<800' })] },
      { title: '신뢰성', fields: [F('route_error_ratio', P('D-4'), { unit: 'ratio', slo: '<0.01', contract: true }), F('fallbacks success/fail', P('D-4')), F('retries', P('D-4')), F('rate_limit_429', P('D-4'), { unit: 'count' }), F('availability', P('D-4'), { unit: 'ratio', slo: '>=0.99' })] },
      { title: '비용', fields: [F('total_spend', P('D-4'), { unit: '$' }), F('by_model', P('D-4')), F('by_team', P('D-4')), F('tokens in/out', P('D-4')), F('monthly_runrate', P('D-4'), { unit: '$' })] },
      { title: '예산 · 키', kind: 'table', fields: [F('key_alias', RE), F('team/user', RE), F('allowed_models', RE), F('max_budget', RE), F('TPM/RPM_limit', RE)], tableRows: [[T('(D-4 발급)'), T('—'), T('tier별'), F('', P('D-4'), { unit: '$' }), F('', P('D-4'))]] },
      { title: '캐시', fields: [F('backend', P('D-4'), { slo: 'redis/s3' }), F('hit_ratio', P('D-4'), { unit: 'ratio', slo: '>0.3' }), F('saved_tokens_cost', P('D-4'), { unit: '$' })] },
    ], consumes: [{ ref: 'postgresql', via: 'PgClaim virtual key/budget (5432)', mode: 'planned', slice: 'D-2' }, { ref: 'redis', via: 'CacheClaim router/rate-limit (6379)', mode: 'planned', slice: 'D-2' }, { ref: 'opensearch', via: 'IndexClaim VectorRAG', mode: 'planned', slice: 'D-4', contract: true }, { ref: 'opentelemetry', via: 'OTLP (4317)', mode: 'planned', slice: 'D-4', contract: true }, { ref: 'openai/azure/anthropic/bedrock/vertex/vllm', via: 'OpenAI-compat REST (upstream)', mode: 'planned', slice: 'D-4', external: true }, { ref: 'keycloak', via: 'OIDC/JWT caller auth', mode: 'planned', slice: 'D-4' }],
      provides: [{ ref: 'opensphere-ai-orchestrator', via: 'LLMRoute /chat/completions', mode: 'planned', slice: 'D-4', contract: true }, { ref: 'opensphere-ai-eval', via: 'LLMRoute', mode: 'planned', slice: 'D-4', contract: true }, { ref: 'langfuse', via: 'callback/SDK trace push', mode: 'planned', slice: 'D-4' }, { ref: 'svc-*', via: 'LLMRoute', mode: 'planned', slice: 'D-4' }] },
    langfuse: { type: 'tracing', panels: [
      { title: '개요', kpi: true, fields: [F('langfuse_up', P('D-4'), { unit: 'bool', slo: '=1' }), F('projects', P('D-4'), { unit: 'count' }), F('ClickHouse_conn', P('D-4'), { unit: 'bool' }), F('Pg_conn', P('D-4'), { unit: 'bool' })] },
      { title: '추적', fields: [F('traces', P('D-4'), { unit: 'count' }), F('ingest_rate', P('D-4'), { unit: '/s' }), F('latency_p95', P('D-4'), { unit: 'ms' }), F('error_trace_ratio', P('D-4'), { unit: 'ratio', slo: '<0.01' }), F('tokens in/out', P('D-4')), F('cost_attribution', P('D-4'), { unit: '$' })] },
      { title: '평가 · 스코어', fields: [F('score_configs', P('D-4'), { unit: 'count' }), F('llm_judge_runs', P('D-4'), { unit: 'count' }), F('eval_pass_ratio', P('D-4'), { unit: 'ratio' }), F('regression_flag', P('D-4'), { slo: '=0' })] },
      { title: '프롬프트', kind: 'table', fields: [F('name', RE), F('versions', RE), F('active_label', RE), F('calls', RE), F('perf', RE)], tableRows: [[T('(D-4)'), F('', P('D-4')), T('prod/staging'), F('', P('D-4')), F('', P('D-4'))]] },
    ], consumes: [{ ref: 'postgresql', via: 'PgClaim meta (5432)', mode: 'planned', slice: 'D-4' }, { ref: 'clickhouse-olap', via: 'HTTP (OLAP, 근사)', mode: 'planned', slice: 'D-4', external: true }, { ref: 'litellm', via: 'callback/OTLP ingestion', mode: 'planned', slice: 'D-4' }, { ref: 'opentelemetry', via: 'OTLP (4318)', mode: 'planned', slice: 'D-4' }, { ref: 'keycloak', via: 'OIDC SSO', mode: 'planned', slice: 'D-4' }],
      provides: [{ ref: 'opensphere-ai-eval', via: 'API/SDK eval+dataset', mode: 'planned', slice: 'D-4' }, { ref: 'foundation-observability', via: 'OTLP/dashboard (ADR-084)', mode: 'planned', slice: 'D-4' }] },
  },

  // ═══════════ COMM (전부 D-5) ═══════════
  comm: {
    novu: { type: 'notify', panels: [
      { title: '개요', kpi: true, fields: [F('deploy_status', P('D-5'), { slo: '=Installed' }), F('components_up (API/Worker/WS)', P('D-5'), { unit: 'bool' }), F('notify_delivery_ratio', P('D-5'), { unit: 'ratio', slo: '>=0.99', contract: true }), F('triggers_24h', P('D-5'), { unit: 'count' }), F('active_workflows', P('D-5'), { unit: 'count' }), F('jobs_pending', P('D-5'), { unit: 'count' }), F('DLQ', P('D-5'), { unit: 'count', slo: '=0' })] },
      { title: '채널', kind: 'table', fields: [F('channel', RE), F('active', RE), F('delivery_ratio', RE), F('bounce/latency', RE), F('provider', RE)], tableRows: [
        [T('In-App'), F('', P('D-5')), F('', P('D-5'), { unit: 'ratio', slo: '>=0.99' }), F('', P('D-5')), T('native')],
        [T('Email'), F('', P('D-5')), F('', P('D-5'), { unit: 'ratio', slo: '>=0.99' }), F('', P('D-5')), T('Stalwart')],
        [T('SMS'), F('', P('D-5')), F('', P('D-5'), { unit: 'ratio' }), F('', P('D-5')), T('sms-gw')],
        [T('Push'), F('', P('D-5')), F('', P('D-5'), { unit: 'ratio' }), F('', P('D-5')), T('FCM/APNs')],
      ] },
      { title: '워크플로', kind: 'table', fields: [F('name', RE), F('trigger_id', RE), F('status', RE), F('steps', RE), F('success_ratio', RE)], tableRows: [[T('(D-5 정의)'), T('—'), T('active/draft'), F('', P('D-5')), F('', P('D-5'), { unit: 'ratio', slo: '>=0.99' })]] },
      { title: '구독자', fields: [F('total', P('D-5'), { unit: 'count' }), F('active_ratio', P('D-5'), { unit: 'ratio' }), F('source (SCIM?)', P('D-5'))] },
      { title: '큐 · 처리량 (Redis/BullMQ)', fields: [F('waiting/active/delayed', P('D-5'), { unit: 'count' }), F('failed', P('D-5'), { slo: '≈0' }), F('DLQ', P('D-5'), { slo: '=0' }), F('throughput', P('D-5'), { unit: 'jobs/s' })] },
      { title: '관측성', fields: [F('OTLP_exporter→OTel', P('D-5'), { unit: 'bool' }), F('unified_alarm_path', P('D-5'), { slo: 'observability→Novu' }), F('alarm_to_send_latency', P('D-5'), { unit: 'ms', slo: '<500' })] },
    ], consumes: [{ ref: 'postgresql', via: 'libpq (5432, meta)', mode: 'planned', slice: 'D-2' }, { ref: 'redis', via: 'RESP (6379, BullMQ)', mode: 'planned', slice: 'D-2' }, { ref: 'stalwart', via: 'SMTP/submission (587, Email)', mode: 'planned', slice: 'D-5' }, { ref: 'keycloak', via: 'OIDC admin SSO', mode: 'planned', slice: 'D-5' }, { ref: 'opentelemetry', via: 'OTLP (4317/4318)', mode: 'planned', slice: 'D-5', contract: true }, { ref: 'observability-alarms', via: 'Novu trigger API (통합알람 입력)', mode: 'planned', slice: 'D-5', contract: true }],
      provides: [{ ref: 'svc-*', via: 'Notify (NotificationChannelClaim)', mode: 'planned', slice: 'D-5', contract: true }, { ref: 'foundation-observability', via: 'Notify (통합알람→알림)', mode: 'planned', slice: 'D-5', contract: true }] },
    stalwart: { type: 'mail', panels: [
      { title: '개요', kpi: true, fields: [F('deploy_status', P('D-5')), F('SMTP (25/587/465)', P('D-5'), { unit: 'bool' }), F('IMAP (143/993)', P('D-5'), { unit: 'bool' }), F('JMAP (443)', P('D-5'), { unit: 'bool' }), F('mail_queue_depth', P('D-5'), { unit: 'count', slo: '<1000', contract: true }), F('active_domains', P('D-5'), { unit: 'count' })] },
      { title: '메일 큐', kind: 'table', fields: [F('msgID', RE), F('from/to', RE), F('status', RE), F('last_smtp_code', RE), F('retries', RE)], tableRows: [[T('(D-5)'), T('—'), T('queued/deferred/sent/bounced'), F('', P('D-5')), F('', P('D-5'))]] },
      { title: '도메인 · 인증', fields: [F('DKIM', P('D-5'), { slo: 'active, keybits>=2048' }), F('SPF', P('D-5'), { slo: 'pass' }), F('DMARC', P('D-5'), { slo: 'quarantine+, align>=0.95' }), F('MTA-STS/TLS-RPT', P('D-5'))] },
      { title: 'TLS · 보안', fields: [F('cert_expiry', P('D-5'), { unit: 'days', slo: '>14' }), F('TLS_version', P('D-5'), { slo: '1.3' }), F('STARTTLS_ratio', P('D-5'), { unit: 'ratio', slo: '>=0.95' }), F('ACME_status', P('D-5'), { slo: 'ok' })] },
      { title: '스팸 · AV', fields: [F('spam_detect', P('D-5')), F('quarantine_24h', P('D-5'), { unit: 'count' }), F('AV_signature_freshness', P('D-5')), F('virus_blocked', P('D-5'), { unit: 'count' })] },
      { title: '메일박스 · 스토리지', fields: [F('used/allocated', P('D-5'), { unit: 'GiB' }), F('mailboxes', P('D-5'), { unit: 'count' }), F('blob_store', P('D-5'), { slo: 'FS/S3' })] },
    ], consumes: [{ ref: 'metadata-store', via: 'RocksDB/외부 DB', mode: 'declared' }, { ref: 'rustfs-minio', via: 'S3 blob store', mode: 'planned', slice: 'D-2' }, { ref: 'keycloak', via: 'OIDC admin SSO', mode: 'planned', slice: 'D-5' }, { ref: 'opentelemetry', via: 'OTLP + prometheus scrape', mode: 'planned', slice: 'D-5', contract: true }, { ref: 'external-dns', via: 'MX/SPF/DKIM/DMARC (DNS)', mode: 'declared', external: true }, { ref: 'acme', via: "Let's Encrypt (ACME)", mode: 'declared', external: true }],
      provides: [{ ref: 'svc-mail', via: 'SMTP/IMAP/JMAP backbone', mode: 'planned', slice: 'D-5', contract: true }, { ref: 'novu', via: 'SMTP/submission 587 (Email send)', mode: 'planned', slice: 'D-5' }, { ref: 'external-mail', via: 'SMTP 25 (MX)', mode: 'declared', external: true }] },
  },

  // ═══════════ OBSERVABILITY (OTel LIVE; 나머지 D-2) ═══════════
  observability: {
    opentelemetry: {
      type: 'metrics',
      panels: [
        { title: 'Collector 상태', kpi: true, fields: [
          F('collector_up', RL, { unit: 'bool', slo: '=1', observedId: 'collector_up', contract: true, liveToday: true }),
          F('health_check', SC, { slo: 'Server available', scrapeKey: 'health' }),
          F('image tag', RL, { statusPath: 'operator.version', hint: '이미지 태그' }),
          F('uptime', SC, { unit: 's', scrapeKey: 'uptime' }),
          F('pod_restarts', P('D-2'), { unit: 'count', slo: '=0' }),
          F('last_reconcile', RL, { statusPath: 'observedAt', liveToday: true }),
        ] },
        { title: '프로세스 리소스', fields: [F('memory_rss', SC, { unit: 'bytes', slo: '<256Mi', scrapeKey: 'mem_rss' }), F('heap_alloc', SC, { unit: 'bytes', scrapeKey: 'heap_alloc' }), F('cpu_seconds', SC, { unit: 's', scrapeKey: 'cpu_seconds' }), F('goroutines', SC, { unit: 'count', scrapeKey: 'goroutines' }), F('mem req/limit', RL, { text: '96Mi / 256Mi' }), F('cpu req/limit', RL, { text: '20m / 500m' })] },
        { title: 'Receivers', kpi: true, fields: [F('otlp_ingest_rate', RL, { unit: 'spans/s', slo: '>0', observedId: 'otlp_ingest_rate', contract: true, liveToday: true }), F('accepted_spans', SC, { unit: 'spans', scrapeKey: 'accepted_spans' }), F('refused_spans', SC, { unit: 'spans', slo: '=0', scrapeKey: 'refused_spans' }), F('accepted_metric_points', SC, { scrapeKey: 'accepted_metrics' }), F('accepted_log_records', SC, { scrapeKey: 'accepted_logs' }), F('otlp_listen', RL, { text: 'gRPC:4317 / HTTP:4318' })] },
        { title: 'Processors', fields: [F('batch_send_size', SC, { unit: 'items', scrapeKey: 'batch_send_size' }), F('batch_timeout_trigger', SC, { unit: 'count', scrapeKey: 'batch_timeout' }), F('memory_limiter', RL, { text: 'limit 80% / spike 25% / check 5s' }), F('memory_drop', SC, { unit: 'count', slo: '=0', scrapeKey: 'mem_drop' })] },
        { title: 'Exporters', fields: [F('active_exporter', RL, { text: 'debug (basic)', liveToday: true }), F('sent_spans', SC, { scrapeKey: 'sent_spans' }), F('send_failed_spans', SC, { slo: '=0', scrapeKey: 'send_failed_spans' }), F('queue_size', SC, { unit: 'items', scrapeKey: 'queue_size' }), F('downstream_backend', P('D-2'), { slo: 'Tempo/Loki/Prometheus' })] },
        { title: 'Pipelines', fields: [F('traces', RL, { text: 'otlp→memlim,batch→debug', liveToday: true }), F('metrics', RL, { text: 'otlp→memlim,batch→debug', liveToday: true }), F('logs', RL, { text: 'otlp→memlim,batch→debug', liveToday: true })] },
        { title: '연결성', fields: [F('service_dns', RL, { text: 'foundation-observability-collector.<ns>.svc', liveToday: true }), F('OTLP_gRPC_RTT', SC, { unit: 'ms', slo: '<200', scrapeKey: 'rtt_4317' }), F('availability_slo', RL, { text: '0.999' }), F('networkpolicy_ingress', RL, { text: '4317/4318/8888/13133', liveToday: true })] },
      ],
      consumes: [{ ref: 'configmap', via: 'collector-config volumeMount', mode: 'live' }, { ref: 'jaeger-tempo', via: 'OTLP/gRPC (otlp/tempo exporter)', mode: 'planned', slice: 'D-2' }, { ref: 'grafana-loki', via: 'OTLP/loki', mode: 'planned', slice: 'D-2' }, { ref: 'prometheus', via: 'remote-write/prometheus exporter', mode: 'planned', slice: 'D-2' }, { ref: 'foundation-comm', display: 'novu', via: 'Novu (통합알람)', mode: 'planned', slice: 'D-5', contract: true }, { ref: 'host', via: 'Prometheus HostDelegate', mode: 'declared' }],
      provides: [{ ref: 'all-planes', via: 'OTLP (4317/4318)', mode: 'declared', contract: true }, { ref: 'control-plane-reconciler', display: 'control-plane', via: ':8888 scrape + :13133 + probeTCP', mode: 'live' }, { ref: 'foundation-data', via: 'OTLP', mode: 'declared', contract: true }, { ref: 'foundation-ai', via: 'OTLP', mode: 'planned', slice: 'D-4', contract: true }, { ref: 'opensphere-operator', via: 'SLO', mode: 'declared', contract: true }],
      actions: [{ label: ':8888/metrics raw 보기', kind: 'reveal', target: 'config', liveOnly: true }, { label: 'config.yaml 보기', kind: 'reveal', target: 'config', liveOnly: true }, { label: 'endpoint 복사', kind: 'copy', target: 'issuerURL' }],
    },
    prometheus: { type: 'metrics', panels: [
      { title: 'TSDB', kpi: true, fields: [F('head_series', P('D-2'), { unit: 'count' }), F('ingest_rate', P('D-2'), { unit: 'samples/s', slo: '>0' }), F('WAL_size', P('D-2'), { unit: 'GiB' }), F('retention', P('D-2'), { unit: 'd' }), F('compaction_failed', P('D-2'), { unit: 'count', slo: '=0' })] },
      { title: 'Scrape', fields: [F('target_up_ratio', P('D-2'), { unit: 'ratio', slo: '=1' }), F('active_down', P('D-2'), { unit: 'count', slo: '=0' }), F('ServiceMonitor_count', P('D-2'), { unit: 'count' })] },
      { title: '쿼리엔진', fields: [F('query_rate', P('D-2'), { unit: '/s' }), F('query_p99', P('D-2'), { unit: 'ms' }), F('rejected', P('D-2'), { slo: '=0' })] },
      { title: '규칙 · 알람', fields: [F('rule_groups', P('D-2'), { unit: 'count' }), F('eval_failures', P('D-2'), { slo: '=0' }), F('firing', P('D-2'), { unit: 'count' }), F('AM_send_failures', P('D-2'), { slo: '=0' })] },
    ], consumes: [{ ref: 'servicemonitor-targets', via: 'svc-*/foundation /metrics scrape', mode: 'planned', slice: 'D-2' }, { ref: 'opentelemetry', via: ':8888 scrape/remote-write', mode: 'planned', slice: 'D-2' }, { ref: 'host', via: 'StorageClass TSDB PVC', mode: 'planned', slice: 'D-2' }], provides: [{ ref: 'grafana-loki', via: 'PromQL datasource', mode: 'planned', slice: 'D-2' }, { ref: 'novu', via: 'Alertmanager→Novu', mode: 'planned', slice: 'D-2' }, { ref: 'opensphere-operator', via: 'SLO query', mode: 'planned', slice: 'D-2' }] },
    'grafana-loki': { type: 'logs', panels: [
      { title: 'Grafana', kpi: true, fields: [F('up', P('D-2'), { unit: 'bool', slo: '=1' }), F('datasources', P('D-2'), { slo: 'ok' }), F('dashboards', P('D-2'), { unit: 'count' }), F('OIDC_SSO', P('D-2'), { unit: 'bool', slo: '=1' })] },
      { title: 'Loki 수집', fields: [F('bytes_rate', P('D-2'), { slo: '>0' }), F('active_streams', P('D-2'), { unit: 'count' }), F('discarded_lines', P('D-2'), { slo: '=0' }), F('retention', P('D-2'), { unit: 'd' }), F('object_storage', P('D-2'), { slo: 'S3=RustFS' })] },
      { title: '로그 탐색 (LogQL)', fields: [F('label_cardinality', P('D-2'), { slo: '폭증 경보' }), F('query_p99', P('D-2'), { unit: 'ms' }), F('trace_id_correlation', P('D-2'), { unit: 'bool' })] },
    ], consumes: [{ ref: 'prometheus', via: 'PromQL datasource', mode: 'planned', slice: 'D-2' }, { ref: 'jaeger-tempo', via: 'trace datasource (trace-id)', mode: 'planned', slice: 'D-2' }, { ref: 'keycloak', via: 'OIDC generic_oauth SSO', mode: 'planned', slice: 'D-2' }, { ref: 'opentelemetry', via: 'OTLP/loki exporter', mode: 'planned', slice: 'D-2' }, { ref: 'rustfs-minio', via: 'S3 chunk store', mode: 'planned', slice: 'D-2' }], provides: [{ ref: 'sre-users', via: 'browser UI dashboards', mode: 'planned', slice: 'D-2', external: true }, { ref: 'novu', via: 'unified alerting notify', mode: 'planned', slice: 'D-2' }] },
    'jaeger-tempo': { type: 'tracing', panels: [
      { title: '수집/저장', kpi: true, fields: [F('span_received_rate', P('D-2'), { slo: '>0' }), F('span_refused', P('D-2'), { slo: '=0' }), F('active_traces', P('D-2'), { unit: 'count' }), F('storage_used', P('D-2'), { unit: 'GiB' }), F('retention', P('D-2'), { unit: 'd' })] },
      { title: '샘플링', fields: [F('policy', P('D-2'), { slo: 'head/tail' }), F('rate', P('D-2'), { unit: 'ratio' }), F('sampled_dropped', P('D-2'))] },
      { title: '조회/상관', fields: [F('query_p99', P('D-2'), { unit: 'ms' }), F('service_graph_nodes', P('D-2'), { unit: 'count' }), F('span_metrics_RED', P('D-2') ), F('loki_correlation', P('D-2'), { unit: 'bool' })] },
    ], note: '현재 collector exporter=debug → 트레이스 미저장; D-2 otlp/tempo 추가 시 라이브화.', consumes: [{ ref: 'opentelemetry', via: 'OTLP/gRPC (otlp/tempo span recv)', mode: 'planned', slice: 'D-2' }, { ref: 'rustfs-minio', via: 'S3 trace block', mode: 'planned', slice: 'D-2' }, { ref: 'prometheus', via: 'remote-write span-metrics', mode: 'planned', slice: 'D-2' }], provides: [{ ref: 'grafana-loki', via: 'trace datasource (waterfall/service graph)', mode: 'planned', slice: 'D-2' }] },
    langfuse: { type: 'tracing', panels: [
      { title: 'LLM 추적/관측', kpi: true, fields: [F('trace_rate', P('D-2'), { slo: '>0' }), F('observations', P('D-2'), { unit: 'count' }), F('ingest_queue_lag', P('D-2'), { unit: 's' }), F('ingest_failures', P('D-2'), { slo: '=0' })] },
      { title: '비용 · 토큰', fields: [F('tokens in/out', P('D-2')), F('est_cost', P('D-2'), { unit: 'USD' }), F('by_model', P('D-2')), F('llm_call_p95', P('D-2'), { unit: 'ms', hint: '↔llmroute_p95_ms' })] },
      { title: '품질 · 평가', fields: [F('scores', P('D-2')), F('datasets/experiments', P('D-2')), F('prompt_versions', P('D-2'))] },
      { title: '백엔드 의존', fields: [F('Pg_meta', P('D-2'), { unit: 'bool' }), F('object_store', P('D-2'), { unit: 'bool' }), F('OIDC', P('D-2'), { unit: 'bool', slo: '=1' })] },
    ], consumes: [{ ref: 'litellm', via: 'OTLP GenAI semconv/SDK', mode: 'planned', slice: 'D-4' }, { ref: 'opentelemetry', via: 'OTLP GenAI span', mode: 'planned', slice: 'D-2' }, { ref: 'postgresql', via: 'JDBC meta+trace', mode: 'planned', slice: 'D-2' }, { ref: 'rustfs-minio', via: 'S3 large events', mode: 'planned', slice: 'D-2' }, { ref: 'keycloak', via: 'OIDC SSO', mode: 'planned', slice: 'D-2' }], provides: [{ ref: 'opensphere-ai-eval', via: 'API/UI LLM quality+cost', mode: 'planned', slice: 'D-4' }, { ref: 'ops-ai-engineer', via: 'browser UI', mode: 'planned', slice: 'D-2', external: true }] },
  },

  // ═══════════ BACKUP (전부 D-6) ═══════════
  backup: {
    'rustfs-minio': { type: 'backup', panels: [
      { title: '백업 서비스 상태', kpi: true, fields: [F('backup_success_ratio', P('D-6'), { unit: 'ratio', slo: '>=0.99', contract: true }), F('last_restore_age_h', P('D-6'), { unit: 'h', slo: '<24', contract: true }), F('operator_phase', P('D-6'), { slo: '=Installed' }), F('active_policies', P('D-6'), { unit: 'count' }), F('running_runs', P('D-6'), { unit: 'count' }), F('last_result', P('D-6'), { slo: '=Succeeded' }), F('protected_scope', P('D-6'), { slo: 'n/6' })] },
      { title: 'BackupPolicy', kind: 'table', fields: [F('policy', RE), F('scope', RE), F('schedule', RE), F('mode', RE), F('retention_GFS', RE), F('next_run', RE)], tableRows: [[T('(D-6 정의)'), T('per Foundation model'), T('cron'), T('Full/Incr/Diff'), T('7/4/12'), F('', P('D-6'))]] },
      { title: 'BackupRun', kind: 'table', fields: [F('run_id', RE), F('start/end', RE), F('status', RE), F('duration', RE), F('size', RE), F('verify', RE)], tableRows: [[T('(D-6)'), F('', P('D-6')), T('Succeeded'), F('', P('D-6')), F('', P('D-6'), { unit: 'GiB' }), T('Verified')]] },
      { title: '복구 · DR', fields: [F('last_restore_age_h', P('D-6'), { unit: 'h', slo: '<24', contract: true }), F('last_restore_test', P('D-6'), { slo: '<=30d' }), F('measured_RTO', P('D-6'), { unit: 's' }), F('target_RTO', P('D-6'), { unit: 's' }), F('measured_RPO', P('D-6'), { unit: 's' }), F('restore_success', P('D-6'), { unit: 'ratio', slo: '>=0.99' })] },
      { title: '타깃 · 용량', fields: [F('primary_target', P('D-6'), { slo: 'RustFS/MinIO S3' }), F('BucketClaim_binding', P('D-6'), { slo: '=Connected' }), F('RTT', P('D-6'), { unit: 'ms', slo: '<1000 (connSLO)' }), F('used/total', P('D-6'), { unit: '%', slo: '<80%' }), F('offsite_replication', P('D-6'), { slo: '=Enabled (3-2-1)' }), F('object_lock_WORM', P('D-6'), { slo: '=Enabled' })] },
      { title: 'pre-upgrade 게이트 (INV-3)', fields: [F('gate_status', P('D-6'), { slo: '=Pass' }), F('gate_policy', P('D-6'), { unit: 'h', slo: '<24' }), F('uncovered_models', P('D-6'), { slo: '없음' }), F('override_history', P('D-6'))] },
      { title: '암호화 · 카탈로그', fields: [F('TLS', P('D-6'), { unit: 'bool', slo: '=Enabled' }), F('SSE_at_rest', P('D-6'), { slo: '!=none' }), F('key_rotation', P('D-6'), { unit: 'days' }), F('orphan_expired', P('D-6'), { slo: '=0' })] },
    ], consumes: [{ ref: 'rustfs-minio', display: 'data:RustFS·MinIO', via: 'BucketClaim→BucketBinding S3 (HTTPS)', mode: 'planned', slice: 'D-6', contract: true }, { ref: 'opentelemetry', via: 'OTLP (4317/4318)', mode: 'planned', slice: 'D-6', contract: true }, { ref: 'opensphere-crossplane', via: 'XRD/Composition (via data)', mode: 'declared' }, { ref: 'kms-age-sealed', via: 'KMS API/secret mount', mode: 'planned', slice: 'D-6' }],
      provides: [{ ref: 'opensphere-operator', via: 'PreUpgradeGate (Pass/Block, INV-3)', mode: 'planned', slice: 'D-6', contract: true }, { ref: 'operators', via: 'BackupPolicy (K8s API CR)', mode: 'planned', slice: 'D-6', contract: true }, { ref: 'identity/data/ai/comm/observability', via: 'BackupPolicy.scope (pre/post hook + S3 PUT)', mode: 'planned', slice: 'D-6' }],
      actions: [{ label: 'BackupPolicy 보기', kind: 'reveal', target: 'config' }, { label: 'BackupRun 이력 보기', kind: 'reveal', target: 'config' }, { label: '백업 지금 실행', kind: 'link', target: 'run', liveOnly: true }, { label: '복구 테스트 실행', kind: 'link', target: 'restore', liveOnly: true }] },
    ptm: { type: 'snapshot', panels: [
      { title: '.ptm 개요', kpi: true, fields: [F('consistency_groups', P('D-6'), { unit: 'count' }), F('last_snapshot', P('D-6'), { slo: 'RPO 내' }), F('last_consistency', P('D-6'), { slo: '=Consistent' }), F('included_models', P('D-6'), { slo: 'n/6' }), F('time_skew', P('D-6'), { unit: 'ms', slo: '<barrier' })] },
      { title: '일관성그룹', kind: 'table', fields: [F('group', RE), F('members', RE), F('barrier', RE), F('max_skew', RE), F('last_result', RE)], tableRows: [[T('(D-6 정의)'), T('model·operand'), T('quiesce/freeze/fence'), F('', P('D-6'), { unit: 'ms' }), T('All-consistent')]] },
      { title: '.ptm 매니페스트', kind: 'table', fields: [F('ptm_id', RE), F('point_in_time', RE), F('member_entries', RE), F('integrity', RE), F('format_version', RE)], tableRows: [[T('(D-6)'), F('', P('D-6')), T('model·capability·offset'), T('Valid'), T('v1')]] },
      { title: '동일시점 정합', fields: [F('member_timestamp_skew', P('D-6'), { unit: 'ms', slo: '<maxSkew' }), F('referential_integrity', P('D-6'), { slo: 'Keycloak↔Pg row =OK' }), F('barrier_applied', P('D-6'), { unit: 'bool', slo: '=true' }), F('missing_partial', P('D-6'), { slo: '=0' })] },
      { title: '멀티모델 복원', fields: [F('restore_order', P('D-6'), { slo: 'data→identity 등' }), F('measured_group_RTO', P('D-6'), { unit: 's' }), F('point_in_time_guarantee', P('D-6'), { unit: 'bool', slo: '=true' })] },
    ], consumes: [{ ref: 'rustfs-minio', display: 'backup-store', via: 'BackupPolicy/Run 위 동작 + S3 manifest', mode: 'planned', slice: 'D-6' }, { ref: 'identity/data/ai/comm/observability', via: '동일시점 barrier (quiesce/fsfreeze/fence)', mode: 'planned', slice: 'D-6' }, { ref: 'signing-key', via: '.ptm 매니페스트 서명', mode: 'planned', slice: 'D-6' }], provides: [{ ref: 'restore-workflow', via: '멀티모델 RestoreRun (의존순서)', mode: 'planned', slice: 'D-6' }, { ref: 'opensphere-operator', via: '동일시점 복구점 (DR/롤백)', mode: 'planned', slice: 'D-6' }] },
  },
};

export function catalogOf(model: string, operandId: string): OperandCatalog | undefined {
  return CATALOGS[model]?.[operandId];
}

