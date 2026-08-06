import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CarbonIcon } from '../../../carbon-icon';
import Renew16 from '@carbon/icons/es/renew/16';
import { UPlotLineChart, UPlotLineSeries } from '../../../shared/uplot-line-chart';
import { OsMetricsService, OsNodeMetricSeries } from '../os-metrics.service';

@Component({
  selector: 'os-monitoring',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, UPlotLineChart],
  template: `
    <section class="osm">
      <div class="osm-head">
        <div><span class="vl-eyebrow">Operations · Prometheus · uPlot</span><h2>OpenSearch Monitoring</h2><p>15초마다 시계열 데이터만 갱신하며, 클러스터 노드 변경에 맞춰 노드 차트를 자동으로 구성합니다.</p></div>
        <button class="btn btn-sm" type="button" (click)="metrics.refresh()" [disabled]="metrics.busy()"><os-cicon [icon]="iRenew" [size]="16"/> 새로고침</button>
      </div>
      <div class="osm-target">
        <span class="osm-dot" [class.up]="metrics.target()==='up'" [class.down]="metrics.target()==='down'"></span>
        <div><b>Prometheus target</b><span>{{metrics.targetDetail()}}</span></div>
        <span class="label" [ngClass]="metrics.target()==='up'?'label-success':metrics.target()==='down'?'label-danger':'label-warning'">{{metrics.target()}}</span>
      </div>
      <clr-alert *ngIf="metrics.state()!=='ok'" [clrAlertType]="metrics.state()==='error'?'danger':'info'" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{metrics.hint()}}</span></clr-alert-item></clr-alert>
      <div class="osm-kpis">
        <article><span>JVM heap</span><strong>{{number(metrics.latestHeap(),1)}}%</strong><small>node max</small></article>
        <article><span>Process CPU</span><strong>{{number(metrics.latestCpu(),1)}}%</strong><small>node max</small></article>
        <article><span>Disk available</span><strong>{{bytes(metrics.latestDisk())}}</strong><small>node min</small></article>
        <article><span>Documents</span><strong>{{integer(metrics.latestDocuments())}}</strong><small>cluster total</small></article>
        <article><span>Index store</span><strong>{{bytes(metrics.latestStore())}}</strong><small>cluster total</small></article>
        <article><span>Rejected tasks</span><strong>{{number(metrics.latestRejected(),0)}}</strong><small>last 5 minutes</small></article>
      </div>
      <div class="osm-charts" *ngIf="metrics.state()==='ok' && metrics.series().timestamps.length">
        <article class="osm-chart-card" [class.expanded]="isExpanded('resources')"><div class="osm-chart-head"><div><h3>JVM heap & CPU</h3><p>노드 중 최대 사용률</p></div><button class="btn btn-sm btn-link" type="button" (click)="toggleChart('resources')" [attr.aria-expanded]="isExpanded('resources')">{{expandLabel('resources')}}</button></div><os-uplot-line-chart [timestamps]="metrics.series().timestamps" [series]="percentSeries()" [height]="chartHeight('resources')" valueAxisTitle="Percent" ariaLabel="OpenSearch JVM heap과 CPU 사용률" /></article>
        <article class="osm-chart-card" [class.expanded]="isExpanded('documents')"><div class="osm-chart-head"><div><h3>Documents</h3><p>클러스터 문서 수</p></div><button class="btn btn-sm btn-link" type="button" (click)="toggleChart('documents')" [attr.aria-expanded]="isExpanded('documents')">{{expandLabel('documents')}}</button></div><os-uplot-line-chart [timestamps]="metrics.series().timestamps" [series]="documentSeries()" [height]="chartHeight('documents')" valueAxisTitle="Documents" ariaLabel="OpenSearch 문서 수" /></article>
        <article class="osm-chart-card" [class.expanded]="isExpanded('storage')"><div class="osm-chart-head"><div><h3>Storage</h3><p>가용 디스크와 index store, GiB</p></div><button class="btn btn-sm btn-link" type="button" (click)="toggleChart('storage')" [attr.aria-expanded]="isExpanded('storage')">{{expandLabel('storage')}}</button></div><os-uplot-line-chart [timestamps]="metrics.series().timestamps" [series]="storageSeries()" [height]="chartHeight('storage')" valueAxisTitle="GiB" ariaLabel="OpenSearch 디스크와 index store" /></article>
        <article class="osm-chart-card" [class.expanded]="isExpanded('rejections')"><div class="osm-chart-head"><div><h3>Thread-pool rejections</h3><p>5분 구간 거부 작업 합계</p></div><button class="btn btn-sm btn-link" type="button" (click)="toggleChart('rejections')" [attr.aria-expanded]="isExpanded('rejections')">{{expandLabel('rejections')}}</button></div><os-uplot-line-chart [timestamps]="metrics.series().timestamps" [series]="rejectedSeries()" [height]="chartHeight('rejections')" valueAxisTitle="Rejected / 5m" ariaLabel="OpenSearch thread pool 거부 작업" /></article>
      </div>
      <section class="osm-nodes" aria-labelledby="osm-node-title">
        <div class="osm-section-head"><div><span class="vl-eyebrow">Dynamic topology</span><h2 id="osm-node-title">Node resource trends</h2><p>StatefulSet 구성, OpenSearch 합류, Prometheus 수집 상태를 노드별로 비교합니다.</p></div><div class="osm-node-counts"><span><b>{{metrics.configuredNodeCount()}}</b> configured</span><span><b>{{metrics.joinedNodeCount()}}</b> joined</span><span><b>{{metrics.metricsNodeCount()}}</b> metrics</span></div></div>
        <p *ngIf="!metrics.nodes().length" class="osm-empty">클러스터 노드 목록을 확인하고 있습니다.</p>
        <div class="osm-node-grid" [style.--node-columns]="nodeColumns()">
          <article class="osm-node" [class.expanded]="isExpanded('node:'+node.node)" *ngFor="let node of metrics.nodes(); trackBy: trackNode" [attr.data-node]="node.node">
            <div class="osm-node-head"><div><span class="osm-node-kicker">OpenSearch node</span><h3>{{node.node}}</h3></div><div class="osm-node-actions"><span class="label" [ngClass]="node.joined && node.metricsObserved?'label-success':'label-warning'">{{node.joined && node.metricsObserved?'live':node.joined?'metrics pending':'join pending'}}</span><button *ngIf="node.metricsObserved" class="btn btn-sm btn-link" type="button" (click)="toggleChart('node:'+node.node)" [attr.aria-expanded]="isExpanded('node:'+node.node)">{{expandLabel('node:'+node.node)}}</button></div></div>
            <div class="osm-node-state">
              <span [class.ok]="node.podReady"><i></i>Pod {{node.podReady?'Ready':node.podPhase}}</span>
              <span [class.ok]="node.joined"><i></i>Cluster {{node.joined?'joined':'not joined'}}</span>
              <span [class.ok]="node.metricsObserved"><i></i>Metrics {{node.metricsObserved?'active':'pending'}}</span>
            </div>
            <p class="osm-node-meta">{{node.podIP || 'Pod IP 확인 중'}}<ng-container *ngIf="node.roles"> · roles {{node.roles}}</ng-container><ng-container *ngIf="node.master"> · cluster manager</ng-container></p>
            <div class="osm-node-kpis">
              <span>Heap <b>{{node.metricsObserved?number(last(node.heap),1)+'%':'—'}}</b></span>
              <span>CPU <b>{{node.metricsObserved?number(last(node.cpu),1)+'%':'—'}}</b></span>
              <span>Disk <b>{{node.metricsObserved?bytes(last(node.diskAvailable)):'—'}}</b></span>
            </div>
            <os-uplot-line-chart *ngIf="node.timestamps.length; else pendingNode" [timestamps]="node.timestamps" [series]="nodePercentSeries(node)" [height]="chartHeight('node:'+node.node)" valueAxisTitle="Percent" [ariaLabel]="node.node + ' JVM heap과 CPU 사용률'" />
            <ng-template #pendingNode><p class="osm-empty">Prometheus의 node label 시계열 수집을 기다리고 있습니다.</p></ng-template>
          </article>
        </div>
      </section>
      <p class="os-dim">{{metrics.hint()}} · 마지막 확인 {{metrics.lastSync() || '—'}}</p>
    </section>
  `,
  styles: [`
    .osm{display:grid;gap:16px}.osm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.osm-head h2{margin:3px 0 4px}.osm-head p{margin:0;color:#525252}.osm-target{display:flex;align-items:center;gap:10px;border:1px solid #d0d0d0;background:#fff;padding:12px 14px}.osm-target div{display:grid;flex:1}.osm-target span:not(.label):not(.osm-dot){color:#6f6f6f;font-size:.78rem}.osm-dot{width:10px;height:10px;border-radius:50%;background:#f1c21b}.osm-dot.up{background:#24a148}.osm-dot.down{background:#da1e28}.osm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.osm-kpis article,.osm-charts article,.osm-node{border:1px solid #d0d0d0;background:#fff;padding:14px;min-width:0}.osm-kpis span,.osm-kpis small{display:block;color:#6f6f6f}.osm-kpis strong{display:block;margin:7px 0 3px;font-size:1.35rem;overflow-wrap:anywhere}.osm-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.osm-chart-card{padding:9px 10px 4px!important}.osm-chart-card.expanded,.osm-node.expanded{grid-column:1/-1}.osm-chart-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:0}.osm-chart-head .btn,.osm-node-actions .btn{margin:0;white-space:nowrap}.osm-node-grid{display:grid;grid-template-columns:repeat(var(--node-columns,1),minmax(0,1fr));gap:12px}.osm-charts h3{margin:0 0 2px;font-size:1rem}.osm-charts p{margin:0;color:#6f6f6f;font-size:.78rem}.osm-nodes{display:grid;gap:10px}.osm-section-head,.osm-node-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.osm-section-head h2,.osm-node-head h3{margin:3px 0 0}.osm-section-head p{margin:5px 0 0;color:#6f6f6f;font-size:.78rem}.osm-node-counts{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}.osm-node-counts span{border:1px solid #d0d0d0;background:#fff;padding:5px 8px;color:#525252;font-size:.74rem;white-space:nowrap}.osm-node-counts b{color:#161616}.osm-node-actions{display:flex;align-items:center;gap:8px}.osm-node-kicker{color:#6f6f6f;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}.osm-node-state{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;color:#6f6f6f;font-size:.74rem}.osm-node-state span{display:inline-flex;align-items:center;gap:5px}.osm-node-state i{width:7px;height:7px;border-radius:50%;background:#f1c21b}.osm-node-state .ok i{background:#24a148}.osm-node-meta{margin:7px 0 0;color:#6f6f6f;font-size:.74rem}.osm-node-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.osm-node-kpis span{color:#6f6f6f;font-size:.78rem}.osm-node-kpis b{display:block;color:#161616;font-size:1rem}.osm-empty{padding:20px;margin:0;background:#f4f4f4;color:#6f6f6f;text-align:center}@media(max-width:1200px){.osm-node-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}}@media(max-width:820px){.osm-head,.osm-section-head{display:block}.osm-node-counts{justify-content:flex-start;margin-top:10px}.osm-kpis,.osm-charts,.osm-node-grid{grid-template-columns:1fr}}
  `],
})
export class OsMonitoringTab {
  readonly metrics = inject(OsMetricsService);
  readonly iRenew = Renew16;
  readonly expandedChart = signal<string | null>(null);
  readonly percentSeries = computed<UPlotLineSeries[]>(() => { const s=this.metrics.series();return[{label:'heap %',data:s.heap,color:'#0f62fe'},{label:'CPU %',data:s.cpu,color:'#8a3ffc'}]; });
  readonly documentSeries = computed<UPlotLineSeries[]>(() => [{label:'documents',data:this.metrics.series().documents,color:'#24a148'}]);
  readonly storageSeries = computed<UPlotLineSeries[]>(() => { const s=this.metrics.series();return[{label:'available GiB',data:s.diskAvailable.map(v=>v===null?null:v/1073741824),color:'#0f62fe'},{label:'store GiB',data:s.storeBytes.map(v=>v===null?null:v/1073741824),color:'#fa4d56'}]; });
  readonly rejectedSeries = computed<UPlotLineSeries[]>(() => [{label:'rejected / 5m',data:this.metrics.series().rejected,color:'#da1e28'}]);
  readonly nodeColumns = computed(() => Math.min(Math.max(this.metrics.nodes().length, 1), 3));
  toggleChart(id: string): void { this.expandedChart.update((current) => current === id ? null : id); }
  isExpanded(id: string): boolean { return this.expandedChart() === id; }
  expandLabel(id: string): string { return this.isExpanded(id) ? '원래 크기' : '확대 보기'; }
  chartHeight(id: string): number { return this.isExpanded(id) ? 380 : 240; }
  number(value: number | null, digits: number): string { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
  integer(value: number): string { return Math.round(value || 0).toLocaleString(); }
  bytes(value: number): string { const n=Number(value||0);return n>=1099511627776?`${(n/1099511627776).toFixed(1)} TiB`:n>=1073741824?`${(n/1073741824).toFixed(1)} GiB`:n>=1048576?`${(n/1048576).toFixed(1)} MiB`:`${Math.round(n)} B`; }
  last(values: (number | null)[]): number { return [...values].reverse().find((value): value is number => value !== null) ?? 0; }
  nodePercentSeries(node: OsNodeMetricSeries): UPlotLineSeries[]{return[{label:'heap %',data:node.heap,color:'#0f62fe'},{label:'CPU %',data:node.cpu,color:'#8a3ffc'}];}
  trackNode(_index: number, node: OsNodeMetricSeries): string { return node.node; }
}
