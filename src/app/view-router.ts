import { Injectable, signal } from '@angular/core';

// Foundation 딥링크 — 플랫폼 표준(shell-template 원본)과 동일: **경로 세그먼트 + pushState/popstate**.
// 콘솔 pluginHostMatcher가 `/p/foundation` 아래 임의 서브패스를 전부 위임하므로, 서브패스가 바뀌어도
// id(foundation)가 그대로면 재마운트되지 않는다. 주소 형태:
//   · 모듈:      /p/foundation/<module>            (예: /p/foundation/postgres)
//   · 모듈+탭:   /p/foundation/<module>/<tab>       (예: /p/foundation/postgres/config)
//   · overview:  /p/foundation                      (fragment 없음)
// (구 `?fview=<module>.<tab>` 쿼리 방식 폐기 — D-14. select()/syncUrl() 한 곳만 URL을 건드린다.)
@Injectable({ providedIn: 'root' })
export class ViewRouter {
  readonly module = signal<string>('overview');
  readonly tab = signal<string>('overview');

  constructor() {
    this.read();
    try { window.addEventListener('popstate', () => this.read()); } catch { /* noop */ }
  }

  /** URL 경로 → module/tab 복원(북마크·새로고침·뒤로가기). 'foundation' 세그먼트 뒤를 취한다. */
  private read(): void {
    try {
      const parts = location.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('foundation');
      const m = i >= 0 ? (parts[i + 1] ?? '') : '';
      const t = i >= 0 ? (parts[i + 2] ?? '') : '';
      this.module.set(m || 'overview');
      this.tab.set(t || 'overview');
    } catch { /* noop */ }
  }

  setModule(m: string): void {
    if (this.module() === m) { return; }
    this.module.set(m);
    this.tab.set('overview');
    this.write();
  }

  setTab(t: string): void {
    if (this.tab() === t) { return; }
    this.tab.set(t);
    this.write();
  }

  /** 경로 세그먼트로 pushState 갱신 — 콘솔 라우터 재평가돼도 id 동일이라 재마운트 없음. */
  private write(): void {
    try {
      const m = this.module();
      const hasTabs = m === 'postgres' || m === 'opensearch' || m === 'bss' || m === 'engines';
      const t = this.tab();
      let next = '/p/foundation';
      if (m && m !== 'overview') next += hasTabs && t && t !== 'overview' ? `/${m}/${t}` : `/${m}`;
      const target = next + location.search + location.hash;
      if (location.pathname !== next) history.pushState(history.state, '', target);
    } catch { /* noop */ }
  }
}
