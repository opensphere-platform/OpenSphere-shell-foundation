import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

export interface BarDatum { label: string; value: number; kind?: 'ok' | 'bad' | 'warn' | 'default'; hint?: string }

// 의존성 없는 최소 막대 차트 — 타깃 up/down, 인증서 만료 임박도, Release 상태 분포 등 "값 목록의 상대 비교"에 공용.
@Component({
  selector: 'os-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="obc-wrap">
      <div class="obc-row" *ngFor="let d of data">
        <span class="obc-label">{{ d.label }}</span>
        <div class="obc-track"><div class="obc-fill" [ngClass]="'obc-' + (d.kind || 'default')" [style.width.%]="pct(d.value)"></div></div>
        <span class="obc-val">{{ d.value }}{{ d.hint ? ' ' + d.hint : '' }}</span>
      </div>
      <p class="obc-empty" *ngIf="!data.length">표시할 값 없음</p>
    </div>
  `,
})
export class BarChart {
  @Input() data: BarDatum[] = [];
  pct(v: number): number {
    const max = Math.max(1, ...this.data.map((d) => Math.abs(d.value)));
    return Math.min(100, Math.round((Math.abs(v) / max) * 100));
  }
}
