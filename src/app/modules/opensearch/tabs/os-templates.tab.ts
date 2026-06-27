import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { OsService } from '../os.service';
import { PgState } from '../../postgres/ui/pg-state';

@Component({
  selector: 'os-templates',
  standalone: true,
  imports: [CommonModule, PgState],
  template: `
    <div class="sec-h">인덱스 템플릿</div>
    <pg-state [state]="svc.tmplState()" hint="템플릿 없음" sub="OpenSearchIndexClaim(operator 승격 후)이 여기에 템플릿을 발급합니다." (retry)="svc.refresh()">
      <table class="tbl">
        <thead><tr><th>이름</th><th>패턴</th><th>order</th><th>version</th></tr></thead>
        <tbody>
          <tr *ngFor="let t of svc.templates()">
            <td class="mono">{{ t.name }}</td>
            <td class="mono">{{ t.index_patterns }}</td>
            <td>{{ t.order ?? '—' }}</td>
            <td>{{ t.version ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </pg-state>

    <div class="sec-h">별칭 (Aliases)</div>
    <div class="empty" *ngIf="!svc.aliases().length">별칭 없음.</div>
    <table class="tbl" *ngIf="svc.aliases().length">
      <thead><tr><th>alias</th><th>인덱스</th><th>write index</th></tr></thead>
      <tbody>
        <tr *ngFor="let a of svc.aliases()">
          <td class="mono">{{ a.alias }}</td>
          <td class="mono">{{ a.index }}</td>
          <td>{{ a.is_write_index || '—' }}</td>
        </tr>
      </tbody>
    </table>
  `,
})
export class OsTemplatesTab {
  readonly svc = inject(OsService);
}
