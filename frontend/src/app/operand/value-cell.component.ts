import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { ResolvedCell } from '../core/format';

/** value-cell — resolveCell 4상태만 렌더(live/scrape-pending/planned/n-a). 숫자는 sourced 상태에서만. 위조 불가. */
@Component({
  selector: 'app-value-cell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container [ngSwitch]="cell()?.state">
      <span *ngSwitchCase="'label'" class="vc vc-lbl">{{ cell()?.value }}</span>
      <span *ngSwitchCase="'live'" class="vc vc-live" [title]="cell()?.sourceLabel || 'live'">{{ cell()?.value }}{{ unitSuffix() }}</span>
      <span *ngSwitchCase="'n-a'" class="vc vc-na" title="실측 가능하나 현재 값 없음">n/a</span>
      <span *ngSwitchCase="'scrape-pending'" class="vc vc-pending" [title]="cell()?.sourceLabel || ''">{{ cell()?.note || '측정 대기' }}</span>
      <span *ngSwitchDefault class="vc vc-planned" title="미배포 — 정의만(배포 후 측정)">배포 후 측정<span *ngIf="cell()?.slice"> · {{ cell()?.slice }}</span></span>
    </ng-container>
    <span class="vc-slo" *ngIf="cell()?.slo">목표 {{ cell()?.slo }}</span>
    <span class="vc-badge vc-contract" *ngIf="contract()" title="디스크립터 계약 metric">계약</span>
  `,
})
export class ValueCellComponent {
  readonly cell = input<ResolvedCell | null>(null);
  readonly contract = input<boolean>(false);
  unitSuffix() { const c = this.cell(); return (c?.unit && c.unit !== 'bool' && c.value != null) ? ' ' + c.unit : ''; }
}
