import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Carbon 아이콘 렌더러 — @carbon/icons SVG 디스크립터를 직접 직렬화(@carbon/icons-angular는 Angular11 고정).
 * 사용: import Code32 from '@carbon/icons/es/code/32'; <os-cicon [icon]="Code32" [size]="32"/>
 */
interface IconNode { elem: string; attrs?: Record<string, unknown>; content?: IconNode[]; }

@Component({
  selector: 'os-cicon',
  template: `<span class="os-cicon" [innerHTML]="html"></span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`:host{display:inline-flex} .os-cicon{display:inline-flex;line-height:0} .os-cicon ::ng-deep svg{fill:currentColor}`],
})
export class CarbonIcon {
  private san = inject(DomSanitizer);
  html: SafeHtml = '';
  private _d?: IconNode;
  private _s = 16;

  @Input({ required: true }) set icon(d: IconNode) { this._d = d; this.render(); }
  @Input() set size(s: number) { this._s = s; this.render(); }

  private render(): void {
    if (!this._d) return;
    const root: IconNode = { ...this._d, attrs: { ...this._d.attrs, width: this._s, height: this._s } };
    this.html = this.san.bypassSecurityTrustHtml(this.toStr(root));
  }
  private toStr(n: IconNode): string {
    const a = Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${String(v)}"`).join(' ');
    const inner = (n.content || []).map((c) => this.toStr(c)).join('');
    return `<${n.elem} ${a}>${inner}</${n.elem}>`;
  }
}
