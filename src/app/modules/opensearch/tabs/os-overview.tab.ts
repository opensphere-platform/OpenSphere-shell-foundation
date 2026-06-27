import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject } from '@angular/core';
import { OsService } from '../os.service';
import { TlItem, fmtBytes } from '../os.types';
import { PgMetric } from '../../postgres/ui/pg-metric';
import { PgTimeline } from '../../postgres/ui/pg-timeline';
import { PgState } from '../../postgres/ui/pg-state';

@Component({
  selector: 'os-overview',
  standalone: true,
  imports: [CommonModule, PgMetric, PgTimeline, PgState],
  template: `
    <div class="os-metrics">
      <pg-metric label="상태" [value]="svc.status() || '확인 중'" [status]="svc.statusPhase()" [sub]="svc.lastSync() ? '동기화 ' + svc.lastSync() : ''"></pg-metric>
      <pg-metric label="노드" [value]="svc.nodeCount()" status="ok" [sub]="'data ' + svc.dataNodes()"></pg-metric>
      <pg-metric label="인덱스" [value]="svc.indexCount()" [sub]="svc.docCount() + ' docs'" [clickable]="true" (go)="jump.emit('indices')"></pg-metric>
      <pg-metric label="크기" [value]="bytes()"></pg-metric>
      <pg-metric label="활성 샤드" [value]="svc.activeShards()" [status]="svc.unassigned() ? 'warn' : 'ok'" [sub]="svc.shardPct() + '%'" [clickable]="true" (go)="jump.emit('shards')"></pg-metric>
    </div>

    <div class="os-cardgrid">
      <div class="card">
        <div class="card-header">클러스터 · {{ svc.clusterName() }}</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>버전</dt><dd class="os-mono">{{ svc.version() }}</dd>
            <dt>네임스페이스</dt><dd class="os-mono">{{ svc.ns }}</dd>
            <dt>모드</dt><dd>single-node (dev) · security 비활성</dd>
            <dt>pending tasks</dt><dd>{{ svc.pendingTasks() }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">연결 — 상위 서비스 소비점</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>엔드포인트</dt><dd class="os-mono">{{ svc.endpoint }}</dd>
            <dt>인덱스</dt><dd>{{ svc.indexCount() }}</dd>
            <dt>문서 합</dt><dd>{{ svc.docCount() }}</dd>
          </dl>
          <p class="os-muted">Help Center 종합검색의 백본. 앱별 인덱스는 <code class="os-mono">OpenSearchIndexClaim</code>(Claims 탭).</p>
        </div>
      </div>
    </div>

    <div class="os-sech">샤드 분포</div>
    <pg-state [state]="svc.healthState()" hint="health 조회 불가" (retry)="svc.refresh()">
      <pg-timeline [items]="shardItems()"></pg-timeline>
    </pg-state>
  `,
})
export class OsOverviewTab {
  readonly svc = inject(OsService);
  @Output() jump = new EventEmitter<string>();
  bytes(): string { return fmtBytes(this.svc.storeBytes()); }
  readonly shardItems = computed<TlItem[]>(() => [
    { cls: 'ok', title: '활성 (STARTED)', msg: this.svc.activeShards() + ' 샤드 · ' + this.svc.shardPct() + '%' },
    { cls: this.svc.relocating() ? 'warn' : '', title: '재배치 (relocating)', msg: String(this.svc.relocating()) },
    { cls: this.svc.initializing() ? 'warn' : '', title: '초기화 (initializing)', msg: String(this.svc.initializing()) },
    { cls: this.svc.unassigned() ? 'bad' : '', title: '미할당 (unassigned)', msg: this.svc.unassigned() + (this.svc.unassigned() ? ' — 단일노드에서 replica 미할당은 정상' : '') },
  ]);
}
