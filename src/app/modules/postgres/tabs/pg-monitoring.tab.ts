import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { CnpgService, PgMonitoringMetrics } from '../cnpg.service';
import { Phase } from '../cnpg.types';
import { PgChart, PgChartSeries } from '../ui/pg-chart';
import { PgMetric } from '../ui/pg-metric';

type SeriesKey = Exclude<keyof PgMonitoringMetrics, 'labels'>;

@Component({
  selector: 'pg-monitoring',
  standalone: true,
  imports: [CommonModule, PgChart, PgMetric],
  template: `
    <section class="pg-monitoring" aria-labelledby="pg-monitoring-title">
      <header class="pg-monitoring-head">
        <div class="pg-monitoring-title"><span>OPERATIONS · PROMETHEUS</span><h2 id="pg-monitoring-title">PostgreSQL Monitoring</h2><p>{{ providerLabel() }} exporter와 Kubernetes 볼륨·컨테이너 시계열을 최근 1시간 기준으로 표시합니다.</p></div>
        <div class="pg-monitoring-sync"><strong [class.ok]="svc.metricsState() === 'ok'">{{ statusLabel() }}</strong><small>{{ svc.metricsHint() }}</small><button class="btn btn-sm btn-outline" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">{{ svc.busy() ? '갱신 중' : '새로고침' }}</button></div>
      </header>

      <div class="os-metrics pg-monitoring-metrics">
        <pg-metric label="활성 연결" [value]="numberValue('connections')" [status]="statusFor('connections')" sub="backends total"></pg-metric>
        <pg-metric label="대기 연결" [value]="numberValue('waiting')" [status]="statusFor('waiting', true)" sub="waiting backends"></pg-metric>
        <pg-metric label="Commit" [value]="rateValue('commit')" sub="transactions / second"></pg-metric>
        <pg-metric label="Rollback" [value]="rateValue('rollback')" [status]="statusFor('rollback', true)" sub="transactions / second"></pg-metric>
        <pg-metric label="Cache hit" [value]="percentValue('cacheHitPct')" [status]="cacheStatus()" sub="buffer hit ratio"></pg-metric>
        <pg-metric label="Database size" [value]="bytesValue('databaseBytes')" sub="all databases"></pg-metric>
        <pg-metric label="Replication lag" [value]="secondsValue('replicationLagSeconds')" [status]="statusFor('replicationLagSeconds', true)" sub="maximum"></pg-metric>
        <pg-metric label="WAL" [value]="bytesRateValue('walBytesPerSecond')" sub="generated / second"></pg-metric>
        <pg-metric label="CPU" [value]="cpuValue()" sub="postgres containers"></pg-metric>
        <pg-metric label="Memory" [value]="bytesValue('memoryBytes')" sub="working set"></pg-metric>
        <pg-metric label="PVC usage" [value]="pvcUsage()" [status]="pvcStatus()" sub="data volumes"></pg-metric>
      </div>

      <div class="pg-monitoring-grid" *ngIf="svc.metricsState() === 'ok'; else metricsUnavailable">
        <article class="card"><div class="card-header"><span>트랜잭션 처리량</span><small>commit / rollback</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['commit','rollback']); else noSeries" kind="line" [labels]="labels()" [series]="transactionSeries()" ariaLabel="최근 1시간 PostgreSQL commit과 rollback 초당 처리량"></pg-chart></div></article>
        <article class="card"><div class="card-header"><span>연결 상태</span><small>active / waiting</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['connections','waiting']); else noSeries" kind="line" [labels]="labels()" [series]="connectionSeries()" ariaLabel="최근 1시간 PostgreSQL 활성 연결과 대기 연결"></pg-chart></div></article>
        <article class="card"><div class="card-header"><span>WAL 생성량</span><small>MiB/s</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['walBytesPerSecond']); else noSeries" kind="line" [labels]="labels()" [series]="walSeries()" ariaLabel="최근 1시간 PostgreSQL WAL 생성량"></pg-chart></div></article>
        <article class="card"><div class="card-header"><span>복제 지연</span><small>seconds</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['replicationLagSeconds']); else noSeries" kind="line" [labels]="labels()" [series]="replicationSeries()" ariaLabel="최근 1시간 PostgreSQL 복제 지연"></pg-chart></div></article>
        <article class="card"><div class="card-header"><span>CPU 사용량</span><small>cores</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['cpuCores']); else noSeries" kind="line" [labels]="labels()" [series]="cpuSeries()" ariaLabel="최근 1시간 PostgreSQL CPU 코어 사용량"></pg-chart></div></article>
        <article class="card"><div class="card-header"><span>메모리 사용량</span><small>MiB working set</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['memoryBytes']); else noSeries" kind="line" [labels]="labels()" [series]="memorySeries()" ariaLabel="최근 1시간 PostgreSQL 메모리 사용량"></pg-chart></div></article>
        <article class="card"><div class="card-header"><span>데이터 볼륨 사용률</span><small>PVC percent</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['pvcUsedBytes','pvcCapacityBytes']); else noSeries" kind="line" [labels]="labels()" [series]="pvcSeries()" ariaLabel="최근 1시간 PostgreSQL PVC 사용률"></pg-chart></div></article>
        <article class="card"><div class="card-header"><span>데이터베이스 오류 징후</span><small>deadlocks / conflicts</small></div><div class="card-block"><pg-chart *ngIf="hasAny(['deadlocksPerSecond','conflictsPerSecond']); else noSeries" kind="line" [labels]="labels()" [series]="errorSeries()" ariaLabel="최근 1시간 PostgreSQL deadlock과 conflict 발생률"></pg-chart></div></article>
      </div>
      <ng-template #metricsUnavailable><div class="pg-monitoring-empty"><strong>{{ svc.metricsState() === 'error' ? 'Prometheus 조회 실패' : '시계열 수집 대기' }}</strong><p>{{ svc.metricsHint() }}</p></div></ng-template>
      <ng-template #noSeries><div class="pg-monitoring-empty pg-monitoring-empty--card"><strong>수집된 시계열 없음</strong><p>해당 메트릭은 0으로 대체하지 않습니다.</p></div></ng-template>

      <footer class="pg-monitoring-source"><b>데이터 경로</b><span>{{ providerLabel() }} exporter → Shared Observability Prometheus → Console read-only query_range</span><span>15초 화면 갱신 · 60초 step · 최근 1시간</span><span>Grafana와 동일한 Prometheus 정본을 사용합니다.</span></footer>
    </section>
  `,
  styles: [`
    .pg-monitoring { container-type: inline-size; margin-top: 1rem; }
    .pg-monitoring-head { display: flex; height: auto; min-height: 4.5rem; justify-content: space-between; gap: 1rem; align-items: center; padding: .75rem 1rem; color: #fff; background: #102a43; }
    .pg-monitoring-title { min-width: 0; }
    .pg-monitoring-head span { display: block; color: #78a9ff; font-size: .6rem; font-weight: 700; line-height: 1.25; letter-spacing: .08em; }
    .pg-monitoring-head h2 { margin: .12rem 0 .18rem; color: #fff; font-size: 1.05rem; font-weight: 600; line-height: 1.3; }
    .pg-monitoring-head p { margin: 0; color: #d9e2ec; font-size: .7rem; line-height: 1.35; }
    .pg-monitoring-sync { display: grid; grid-template-columns: 1fr auto; gap: .2rem .75rem; align-items: center; min-width: 20rem; text-align: right; }
    .pg-monitoring-sync strong { color: #ffb3a7; font-size: .68rem; } .pg-monitoring-sync strong.ok { color: #7ee2b8; }
    .pg-monitoring-sync small { color: #d9e2ec; font-size: .6rem; } .pg-monitoring-sync .btn { grid-column: 2; grid-row: 1 / span 2; margin: 0; }
    .pg-monitoring-metrics { margin: .85rem 0; grid-template-columns: repeat(6, minmax(0, 1fr)); align-items: stretch; }
    .pg-monitoring-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
    .pg-monitoring-grid .card { min-width: 0; margin: 0; }
    .pg-monitoring-grid .card-header { display: flex; justify-content: space-between; min-height: 2.6rem; align-items: center; border-bottom: 1px solid #d7dcdf; font-size: .82rem; font-weight: 600; }
    .pg-monitoring-grid .card-header small { color: #5b6971; font-size: .6rem; font-weight: 400; }
    .pg-monitoring-grid .card-block { min-height: 14rem; padding: .75rem; }
    .pg-monitoring-empty { display: grid; min-height: 12rem; place-content: center; padding: 1rem; text-align: center; color: #5b6971; background: #f5f7f9; }
    .pg-monitoring-empty strong { color: #394b54; } .pg-monitoring-empty p { margin: .25rem 0 0; font-size: .66rem; }
    .pg-monitoring-source { display: flex; flex-wrap: wrap; gap: .3rem 1rem; margin-top: .8rem; padding: .65rem .8rem; border-left: 3px solid #0f62fe; color: #5b6971; background: #f5f9ff; font-size: .62rem; }
    .pg-monitoring-source b { color: #1b2a32; }
    @container (max-width: 75rem) { .pg-monitoring-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @container (max-width: 60rem) { .pg-monitoring-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @container (max-width: 42rem) { .pg-monitoring-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @container (max-width: 24rem) { .pg-monitoring-metrics { grid-template-columns: 1fr; } }
    @media (max-width: 1050px) { .pg-monitoring-grid { grid-template-columns: 1fr; } }
    @media (max-width: 720px) { .pg-monitoring-head { align-items: start; flex-direction: column; } .pg-monitoring-sync { min-width: 0; width: 100%; text-align: left; } }
  `],
})
export class PgMonitoringTab {
  readonly svc = inject(CnpgService);
  readonly labels = computed(() => this.svc.monitoringMetrics().labels);
  providerLabel(): string { return 'StackGres'; }
  private latest(key: SeriesKey): number | null { return this.svc.metricsLatest()[key]; }
  hasAny(keys: SeriesKey[]): boolean { return keys.some((key) => this.svc.monitoringMetrics()[key].some(Number.isFinite)); }
  numberValue(key: SeriesKey): string { const value = this.latest(key); return value == null ? '—' : Math.round(value).toLocaleString(); }
  rateValue(key: SeriesKey): string { const value = this.latest(key); return value == null ? '—' : `${this.round(value)}/s`; }
  percentValue(key: SeriesKey): string { const value = this.latest(key); return value == null ? '—' : `${this.round(value)}%`; }
  secondsValue(key: SeriesKey): string { const value = this.latest(key); return value == null ? '—' : `${this.round(value)}s`; }
  bytesRateValue(key: SeriesKey): string { const value = this.latest(key); return value == null ? '—' : `${this.formatBytes(value)}/s`; }
  bytesValue(key: SeriesKey): string { const value = this.latest(key); return value == null ? '—' : this.formatBytes(value); }
  cpuValue(): string { const value = this.latest('cpuCores'); return value == null ? '—' : `${this.round(value)} cores`; }
  pvcUsage(): string { const used = this.latest('pvcUsedBytes'); const capacity = this.latest('pvcCapacityBytes'); return used == null || capacity == null || capacity <= 0 ? '—' : `${this.round(used / capacity * 100)}%`; }
  statusFor(key: SeriesKey, warnPositive = false): Phase { const value = this.latest(key); return value == null ? '' : warnPositive && value > 0 ? 'warn' : 'ok'; }
  cacheStatus(): Phase { const value = this.latest('cacheHitPct'); return value == null ? '' : value >= 95 ? 'ok' : 'warn'; }
  pvcStatus(): Phase { const used = this.latest('pvcUsedBytes'); const capacity = this.latest('pvcCapacityBytes'); if (used == null || capacity == null || capacity <= 0) return ''; return used / capacity >= .8 ? 'warn' : 'ok'; }
  statusLabel(): string { return this.svc.metricsState() === 'ok' ? 'Prometheus connected' : this.svc.metricsState() === 'error' ? 'Prometheus unavailable' : 'Metrics pending'; }
  readonly transactionSeries = computed<PgChartSeries[]>(() => this.series([['commit', 'Commit /s', '#0f62fe'], ['rollback', 'Rollback /s', '#da1e28']]));
  readonly connectionSeries = computed<PgChartSeries[]>(() => this.series([['connections', 'Active', '#003b5c'], ['waiting', 'Waiting', '#f1c21b']]));
  readonly walSeries = computed<PgChartSeries[]>(() => [{ label: 'WAL MiB/s', data: this.toMiB(this.svc.monitoringMetrics().walBytesPerSecond), color: '#8a3ffc' }]);
  readonly replicationSeries = computed<PgChartSeries[]>(() => [{ label: 'Lag seconds', data: this.svc.monitoringMetrics().replicationLagSeconds, color: '#fa4d56' }]);
  readonly cpuSeries = computed<PgChartSeries[]>(() => [{ label: 'CPU cores', data: this.svc.monitoringMetrics().cpuCores, color: '#007d79' }]);
  readonly memorySeries = computed<PgChartSeries[]>(() => [{ label: 'Memory MiB', data: this.toMiB(this.svc.monitoringMetrics().memoryBytes), color: '#4589ff' }]);
  readonly pvcSeries = computed<PgChartSeries[]>(() => [{ label: 'PVC used %', data: this.percentage(this.svc.monitoringMetrics().pvcUsedBytes, this.svc.monitoringMetrics().pvcCapacityBytes), color: '#24a148' }]);
  readonly errorSeries = computed<PgChartSeries[]>(() => this.series([['deadlocksPerSecond', 'Deadlocks /s', '#da1e28'], ['conflictsPerSecond', 'Conflicts /s', '#ff832b']]));
  private series(entries: [SeriesKey, string, string][]): PgChartSeries[] { return entries.filter(([key]) => this.hasAny([key])).map(([key, label, color]) => ({ label, data: this.svc.monitoringMetrics()[key], color })); }
  private toMiB(values: number[]): number[] { return values.map((value) => Number.isFinite(value) ? this.round(value / 1024 / 1024) : Number.NaN); }
  private percentage(used: number[], capacity: number[]): number[] { return used.map((value, index) => Number.isFinite(value) && Number.isFinite(capacity[index]) && capacity[index] > 0 ? this.round(value / capacity[index] * 100) : Number.NaN); }
  private round(value: number): number { return Math.round(value * 100) / 100; }
  private formatBytes(value: number): string { if (value >= 1024 ** 3) return `${this.round(value / 1024 ** 3)} GiB`; if (value >= 1024 ** 2) return `${this.round(value / 1024 ** 2)} MiB`; if (value >= 1024) return `${this.round(value / 1024)} KiB`; return `${this.round(value)} B`; }
}
