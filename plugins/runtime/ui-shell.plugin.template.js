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
      history.pushState(history.state, '', '/pfss/modules');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    this.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => this.navigate(button.dataset.tab)));
    this.querySelector('[data-create-claim]')?.addEventListener('click', () => void this.createClaim());
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
