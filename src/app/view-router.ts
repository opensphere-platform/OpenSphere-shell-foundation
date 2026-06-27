import { Injectable, signal } from '@angular/core';

// Foundation 콘솔의 딥링크 주소 — mainShell은 pathname(/p/foundation)만 매칭하므로 하위경로 위임이 안 됨.
// → subShell이 foundation 전용 쿼리 파라미터 ?fview=<module>.<tab> 를 소유해 각 메뉴/탭에 개별 주소를 부여.
// 예: /p/foundation?fview=postgres.config · /p/foundation?fview=opensearch.indices
// 북마크·공유·새로고침 위치유지·뒤로가기(popstate) 지원. 다른 subShell과 충돌 안 하도록 'fview'로 네임스페이스.
const PARAM = 'fview';

@Injectable({ providedIn: 'root' })
export class ViewRouter {
  readonly module = signal<string>('overview');
  readonly tab = signal<string>('overview');

  constructor() {
    this.read();
    try { window.addEventListener('popstate', () => this.read()); } catch { /* noop */ }
  }

  private read(): void {
    let v = '';
    try { v = new URLSearchParams(location.search).get(PARAM) || ''; } catch { /* noop */ }
    const [m, t] = (v || 'overview').split('.');
    this.module.set(m || 'overview');
    this.tab.set(t || 'overview');
  }

  setModule(m: string): void {
    if (this.module() === m) { return; }
    this.module.set(m);
    this.tab.set('overview');
    this.write(true);
  }

  setTab(t: string): void {
    if (this.tab() === t) { return; }
    this.tab.set(t);
    this.write(true);
  }

  private write(push: boolean): void {
    try {
      const u = new URL(location.href);
      const hasTabs = this.module() === 'postgres' || this.module() === 'opensearch';
      u.searchParams.set(PARAM, hasTabs ? `${this.module()}.${this.tab()}` : this.module());
      const target = u.pathname + u.search + u.hash;
      if (push) { history.pushState(history.state, '', target); }
      else { history.replaceState(history.state, '', target); }
    } catch { /* noop */ }
  }
}
