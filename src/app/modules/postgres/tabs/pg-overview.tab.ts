import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject } from '@angular/core';
import { CnpgService } from '../cnpg.service';
import { TlItem } from '../cnpg.types';
import { PgMetric } from '../ui/pg-metric';
import { PgTimeline } from '../ui/pg-timeline';
import { PgState } from '../ui/pg-state';
import { PgChart, PgChartSeries } from '../ui/pg-chart';

@Component({
  selector: 'pg-overview',
  standalone: true,
  imports: [CommonModule, PgMetric, PgTimeline, PgState, PgChart],
  template: `
    <div class="os-metrics">
      <pg-metric label="상태" [value]="svc.phase()" [status]="svc.phaseCls()" [sub]="svc.lastSync() ? '동기화 ' + svc.lastSync() : ''"></pg-metric>
      <pg-metric label="인스턴스" [value]="svc.readyN() + ' / ' + svc.totalN()" [status]="svc.allReady() ? 'ok' : 'warn'" sub="ready" [clickable]="true" (go)="jump.emit('topology')"></pg-metric>
      <pg-metric label="Primary" [value]="primaryShort()" [status]="svc.primary() ? 'ok' : ''" [sub]="svc.primary() ? 'rw 라우팅' : '미상'" [clickable]="true" (go)="jump.emit('topology')"></pg-metric>
      <pg-metric label="PostgreSQL" [value]="'v' + svc.pgMajor()" [sub]="imageShort()"></pg-metric>
      <pg-metric label="Storage" [value]="svc.storage()" [sub]="svc.storageClass()" [clickable]="true" (go)="jump.emit('config')"></pg-metric>
    </div>

    <section class="pg-live" aria-labelledby="pg-live-title">
      <header class="pg-live-head">
        <div>
          <span class="pg-live-eyebrow">LIVE MONITORING</span>
          <h2 id="pg-live-title">PostgreSQL 운영 상태</h2>
          <p>Kubernetes 상태와 CloudNativePG exporter의 최근 1시간 시계열을 함께 표시합니다.</p>
        </div>
        <div class="pg-live-sync">
          <span [class.pg-live-ok]="svc.metricsState() === 'ok'">{{ monitoringStatus() }}</span>
          <small>{{ svc.metricsLastSync() ? '메트릭 ' + svc.metricsLastSync() : svc.lastSync() ? '상태 ' + svc.lastSync() : '동기화 대기' }}</small>
          <button class="btn btn-sm btn-outline" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">{{ svc.busy() ? '갱신 중' : '새로고침' }}</button>
        </div>
      </header>

      <div class="pg-live-grid">
        <article class="card pg-live-card">
          <div class="card-header"><span>인스턴스 가용성</span><small>현재 Pod 상태</small></div>
          <div class="card-block">
            <p>Primary와 replica가 Kubernetes Ready 조건을 충족하는지 비교합니다.</p>
            <pg-chart *ngIf="svc.instances().length; else noInstances" kind="horizontalBar"
              [labels]="instanceLabels()" [series]="instanceSeries()" [showLegend]="false"
              [ariaLabel]="'PostgreSQL 인스턴스별 Ready 비율. ' + instanceSummary()"></pg-chart>
            <ng-template #noInstances><div class="pg-live-empty">인스턴스가 발견되면 상태 차트를 표시합니다.</div></ng-template>
            <footer><span><b>{{ svc.readyN() }}</b> / {{ svc.totalN() }} Ready</span><span>재시작 {{ restartTotal() }}회</span></footer>
          </div>
        </article>

        <article class="card pg-live-card">
          <div class="card-header"><span>클러스터 가용성</span><small>현재 상태</small></div>
          <div class="card-block">
            <p>선언한 인스턴스 대비 실제 Ready 인스턴스 비율입니다.</p>
            <pg-chart kind="doughnut" [labels]="['Ready', 'Unavailable']" [series]="availabilitySeries()"
              [centerValue]="availability() + '%'" centerLabel="instances ready" [showLegend]="false"
              [ariaLabel]="'PostgreSQL 클러스터 가용성 ' + availability() + '퍼센트'"></pg-chart>
            <footer><span class="pg-live-state" [class.pg-live-ok]="svc.allReady()">{{ svc.phase() }}</span><span>Primary {{ primaryShort() }}</span></footer>
          </div>
        </article>

        <article class="card pg-live-card">
          <div class="card-header"><span>트랜잭션 처리량</span><small>최근 1시간</small></div>
          <div class="card-block">
            <p>초당 commit과 rollback 변화로 쓰기 부하와 오류 징후를 확인합니다.</p>
            <pg-chart *ngIf="hasTransactionMetrics(); else noTransactions" kind="line"
              [labels]="svc.transactionMetrics().labels" [series]="transactionSeries()"
              ariaLabel="최근 1시간 PostgreSQL 초당 commit 및 rollback 추이"></pg-chart>
            <ng-template #noTransactions><div class="pg-live-empty pg-live-empty--metrics"><b>{{ svc.metricsState() === 'error' ? 'Prometheus 조회 실패' : '시계열 대기 중' }}</b><span>{{ svc.metricsHint() }}</span></div></ng-template>
            <footer><span>Commit {{ latestTransaction('commit') }}/s</span><span>Rollback {{ latestTransaction('rollback') }}/s</span></footer>
          </div>
        </article>
      </div>
      <p class="pg-live-note"><b>수집:</b> 15초 자동 갱신 · CloudNativePG PodMonitor · Prometheus query_range(60초 간격). 메트릭 부재를 정상값 0으로 표시하지 않습니다.</p>
    </section>

    <div class="os-cardgrid">
      <div class="card">
        <div class="card-header">클러스터 · {{ svc.name }}</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>네임스페이스</dt><dd class="os-mono">{{ svc.ns }}</dd>
            <dt>이미지</dt><dd class="os-mono">{{ svc.image() || '—' }}</dd>
            <dt>프로파일</dt><dd>{{ svc.instanceProfile() }} (cpu/mem)</dd>
            <dt>관리 role</dt><dd>{{ svc.managedRoles().length }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">연결 — 상위 서비스 소비점</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>쓰기(RW)</dt><dd class="os-mono">{{ svc.name }}-rw.{{ svc.ns }}.svc:5432</dd>
            <dt>읽기(RO)</dt><dd class="os-mono">{{ svc.name }}-ro.{{ svc.ns }}.svc:5432</dd>
            <dt>자격 Secret</dt><dd class="os-mono">{{ svc.name }}-app · pgc-&lt;claim&gt;-conn</dd>
          </dl>
          <p class="os-sub">키: host·port·dbname·user·password·uri. 값은 정책상 비노출 — <code>kubectl get secret</code>.</p>
        </div>
      </div>
    </div>

    <div class="os-sech">상태 조건 (conditions)</div>
    <pg-state [state]="condState()" hint="조건 보고 없음" sub="클러스터가 막 생성되었거나 status를 아직 보고하지 않습니다." (retry)="svc.refresh()">
      <pg-timeline [items]="condItems()"></pg-timeline>
    </pg-state>
  `,
  styles: [`
    .pg-live { margin: 1.1rem 0 1.25rem; }
    .pg-live-head { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: .55rem; }
    .pg-live-eyebrow { display: block; color: #4c6fff; font-size: .58rem; font-weight: 700; letter-spacing: .08em; }
    .pg-live-head h2 { margin: .12rem 0 0; color: #1b2a32; font-size: 1rem; font-weight: 600; }
    .pg-live-head p { margin: .18rem 0 0; color: #5b6971; font-size: .67rem; }
    .pg-live-sync { display: grid; grid-template-columns: auto auto auto; align-items: center; gap: .2rem .55rem; text-align: right; color: #a32100; font-size: .62rem; }
    .pg-live-sync small { color: #5b6971; }
    .pg-live-sync .btn { grid-row: 1 / span 2; grid-column: 3; margin: 0; }
    .pg-live-ok { color: #2f8400 !important; }
    .pg-live-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
    .pg-live-card { min-width: 0; margin: 0; border-radius: 0; box-shadow: 0 2px 0 #d7dcdf; }
    .pg-live-card .card-header { display: flex; justify-content: space-between; align-items: center; min-height: 2.6rem; padding: .65rem .8rem; border-bottom: 1px solid #d7dcdf; font-size: .82rem; font-weight: 600; }
    .pg-live-card .card-header small { color: #5b6971; font-size: .58rem; font-weight: 400; }
    .pg-live-card .card-block { display: flex; min-height: 18.5rem; padding: .7rem .8rem .55rem; flex-direction: column; }
    .pg-live-card .card-block > p { min-height: 2rem; margin: 0 0 .35rem; color: #394b54; font-size: .65rem; line-height: 1.45; }
    .pg-live-card footer { display: flex; justify-content: space-between; gap: .5rem; margin-top: auto; padding-top: .45rem; border-top: 1px solid #eef0f2; color: #5b6971; font-size: .61rem; }
    .pg-live-card footer b { color: #1b2a32; }
    .pg-live-state { max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pg-live-empty { display: grid; min-height: 12rem; place-content: center; padding: 1rem; text-align: center; color: #5b6971; background: #f7f8f9; font-size: .65rem; }
    .pg-live-empty--metrics { gap: .3rem; }
    .pg-live-empty--metrics b { color: #394b54; font-size: .72rem; }
    .pg-live-note { margin: .55rem 0 0; color: #5b6971; font-size: .6rem; }
    @media (max-width: 1050px) { .pg-live-grid { grid-template-columns: 1fr; } .pg-live-card .card-block { min-height: 17rem; } }
    @media (max-width: 680px) { .pg-live-head { align-items: start; flex-direction: column; } .pg-live-sync { text-align: left; } }
  `],
})
export class PgOverviewTab {
  readonly svc = inject(CnpgService);
  @Output() jump = new EventEmitter<string>();

