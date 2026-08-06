import { Injectable, signal } from '@angular/core';

// Foundation 딥링크 — 플랫폼 표준(shell-template 원본)과 동일: **경로 세그먼트 + pushState/popstate**.
// 콘솔 host matcher가 PFSS 정본 `/pfss/*`를 Foundation에 위임하므로, 경로가 바뀌어도
// id(foundation)가 그대로면 재마운트되지 않는다. 주소 형태:
//   · 모듈:      /pfss/<module>            (예: /pfss/directory)
//   · 모듈+탭:   /pfss/<module>/<tab>       (예: /pfss/directory/operator)
//   · overview:  /pfss/foundation          (fragment 없음)
// (구 `?fview=<module>.<tab>` 쿼리 방식 폐기 — D-14. select()/syncUrl() 한 곳만 URL을 건드린다.)
@Injectable({ providedIn: 'root' })
export class ViewRouter {
  readonly module = signal<string>('overview');
  readonly tab = signal<string>('overview');
  /** Platform Delivery처럼 실제 상위 도메인이 있는 화면에서만 쓰는 4단 세부 탭. */
  readonly detail = signal<string>('overview');

  constructor() {
    this.read();
    try { window.addEventListener('popstate', () => this.read()); } catch { /* noop */ }
  }

  /** URL 경로 → module/tab 복원(북마크·새로고침·뒤로가기). */
  private read(): void {
    try {
      const parts = location.pathname.split('/').filter(Boolean);
      const pfss = parts[0] === 'pfss';
      const legacyIndex = parts.indexOf('foundation');
      const route = pfss
        ? (parts[1] === 'foundation' ? [] : parts.slice(1))
        : (legacyIndex >= 0 ? parts.slice(legacyIndex + 1) : []);
      const [m = '', t = '', d = ''] = route;
      if (!pfss && legacyIndex >= 0) {
        const canonicalPath = route.length ? `/pfss/${route.join('/')}` : '/pfss/foundation';
        history.replaceState(history.state, '', canonicalPath + location.search + location.hash);
      }
      this.module.set(m || 'overview');
      this.tab.set(t || 'overview');
      this.detail.set(d || 'overview');
    } catch { /* noop */ }
  }

  setModule(m: string): void {
    if (this.module() === m) { return; }
    this.module.set(m);
    this.tab.set('overview');
    this.detail.set('overview');
    this.write();
  }

  setTab(t: string): void {
    if (this.tab() === t) { return; }
    this.tab.set(t);
    this.detail.set('overview');
    this.write();
  }

  setDetail(d: string): void {
    if (this.detail() === d) { return; }
    this.detail.set(d);
    this.write();
  }

  /** 경로 세그먼트로 pushState 갱신 — 콘솔 라우터 재평가돼도 id 동일이라 재마운트 없음. */
  private write(): void {
    try {
      const m = this.module();
      const hasTabs = [
        'postgres', 'psmdb', 'valkey', 'rustfs', 'opensearch', 'keycloak', 'directory',
        'syncope', 'opa', 'litellm', 'langfuse', 'stalwart', 'novu', 'mattermost',
        'otel', 'tempo', 'loki', 'grafana-operator', 'ptm', 'delivery',
      ].includes(m);
      const t = this.tab();
      let next = m && m !== 'overview' ? `/pfss/${m}` : '/pfss/foundation';
      if (m && m !== 'overview' && hasTabs && t && t !== 'overview') next += `/${t}`;
      if (m === 'delivery' && t && t !== 'overview' && this.detail() !== 'overview') next += `/${this.detail()}`;
      const target = next + location.search + location.hash;
      if (location.pathname !== next) history.pushState(history.state, '', target);
    } catch { /* noop */ }
  }
}
