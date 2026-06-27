import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { OsService } from '../os.service';
import { PgState } from '../../postgres/ui/pg-state';
import { PgKv } from '../../postgres/ui/pg-kv';

@Component({
  selector: 'os-tasks',
  standalone: true,
  imports: [CommonModule, PgState, PgKv],
  template: `
    <div class="sec-h">Pending Cluster Tasks</div>
    <pg-state [state]="svc.taskState()" hint="대기 작업 없음 — 안정적입니다." sub="클러스터 상태변경 큐가 비어 있습니다(고장 아님)." (retry)="svc.refresh()">
      <table class="tbl">
        <thead><tr><th>순번</th><th>우선순위</th><th>소스</th><th>대기(ms)</th></tr></thead>
        <tbody>
          <tr *ngFor="let t of svc.pending()">
            <td>{{ t.insert_order }}</td>
            <td>{{ t.priority }}</td>
            <td class="mono">{{ t.source }}</td>
            <td>{{ t.time_in_queue_millis }}</td>
          </tr>
        </tbody>
      </table>
    </pg-state>

    <div class="sec-h">Thread Pools (활성)</div>
    <div class="empty" *ngIf="!svc.threadPool().length">활성 thread pool 없음 — 유휴 상태입니다.</div>
    <table class="tbl" *ngIf="svc.threadPool().length">
      <thead><tr><th>노드</th><th>pool</th><th>active</th><th>queue</th><th>rejected</th></tr></thead>
      <tbody>
        <tr *ngFor="let t of svc.threadPool()">
          <td class="mono">{{ t.node_name }}</td>
          <td>{{ t.name }}</td>
          <td>{{ t.active }}</td>
          <td>{{ t.queue }}</td>
          <td><span class="pill" [class.bad]="+t.rejected">{{ t.rejected }}</span></td>
        </tr>
      </tbody>
    </table>

    <div class="sec-h">클러스터 설정 (override)</div>
    <div class="empty" *ngIf="!hasSettings()">override 설정 없음 — 기본값을 사용합니다.</div>
    <pg-kv [params]="settingsFlat()" *ngIf="hasSettings()"></pg-kv>
  `,
})
export class OsTasksTab {
  readonly svc = inject(OsService);
  readonly settingsFlat = computed<Record<string, string>>(() => {
    const s = this.svc.settings() || {};
    return { ...(s.persistent || {}), ...(s.transient || {}) };
  });
  hasSettings(): boolean { return Object.keys(this.settingsFlat()).length > 0; }
}
