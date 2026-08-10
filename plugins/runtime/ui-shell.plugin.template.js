const SPEC = Object.freeze(__PLUGIN_SPEC__);
const MANUAL_CONTENT = __MANUAL_CONTENT__;

// Extension Host는 registry 변경 때 같은 plugin을 deactivate/re-import한다.
// customElements는 한 번 정의한 constructor를 교체할 수 없으므로, constructor가
// 항상 최신 권한 context를 읽도록 전역 runtime slot을 plugin별로 유지한다.
const RUNTIME_KEY = Symbol.for(`opensphere.plugin.foundation.${SPEC.id}.runtime`);
const RUNTIME = globalThis[RUNTIME_KEY] || (globalThis[RUNTIME_KEY] = {
  apiBase: '', apiFetch: null, owner: null,
});
let ACTIVE_OWNER = null;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const DOMAIN_LABELS = Object.freeze({
  identity: 'Resources & Access', ai: 'Models & Routes', communication: 'Domains & Workflows',
  observability: 'Signals & Tenants', backup: 'Policies & Restore Points', delivery: 'Applications & Projects',
  data: 'Databases & Roles',
});

// PostgreSQL PFSS가 확립한 Operator UX 계약:
// 실행 중인 리소스의 상태 탭과 플랫폼 관리 작업을 같은 레벨에 섞지 않는다.
const RUNTIME_TABS = Object.freeze([
  ['overview', 'Overview'], ['monitoring', 'Monitoring'], ['topology', 'Topology'],
  ['domain', DOMAIN_LABELS[SPEC.sector] || 'Resources & Access'],
  ['protection', SPEC.sector === 'backup' ? 'Restore Points' : 'Data Protection'],
  ['operations', 'Operations'], ['events', 'Events'], ['documentation', 'Documentation'],
]);

const hasManagedFleet = () => SPEC.control?.requestModes?.Instance === 'managed';
// PostgreSQL 기준 Carbon 관리 아이콘 계약: ListBoxes16, Catalog16, DataAdd16, Settings16.
const MANAGEMENT_ICONS = Object.freeze({
  fleet: { viewBox: '0 0 32 32', paths: ['M16 8H30V10H16z', 'M16 22H30V24H16z', 'M10,14H4a2.0023,2.0023,0,0,1-2-2V6A2.0023,2.0023,0,0,1,4,4h6a2.0023,2.0023,0,0,1,2,2v6A2.0023,2.0023,0,0,1,10,14ZM4,6v6h6.0012L10,6Z', 'M10,28H4a2.0023,2.0023,0,0,1-2-2V20a2.0023,2.0023,0,0,1,2-2h6a2.0023,2.0023,0,0,1,2,2v6A2.0023,2.0023,0,0,1,10,28ZM4,20v6h6.0012L10,20Z'] },
  profiles: { viewBox: '0 0 32 32', paths: ['M26,2H8A2,2,0,0,0,6,4V8H4v2H6v5H4v2H6v5H4v2H6v4a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2V4A2,2,0,0,0,26,2Zm0,26H8V24h2V22H8V17h2V15H8V10h2V8H8V4H26Z', 'M14 8H22V10H14z', 'M14 15H22V17H14z', 'M14 22H22V24H14z'] },
  provisioning: { viewBox: '0 0 32 32', paths: ['M9,9c-.5523,0-1-.4477-1-1s.4477-1,1-1,1,.4477,1,1-.4477,1-1,1ZM10,16c0-.5523-.4477-1-1-1s-1,.4477-1,1,.4477,1,1,1,1-.4477,1-1ZM10,24c0-.5523-.4477-1-1-1s-1,.4477-1,1,.4477,1,1,1,1-.4477,1-1ZM24,25h4v-2h-4v-4h-2v4h-4v2h4v4h2v-4ZM15,27H6v-6h9v-2H6v-6h16v3h2V5c0-1.103-.8975-2-2-2H6c-1.103,0-2,.897-2,2v22c0,1.1025.897,2,2,2h9v-2ZM6,5h16v6H6v-6Z'] },
  operator: { viewBox: '0 0 16 16', paths: ['M13.5,8.4c0-0.1,0-0.3,0-0.4c0-0.1,0-0.3,0-0.4l1-0.8c0.4-0.3,0.4-0.9,0.2-1.3l-1.2-2C13.3,3.2,13,3,12.6,3 c-0.1,0-0.2,0-0.3,0.1l-1.2,0.4c-0.2-0.1-0.4-0.3-0.7-0.4l-0.3-1.3C10.1,1.3,9.7,1,9.2,1H6.8c-0.5,0-0.9,0.3-1,0.8L5.6,3.1 C5.3,3.2,5.1,3.3,4.9,3.4L3.7,3C3.6,3,3.5,3,3.4,3C3,3,2.7,3.2,2.5,3.5l-1.2,2C1.1,5.9,1.2,6.4,1.6,6.8l0.9,0.9c0,0.1,0,0.3,0,0.4 c0,0.1,0,0.3,0,0.4L1.6,9.2c-0.4,0.3-0.5,0.9-0.2,1.3l1.2,2C2.7,12.8,3,13,3.4,13c0.1,0,0.2,0,0.3-0.1l1.2-0.4 c0.2,0.1,0.4,0.3,0.7,0.4l0.3,1.3c0.1,0.5,0.5,0.8,1,0.8h2.4c0.5,0,0.9-0.3,1-0.8l0.3-1.3c0.2-0.1,0.4-0.2,0.7-0.4l1.2,0.4 c0.1,0,0.2,0.1,0.3,0.1c0.4,0,0.7-0.2,0.9-0.5l1.1-2c0.2-0.4,0.2-0.9-0.2-1.3L13.5,8.4z M12.6,12l-1.7-0.6c-0.4,0.3-0.9,0.6-1.4,0.8 L9.2,14H6.8l-0.4-1.8c-0.5-0.2-0.9-0.5-1.4-0.8L3.4,12l-1.2-2l1.4-1.2c-0.1-0.5-0.1-1.1,0-1.6L2.2,6l1.2-2l1.7,0.6 C5.5,4.2,6,4,6.5,3.8L6.8,2h2.4l0.4,1.8c0.5,0.2,0.9,0.5,1.4,0.8L12.6,4l1.2,2l-1.4,1.2c0.1,0.5,0.1,1.1,0,1.6l1.4,1.2L12.6,12z', 'M8,11c-1.7,0-3-1.3-3-3s1.3-3,3-3s3,1.3,3,3C11,9.6,9.7,11,8,11C8,11,8,11,8,11z M8,6C6.9,6,6,6.8,6,7.9C6,7.9,6,8,6,8 c0,1.1,0.8,2,1.9,2c0,0,0.1,0,0.1,0c1.1,0,2-0.8,2-1.9c0,0,0-0.1,0-0.1C10,6.9,9.2,6,8,6C8.1,6,8,6,8,6z'] },
});
const MANAGEMENT_VIEWS = Object.freeze([
  ...(hasManagedFleet() ? [['fleet', 'Fleet', MANAGEMENT_ICONS.fleet]] : []),
  ['profiles', 'Profiles', MANAGEMENT_ICONS.profiles],
  ['provisioning', 'Provisioning', MANAGEMENT_ICONS.provisioning],
  ['operator', 'Operator', MANAGEMENT_ICONS.operator],
]);

