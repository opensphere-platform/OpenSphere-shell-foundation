import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * os-icon — 얇은 아웃라인(선) 인라인 SVG 아이콘. AI Hub / shell-template의 Carbon 라인 아이콘과 동일한
 * 시각 무게(fill:none·stroke:currentColor·1.7px)를 Carbon 의존 없이 재현.
 *   ※ cds-icon(Clarity Core 웹컴포넌트)은 이 ShadowDom Angular-Element 셸에서 부트스트랩 크래시 → 미사용.
 *   ※ @carbon/icons(채움 디스크립터)도 미사용 — 디자인 시스템 혼입 금지(사용자 지시).
 * 사용: <os-icon name="db" clrVerticalNavIcon class="os-tree-ic"/>
 */
const G: Record<string, string> = {
  overview: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  plugins: '<path d="M4 6h9"/><circle cx="17" cy="6" r="2.3"/><path d="M4 12h4"/><circle cx="12" cy="12" r="2.3"/><path d="M16 12h4"/><path d="M4 18h9"/><circle cx="17" cy="18" r="2.3"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  storage: '<rect x="3" y="4.5" width="18" height="6" rx="1"/><rect x="3" y="13" width="18" height="6" rx="1"/><path d="M7 7.5h0"/><path d="M7 16h0"/>',
  identity: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M16 14.2c2.8.2 4.5 2 4.5 4.8"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M16 14.2c2.8.2 4.5 2 4.5 4.8"/>',
  key: '<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13l8-8"/><path d="M15.5 5.5h3v3"/><path d="M14 9l2 2"/>',
};

@Component({
  selector: 'os-icon',
  standalone: true,
  template: `<span class="os-ic-wrap" [innerHTML]="html"></span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`:host{display:inline-flex} .os-ic-wrap{display:inline-flex;line-height:0} .os-ic-wrap ::ng-deep svg{stroke:currentColor;fill:none}`],
})
export class OsIcon {
  private san = inject(DomSanitizer);
  html: SafeHtml = '';
  private _s = 16;

  @Input({ required: true }) set name(k: string) { this._k = k; this.render(); }
  @Input() set size(s: number) { this._s = s; this.render(); }
  private _k = 'plugins';

  private render(): void {
    const inner = G[this._k] || G['plugins'];
    const svg = `<svg viewBox="0 0 24 24" width="${this._s}" height="${this._s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    this.html = this.san.bypassSecurityTrustHtml(svg);
  }
}
