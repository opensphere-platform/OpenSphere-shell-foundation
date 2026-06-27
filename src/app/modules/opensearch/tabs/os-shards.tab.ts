import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { OsService } from '../os.service';
import { fmtBytes } from '../os.types';
import { PgState } from '../../postgres/ui/pg-state';

@Component({
  selector: 'os-shards',
  standalone: true,
  imports: [CommonModule, PgState],
  template: `
    <p class="muted">샤드 할당 — 단일노드에서 replica(r) 샤드는 <b>UNASSIGNED</b>가 정상입니다(같은 노드에 복제 불가).</p>
    <pg-state [state]="svc.shardState()" hint="샤드 없음" (retry)="svc.refresh()">
      <table class="tbl">
        <thead><tr><th>인덱스</th><th>샤드</th><th>유형</th><th>상태</th><th>docs</th><th>크기</th><th>노드</th></tr></thead>
        <tbody>
          <tr *ngFor="let s of svc.shards()">
            <td class="mono">{{ s.index }}</td>
            <td>{{ s.shard }}</td>
            <td>{{ s.prirep === 'p' ? 'primary' : 'replica' }}</td>
            <td><span class="pill" [ngClass]="scls(s.state)">{{ s.state }}</span></td>
            <td>{{ s.docs || '—' }}</td>
            <td>{{ size(s.store) }}</td>
            <td class="mono">{{ s.node || '— (unassigned)' }}</td>
          </tr>
        </tbody>
      </table>
    </pg-state>
  `,
})
export class OsShardsTab {
  readonly svc = inject(OsService);
  scls(state: string): string {
    if (state === 'STARTED') { return 'os-green'; }
    if (state === 'UNASSIGNED') { return ''; }   // 중립 회색(에러 아님 — 단일노드 replica)
    return 'os-yellow';                            // RELOCATING / INITIALIZING
  }
  size(b: any): string { return fmtBytes(b); }
}
