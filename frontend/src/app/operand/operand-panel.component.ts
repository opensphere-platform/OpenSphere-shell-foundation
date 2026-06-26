import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { OperandField, OperandPanel, REALM_FACTS } from '../core/operands';
import { resolveCell } from '../core/format';
import { ValueCellComponent } from './value-cell.component';

/** operand-panel — 카탈로그 패널을 표/필드로 렌더. 모든 값은 resolveCell 경유(위조 불가). */
@Component({
  selector: 'app-operand-panel',
  standalone: true,
  imports: [CommonModule, ValueCellComponent],
  template: `
    <div class="op-panel">
      <h4 class="fs-h4">{{ panel().title }}<span class="fs-muted" *ngIf="panel().kind==='table'"> · 목록</span></h4>

      <table class="table table-compact" *ngIf="panel().kind==='table'; else fieldsTpl">
        <thead><tr><th class="left" *ngFor="let c of panel().fields">{{ c.label }}</th></tr></thead>
        <tbody>
          <tr *ngFor="let row of panel().tableRows || []">
            <td class="left" *ngFor="let cell of row"><app-value-cell [cell]="resolve(cell)" [contract]="!!cell.contract"></app-value-cell></td>
          </tr>
          <tr *ngIf="!(panel().tableRows || []).length"><td class="fs-muted" [attr.colspan]="panel().fields.length">행은 배포 후 채워집니다(정의됨).</td></tr>
        </tbody>
      </table>

      <ng-template #fieldsTpl>
        <table class="table table-compact op-kv">
          <tbody>
            <tr *ngFor="let f of panel().fields">
              <td class="left op-k">{{ f.label }}<span class="fs-muted" *ngIf="f.unit && f.unit!=='bool'"> ({{ f.unit }})</span></td>
              <td class="left op-v"><app-value-cell [cell]="resolve(f)" [contract]="!!f.contract"></app-value-cell></td>
            </tr>
          </tbody>
        </table>
      </ng-template>

      <p class="fs-muted op-note" *ngIf="panel().note">ⓘ {{ panel().note }}</p>
    </div>
  `,
})
export class OperandPanelComponent {
  readonly panel = input.required<OperandPanel>();
  readonly fm = input<any>(null);
  readonly live = input<boolean>(false);
  resolve(f: OperandField) { return resolveCell(f, this.fm(), this.live(), REALM_FACTS); }
}
