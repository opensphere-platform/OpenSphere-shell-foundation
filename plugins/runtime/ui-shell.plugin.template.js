const SPEC = Object.freeze(__PLUGIN_SPEC__);
const MANUAL_CONTENT = __MANUAL_CONTENT__;
let API_BASE = '';
let API_FETCH = null;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]);

class FoundationPluginElement extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    const operands = SPEC.operands.map((item) => `<li><code>${esc(item)}</code></li>`).join('');
    const manualId = encodeURIComponent(`plugin:foundation/${SPEC.id}`);
    this.innerHTML = `<article class="os-plugin-page" aria-labelledby="${esc(SPEC.id)}-title">
      <header class="os-plugin-header">
        <img src="${esc(SPEC.logo)}" alt="" width="48" height="48" style="object-fit:contain">
        <div>
          <div class="os-eyebrow">PFS · ${esc(SPEC.sector.toUpperCase())}</div>
          <h1 id="${esc(SPEC.id)}-title">${esc(SPEC.displayName)}</h1>
          <p>${esc(SPEC.description)}</p>
        </div>
      </header>
      <nav class="nav" aria-label="Plugin sections">
        <span class="nav-link active">Overview</span>
        <span class="nav-link">설치·운영 구성</span>
        <span class="nav-link">Topology</span>
        <span class="nav-link">Protection</span>
        <span class="nav-link">Documentation</span>
      </nav>
      <section class="card">
        <div class="card-header">Signed plugin package</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>Capability</dt><dd><code>${esc(SPEC.capability)}</code></dd>
            <dt>Version</dt><dd>${esc(SPEC.version)} · ${esc(SPEC.channel)}</dd>
            <dt>Namespace</dt><dd><code>${esc(SPEC.namespace)}</code></dd>
            <dt>Write path</dt><dd>${esc(SPEC.installer)}</dd>
          </dl>
        </div>
      </section>
      <section class="card">
        <div class="card-header">Operand plan</div>
        <div class="card-block">
          <p>실제 적용 시 Foundation BOM이 아래 channel ref를 검증된 immutable digest로 해석합니다.</p>
          <ul>${operands}</ul>
          <p><a href="${esc(SPEC.officialDocs)}" target="_blank" rel="noreferrer">공식 문서</a> · <a href="/manual?doc=${manualId}">OpenSphere 한글 운영 안내서</a></p>
        </div>
      </section>
      <div class="alert alert-info" role="status">
        <div class="alert-items"><div class="alert-item"><span class="alert-text">설치·변경은 Foundation의 선언형 write-path와 사용자 승인으로만 수행됩니다. 이 plugin workload는 평문 secret을 소유하지 않습니다.</span></div></div>
      </div>
    </article>`;
  }
}

export function activate(ctx) {
  API_BASE = ctx.api?.baseUrl ?? '';
  API_FETCH = ctx.api?.fetch ?? null;
  if (!customElements.get(SPEC.element)) customElements.define(SPEC.element, FoundationPluginElement);
  ctx.extensions.manual?.contribute?.({
    sourceId: `plugin:foundation/${SPEC.id}`,
    name: `${SPEC.displayName} 운영 안내서`,
    authorityTier: 2,
    language: 'ko',
    documents: [{
      id: `${SPEC.id}-operations-ko`,
      title: `${SPEC.displayName} 설치 및 운영 안내서`,
      route: SPEC.route,
      content: MANUAL_CONTENT,
    }],
  });
}

export function deactivate() {
  API_BASE = '';
  API_FETCH = null;
}