const LEGACY_VIEW_ALIASES = Object.freeze({
  cluster: 'fleet', config: 'profiles', claims: 'provisioning',
  backups: 'protection', upgrade: 'operations',
});

const OPERATOR_SHELL_CSS = `
  .pfss-op-shell{position:relative;min-width:0;background:#fff;border:1px solid #d7d7d7;margin-top:.35rem}
  .pfss-op-head{position:relative;display:grid;grid-template-columns:minmax(22rem,1fr) auto;gap:1.25rem;min-height:8.4rem;padding:1.2rem 1.25rem .85rem;box-sizing:border-box}
  .pfss-op-brand{display:flex;align-items:flex-start;gap:1rem;min-width:0;padding-right:1rem}.pfss-op-logo{width:3.5rem;height:3.5rem;object-fit:contain;flex:0 0 auto}
  .pfss-op-brand h1{font-size:2rem;line-height:1.05;margin:.2rem 0 .25rem}.pfss-op-brand p{margin:0;max-width:48rem;color:#565656;line-height:1.35}.pfss-op-eyebrow{color:#526eff;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .pfss-op-meta{display:flex;align-items:center;justify-content:flex-end;gap:0;min-width:0;padding-top:1.35rem}.pfss-op-meta>div{min-width:6.3rem;padding:0 .8rem;border-left:1px solid #ddd}.pfss-op-meta dt,.pfss-op-context label{font-size:.68rem;color:#666}.pfss-op-meta dd{margin:.32rem 0 0;white-space:nowrap}
  .pfss-op-actions{position:absolute;right:1rem;top:.7rem;display:flex;gap:.2rem;z-index:2}.pfss-op-action{display:grid;place-items:center;width:2rem;height:2rem;border:0;background:transparent;color:#7b1fa2;cursor:pointer}.pfss-op-action:hover,.pfss-op-action.active{background:#f4eafa}.pfss-op-action.active{box-shadow:inset 0 -2px #f47b20}.pfss-op-action svg{width:1rem;height:1rem;fill:currentColor}
  .pfss-op-context{display:flex;align-items:flex-end;justify-content:flex-end;gap:.75rem;padding-right:.15rem}.pfss-op-context>div{width:13.75rem}.pfss-op-context select{width:100%;height:2rem;border:0;border-bottom:1px solid #6f7d85;background:#fff}
  .pfss-op-tabs{display:flex;gap:0;border-top:1px solid #eee;border-bottom:1px solid #d7d7d7;overflow-x:auto}.pfss-op-tab{border:0;background:#fff;padding:.72rem 1rem;color:#7b1fa2;white-space:nowrap;cursor:pointer}.pfss-op-tab.active{font-weight:700;box-shadow:inset 0 -2px #526eff}
  .pfss-op-scope{display:flex;align-items:center;justify-content:space-between;padding:.55rem .9rem;background:#fff7f1;border-top:1px solid #f7c8aa;border-bottom:1px solid #f7c8aa;font-size:.76rem}.pfss-op-scope button{border:0;background:transparent;color:#0072a3;cursor:pointer;font-weight:600}
  @media(max-width:1180px){.pfss-op-head{grid-template-columns:1fr;padding-top:1.1rem}.pfss-op-meta{justify-content:flex-start;padding-top:.2rem;flex-wrap:wrap}.pfss-op-context{justify-content:flex-start}.pfss-op-actions{right:.7rem}.pfss-op-brand{padding-right:8.5rem}}
  @media(max-width:720px){.pfss-op-head{padding:.9rem}.pfss-op-brand{padding-right:0;padding-top:2.2rem}.pfss-op-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.pfss-op-context{grid-column:1/-1;flex-wrap:wrap}.pfss-op-context>div{width:100%}}
`;

