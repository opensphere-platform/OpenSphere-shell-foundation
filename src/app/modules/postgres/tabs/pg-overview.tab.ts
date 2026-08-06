import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CnpgService } from '../cnpg.service';
import { TlItem } from '../cnpg.types';
import { PgTimeline } from '../ui/pg-timeline';
import { PgState } from '../ui/pg-state';
import { PgChart, PgChartSeries } from '../ui/pg-chart';

@Component({
  selector: 'pg-overview',
  standalone: true,
  imports: [CommonModule, PgTimeline, PgState, PgChart],
  template: `
    <section class="pg-live" *ngIf="part === 'monitoring'" aria-labelledby="pg-live-title">
      <header class="pg-live-head">
        <div>
          <span class="pg-live-eyebrow">LIVE MONITORING</span>
          <h2 id="pg-live-title">PostgreSQL 운영 상태</h2>
          <p>Kubernetes 상태와 {{ providerLabel() }} exporter의 최근 1시간 시계열을 함께 표시합니다.</p>
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
      <p class="pg-live-note"><b>수집:</b> 15초 자동 갱신 · {{ providerLabel() }} exporter · Prometheus query_range(60초 간격). 메트릭 부재를 정상값 0으로 표시하지 않습니다.</p>
    </section>

    <ng-container *ngIf="part === 'details'">
    <section class="pg-storage" aria-labelledby="pg-storage-title">
      <div class="os-sech" id="pg-storage-title">Persistent volumes</div>
      <table class="table" *ngIf="svc.pvcRows().length; else noPvcs">
        <thead><tr><th>PVC</th><th>상태</th><th>용량</th><th>StorageClass</th><th>PersistentVolume</th></tr></thead>
        <tbody><tr *ngFor="let pvc of svc.pvcRows()"><td class="os-mono">{{ pvc.name }}</td><td><span class="label" [ngClass]="pvc.status === 'Bound' ? 'label-success' : 'label-warning'">{{ pvc.status }}</span></td><td>{{ pvc.capacity }}</td><td class="os-mono">{{ pvc.storageClass }}</td><td class="os-mono">{{ pvc.volume }}</td></tr></tbody>
      </table>
      <ng-template #noPvcs><p class="pg-live-empty pg-live-empty--compact">PostgreSQL 데이터 PVC가 아직 발견되지 않았습니다.</p></ng-template>
    </section>

    <div class="os-cardgrid pg-overview-details">
      <div class="card">
        <div class="card-header">클러스터 · {{ svc.name }}</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>네임스페이스</dt><dd class="os-mono">{{ svc.ns }}</dd>
            <dt>이미지</dt><dd><strong>PostgreSQL {{ svc.pgMajor() }}</strong><details class="pg-image-evidence"><summary>이미지 근거</summary><code>{{ svc.image() || '—' }}</code></details></dd>
            <dt>프로파일</dt><dd>{{ svc.instanceProfile() }} (cpu/mem)</dd>
            <dt>관리 role</dt><dd>{{ svc.managedRoles().length }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">연결 — 상위 서비스 소비점</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>쓰기(RW)</dt><dd class="os-mono">{{ svc.writeService() }}</dd>
            <dt>읽기(RO)</dt><dd class="os-mono">{{ svc.readService() }}</dd>
            <dt>자격 Secret</dt><dd class="os-mono">{{ svc.credentialSecret() }}</dd>
          </dl>
          <p class="os-sub">키: host·port·dbname·user·password·uri. 값은 정책상 비노출 — <code>kubectl get secret</code>.</p>
        </div>
      </div>
    </div>

    <div class="os-sech">상태 조건 (conditions)</div>
    <pg-state [state]="condState()" hint="조건 보고 없음" sub="클러스터가 막 생성되었거나 status를 아직 보고하지 않습니다." (retry)="svc.refresh()">
      <pg-timeline [items]="condItems()"></pg-timeline>
    </pg-state>
    </ng-container>
  `,
  styles: [`
    .pg-live { margin: 1.1rem 0 1.25rem; }
    .pg-live-head { display: flex; min-height: 5.25rem; box-sizing: border-box; justify-content: space-between; align-items: center; gap: 1.25rem; margin-bottom: .55rem; padding: .9rem 1rem; background: #102a43; }
    .pg-live-head > div:first-child { display: grid; min-width: 0; align-content: center; gap: .2rem; }
    .pg-live-eyebrow { display: block; color: #78a9ff; font-size: .58rem; font-weight: 700; line-height: 1.2; letter-spacing: .08em; }
    .pg-live-head h2 { margin: 0; color: #fff; font-size: .88rem; font-weight: 600; line-height: 1.25; }
    .pg-live-head p { margin: 0; color: #d9e2ec; font-size: .64rem; line-height: 1.45; }
    .pg-live-sync { display: grid; grid-template-columns: auto auto auto; align-items: center; gap: .2rem .55rem; text-align: right; color: #ffb3a7; font-size: .62rem; }
    .pg-live-sync small { color: #d9e2ec; }
    .pg-live-sync .btn { grid-row: 1 / span 2; grid-column: 3; margin: 0; }
    .pg-live-sync .pg-live-ok { color: #7ee2b8 !important; }
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
    .pg-live-empty--compact { min-height: 5rem; margin: 0; }
    .pg-live-empty--metrics b { color: #394b54; font-size: .72rem; }
    .pg-live-note { margin: .55rem 0 0; color: #5b6971; font-size: .6rem; }
    .pg-storage { margin: 1rem 0; }
    .pg-overview-details { grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; align-items: stretch; }
    .pg-overview-details > .card { min-width: 0; width: 100%; margin: 0; }
    .pg-overview-details .card-header { min-height: 2.5rem; padding: .6rem .8rem; border-bottom: 1px solid #d7dcdf; font-size: .72rem; font-weight: 500; line-height: 1.35; }
    .pg-overview-details .card-block { min-height: 8rem; padding: .65rem .8rem; }
    .pg-overview-details .os-kv { grid-template-columns: 6.5rem minmax(0, 1fr); gap: .3rem .75rem; font-size: .66rem; line-height: 1.45; }
    .pg-overview-details .os-kv dd { min-width: 0; overflow-wrap: anywhere; font-weight: 400; }
    .pg-overview-details .os-mono { font-size: .65rem; font-weight: 400; line-height: 1.45; }
    .pg-overview-details .os-sub { margin: .55rem 0 0; font-size: .61rem; line-height: 1.45; }
    .pg-image-evidence { margin-top: .3rem; }
    .pg-image-evidence summary { cursor: pointer; color: #0067a0; font-size: .62rem; }
    .pg-image-evidence code { display: block; margin-top: .25rem; overflow-wrap: anywhere; color: #5b6971; font-size: .58rem; line-height: 1.45; }
    @media (max-width: 1050px) { .pg-live-grid, .pg-overview-details { grid-template-columns: 1fr; } .pg-live-card .card-block { min-height: 17rem; } }
    @media (max-width: 680px) { .pg-live-head { align-items: start; flex-direction: column; } .pg-live-sync { text-align: left; } }
  `],
})
export class PgOverviewTab {
  readonly svc = inject(CnpgService);
  @Input() part: 'monitoring' | 'details' = 'monitoring';
  @Output() jump = new EventEmitter<string>();

  primaryShort(): string { const p = this.svc.primary(); return p ? p.replace(this.svc.name + '-', '#') : '—'; }
  providerLabel(): string { return 'StackGres'; }

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
    if (!this.svc.monitoringEnabled()) return 'Exporter disabled';
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