  primaryShort(): string { const p = this.svc.primary(); return p ? p.replace(this.svc.name + '-', '#') : '—'; }
  imageShort(): string { const i = this.svc.image(); return i ? (i.split('/').pop() || i) : '—'; }

  readonly instanceLabels = computed(() => this.svc.instances().map((item) => item.name.replace(`${this.svc.name}-`, '#')));
  readonly instanceSeries = computed<PgChartSeries[]>(() => [{ label: 'Ready', data: this.svc.instances().map((item) => item.ready ? 100 : 0), color: '#003b5c' }]);
  readonly availabilitySeries = computed<PgChartSeries[]>(() => {
    const ready = this.svc.readyN();
    const unavailable = Math.max(0, this.svc.totalN() - ready);
    return [{ label: 'Instances', data: [ready, unavailable], color: '#24a148', colors: ['#24a148', '#d7dcdf'] }];
  });
  readonly transactionSeries = computed<PgChartSeries[]>(() => [
    { label: 'Commit /s', data: this.svc.transactionMetrics().commit, color: '#003b5c' },
    { label: 'Rollback /s', data: this.svc.transactionMetrics().rollback, color: '#da1e28' },
  ]);
  readonly hasTransactionMetrics = computed(() => this.svc.metricsState() === 'ok' && this.svc.transactionMetrics().labels.length > 0);

