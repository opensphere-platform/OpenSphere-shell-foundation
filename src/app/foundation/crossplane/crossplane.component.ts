import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CrossplaneService } from './crossplane.service';
import { ViewRouter } from '../../view-router';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent } from '../../shared/plugin-page-shell.component';

const LOGO = 'https://logos.opl.io.kr/i/crossplane-non-typo';

@Component({
  selector: 'app-crossplane',
  standalone: true,
  imports: [CommonModule, ClarityModule, PluginPageHeaderComponent, PluginTabsComponent],
  template: `
    <button class="btn btn-sm btn-link rm-back" type="button" (click)="back()">← PFS 모듈</button>
    <section class="pgp-page-frame" aria-label="Crossplane plugin 개요와 메뉴"><osp-plugin-page-header [model]="headerModel()" headingId="crossplane-plugin-title" /><osp-plugin-tabs [tabs]="tabs" [active]="active()" ariaLabel="Crossplane 관리 메뉴" (selected)="select($event)" /></section>

    <section class="rm-grid" *ngIf="active()==='overview'">
      <article class="rm-panel"><h2>Control plane health</h2><dl><dt>Core</dt><dd><span class="label" [ngClass]="svc.coreState()==='ok'?'label-success':'label-danger'">{{svc.coreState()==='ok'?'Running':'문제'}}</span></dd><dt>RBAC manager</dt><dd><span class="label" [ngClass]="svc.rbacState()==='ok'?'label-success':'label-danger'">{{svc.rbacState()==='ok'?'Running':'문제'}}</span></dd><dt>Providers</dt><dd>{{svc.healthyProviderCount()}}/{{svc.providers().length}} healthy</dd></dl></article>
      <article class="rm-panel"><h2>Delivery role</h2><p>GitOps가 기본 write-path이며 Crossplane은 외부 managed resource와 provider가 강한 영역의 선택적 provisioning adapter입니다.</p><button class="btn btn-sm btn-primary" (click)="select('topology')">Provider topology</button></article>
      <article class="rm-panel"><h2>Managed releases</h2><div class="de-big">{{svc.readyReleaseCount()}}/{{svc.releases().length}}</div><p>provider-helm Release Ready</p></article>
    </section>

    <section class="rm-work" *ngIf="active()==='dependency'"><h2>실행 기반</h2><table class="table"><thead><tr><th>요구조건</th><th>상태</th></tr></thead><tbody><tr><td>Kubernetes CRD/API extension</td><td><span class="label label-success">Required</span></td></tr><tr><td>GitOps write-path</td><td><span class="label label-info">Primary</span></td></tr><tr><td>provider-helm ProviderConfig</td><td><span class="label" [ngClass]="svc.healthyProviderCount()?'label-success':'label-warning'">{{svc.healthyProviderCount()?'Ready':'점검 필요'}}</span></td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='plan'"><h2>설치·운영 구성</h2><clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Crossplane 자체 lifecycle은 HIS/Setup이 아니라 Foundation delivery adapter 정책으로 관리합니다. 이 화면에서는 무단 재설치를 제공하지 않습니다.</span></clr-alert-item></clr-alert><dl class="os-kv"><dt>Profile</dt><dd>optional-adapter</dd><dt>Namespace</dt><dd>crossplane-system</dd><dt>Default provider</dt><dd>provider-helm</dd></dl></section>
    <section class="rm-work" *ngIf="active()==='topology'"><h2>Providers & releases</h2><table class="table"><thead><tr><th>Provider</th><th>Package</th><th>Installed</th><th>Healthy</th></tr></thead><tbody><tr *ngFor="let p of svc.providers()"><td>{{p.name}}</td><td class="os-mono">{{p.package}}</td><td><span class="label" [ngClass]="p.installed?'label-success':'label-danger'">{{p.installed?'설치됨':'미설치'}}</span></td><td><span class="label" [ngClass]="p.healthy?'label-success':'label-warning'">{{p.healthy?'Healthy':'점검 필요'}}</span></td></tr></tbody></table><h2>Managed Release</h2><table class="table"><thead><tr><th>Release</th><th>Chart</th><th>Namespace</th><th>Ready</th></tr></thead><tbody><tr *ngFor="let r of svc.releases()"><td>{{r.name}}</td><td>{{r.chart}}</td><td>{{r.namespace}}</td><td><span class="label" [ngClass]="r.ready?'label-success':'label-warning'">{{r.ready?'Ready':'대기'}}</span></td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='consumers'"><h2>Consumers & contracts</h2><table class="table"><thead><tr><th>소비자</th><th>계약</th><th>경계</th></tr></thead><tbody><tr><td>Foundation plugins</td><td>Release CR</td><td>provider-helm</td></tr><tr><td>External managed resources</td><td>Provider CR</td><td>승인된 Provider만</td></tr><tr><td>GitOps</td><td>desired state</td><td>기본 write-path</td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='protection'"><h2>Protection & security</h2><div class="rm-grid"><article class="rm-panel"><h3>Provider allowlist</h3><p>임의 Provider package 설치를 금지하고 서명 BOM으로 고정합니다.</p></article><article class="rm-panel"><h3>Credentials</h3><p>ProviderConfig는 SecretRef만 허용합니다.</p></article><article class="rm-panel"><h3>Ownership</h3><p>GitOps와 adapter의 field ownership을 분리합니다.</p></article></div></section>
    <section class="rm-work" *ngIf="active()==='events'"><h2>Events</h2><div class="rm-empty"><b>상태 동기화 완료</b><span>Provider와 Release condition은 Topology 탭에서 확인합니다.</span></div></section>
    <section class="rm-work" *ngIf="active()==='upgrade'"><h2>Upgrade & rollback</h2><p>Crossplane core와 Provider package는 독립적으로 승격하며, 기존 managed resource의 호환성과 회수 정책을 먼저 검증합니다.</p><clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Provider major upgrade는 composition/CRD migration과 rollback 증거 없이는 허용하지 않습니다.</span></clr-alert-item></clr-alert></section>
    <section class="rm-work" *ngIf="active()==='documentation'"><h2>Documentation</h2><p>한글 운영 안내서는 Manual Registry와 통합 검색에 자동 등록됩니다.</p><a class="btn btn-sm btn-primary" [href]="manualUrl">한글 안내서 열기</a><a class="btn btn-sm" href="https://docs.crossplane.io/" target="_blank" rel="noreferrer">공식 문서 열기</a></section>
  `,
})
export class CrossplaneComponent {
  readonly svc = inject(CrossplaneService);
  readonly vr = inject(ViewRouter);
  readonly manualUrl = `/manual?doc=${encodeURIComponent('plugin:foundation/crossplane-operations-ko')}`;
  readonly tabs: PluginPageTab[] = [
    {id:'overview',label:'Overview'},{id:'dependency',label:'실행 기반'},{id:'plan',label:'설치·운영 구성'},
    {id:'topology',label:'Topology'},{id:'consumers',label:'Consumers'},{id:'protection',label:'Protection'},
    {id:'events',label:'Events'},{id:'upgrade',label:'Upgrade'},{id:'documentation',label:'Documentation'},
  ];
  readonly active = computed(() => this.vr.detail());
  ngOnInit():void{this.svc.start();} ngOnDestroy():void{this.svc.stop();}
  headerModel():PluginPageHeaderModel{return{name:'Crossplane',logo:LOGO,capability:'delivery.adapter',description:'GitOps와 병행하는 선택적 provisioning adapter. Provider와 managed Release의 수명주기를 관리합니다.',lifecycle:this.svc.phaseLabel(),lifecycleClass:this.svc.phaseLabel()==='Running'?'label-success':'label-warning',version:'v2.3.3',profile:'optional-adapter',namespace:'crossplane-system'};}
  select(tab:string):void{this.vr.setDetail(tab);} back():void{this.vr.setTab('overview');}
}