function apiFetch(path, init) {
  if (typeof RUNTIME.apiFetch !== 'function') {
    return Promise.reject(new Error('Host API fetch capability is unavailable'));
  }
  return RUNTIME.apiFetch(`${RUNTIME.apiBase}${path}`, init);
}

function statePill(kind, text) {
  const cls = kind === 'ok' ? 'label-success' : kind === 'warn' ? 'label-warning' : 'label-info';
  return `<span class="label ${cls}">${esc(text)}</span>`;
}

class FoundationPluginElement extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block';
    this.style.width = '100%';
    this.style.minWidth = '0';
    this._onPopstate = () => this.render();
    window.addEventListener('popstate', this._onPopstate);
    this.render();
    void this.loadRuntimeEvidence();
  }

  disconnectedCallback() {
    if (this._onPopstate) window.removeEventListener('popstate', this._onPopstate);
    this._onPopstate = null;
  }

  activeTab() {
    const base = SPEC.route.replace(/\/$/, '');
    const path = location.pathname;
    if (path === base) return 'overview';
    const child = path.startsWith(`${base}/`) ? path.slice(base.length + 1).split('/')[0] : '';
    const normalized = LEGACY_VIEW_ALIASES[child] || child;
    const known = [...RUNTIME_TABS, ...MANAGEMENT_VIEWS].some(([id]) => id === normalized);
    if (normalized === 'fleet' && !hasManagedFleet()) return 'profiles';
    return known ? normalized : 'overview';
  }

  navigate(tab) {
    const next = tab === 'overview' ? SPEC.route : `${SPEC.route}/${tab}`;
    history.pushState(history.state, '', `${next}${location.search}${location.hash}`);
    this.render();
    void this.loadRuntimeEvidence();
  }

  render() {
    const active = this.activeTab();
    const management = MANAGEMENT_VIEWS.map(([id, label, icon]) => `<button type="button" class="pfss-op-action${active === id ? ' active' : ''}" data-tab="${id}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="${icon.viewBox}" aria-hidden="true">${icon.paths.map((path) => `<path d="${path}"></path>`).join('')}</svg></button>`).join('');
    const isManagement = MANAGEMENT_VIEWS.some(([id]) => id === active);
    const tabs = RUNTIME_TABS.map(([id, label]) => `<button type="button" class="pfss-op-tab${active === id ? ' active' : ''}" role="tab" aria-selected="${active === id}" data-tab="${id}">${esc(label)}</button>`).join('');
    this.innerHTML = `<button class="btn btn-sm btn-link" type="button" data-back>← PFS 모듈</button>
      <style>${OPERATOR_SHELL_CSS}</style>
      <section class="pfss-op-shell" aria-label="${esc(SPEC.displayName)} Operator 작업 영역">
        <header class="pfss-op-head" aria-labelledby="${esc(SPEC.id)}-title">
          <div class="pfss-op-brand"><img class="pfss-op-logo" src="${esc(SPEC.logo)}" alt="${esc(SPEC.displayName)}"><div><div class="pfss-op-eyebrow">PFS · OPERATOR · ${esc(SPEC.capability.toUpperCase())}</div><h1 id="${esc(SPEC.id)}-title">${esc(SPEC.displayName)}</h1><p>${esc(SPEC.description)}</p></div></div>
          <dl class="pfss-op-meta"><div><dt>Lifecycle</dt><dd>${statePill('ok', 'Ready')}</dd></div><div><dt>Version</dt><dd>${esc(SPEC.version)}</dd></div><div><dt>Profile</dt><dd>${esc(SPEC.control?.operatorDriver || SPEC.channel)}</dd></div><div class="pfss-op-context"><div><label>Namespace</label><select aria-label="Namespace"><option>${esc(SPEC.namespace)}</option></select></div><div><label>${hasManagedFleet() ? 'Instance' : 'Service'}</label><select aria-label="${hasManagedFleet() ? 'Instance' : 'Service'}"><option>${esc(SPEC.displayName)}</option></select></div></div></dl>
          <div class="pfss-op-actions" aria-label="플랫폼 관리 작업">${management}</div>
        </header>
        ${isManagement ? `<div class="pfss-op-scope"><span><b>관리 작업</b> · 실행 상태 탭과 분리된 Namespace/플랫폼 설정 영역입니다.</span><button type="button" data-tab="overview">선택한 서비스로 돌아가기</button></div>` : `<nav class="pfss-op-tabs" role="tablist" aria-label="${esc(SPEC.displayName)} 실행 상태 메뉴">${tabs}</nav>`}
      </section>
      <div data-content>${this.renderTab(active)}</div>`;
    this.querySelector('[data-back]')?.addEventListener('click', () => {
      history.pushState(history.state, '', '/pfss/modules');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    this.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => this.navigate(button.dataset.tab)));
    this.querySelector('[data-create-claim]')?.addEventListener('click', () => void this.createClaim());
  }

  renderTab(active) {
    if (active === 'overview') return this.overview();
    if (active === 'monitoring') return this.monitoring();
    if (active === 'operator') return this.operator();
    if (active === 'fleet') return this.fleet();
    if (active === 'topology') return this.topology();
    if (active === 'profiles') return this.profiles();
    if (active === 'domain') return this.domainResources();
    if (active === 'protection') return this.backups();
    if (active === 'events') return this.events();
    if (active === 'provisioning') return this.claims();
    if (active === 'operations') return this.operations();
    return this.documentation();
  }

  overview() {
    return `<section class="pgp-dashboard">
      <article class="pgp-panel"><h2>서비스 상태</h2><p>선택한 Namespace의 실제 operand와 Host API 상태입니다.</p><dl class="os-kv"><dt>Lifecycle</dt><dd>${statePill('ok', 'Package active')}</dd><dt>Host API</dt><dd data-runtime-api>${statePill('info', '확인 중')}</dd><dt>Runtime</dt><dd data-operand-state>상태 확인 중</dd><dt>Namespace</dt><dd><code>${esc(SPEC.namespace)}</code></dd></dl></article>
      <article class="pgp-panel"><h2>Operator 연결</h2><p>요청은 공통 Claim으로 받고 제품별 driver가 native resource를 수렴합니다.</p><dl class="os-kv"><dt>Driver</dt><dd>${esc(SPEC.control.operatorDriver)}</dd><dt>Native resource</dt><dd><code>${esc(SPEC.control.nativeResource)}</code></dd><dt>Reconciler</dt><dd>${statePill(SPEC.control.reconciler === 'implemented' ? 'ok' : 'warn', SPEC.control.reconciler)}</dd></dl><button class="btn btn-sm btn-primary" type="button" data-tab="operator">Operator 확인</button></article>
      <article class="pgp-panel"><h2>소비 계약</h2><p>연결 정보는 FoundationBinding과 SecretRef로만 소비자에게 발급합니다.</p><dl class="os-kv"><dt>Request types</dt><dd>${esc((SPEC.control.requestTypes || []).join(' · '))}</dd><dt>Capabilities</dt><dd>${esc((SPEC.control.capabilities || []).join(' · ') || '—')}</dd><dt>Mutable tags</dt><dd>적용 금지</dd></dl><button class="btn btn-sm" type="button" data-tab="provisioning">요청 관리</button></article>
    </section>`;
  }

  monitoring() {
    return `<section class="rm-work"><h2>Monitoring</h2><p>제품별 exporter와 Kubernetes condition을 같은 시간축으로 관찰합니다.</p><div class="pgp-dashboard"><article class="pgp-panel"><h3>Runtime condition</h3><strong data-operand-state>상태 확인 중</strong><p class="os-sub">준비 상태를 임의의 0 값으로 대체하지 않습니다.</p></article><article class="pgp-panel"><h3>Telemetry source</h3><dl class="os-kv"><dt>Operator</dt><dd>${esc(SPEC.control.operatorDriver)}</dd><dt>Namespace</dt><dd><code>${esc(SPEC.namespace)}</code></dd><dt>Samples</dt><dd>${statePill('info', '제품 exporter 계약 확인')}</dd></dl></article><article class="pgp-panel"><h3>Reconciliation</h3><p>Kubernetes Event와 reconciler condition은 실제 제품 API에서만 표시합니다.</p><button class="btn btn-sm" type="button" data-tab="events">Events 확인</button></article></div></section>`;
  }

  operator() {
    const modes = Object.values(SPEC.control.requestModes || {});
    const someReady = modes.some((mode) => mode !== 'pending');
    const ready = SPEC.control.reconciler === 'implemented' && modes.length > 0 && modes.every((mode) => mode !== 'pending');
    const operatorState = ready ? 'Ready' : someReady ? 'Partial' : 'Pending';
    const requestRows = (SPEC.control.requestTypes || []).map((requestType) => { const mode = SPEC.control.requestModes?.[requestType] || 'pending'; const available = mode !== 'pending'; return `<tr><td>${esc(requestType)}</td><td>${statePill(available ? 'ok' : 'warn', mode)}</td><td>${available ? '실제 driver 경로가 검증 대상입니다.' : 'driver 구현·배포 검증 전에는 Claim이 Pending을 유지합니다.'}</td></tr>`; }).join('');
    return `<section class="rm-work"><h2>Operator</h2><p>모든 PFSS 모듈은 공통 Claim/Binding lifecycle을 사용하고 제품별 driver가 실제 리소스를 수렴합니다.</p><table class="table"><thead><tr><th>검사</th><th>상태</th><th>근거</th></tr></thead><tbody><tr><td>UIPluginPackage</td><td>${statePill('ok', 'Activated')}</td><td>${esc(SPEC.version)} · ${esc(SPEC.channel)}</td></tr><tr><td>Host API</td><td data-runtime-api>${statePill('info', '확인 중')}</td><td>${esc(RUNTIME.apiBase || '승인 context 대기')}</td></tr><tr><td>Operator driver</td><td>${statePill(ready ? 'ok' : 'warn', operatorState)}</td><td>${esc(SPEC.control.operatorDriver)} · <code>${esc(SPEC.control.nativeResource)}</code></td></tr>${requestRows}</tbody></table>${ready ? '' : `<div class="alert alert-warning"><div class="alert-items"><div class="alert-item"><span class="alert-text">${esc(SPEC.control.blocker || (someReady ? '요청 종류별 driver 보강이 진행 중입니다.' : '배포 검증 대기'))}</span></div></div></div>`}</section>`;
  }

  clusterPlan() {
    const operands = SPEC.operands.map((item) => `<tr><td><code>${esc(item)}</code></td><td>channel ref</td><td>적용 시 digest 고정 필수</td></tr>`).join('');
    return `<section class="rm-work"><h2>Cluster plan</h2><div class="rm-form"><label><span>Channel</span><input value="${esc(SPEC.channel)}" disabled></label><label><span>Operator driver</span><input value="${esc(SPEC.control.operatorDriver)}" disabled></label><label><span>Native resource</span><input value="${esc(SPEC.control.nativeResource)}" disabled></label><label><span>Namespace</span><input value="${esc(SPEC.namespace)}" disabled></label></div><table class="table"><thead><tr><th>Operand image</th><th>선언</th><th>적용 정책</th></tr></thead><tbody>${operands}</tbody></table><div class="alert alert-info" role="status"><div class="alert-items"><div class="alert-item"><span class="alert-text">사용자는 FoundationClaim만 제출합니다. 제품별 Operator driver가 승인된 digest의 native resource를 선언하고 FoundationBinding으로 연결을 발급합니다.</span></div></div></div></section>`;
  }

  fleet() {
    if (!hasManagedFleet()) return this.profiles();
    const modes = Object.entries(SPEC.control.requestModes || {}).map(([kind, mode]) => `<tr><td>${esc(kind)}</td><td>${statePill(mode === 'pending' ? 'warn' : 'ok', mode)}</td><td>${esc(SPEC.namespace)}</td></tr>`).join('');
    return `<section class="rm-work"><h2>${esc(SPEC.displayName)} Fleet</h2><p>관리형 인스턴스와 요청 가능 범위를 Namespace 경계로 확인합니다.</p><table class="table"><thead><tr><th>Resource</th><th>Mode</th><th>Namespace</th></tr></thead><tbody>${modes}</tbody></table>${this.clusterPlan()}</section>`;
  }

  topology() {
    const dependencies = SPEC.control.dependencies || [];
    const requestModes = Object.values(SPEC.control.requestModes || {});
    const operatorReady = requestModes.length > 0 && requestModes.every((mode) => mode !== 'pending');
    const dependencyNodes = dependencies.map((item) => `<article><span class="rm-node">${esc(item.module)}</span>${statePill(item.required ? 'warn' : 'info', item.required ? '필수' : '운영 Profile')}<small>${esc(item.requestType)} · ${esc(item.purpose)}</small></article>`).join('');
    const operandNodes = SPEC.operands.map((item) => `<article><span class="rm-node">${esc(item.split(':')[0])}</span>${statePill('warn', 'Operand condition 필요')}</article>`).join('');
    return `<section class="rm-work"><h2>Topology</h2><p>의존 서비스는 별도 FoundationClaim/FoundationBinding으로 연결되며 원문 자격 증명을 전달하지 않습니다.</p><div class="rm-topology"><article><span class="rm-node">${esc(SPEC.id)}</span>${statePill(operatorReady ? 'ok' : 'warn', operatorReady ? SPEC.control.operatorDriver : '요청별 보강 중')}</article>${dependencyNodes}${operandNodes}</div>${dependencies.length ? '' : '<p class="os-sub">필수 PFS 의존성이 없는 독립 Operator입니다.</p>'}</section>`;
  }

  configuration() {
    const dependencies = (SPEC.control.dependencies || []).map((item) => `${item.required ? '필수' : 'Profile'}: ${item.module} / ${item.requestType}`).join(' · ');
    return `<section class="rm-work"><h2>Configuration</h2><dl class="os-kv"><dt>Capability</dt><dd><code>${esc(SPEC.capability)}</code></dd><dt>Namespace</dt><dd><code>${esc(SPEC.namespace)}</code></dd><dt>Operator</dt><dd>${esc(SPEC.control.operatorDriver)}</dd><dt>Native resource</dt><dd><code>${esc(SPEC.control.nativeResource)}</code></dd><dt>Request kinds</dt><dd>${(SPEC.control.requestTypes || []).map((item) => { const mode = SPEC.control.requestModes?.[item] || 'pending'; return statePill(mode === 'pending' ? 'warn' : 'info', `${item} · ${mode}`); }).join(' ')}</dd><dt>Binding capabilities</dt><dd>${(SPEC.control.capabilities || []).map((item) => `<code>${esc(item)}</code>`).join(' · ')}</dd><dt>Dependencies</dt><dd>${dependencies ? esc(dependencies) : '없음'}</dd></dl><p class="os-sub">자격 증명 원문은 입력하지 않고 동일 Namespace의 SecretRef만 참조합니다.</p></section>`;
  }

  profiles() {
    return `<section class="rm-work"><h2>Profile Catalog</h2><p>제품별 차이는 Profile과 native resource 설정으로 표현하고 공통 수명주기 계약은 유지합니다.</p>${this.configuration()}</section>`;
  }

  domainResources() {
    return `<section class="rm-work"><h2>${esc(DOMAIN_LABELS[SPEC.sector] || 'Resources & Access')}</h2><table class="table"><thead><tr><th>계약</th><th>요청 종류</th><th>발급 결과</th><th>소유자</th></tr></thead><tbody><tr><td>${esc(SPEC.capability)}</td><td>${esc((SPEC.control.requestTypes || []).join(' · '))}</td><td>${statePill('ok', 'FoundationBinding v1alpha1')}</td><td>${esc(SPEC.control.operatorDriver)}</td></tr></tbody></table></section>`;
  }

  backups() {
    return `<section class="rm-work"><h2>Backups</h2><div class="rm-empty"><b>보호 계약 확인 필요</b><span>영구 데이터, backup target, retention, restore rehearsal을 전용 reconciler가 보고하기 전에는 “백업됨”으로 표시하지 않습니다.</span></div></section>`;
  }

  events() {
    return `<section class="rm-work"><h2>Events</h2><div class="rm-empty"><b>공용 package event API 미선언</b><span>package 활성은 확인됐습니다. operand Kubernetes Event와 reconciler condition은 제품별 API가 제공해야 합니다.</span></div></section>`;
  }

  claims() {
    const availableRequests = (SPEC.control.requestTypes || []).filter((item) => (SPEC.control.requestModes?.[item] || 'pending') !== 'pending');
    const requestOptions = (SPEC.control.requestTypes || []).map((item) => { const mode = SPEC.control.requestModes?.[item] || 'pending'; return `<option value="${esc(item)}"${mode === 'pending' ? ' disabled' : ''}>${esc(item)}${mode === 'pending' ? ' · 준비 중' : ''}</option>`; }).join('');
    return `<section class="rm-work"><h2>Claims</h2><p>제품 특성에 맞는 요청을 제출하면 Operator가 native resource와 연결 Binding을 수렴합니다.</p>${availableRequests.length ? '' : '<div class="alert alert-warning"><div class="alert-items"><div class="alert-item"><span class="alert-text">현재 배포 가능한 요청 driver가 없습니다. 준비 중인 요청은 제출할 수 없습니다.</span></div></div></div>'}<div class="rm-form"><label><span>이름</span><input data-claim-name placeholder="${esc(SPEC.id)}-request"></label><label><span>요청 종류</span><select data-claim-type>${requestOptions}</select></label><label><span>대상 이름 (선택)</span><input data-claim-target placeholder="기존 인스턴스 또는 리소스"></label><label><span>대상 Namespace (선택)</span><input data-claim-target-namespace placeholder="미입력 시 현재 Namespace"></label><label><span>Profile / Plan (선택)</span><input data-claim-profile placeholder="승인된 Profile 또는 Plan"></label><label><span>데이터·리소스 이름 (선택)</span><input data-claim-resource placeholder="database, bucket, index, realm 등"></label><label><span>소유자·계정 (선택)</span><input data-claim-owner placeholder="owner 또는 application account"></label><label><span>접근 수준 (선택)</span><select data-claim-access><option value="">제품 기본값</option><option value="ReadOnly">ReadOnly</option><option value="ReadWrite">ReadWrite</option></select></label><label><span>Credential Secret (선택)</span><input data-claim-secret placeholder="SecretRef 이름"></label></div><button class="btn btn-sm btn-primary" type="button" data-create-claim${availableRequests.length ? '' : ' disabled'}>요청</button><span class="os-sub" data-claim-result></span><table class="table"><thead><tr><th>이름</th><th>종류</th><th>상태</th><th>Binding</th></tr></thead><tbody data-claim-list><tr><td colspan="4">불러오는 중</td></tr></tbody></table></section>`;
  }

  async createClaim() {
    const result = this.querySelector('[data-claim-result]');
    const name = this.querySelector('[data-claim-name]')?.value?.trim() || '';
    const requestType = this.querySelector('[data-claim-type]')?.value || '';
    const targetName = this.querySelector('[data-claim-target]')?.value?.trim() || '';
    const targetNamespace = this.querySelector('[data-claim-target-namespace]')?.value?.trim() || '';
    const profileName = this.querySelector('[data-claim-profile]')?.value?.trim() || '';
    const resourceName = this.querySelector('[data-claim-resource]')?.value?.trim() || '';
    const owner = this.querySelector('[data-claim-owner]')?.value?.trim() || '';
    const access = this.querySelector('[data-claim-access]')?.value || '';
    const credentialSecretName = this.querySelector('[data-claim-secret]')?.value?.trim() || '';
    if (!name) { if (result) result.textContent = '이름을 입력하십시오.'; return; }
    if (result) result.textContent = '요청 중…';
    try {
      const response = await apiFetch('/api/claims', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-os-idempotency-key': `${SPEC.id}-${crypto.randomUUID?.() || Date.now()}` },
        body: JSON.stringify({
          name, requestType,
          ...(targetName ? { targetRef: { name: targetName, ...(targetNamespace ? { namespace: targetNamespace } : {}) } } : {}),
          ...(profileName ? { profileName } : {}),
          parameters: {
            ...(resourceName ? { database: resourceName, resourceName } : {}),
            ...(owner ? { owner } : {}),
            ...(access ? { access } : {}),
          },
          ...(credentialSecretName ? { credentialSecretName } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (result) result.textContent = `${name} 요청이 접수되었습니다.`;
      await this.loadClaims();
    } catch (error) {
      if (result) result.textContent = String(error?.message || error);
    }
  }

  async loadClaims() {
    const target = this.querySelector('[data-claim-list]');
    if (!target) return;
    try {
      const response = await apiFetch('/api/claims', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const items = Array.isArray(body.items) ? body.items : [];
      target.innerHTML = items.length ? items.map((item) => `<tr><td><code>${esc(item.metadata?.name)}</code></td><td>${esc(item.spec?.request?.type || '-')}</td><td>${statePill(item.status?.phase === 'Bound' ? 'ok' : 'warn', item.status?.phase || 'Pending')}</td><td><code>${esc(item.status?.bindingRef?.name || '-')}</code></td></tr>`).join('') : '<tr><td colspan="4">등록된 요청이 없습니다.</td></tr>';
    } catch (error) {
      target.innerHTML = `<tr><td colspan="4">${esc(error?.message || error)}</td></tr>`;
    }
  }

  upgrade() {
    return `<section class="rm-work"><h2>Upgrade & rollback</h2><table class="table"><thead><tr><th>Channel</th><th>목적</th><th>승격 조건</th></tr></thead><tbody><tr><td>stable</td><td>운영</td><td>감사·복구 증거</td></tr><tr><td>candidate</td><td>승격 검증</td><td>E2E·호환성·보안 검사</td></tr><tr><td>edge</td><td>개발</td><td>${SPEC.channel === 'edge' ? statePill('ok', '현재 package') : '기능 검증'}</td></tr></tbody></table></section>`;
  }

  operations() {
    return `<section class="rm-work"><h2>Operations</h2><p>운영 중 변경, 재조정, 업데이트와 롤백 근거를 한곳에서 확인합니다.</p><dl class="os-kv"><dt>Reconciler</dt><dd>${esc(SPEC.control.reconciler)}</dd><dt>Driver</dt><dd>${esc(SPEC.control.operatorDriver)}</dd><dt>Native resource</dt><dd><code>${esc(SPEC.control.nativeResource)}</code></dd><dt>Apply owner</dt><dd>Foundation Control Plane</dd></dl>${this.upgrade()}</section>`;
  }

  documentation() {
    const manualId = encodeURIComponent(`plugin:foundation/${SPEC.id}-operations-ko`);
    return `<section class="rm-work"><h2>Documentation</h2><p>이 package가 활성화되면 한글 운영 안내서를 Console Manual Registry와 통합 검색에 등록합니다.</p><dl class="os-kv"><dt>Source ID</dt><dd><code>plugin:foundation/${esc(SPEC.id)}</code></dd><dt>Language</dt><dd>ko</dd><dt>Authority</dt><dd>Tier 2</dd></dl><a class="btn btn-sm btn-primary" href="/manual?doc=${manualId}">OpenSphere 한글 운영 안내서</a><a class="btn btn-sm" href="${esc(SPEC.officialDocs)}" target="_blank" rel="noreferrer">공식 문서</a></section>`;
  }

  async loadRuntimeEvidence() {
    try {
      const [infoResponse, planResponse] = await Promise.all([
        apiFetch('/api/info', { cache: 'no-store' }),
        apiFetch('/api/plan', { cache: 'no-store' }),
      ]);
      if (!infoResponse.ok || !planResponse.ok) throw new Error(`HTTP ${infoResponse.status}/${planResponse.status}`);
      const plan = await planResponse.json();
      this.querySelectorAll('[data-runtime-api]').forEach((node) => { node.innerHTML = statePill('ok', 'Ready'); });
      const operand = this.querySelector('[data-operand-state]');
      if (operand) operand.textContent = `${(plan.operands || []).length}개 operand 계획 확인`;
      await this.loadClaims();
    } catch (error) {
      this.querySelectorAll('[data-runtime-api]').forEach((node) => { node.innerHTML = statePill('warn', 'Unavailable'); node.title = String(error); });
    }
  }
}

export function activate(ctx) {
  ACTIVE_OWNER = Object.freeze({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` });
  RUNTIME.owner = ACTIVE_OWNER;
  RUNTIME.apiBase = ctx.api?.baseUrl ?? '';
  RUNTIME.apiFetch = ctx.api?.fetch ?? null;
  if (!customElements.get(SPEC.element)) customElements.define(SPEC.element, FoundationPluginElement);
  ctx.extensions.manual?.contribute?.({
    sourceId: `plugin:foundation/${SPEC.id}`,
    name: `${SPEC.displayName} 운영 안내서`,
    authorityTier: 2,
    language: 'ko',
    documents: [{ id: `${SPEC.id}-operations-ko`, title: `${SPEC.displayName} 설치 및 운영 안내서`, route: SPEC.route, content: MANUAL_CONTENT }],
  });
}

export function deactivate() {
  if (RUNTIME.owner === ACTIVE_OWNER) {
    RUNTIME.apiBase = '';
    RUNTIME.apiFetch = null;
    RUNTIME.owner = null;
  }
  ACTIVE_OWNER = null;
}
