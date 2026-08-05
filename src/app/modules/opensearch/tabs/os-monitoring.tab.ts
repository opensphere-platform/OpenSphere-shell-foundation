import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CarbonIcon } from '../../../carbon-icon';
import Renew16 from '@carbon/icons/es/renew/16';
import { CarbonLineChart, CarbonLineSeries } from '../../../shared/carbon-line-chart';
import { OsMetricsService } from '../os-metrics.service';

@Component({
  selector: 'os-monitoring',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, CarbonLineChart],
  template: `
    <section class="osm">
      <div class="osm-head">
        <div><span class="vl-eyebrow">Operations · Prometheus</span><h2>OpenSearch Monitoring</h2><p>플러그인 exporter를 Prometheus Operator ServiceMonitor로 수집한 최근 1시간 메트릭입니다.</p></div>
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
      <div class="osm-charts" *ngIf="metrics.state()==='ok'">
        <article><h3>JVM heap & CPU</h3><p>노드 중 최대 사용률</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="percentSeries()" valueAxisTitle="Percent" ariaLabel="OpenSearch JVM heap과 CPU 사용률" /></article>
        <article><h3>Documents</h3><p>클러스터 문서 수</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="documentSeries()" valueAxisTitle="Documents" ariaLabel="OpenSearch 문서 수" /></article>
        <article><h3>Storage</h3><p>가용 디스크와 index store, GiB</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="storageSeries()" valueAxisTitle="GiB" ariaLabel="OpenSearch 디스크와 index store" /></article>
        <article><h3>Thread-pool rejections</h3><p>5분 구간 거부 작업 합계</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="rejectedSeries()" valueAxisTitle="Rejected / 5m" ariaLabel="OpenSearch thread pool 거부 작업" /></article>
      </div>
      <p class="os-dim">{{metrics.hint()}} · 마지막 확인 {{metrics.lastSync() || '—'}}</p>
    </section>
  `,
  styles: [`
    .osm{display:grid;gap:16px}.osm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.osm-head h2{margin:3px 0 4px}.osm-head p{margin:0;color:#525252}.osm-target{display:flex;align-items:center;gap:10px;border:1px solid #d0d0d0;background:#fff;padding:12px 14px}.osm-target div{display:grid;flex:1}.osm-target span:not(.label):not(.osm-dot){color:#6f6f6f;font-size:.78rem}.osm-dot{width:10px;height:10px;border-radius:50%;background:#f1c21b}.osm-dot.up{background:#24a148}.osm-dot.down{background:#da1e28}.osm-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.osm-kpis article,.osm-charts article{border:1px solid #d0d0d0;background:#fff;padding:14px;min-width:0}.osm-kpis span,.osm-kpis small{display:block;color:#6f6f6f}.osm-kpis strong{display:block;margin:7px 0 3px;font-size:1.35rem}.osm-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.osm-charts h3{margin:0 0 3px;font-size:1rem}.osm-charts p{margin:0 0 8px;color:#6f6f6f;font-size:.78rem}@media(max-width:1100px){.osm-kpis{grid-template-columns:repeat(3,1fr)}}@media(max-width:720px){.osm-head{display:block}.osm-kpis,.osm-charts{grid-template-columns:1fr}}
  `],
})
export class OsMonitoringTab {
  readonly metrics = inject(OsMetricsService);
  readonly iRenew = Renew16;
  number(value: number, digits: number): string { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
  integer(value: number): string { return Math.round(value || 0).toLocaleString(); }
  bytes(value: number): string { const n=Number(value||0);return n>=1099511627776?`${(n/1099511627776).toFixed(1)} TiB`:n>=1073741824?`${(n/1073741824).toFixed(1)} GiB`:n>=1048576?`${(n/1048576).toFixed(1)} MiB`:`${Math.round(n)} B`; }
  percentSeries(): CarbonLineSeries[]{const s=this.metrics.series();return[{label:'heap %',data:s.heap,color:'#0f62fe'},{label:'CPU %',data:s.cpu,color:'#8a3ffc'}];}
  documentSeries(): CarbonLineSeries[]{return[{label:'documents',data:this.metrics.series().documents,color:'#24a148'}];}
  storageSeries(): CarbonLineSeries[]{const s=this.metrics.series();return[{label:'available GiB',data:s.diskAvailable.map(v=>v/1073741824),color:'#0f62fe'},{label:'store GiB',data:s.storeBytes.map(v=>v/1073741824),color:'#fa4d56'}];}
  rejectedSeries(): CarbonLineSeries[]{return[{label:'rejected / 5m',data:this.metrics.series().rejected,color:'#da1e28'}];}
}