  availability(): number { return this.svc.totalN() ? Math.round((this.svc.readyN() / this.svc.totalN()) * 100) : 0; }
  restartTotal(): number { return this.svc.instances().reduce((sum, item) => sum + item.restarts, 0); }
  instanceSummary(): string { return this.svc.instances().map((item) => `${item.name} ${item.ready ? 'Ready' : 'Not Ready'}`).join(', '); }
  monitoringStatus(): string {
    if (!this.svc.monitoringEnabled()) return 'PodMonitor disabled';
    if (this.svc.metricsState() === 'ok') return 'Prometheus connected';
    if (this.svc.metricsState() === 'error') return 'Prometheus unavailable';
    return 'Metrics pending';
  }
  latestTransaction(kind: 'commit' | 'rollback'): string {
    const values = this.svc.transactionMetrics()[kind];
    const value = values.at(-1);
    return value == null || !Number.isFinite(value) ? '—' : String(Math.round(value * 100) / 100);
  }

  readonly condState = computed(() => {
    if (this.svc.conditions().length) { return 'ok' as const; }
    return this.svc.clusterState() === 'ok' ? ('empty' as const) : this.svc.clusterState();
  });
  readonly condItems = computed<TlItem[]>(() => this.svc.conditions().map((c: any) => ({
    cls: c.status === 'True' ? 'ok' : (c.type === 'Ready' ? 'bad' : 'warn'),
    title: c.type + (c.reason ? ' · ' + c.reason : ''),
    msg: c.message,
    when: c.lastTransitionTime ? new Date(c.lastTransitionTime).toLocaleString() : '',
  })));
}
