// Foundation — server.js. SDK 표준 subShell 피처 컨테이너: 제네릭 /api/k8s/* 프록시 + WS exec + Angular 범용콘솔(www) + subShell ui-shell 서빙.
// 셸 nginx가 /api/plugins/foundation/<X> → 이 서버 /<X> 로 prefix strip 프록시.
//   /plugins/*  → 매니페스트/번들/서명
//   /app/*      → Angular dist(main.js, styles.css)
//   /api/nodes  → 노드 집계
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const COOKIE = 'osng_token'; // 브라우저 WS는 커스텀 헤더를 못 실음 → 신원 토큰을 HttpOnly 쿠키로 전달
// ⚠️ 'bearer' 쿠키는 Console Supabase access token이 아님 — 읽지 말 것.
//    신원 전달 정본 = Main Shell ctx.api.fetch가 주입한 Authorization Bearer.
function tokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function requestToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}
const PORT = process.env.PORT || 8080;
const PLUGINS = process.env.PLUGINS_DIR || '/app/plugins';
const WWW = process.env.WWW_DIR || '/app/www';
const VERSION = process.env.APP_VERSION || (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGINS, 'module-package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
})();
const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const APISERVER = 'https://kubernetes.default.svc';
const tok = () => fs.readFileSync(`${SA}/token`, 'utf8').trim();

// ── Supabase identity and Kubernetes write boundary ────────────────────────
// Foundation owns neither an IdP nor a parallel JWT verifier. The Console Backend
// evaluates the Supabase session and the canonical console.operator_role projection.
const CONSOLE_IDENTITY_URL = (process.env.CONSOLE_IDENTITY_URL
  || 'http://opensphere-console-backend.opensphere-console.svc.cluster.local:8080').replace(/\/$/, '');
// Kubernetes RBAC still uses platform group names. Only the evaluated Console roles
// below may be projected; a caller cannot inject arbitrary Impersonate-Group values.
const K8S_GROUP_BY_CONSOLE_ROLE = Object.freeze({
  'console-admins': 'opensphere-console-admins',
  'console-operators': 'opensphere-console-operators',
  'console-viewers': 'opensphere-console-viewers',
});
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FND_NS = process.env.FOUNDATION_NS || 'opensphere-foundation';
const CLUSTER_MANAGER_URL = process.env.CLUSTER_MANAGER_URL || 'http://cluster-manager.opensphere-console.svc.cluster.local:8080';
const SAMBA_BOOTSTRAP_SECRET = process.env.SAMBA_BOOTSTRAP_SECRET || 'foundation-identity-samba-creds';
const SAMBA_BOOTSTRAP_SECRET_KEY = 'domain-password';
function k8sGroups(groups) {
  return [...new Set((groups || []).map((role) => K8S_GROUP_BY_CONSOLE_ROLE[role]).filter(Boolean))];
}
function requireConsoleAdmin(actor) {
  if (!actor.groups.includes('console-admins')) throw { code: 403, msg: 'requires console-admins' };
  return actor;
}
async function verifySupabaseToken(rawToken, identityFetch = fetch) {
  if (!rawToken) throw { code: 401, msg: 'no bearer token' };
  let response;
  try {
    response = await identityFetch(`${CONSOLE_IDENTITY_URL}/api/identity/session`, {
      headers: { authorization: `Bearer ${rawToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw { code: 503, msg: 'Supabase identity authority unavailable' };
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw { code: response.status === 403 ? 403 : 401, msg: body.error || 'invalid Supabase session' };
  return {
    username: body.username || body.subject || 'unknown',
    subject: body.subject || '',
    groups: Array.isArray(body.groups) ? body.groups : [],
    provider: 'supabase',
  };
}
async function verifyToken(rawToken) {
  return verifySupabaseToken(rawToken);
}
const readBody = (req) => new Promise((resolve, reject) => {
  const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject);
});
const jsonRes = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const k8sJson = async (method, path, body, actor) => {
  const headers = new Headers({
    Authorization: `Bearer ${tok()}`,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  });
  if (actor) {
    headers.set('Impersonate-User', actor.username);
    for (const group of k8sGroups(actor.groups)) headers.append('Impersonate-Group', group);
  }
  const r = await fetch(`${APISERVER}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, json, text };
};

async function saveSambaBootstrapSecret(req, res) {
  let actor;
  try { actor = await verifyToken(requestToken(req)); }
  catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
  try { requireConsoleAdmin(actor); }
  catch (e) { return jsonRes(res, e.code || 403, { error: e.msg || 'forbidden' }); }
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return jsonRes(res, 400, { error: 'invalid json' }); }
  const password = String(body.password || '');
  if (password.length < 12) return jsonRes(res, 400, { error: 'bootstrap domain password must be at least 12 characters' });
  const obj = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: SAMBA_BOOTSTRAP_SECRET,
      namespace: FND_NS,
      labels: { 'opensphere.io/plugin': 'samba-ad', 'opensphere.io/managed-by': 'foundation' },
    },
    type: 'Opaque',
    stringData: { [SAMBA_BOOTSTRAP_SECRET_KEY]: password },
  };
  const path = `/api/v1/namespaces/${FND_NS}/secrets`;
  let r = await k8sJson('POST', path, obj, actor);
  if (r.status === 409) {
    r = await k8sJson('PATCH', `${path}/${SAMBA_BOOTSTRAP_SECRET}`, {
      metadata: { labels: obj.metadata.labels },
      stringData: obj.stringData,
    }, actor);
  }
  console.log(`[audit] user=${actor.username} action=samba-bootstrap-secret-upsert target=${FND_NS}/${SAMBA_BOOTSTRAP_SECRET} status=${r.status} ${new Date().toISOString()}`);
  if (!r.ok) return jsonRes(res, r.status, { error: r.json?.message || r.json?.error || `kubernetes HTTP ${r.status}` });
  return jsonRes(res, 200, { ok: true, secretRef: { namespace: FND_NS, name: SAMBA_BOOTSTRAP_SECRET, key: SAMBA_BOOTSTRAP_SECRET_KEY } });
}

