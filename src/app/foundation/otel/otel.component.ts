import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { OtelService } from './otel.service';
import { ViewRouter } from '../../view-router';
import { CarbonIcon } from '../../carbon-icon';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent } from '../../shared/plugin-page-shell.component';
import Misuse20 from '@carbon/icons/es/misuse/20';
import Download16 from '@carbon/icons/es/download/16';

const LOGO = 'https://logos.opl.io.kr/i/opentelemetry-non-typo';

@Component({
  selector: 'app-otel',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent, PluginTabsComponent],
  template: `
    <button class="btn btn-sm btn-link rm-back" type="button" (click)="back()">← PFS 모듈</button>
    <section class="pgp-page-frame" aria-label="OpenTelemetry Collector plugin 개요와 메뉴"><osp-plugin-page-header [model]="headerModel()" headingId="otel-plugin-title" /><osp-plugin-tabs [tabs]="tabs" [active]="active()" ariaLabel="OpenTelemetry Collector 관리 메뉴" (selected)="select($event)" /></section>

    <section class="rm-grid" *ngIf="active()==='overview'">
      <article class="rm-panel"><h2>Service health</h2><dl><dt>상태</dt><dd><span class="label" [ngClass]="phasePill()">{{svc.phaseLabel()}}</span></dd><dt>Ready</dt><dd>{{svc.readyN()}}/{{svc.totalN()}}</dd><dt>Image</dt><dd class="os-mono">{{svc.installedImage()||'—'}}</dd></dl></article>
      <article class="rm-panel"><h2>Pipeline role</h2><p>Foundation workload의 OTLP 지표·로그·추적을 받아 승인된 관측 backend로 전달합니다.</p><button class="btn btn-sm btn-primary" (click)="select(svc.installed()?'topology':'plan')">{{svc.installed()?'Topology':'설치 계획'}}</button></article>
      <article class="rm-panel"><h2>Endpoint contract</h2><dl><dt>Namespace</dt><dd class="os-mono">opensphere-foundation</dd><dt>Protocol</dt><dd>OTLP gRPC/HTTP</dd><dt>Exposure</dt><dd>ClusterIP only</dd></dl></article>
    </section>

    <section class="rm-work" *ngIf="active()==='dependency'">
      <h2>실행 기반</h2><table class="table"><thead><tr><th>요구조건</th><th>상태</th></tr></thead><tbody><tr><td>Crossplane provider-helm</td><td><span class="label label-info">Release API</span></td></tr><tr><td>HIS Shared Observability</td><td><span class="label label-warning">연결 검증 필요</span></td></tr><tr><td>Foundation Control Plane</td><td><span class="label label-info">Required</span></td></tr></tbody></table>
    </section>

    <section class="rm-work" *ngIf="active()==='plan'">
      <h2>설치·운영 구성</h2>
      <div class="vl-note vl-note--danger" *ngIf="svc.installState()==='error'"><os-cicon [icon]="iMisuse" [size]="20"/><div><strong>설치 실패</strong><p>{{svc.installError()}} <a class="vl-link" (click)="svc.dismissError()">다시 시도</a></p></div></div>
      <div class="vl-progress-wrap" *ngIf="svc.installState()==='installing'"><div class="vl-progress-head"><span>설치 진행 중 · chart {{svc.plan().chart}}</span><span>{{svc.progress()}}%</span></div><div class="vl-progress-track"><div class="vl-progress-bar" [style.width.%]="svc.progress()"></div></div><div class="vl-log"><div *ngFor="let line of svc.logs()">{{line}}</div></div></div>
      <div class="vl-install" *ngIf="svc.installState()==='idle'"><div class="vl-install-row"><label class="vl-field"><span>버전</span><select class="os-filter" (change)="onSelect($event)"><option *ngFor="let v of svc.versions" [value]="v.chart" [selected]="v.chart===svc.selectedChart()">chart {{v.chart}} · app {{v.app}}</option></select></label><button class="btn btn-primary" [disabled]="!svc.canInstall()" (click)="svc.install()"><os-cicon [icon]="iDownload" [size]="16"/> 설치</button></div><dl class="os-kv"><dt>Namespace</dt><dd>{{svc.plan().namespace}}</dd><dt>Image</dt><dd class="os-mono">{{svc.plan().image}}</dd><dt>Delivery</dt><dd>Crossplane provider-helm Release</dd></dl></div>
    </section>

    <section class="rm-work" *ngIf="active()==='topology'"><h2>Topology & workloads</h2><div class="rm-topology"><article><span class="rm-node">OpenTelemetry Collector Deployment</span><span class="label" [ngClass]="svc.ready()?'label-success':'label-warning'">{{svc.readyN()}}/{{svc.totalN()}}</span></article><article><span class="rm-node">OTLP receiver</span><span class="label label-info">4317 / 4318</span></article><article><span class="rm-node">Exporter pipeline</span><span class="label label-warning">운영 구성 필요</span></article></div></section>
    <section class="rm-work" *ngIf="active()==='consumers'"><h2>Consumers & contracts</h2><table class="table"><thead><tr><th>계약</th><th>소비점</th></tr></thead><tbody><tr><td>TelemetryBinding</td><td>OTLP gRPC/HTTP ClusterIP</td></tr><tr><td>Metrics export</td><td>HIS Prometheus remote endpoint</td></tr><tr><td>Trace/log export</td><td>PFS Tempo/Loki</td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='protection'"><h2>Protection & security</h2><div class="rm-grid"><article class="rm-panel"><h3>Network</h3><p>ClusterIP와 namespace allowlist만 허용합니다.</p></article><article class="rm-panel"><h3>Credentials</h3><p>Exporter SecretRef를 사용하며 화면/ConfigMap에 값을 저장하지 않습니다.</p></article><article class="rm-panel"><h3>Backpressure</h3><p>memory limiter·batch·retry·queue 정책을 검증합니다.</p></article></div></section>
    <section class="rm-work" *ngIf="active()==='events'"><h2>Events</h2><div class="vl-log"><div *ngFor="let line of svc.logs()">{{line}}</div><div *ngIf="!svc.logs().length">현재 작업 이벤트가 없습니다.</div></div></section>
    <section class="rm-work" *ngIf="active()==='upgrade'"><h2>Upgrade & rollback</h2><p>설치 버전과 다른 chart를 선택하면 사전 호환성·exporter endpoint·rollback 계획을 검증한 뒤 적용해야 합니다.</p><table class="table"><thead><tr><th>Chart</th><th>App</th><th>상태</th></tr></thead><tbody><tr *ngFor="let v of svc.versions"><td>{{v.chart}}</td><td>{{v.app}}</td><td><span class="label" [ngClass]="v.chart===svc.selectedChart()?'label-info':''">{{v.chart===svc.selectedChart()?'선택':'사용 가능'}}</span></td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='documentation'"><h2>Documentation</h2><p>한글 운영 안내서는 Manual Registry와 통합 검색에 자동 등록됩니다.</p><a class="btn btn-sm btn-primary" [href]="manualUrl">한글 안내서 열기</a><a class="btn btn-sm" href="https://opentelemetry.io/docs/collector/" target="_blank" rel="noreferrer">공식 문서 열기</a></section>
    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{svc.lastSync()}}</p>
  `,
})
export class OtelComponent {
  readonly svc = inject(OtelService);
  readonly vr = inject(ViewRouter);
  readonly manualUrl = `/manual?doc=${encodeURIComponent('plugin:foundation/otel-operations-ko')}`;
  readonly iMisuse = Misuse20;
  readonly iDownload = Download16;
  readonly tabs: PluginPageTab[] = [
    {id:'overview',label:'Overview'},{id:'dependency',label:'실행 기반'},{id:'plan',label:'설치·운영 구성'},
    {id:'topology',label:'Topology'},{id:'consumers',label:'Consumers'},{id:'protection',label:'Protection'},
    {id:'events',label:'Events'},{id:'upgrade',label:'Upgrade'},{id:'documentation',label:'Documentation'},
  ];
  readonly active = computed(() => this.vr.detail());
  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  headerModel(): PluginPageHeaderModel { return { name:'OpenTelemetry Collector', logo:LOGO, capability:'observability.telemetry', description:'Foundation workload의 지표·로그·추적을 수집하고 승인된 backend로 전달하는 중앙 gateway.', lifecycle:this.svc.phaseLabel(), lifecycleClass:this.phasePill(), version:this.svc.installedImage()||`chart ${this.svc.plan().chart}`, profile:'gateway', namespace:'opensphere-foundation' }; }
  phasePill(): string { if (this.svc.installed()) return this.svc.ready()?'label-success':'label-warning'; return this.svc.phaseLabel()==='확인 중'?'':'label-warning'; }
  select(tab:string):void{this.vr.setDetail(tab);} back():void{this.vr.setTab('overview');}
  onSelect(e:Event):void{this.svc.selectChart((e.target as HTMLSelectElement).value);}
}
