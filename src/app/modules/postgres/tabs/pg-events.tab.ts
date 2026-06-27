import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { CnpgService } from '../cnpg.service';
import { TlItem, age } from '../cnpg.types';
import { PgTimeline } from '../ui/pg-timeline';
import { PgState } from '../ui/pg-state';

@Component({
  selector: 'pg-events',
  standalone: true,
  imports: [CommonModule, PgTimeline, PgState],
  template: `
    <p class="muted">클러스터·Pod 관련 K8s Events (최신순, 최대 50). Warning은 빨강, Normal은 녹색.</p>
    <pg-state [state]="svc.eventState()" hint="이벤트 없음 — 안정적입니다." sub="최근 클러스터 변경/경고가 없습니다(고장 아님)." (retry)="svc.refresh()">
      <pg-timeline [items]="items()"></pg-timeline>
    </pg-state>
  `,
})
export class PgEventsTab {
  readonly svc = inject(CnpgService);
  readonly items = computed<TlItem[]>(() => [...this.svc.events()]
    .sort((a, b) => String(b.lastTimestamp || b.eventTime || '').localeCompare(String(a.lastTimestamp || a.eventTime || '')))
    .slice(0, 50)
    .map((e) => ({
      cls: e.type === 'Warning' ? 'bad' : 'ok',
      title: (e.reason || 'Event') + (e.count > 1 ? ` ×${e.count}` : ''),
      msg: e.message,
      when: age(e.lastTimestamp || e.eventTime) + ' 전',
    })));
}
