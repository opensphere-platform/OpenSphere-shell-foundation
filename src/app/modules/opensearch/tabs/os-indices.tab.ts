import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { OsService } from '../os.service';
import { fmtBytes } from '../os.types';
import { PgState } from '../../postgres/ui/pg-state';

@Component({
  selector: 'os-indices',
  standalone: true,
  imports: [CommonModule, PgState],
  template: `
    <div class="claims-bar">
      <input class="cfg-filter" [value]="filter()" (input)="filter.set(val($event))" placeholder="인덱스 필터…" aria-label="인덱스 필터" style="margin:0">
      <span class="muted">{{ rows().length }} / {{ svc.indices().length }} 인덱스</span>
    </div>
    <pg-state [state]="svc.indexState()" hint="인덱스 없음" sub="앱이 첫 문서를 쓰면 자동 생성됩니다(auto-create-index)." (retry)="svc.refresh()">
      <table class="tbl">
        <thead><tr><th>인덱스</th><th>health</th><th>status</th><th>docs</th><th>deleted</th><th>샤드(p/r)</th><th>크기</th></tr></thead>
        <tbody>
          <tr *ngFor="let i of rows()">
            <td class="mono">{{ i.index }}</td>
            <td><span class="pill" [ngClass]="'os-' + i.health">{{ i.health }}</span></td>
            <td>{{ i.status }}</td>
            <td>{{ i['docs.count'] }}</td>
            <td>{{ i['docs.deleted'] }}</td>
            <td>{{ i.pri }}/{{ i.rep }}</td>
            <td>{{ size(i['store.size']) }}</td>
          </tr>
          <tr *ngIf="!rows().length"><td colspan="7" class="muted">일치하는 인덱스 없음</td></tr>
        </tbody>
      </table>
    </pg-state>
  `,
})
export class OsIndicesTab {
  readonly svc = inject(OsService);
  readonly filter = signal('');
  readonly rows = computed(() => {
    const f = this.filter().toLowerCase();
    return this.svc.indices().filter((i) => !f || String(i.index).toLowerCase().includes(f));
  });
  val(e: Event): string { return (e.target as HTMLInputElement).value; }
  size(b: any): string { return fmtBytes(b); }
}