// HIS의 운영·판정 소유자는 Cluster Manager다. Foundation은 자신의 승인된 API base 안에서
// 이 read-only projection만 제공하고, 브라우저가 다른 subShell API를 직접 호출하지 않게 한다.
// 신원 토큰은 Main Shell hostFetch → Foundation → Cluster Manager로 전달되며 최종 검증은
// HIS 정본 API가 수행한다. 쓰기·임의 경로·무인증 SA 폴백은 허용하지 않는다.
async function hisStatusProxy(req, res) {
  if (req.method !== 'GET') return jsonRes(res, 405, { error: 'read-only proxy' });
  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/i.test(authorization)) return jsonRes(res, 401, { error: 'authorization required' });
  try {
    const r = await fetch(`${CLUSTER_MANAGER_URL.replace(/\/$/, '')}/api/his/status`, {
      headers: { authorization, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    });
    res.end(text);
  } catch (e) {
    jsonRes(res, 502, { error: `Cluster Manager HIS status unavailable: ${String(e && (e.message || e))}` });
  }
}

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.ico': 'image/x-icon',
};

async function nodes() {
  const r = await fetch(`${APISERVER}/api/v1/nodes`, { headers: { Authorization: `Bearer ${tok()}` } });
  if (!r.ok) throw new Error(`nodes HTTP ${r.status}`);
  const items = (await r.json()).items || [];
  return items.map((n) => {
    const cond = (n.status?.conditions || []).find((c) => c.type === 'Ready');
    const roles = Object.keys(n.metadata?.labels || {})
      .filter((k) => k.startsWith('node-role.kubernetes.io/'))
      .map((k) => k.split('/')[1]).filter(Boolean);
    const addr = (n.status?.addresses || []).find((a) => a.type === 'InternalIP');
    const ni = n.status?.nodeInfo || {};
    return {
      name: n.metadata?.name, ready: cond?.status === 'True',
      roles: roles.length ? roles : ['<none>'], version: ni.kubeletVersion || '',
      os: ni.osImage || '', arch: ni.architecture || '',
      cpu: n.status?.capacity?.cpu || '', memory: n.status?.capacity?.memory || '',
      internalIP: addr?.address || '', created: n.metadata?.creationTimestamp || '',
      schedulable: !n.spec?.unschedulable,
    };
  });
}

