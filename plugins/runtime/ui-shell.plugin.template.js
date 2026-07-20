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

const TAB_DEFS = Object.freeze([
  ['overview', 'Overview'], ['operator', 'Operator'], ['cluster', 'Cluster plan'],
  ['topology', 'Topology'], ['config', 'Configuration'],
  ['domain', DOMAIN_LABELS[SPEC.sector] || 'Resources & Access'],
  ['backups', 'Backups'], ['events', 'Events'], ['claims', 'Claims'],
  ['upgrade', 'Upgrade'], ['documentation', 'Documentation'],
]);

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
    return TAB_DEFS.some(([id]) => id === child) ? child : 'overview';
  }

  navigate(tab) {
    const next = tab === 'overview' ? SPEC.route : `${SPEC.route}/${tab}`;
    history.pushState(history.state, '', `${next}${location.search}${location.hash}`);
    this.render();
    void this.loadRuntimeEvidence();
  }

  render() {
    const active = this.activeTab();
    const tabs = TAB_DEFS.map(([id, label]) => `<button type="button" class="pfs-plugin-tab${active === id ? ' active' : ''}" role="tab" aria-selected="${active === id}" data-tab="${id}">${esc(label)}</button>`).join('');
    this.innerHTML = `<button class="btn btn-sm btn-link" type="button" data-back>← PFS 모듈</button>
      <section class="pgp-page-frame" aria-label="${esc(SPEC.displayName)} plugin 개요와 메뉴">
        <header class="pfs-plugin-head" aria-labelledby="${esc(SPEC.id)}-title">
          <img class="pfs-plugin-logo" src="${esc(SPEC.logo)}" alt="${esc(SPEC.displayName)}" width="52" height="52">
          <div class="pfs-plugin-main"><div class="os-eyebrow">PFS · ${esc(SPEC.capability.toUpperCase())}</div><h1 id="${esc(SPEC.id)}-title">${esc(SPEC.displayName)}</h1><p>${esc(SPEC.description)}</p></div>
          <dl class="pfs-plugin-facts"><div><dt>Lifecycle</dt><dd>${statePill('ok', 'Package active')}</dd></div><div><dt>Package</dt><dd>${esc(SPEC.version)}</dd></div><div><dt>Channel</dt><dd>${esc(SPEC.channel)}</dd></div><div><dt>Namespace</dt><dd><code>${esc(SPEC.namespace)}</code></dd></div></dl>
        </header>
        <nav class="pfs-plugin-tabs" role="tablist" aria-label="${esc(SPEC.displayName)} 관리 메뉴">${tabs}</nav>
      </section>
      <div data-content>${this.renderTab(active)}</div>`;
    this.querySelector('[data-back]')?.addEventListener('click', () => {
      history.pushState(history.state, '', '/p/foundation/modules');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    this.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => this.navigate(button.dataset.tab)));
  }

  renderTab(active) {
    if (active === 'overview') return this.overview();
    if (active === 'operator') return this.operator();
    if (active === 'cluster') return this.clusterPlan();
    if (active === 'topology') return this.topology();
    if (active === 'config') return this.configuration();
    if (active === 'domain') return this.domainResources();
    if (active === 'backups') return this.backups();
    if (active === 'events') return this.events();
    if (active === 'claims') return this.claims();
    if (active === 'upgrade') return this.upgrade();
    return this.documentation();
  }

  overview() {
    return `<section class="pgp-steps" aria-label="${esc(SPEC.displayName)} 실행 단계">
      <button type="button" class="pgp-step current" data-tab="operator"><span class="pgp-step-n">1</span><span><b>Package 활성</b><small>서명·digest·권한 검증 완료</small></span></button>
      <button type="button" class="pgp-step" data-tab="cluster"><span class="pgp-step-n">2</span><span><b>Operand 계획</b><small>버전·리소스·스토리지·보호 정책</small></span></button>
      <button type="button" class="pgp-step" data-tab="topology"><span class="pgp-step-n">3</span><span><b>운영 관리</b><small>전용 reconciler가 제공하는 실상태</small></span></button>
    </section>
    <section class="pgp-dashboard">
      <article class="pgp-panel"><h2>Package readiness</h2><p>활성 package와 Host API 연결 상태입니다.</p><dl class="os-kv"><dt>Signed package</dt><dd>${statePill('ok', 'Activated')}</dd><dt>Host API</dt><dd data-runtime-api>${statePill('info', '확인 중')}</dd><dt>Installer</dt><dd>${esc(SPEC.installer)}</dd><dt>Capability</dt><dd><code>${esc(SPEC.capability)}</code></dd></dl></article>
      <article class="pgp-panel"><h2>Operand state</h2><p>package 활성과 operand 설치는 별도 상태입니다.</p><strong data-operand-state>설치 상태 확인 필요</strong><p class="os-sub">실제 operand 상태는 Foundation Control Plane의 선언·condition으로 판정합니다.</p><button class="btn btn-sm btn-primary" type="button" data-tab="cluster">Cluster plan 검토</button></article>
      <article class="pgp-panel"><h2>Operations contract</h2><dl class="os-kv"><dt>Namespace</dt><dd><code>${esc(SPEC.namespace)}</code></dd><dt>Mutable tag apply</dt><dd>금지</dd><dt>Secret ownership</dt><dd>SecretRef only</dd><dt>Manual</dt><dd>${statePill('ok', 'Registered')}</dd></dl></article>
    </section>`;
  }

  operator() {
    return `<section class="rm-work"><h2>Operator</h2><p>서명 package, Host API, 설치 주체의 실제 준비 상태를 구분합니다.</p><table class="table"><thead><tr><th>검사</th><th>상태</th><th>근거</th></tr></thead><tbody><tr><td>UIPluginPackage</td><td>${statePill('ok', 'Activated')}</td><td>${esc(SPEC.version)} · ${esc(SPEC.channel)}</td></tr><tr><td>Host API</td><td data-runtime-api>${statePill('info', '확인 중')}</td><td>${esc(RUNTIME.apiBase || '승인 context 대기')}</td></tr><tr><td>Operand reconciler</td><td>${statePill('warn', '별도 검증')}</td><td>${esc(SPEC.installer)}</td></tr></tbody></table></section>`;
  }

  clusterPlan() {
    const operands = SPEC.operands.map((item) => `<tr><td><code>${esc(item)}</code></td><td>channel ref</td><td>적용 시 digest 고정 필수</td></tr>`).join('');
    return `<section class="rm-work"><h2>Cluster plan</h2><div class="rm-form"><label><span>Channel</span><input value="${esc(SPEC.channel)}" disabled></label><label><span>Installer</span><input value="${esc(SPEC.installer)}" disabled></label><label><span>Namespace</span><input value="${esc(SPEC.namespace)}" disabled></label></div><table class="table"><thead><tr><th>Operand image</th><th>선언</th><th>적용 정책</th></tr></thead><tbody>${operands}</tbody></table><div class="alert alert-warning" role="status"><div class="alert-items"><div class="alert-item"><span class="alert-text">이 공용 package 화면은 계획을 증명하며 임의 Kubernetes write를 수행하지 않습니다. 전용 reconciler가 승인된 digest·리소스·rollback 계약을 제공할 때만 적용할 수 있습니다.</span></div></div></div></section>`;
  }

  topology() {
    return `<section class="rm-work"><h2>Topology</h2><div class="rm-topology">${SPEC.operands.map((item) => `<article><span class="rm-node">${esc(item.split(':')[0])}</span>${statePill('warn', 'Operand condition 필요')}</article>`).join('')}</div></section>`;
  }

  configuration() {
    return `<section class="rm-work"><h2>Configuration</h2><dl class="os-kv"><dt>Capability</dt><dd><code>${esc(SPEC.capability)}</code></dd><dt>Namespace</dt><dd><code>${esc(SPEC.namespace)}</code></dd><dt>Apply owner</dt><dd>${esc(SPEC.installer)}</dd><dt>Package channel</dt><dd>${esc(SPEC.channel)}</dd></dl><p class="os-sub">제품별 리소스·스토리지·접속 정책은 전용 reconciler schema가 제공해야 하며, 정의되지 않은 입력은 생성하지 않습니다.</p></section>`;
  }

  domainResources() {
    return `<section class="rm-work"><h2>${esc(DOMAIN_LABELS[SPEC.sector] || 'Resources & Access')}</h2><table class="table"><thead><tr><th>계약</th><th>상태</th><th>소유자</th></tr></thead><tbody><tr><td>${esc(SPEC.capability)}</td><td>${statePill('warn', 'Claim/Binding schema 필요')}</td><td>Foundation Control Plane</td></tr></tbody></table></section>`;
  }

  backups() {
    return `<section class="rm-work"><h2>Backups</h2><div class="rm-empty"><b>보호 계약 확인 필요</b><span>영구 데이터, backup target, retention, restore rehearsal을 전용 reconciler가 보고하기 전에는 “백업됨”으로 표시하지 않습니다.</span></div></section>`;
  }

  events() {
    return `<section class="rm-work"><h2>Events</h2><div class="rm-empty"><b>공용 package event API 미선언</b><span>package 활성은 확인됐습니다. operand Kubernetes Event와 reconciler condition은 제품별 API가 제공해야 합니다.</span></div></section>`;
  }

  claims() {
    return `<section class="rm-work"><h2>Claims</h2><table class="table"><thead><tr><th>Capability</th><th>상태</th><th>발급 주체</th></tr></thead><tbody><tr><td><code>${esc(SPEC.capability)}</code></td><td>${statePill('warn', '계약 schema 필요')}</td><td>Foundation Control Plane</td></tr></tbody></table></section>`;
  }

  upgrade() {
    return `<section class="rm-work"><h2>Upgrade & rollback</h2><table class="table"><thead><tr><th>Channel</th><th>목적</th><th>승격 조건</th></tr></thead><tbody><tr><td>stable</td><td>운영</td><td>감사·복구 증거</td></tr><tr><td>candidate</td><td>승격 검증</td><td>E2E·호환성·보안 검사</td></tr><tr><td>edge</td><td>개발</td><td>${SPEC.channel === 'edge' ? statePill('ok', '현재 package') : '기능 검증'}</td></tr></tbody></table></section>`;
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