// ── 콘솔 통합 알림 연동 (ADR-UI-003 P1 발행 백본) ──
// foundation 백엔드 → 콘솔 audit bus(/api/admin/events) → 셸 단일 인박스.
// 시작/노드 경고를 콘솔 인박스에 발행 = subShell이 콘솔 알림 core와 '유기적' 작동.
// best-effort: 발행 실패해도 foundation 본 기능엔 영향 없음. (manifest 권한 불요 — 백엔드 in-cluster 호출)
// 발행 입구는 projected ServiceAccount token을 Controller가 TokenReview하여 source와 대조한다.
const CONTROLLER = process.env.OSP_CONTROLLER || 'http://opensphere-console-dupa-controller.opensphere-console.svc.cluster.local:8080';
let _notifyWarned = false;
function warnNotifyOnce(msg) {
  if (_notifyWarned) return;
  _notifyWarned = true;
  console.warn(`[notify] 콘솔 이벤트 발행 실패 — ${msg} (ServiceAccount TokenReview 배선 확인; 이후 동일 경고 억제)`);
}
async function publishNotify(ev) {
  let workloadToken = '';
  try { workloadToken = tok(); } catch { /* handled by response path */ }
  if (!workloadToken) return warnNotifyOnce('ServiceAccount token 없음');
  try {
    const res = await fetch(`${CONTROLLER}/api/admin/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-opensphere-source': 'foundation',
        authorization: `Bearer ${workloadToken}`,
      },
      body: JSON.stringify({ source: 'foundation', ...ev }),
    });
    if (!res.ok) warnNotifyOnce(`http=${res.status}`);
  } catch (e) { warnNotifyOnce(String((e && (e.code || e.message)) || e)); }
}
const _notifiedNodes = new Set();
async function nodeHealthPublish() {
  try {
    for (const n of await nodes()) {
      if (!n.ready && !_notifiedNodes.has(n.name)) {
        _notifiedNodes.add(n.name);
        await publishNotify({ action: 'NodeNotReady', target: `Node/${n.name}`, result: 'warning', reason: `노드 ${n.name} NotReady (foundation 감지)` });
      } else if (n.ready) {
        _notifiedNodes.delete(n.name); // 복구 시 재경고 허용
      }
    }
  } catch (e) { /* best-effort */ }
}

// ── FoundationModel 수명주기 전이 → 콘솔 인박스 (메시지 통합, 2026-07-06) ──
// plugin(엔진) 설치/회수/Ready 전이를 콘솔 audit bus에 발행 — Samba-AD 등 내부 plugin이
// "설치되면서 메시지 통합에 등록"되는 배선. 전이 시에만 발행(dedup — 폴링 스팸 금지, 위조 0: 실측 status만).
const _fmLast = new Map(); // model → { phase, engines: 'samba=1,keycloak=0' }
async function fmTransitionPublish() {
  try {
    const r = await fetch(`${APISERVER}/apis/foundation.opensphere.io/v1alpha1/foundationmodels`, { headers: { Authorization: `Bearer ${tok()}` } });
    if (!r.ok) return;
    for (const fm of (await r.json()).items || []) {
      const name = fm.metadata?.name || '';
      const phase = fm.status?.phase || '';
      const engines = (fm.status?.observed || [])
        .filter((o) => typeof o?.id === 'string' && o.id.endsWith('_up'))
        .map((o) => `${o.id.replace(/_up$/, '')}=${o.value}`)
        .sort().join(',');
      const cur = `${phase}|${engines}`;
      const prev = _fmLast.get(name);
      _fmLast.set(name, cur);
      if (prev === undefined || prev === cur || !phase) continue; // 첫 관측은 기준선만(재기동 스팸 방지)
      const sev = phase === 'Installed' ? 'info' : (phase === 'Failed' || phase === 'Blocked') ? 'error' : 'warning';
      await publishNotify({
        action: 'ModelTransition', target: `FoundationModel/${name}`, result: sev,
        reason: `${name} 모델 ${phase}${engines ? ` (${engines})` : ''}`,
      });
    }
  } catch (e) { /* best-effort */ }
}

function serveFrom(root, rel, res) {
  const fp = path.join(root, path.normalize('/' + rel).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const mime = MIME[path.extname(fp)] || 'application/octet-stream';
    // PoC: 재배포 시 셸 브라우저가 구 번들을 캐시해 변경이 안 보이는 문제 회피
    fs.createReadStream(fp).once('open', () => res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' })).pipe(res);
  });
}

// 제네릭 K8s API 프록시: /api/k8s/<표준 K8s 경로> → APISERVER.
// 모든 요청은 Supabase session을 먼저 검증한다. 읽기는 제한된 ServiceAccount 권한으로,
// 쓰기는 평가된 Console role을 제한된 Kubernetes group으로 매핑해 Impersonate-User로 수행한다.
// secrets 전면 차단, 쓰기는 감사 로그를 남긴다.
async function k8sProxy(req, res, rawUrl) {
  // 보안: 원시 경로 정규식 매칭은 URL 인코딩(sec%72ets)으로 우회됨 → 디코드 후 세그먼트 정확 매칭.
  const qIdx = rawUrl.indexOf('?');
  const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx) : ''; // 쿼리는 원형 유지(labelSelector 등)
  let pathOnly;
  try { pathOnly = decodeURIComponent(rawUrl.slice('/api/k8s'.length).split('?')[0]); }
  catch { return jsonRes(res, 400, { error: 'bad path encoding' }); }
  if (!/^\/(api|apis)\//.test(pathOnly)) return jsonRes(res, 400, { error: 'only /api or /apis paths allowed' });
  const segs = pathOnly.split('/').filter(Boolean);
  // 이중 인코딩 거부(%xx가 디코드 후에도 남아있으면 차단)
  if (segs.some((s) => s.includes('%'))) return jsonRes(res, 400, { error: 'encoded path segments not allowed' });
  // 시크릿: 어느 세그먼트든 'secrets'면 차단(denylist)
  if (segs.includes('secrets')) return jsonRes(res, 403, { error: 'secrets are blocked by policy' });
  // 고위험 서브리소스(마지막 세그먼트) 차단: exec/attach/portforward/proxy, serviceaccounts/*/token
  const last = segs[segs.length - 1];
  if (['exec', 'attach', 'portforward', 'proxy'].includes(last)) return jsonRes(res, 403, { error: 'subresource blocked by policy' });
  if (segs.includes('serviceaccounts') && last === 'token') return jsonRes(res, 403, { error: 'token subresource blocked by policy' });

  const isWrite = WRITE_METHODS.has(req.method);
  const idToken = requestToken(req); // Main Shell host-mediated fetch가 주입한 Supabase access token
  // 헤더는 새로 구성 — 클라이언트의 Impersonate-*/Authorization은 절대 전달하지 않음(위조 차단)
  const headers = { Authorization: `Bearer ${tok()}`, Accept: 'application/json' };
  let actor;
  try { actor = await verifyToken(idToken); }
  catch (e) {
    const status = (typeof e.code === 'number') ? e.code : 502;
    return jsonRes(res, status, { error: e.msg || e.message || 'unauthorized' });
  }

  if (isWrite) {
    headers['Impersonate-User'] = actor.username;
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = ct;
  }

  const body = isWrite ? await readBody(req) : undefined;
  // 업스트림은 검증된 디코드 경로 + 원형 쿼리로 재구성(원시 sub 그대로 전달 금지)
  // 쓰기에 한해 검증된 Console role을 고정된 Kubernetes group으로만 임퍼소네이션한다.
  const fetchHeaders = new Headers(headers);
  const sentGroups = [];
  if (isWrite && actor) {
    for (const g of k8sGroups(actor.groups)) {
      fetchHeaders.append('Impersonate-Group', g);
      sentGroups.push(g);
    }
  }
  const r = await fetch(`${APISERVER}${pathOnly}${rawQuery}`, { method: req.method, headers: fetchHeaders, body });
  const text = await r.text();
  if (isWrite) console.log(`[audit] user=${actor && actor.username} groups=[${sentGroups.join(',')}] verb=${req.method} path=${pathOnly} status=${r.status} ${new Date().toISOString()}`);
  if (isWrite && r.status >= 400) { console.log(`[audit-body] status=${r.status} sentGroupHdr=${JSON.stringify(fetchHeaders.get('Impersonate-Group'))} body=${text.slice(0, 400)}`); }
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

// ── Foundation 모듈: OpenSearch 읽기 프록시 ──
// /api/opensearch/<진단경로> → opensphere-search.opensphere-foundation.svc:9200 (dev, security 비활성, 읽기 전용).
async function opensearchProxy(req, res, rawUrl) {
  const OS = process.env.OPENSEARCH_URL || 'http://opensphere-search.opensphere-foundation.svc:9200';
  if (req.method !== 'GET' && req.method !== 'HEAD') return jsonRes(res, 405, { error: 'read-only proxy' });
  let path;
  try { path = decodeURIComponent(rawUrl.slice('/api/opensearch'.length).split('?')[0]); }
  catch { return jsonRes(res, 400, { error: 'bad path' }); }
  // 화이트리스트: 진단/조회 경로만(_cluster·_cat·_nodes·_stats·_aliases·루트). 쓰기·임의 인덱스 조작 차단.
  const okPath = path === '' || path === '/' || /^\/_(cluster|cat|nodes|stats|aliases)/.test(path);
  if (!okPath) return jsonRes(res, 403, { error: 'only diagnostic GET paths allowed' });
  const qIdx = rawUrl.indexOf('?');
  const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  try {
    const r = await fetch(`${OS}${path || '/'}${rawQuery}`, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(text);
  } catch (e) { jsonRes(res, 502, { error: 'opensearch unreachable: ' + String(e) }); }
}

// ── Foundation 모듈: Prometheus(kube-prometheus-stack) 읽기 프록시 ──
// /api/prometheus/<질의경로> → kube-prometheus-stack Prometheus (읽기 전용, query/query_range/targets만 허용).
async function prometheusProxy(req, res, rawUrl) {
  const PROM = process.env.PROMETHEUS_URL || 'http://kube-prometheus-stack-prometheus.monitoring.svc:9090';
  if (req.method !== 'GET' && req.method !== 'HEAD') return jsonRes(res, 405, { error: 'read-only proxy' });
  let path;
  try { path = decodeURIComponent(rawUrl.slice('/api/prometheus'.length).split('?')[0]); }
  catch { return jsonRes(res, 400, { error: 'bad path' }); }
  // 화이트리스트: 즉석 질의/타깃 상태만(관리 API·설정 리로드 등 차단).
  const okPath = /^\/api\/v1\/(query|query_range|targets)$/.test(path);
  if (!okPath) return jsonRes(res, 403, { error: 'only query/query_range/targets allowed' });
  const qIdx = rawUrl.indexOf('?');
  const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  try {
    const r = await fetch(`${PROM}${path}${rawQuery}`, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(text);
  } catch (e) { jsonRes(res, 502, { error: 'prometheus unreachable: ' + String(e) }); }
}

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (p === '/api/session') {
      // WS(exec/터미널)용 신원 쿠키 발급 — 토큰 JWKS 검증 후 HttpOnly 쿠키로(브라우저 WS가 보낼 수 있게)
      let actor;
      try { actor = await verifyToken(requestToken(req)); }
      catch (e) { return jsonRes(res, e.code || 401, { error: e.msg || 'unauthorized' }); }
      const secure = req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : '';
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': `${COOKIE}=${encodeURIComponent(requestToken(req))}; HttpOnly; SameSite=Strict; Path=/api/plugins/foundation;${secure} Max-Age=600`,
      });
      return res.end(JSON.stringify({ user: actor.username }));
    }
    if (p === '/api/foundation/samba/bootstrap-secret') return saveSambaBootstrapSecret(req, res);
    if (p === '/api/foundation/his-status') return hisStatusProxy(req, res);
    if (p.startsWith('/api/k8s/')) return k8sProxy(req, res, req.url);
    if (p.startsWith('/api/opensearch')) return opensearchProxy(req, res, req.url);
    if (p.startsWith('/api/prometheus')) return prometheusProxy(req, res, req.url);
    if (p === '/api/nodes') {
      const list = await nodes();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        meta: { service: 'foundation', version: VERSION, servedBy: process.env.HOSTNAME, time: new Date().toISOString() },
        nodes: list,
      }));
    }
    if (p === '/plugins' || p === '/plugins/') {
      const files = fs.existsSync(PLUGINS) ? fs.readdirSync(PLUGINS).filter((f) => !f.startsWith('.')) : [];
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ plugins: files }));
    }
    if (p.startsWith('/plugins/')) return serveFrom(PLUGINS, p.slice('/plugins/'.length), res);
    if (p.startsWith('/app/')) return serveFrom(WWW, p.slice('/app/'.length), res);
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e) }));
  }
});
// ── WS exec/터미널 게이트웨이 ──────────────────────────────────────────────
// 브라우저 WS(/api/k8s-exec/<ns>/<pod>?container=&command=) → 쿠키 토큰 JWKS 검증 → apiserver exec
// 채널(v4.channel.k8s.io)로 투명 릴레이. SA 토큰 + Impersonate-User로 사용자 본인 RBAC(create pods/exec) 인가.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  const m = u.pathname.match(/^\/api\/k8s-exec\/([^/]+)\/([^/]+)$/);
  if (!m) { socket.destroy(); return; }
  let actor;
  try { actor = await verifyToken(tokenFromCookie(req.headers.cookie)); }
  catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  const ns = decodeURIComponent(m[1]);
  const pod = decodeURIComponent(m[2]);
  const container = u.searchParams.get('container') || '';
  const commands = u.searchParams.getAll('command');
  const cmds = commands.length ? commands : ['/bin/sh'];
  wss.handleUpgrade(req, socket, head, (browserWs) => {
    const qs = new URLSearchParams();
    if (container) qs.set('container', container);
    qs.set('stdin', 'true'); qs.set('stdout', 'true'); qs.set('stderr', 'true'); qs.set('tty', 'true');
    for (const c of cmds) qs.append('command', c);
    const upUrl = `${APISERVER.replace(/^https/, 'wss')}/api/v1/namespaces/${ns}/pods/${pod}/exec?${qs.toString()}`;
    const headers = { Authorization: `Bearer ${tok()}`, 'Impersonate-User': actor.username };
    const groups = k8sGroups(actor.groups);
    if (groups.length) headers['Impersonate-Group'] = groups;
    const up = new WebSocket(upUrl, ['v4.channel.k8s.io'], { headers });
    console.log(`[audit] exec user=${actor.username} pod=${ns}/${pod} container=${container} ${new Date().toISOString()}`);
    const closeBoth = () => { try { browserWs.close(); } catch {} try { up.close(); } catch {} };
    up.on('message', (data) => { if (browserWs.readyState === 1) browserWs.send(data, { binary: true }); });
    browserWs.on('message', (data) => { if (up.readyState === 1) up.send(data); });
    up.on('close', closeBoth);
    up.on('error', (e) => { try { browserWs.send(Buffer.from([3, ...Buffer.from(String(e))])); } catch {} closeBoth(); });
    browserWs.on('close', closeBoth);
    browserWs.on('error', closeBoth);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`foundation v${VERSION} on :${PORT}`);
    // 콘솔 인박스에 시작 이벤트 발행 + 주기적 노드 헬스 + FoundationModel 수명주기 전이(유기적 연동)
    publishNotify({ action: 'started', target: 'foundation', result: 'info', reason: `Foundation 백엔드 v${VERSION} 시작` });
    nodeHealthPublish();
    fmTransitionPublish(); // 첫 호출 = 기준선 수립(발행 없음), 이후 전이만 발행
    setInterval(nodeHealthPublish, 60000);
    setInterval(fmTransitionPublish, 30000);
  });
} else {
  module.exports = { verifySupabaseToken, k8sGroups, requireConsoleAdmin };
}
