import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CrossplaneService } from './crossplane.service';
import { ViewRouter } from '../../view-router';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent, pfsPluginTabs } from '../../shared/plugin-page-shell.component';

const LOGO = 'https://logos.opl.io.kr/i/crossplane-non-typo';

@Component({
  selector: 'app-crossplane',
  standalone: true,
  imports: [CommonModule, ClarityModule, PluginPageHeaderComponent, PluginTabsComponent],
  template: `
    <button class="btn btn-sm btn-link rm-back" type="button" (click)="back()">← PFS 모듈</button>
    <section class="pgp-page-frame" aria-label="Crossplane plugin 개요와 메뉴"><osp-plugin-page-header [model]="headerModel()" headingId="crossplane-plugin-title" /><osp-plugin-tabs [tabs]="tabs" [active]="active()" ariaLabel="Crossplane 관리 메뉴" (selected)="select($event)" /></section>

    <ng-container *ngIf="active()==='overview'">
      <section class="pgp-steps" aria-label="Crossplane provisioning 단계">
        <button type="button" class="pgp-step" [class.done]="svc.coreState()==='ok'" [class.current]="svc.coreState()!=='ok'" (click)="select('operator')"><span class="pgp-step-n">1</span><span><b>Control Plane 준비</b><small>Core·RBAC manager·Provider 계약</small></span></button>
        <button type="button" class="pgp-step" [class.done]="svc.readyReleaseCount()>0" [class.current]="svc.coreState()==='ok'&&svc.readyReleaseCount()===0" (click)="select('cluster')"><span class="pgp-step-n">2</span><span><b>Provider 구성</b><small>승인 package·ProviderConfig·Release 계획</small></span></button>
        <button type="button" class="pgp-step" [class.done]="svc.releases().length>0&&svc.readyReleaseCount()===svc.releases().length" [class.current]="svc.readyReleaseCount()>0&&svc.readyReleaseCount()<svc.releases().length" [disabled]="svc.coreState()!=='ok'" (click)="select('topology')"><span class="pgp-step-n">3</span><span><b>운영 관리</b><small>Provider·managed release·이벤트 관리</small></span></button>
      </section>
      <section class="pgp-dashboard">
        <article class="pgp-panel"><h2>Control plane health</h2><p>Crossplane core와 Provider가 보고한 실제 상태입니다.</p><dl><dt>Core</dt><dd><span class="label" [ngClass]="svc.coreState()==='ok'?'label-success':'label-danger'">{{svc.coreState()==='ok'?'Running':'문제'}}</span></dd><dt>RBAC manager</dt><dd><span class="label" [ngClass]="svc.rbacState()==='ok'?'label-success':'label-danger'">{{svc.rbacState()==='ok'?'Running':'문제'}}</span></dd><dt>Providers</dt><dd>{{svc.healthyProviderCount()}}/{{svc.providers().length}} healthy</dd></dl></article>
        <article class="pgp-panel"><h2>Delivery role</h2><p>GitOps가 기본 write-path이며 Crossplane은 외부 managed resource와 provider가 강한 영역의 선택적 provisioning adapter입니다.</p><button class="btn btn-sm btn-primary" (click)="select('topology')">Provider topology</button></article>
        <article class="pgp-panel"><h2>Managed releases</h2><p>승인된 provider-helm Release의 준비 상태입니다.</p><div class="de-big">{{svc.readyReleaseCount()}}/{{svc.releases().length}}</div><p>provider-helm Release Ready</p></article>
      </section>
    </ng-container>

    <section class="rm-work" *ngIf="active()==='operator'"><h2>Operator</h2><table class="table"><thead><tr><th>요구조건</th><th>상태</th></tr></thead><tbody><tr><td>Kubernetes CRD/API extension</td><td><span class="label label-success">Required</span></td></tr><tr><td>GitOps write-path</td><td><span class="label label-info">Primary</span></td></tr><tr><td>provider-helm ProviderConfig</td><td><span class="label" [ngClass]="svc.healthyProviderCount()?'label-success':'label-warning'">{{svc.healthyProviderCount()?'Ready':'점검 필요'}}</span></td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='cluster'"><h2>Cluster plan</h2><clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Crossplane 자체 lifecycle은 HIS/Setup이 아니라 Foundation delivery adapter 정책으로 관리합니다. 이 화면에서는 무단 재설치를 제공하지 않습니다.</span></clr-alert-item></clr-alert><dl class="os-kv"><dt>Profile</dt><dd>optional-adapter</dd><dt>Namespace</dt><dd>crossplane-system</dd><dt>Default provider</dt><dd>provider-helm</dd></dl></section>
    <section class="rm-work" *ngIf="active()==='topology'"><h2>Providers & releases</h2><table class="table"><thead><tr><th>Provider</th><th>Package</th><th>Installed</th><th>Healthy</th></tr></thead><tbody><tr *ngFor="let p of svc.providers()"><td>{{p.name}}</td><td class="os-mono">{{p.package}}</td><td><span class="label" [ngClass]="p.installed?'label-success':'label-danger'">{{p.installed?'설치됨':'미설치'}}</span></td><td><span class="label" [ngClass]="p.healthy?'label-success':'label-warning'">{{p.healthy?'Healthy':'점검 필요'}}</span></td></tr></tbody></table><h2>Managed Release</h2><table class="table"><thead><tr><th>Release</th><th>Chart</th><th>Namespace</th><th>Ready</th></tr></thead><tbody><tr *ngFor="let r of svc.releases()"><td>{{r.name}}</td><td>{{r.chart}}</td><td>{{r.namespace}}</td><td><span class="label" [ngClass]="r.ready?'label-success':'label-warning'">{{r.ready?'Ready':'대기'}}</span></td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='config'"><h2>Configuration</h2><dl class="os-kv"><dt>Profile</dt><dd>optional-adapter</dd><dt>Namespace</dt><dd>crossplane-system</dd><dt>Default provider</dt><dd>provider-helm</dd><dt>Write path</dt><dd>GitOps primary · Crossplane optional</dd></dl></section>
    <section class="rm-work" *ngIf="active()==='domain'"><h2>Providers & Resources</h2><table class="table"><thead><tr><th>Provider</th><th>Package</th><th>Installed</th><th>Healthy</th></tr></thead><tbody><tr *ngFor="let p of svc.providers()"><td>{{p.name}}</td><td class="os-mono">{{p.package}}</td><td>{{p.installed?'설치됨':'미설치'}}</td><td>{{p.healthy?'Healthy':'점검 필요'}}</td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='backups'"><h2>Backups</h2><clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Crossplane은 외부 리소스의 실제 데이터 백업을 소유하지 않습니다. Provider/Release desired state와 자격 SecretRef의 GitOps 복구를 관리합니다.</span></clr-alert-item></clr-alert><div class="rm-grid"><article class="rm-panel"><h3>Provider allowlist</h3><p>임의 Provider package 설치를 금지하고 서명 BOM으로 고정합니다.</p></article><article class="rm-panel"><h3>Credentials</h3><p>ProviderConfig는 SecretRef만 허용합니다.</p></article><article class="rm-panel"><h3>Ownership</h3><p>GitOps와 adapter의 field ownership을 분리합니다.</p></article></div></section>
    <section class="rm-work" *ngIf="active()==='events'"><h2>Events</h2><div class="rm-empty"><b>상태 동기화 완료</b><span>Provider와 Release condition은 Topology 탭에서 확인합니다.</span></div></section>
    <section class="rm-work" *ngIf="active()==='upgrade'"><h2>Upgrade & rollback</h2><p>Crossplane core와 Provider package는 독립적으로 승격하며, 기존 managed resource의 호환성과 회수 정책을 먼저 검증합니다.</p><clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Provider major upgrade는 composition/CRD migration과 rollback 증거 없이는 허용하지 않습니다.</span></clr-alert-item></clr-alert></section>
    <section class="rm-work" *ngIf="active()==='claims'"><h2>Claims</h2><table class="table"><thead><tr><th>소비자</th><th>계약</th><th>경계</th></tr></thead><tbody><tr><td>Foundation plugins</td><td>Release CR</td><td>provider-helm</td></tr><tr><td>External managed resources</td><td>Provider CR</td><td>승인된 Provider만</td></tr><tr><td>GitOps</td><td>desired state</td><td>기본 write-path</td></tr></tbody></table></section>
    <section class="rm-work" *ngIf="active()==='documentation'"><h2>Documentation</h2><p>한글 운영 안내서는 Manual Registry와 통합 검색에 자동 등록됩니다.</p><a class="btn btn-sm btn-primary" [href]="manualUrl">한글 안내서 열기</a><a class="btn btn-sm" href="https://docs.crossplane.io/" target="_blank" rel="noreferrer">공식 문서 열기</a></section>
  `,
})
export class CrossplaneComponent {
  readonly svc = inject(CrossplaneService);
  readonly vr = inject(ViewRouter);
  readonly manualUrl = `/manual?doc=${encodeURIComponent('plugin:foundation/crossplane-operations-ko')}`;
  readonly tabs: PluginPageTab[] = pfsPluginTabs('Providers & Resources');
  readonly active = computed(() => this.vr.detail());
  ngOnInit():void{this.svc.start();} ngOnDestroy():void{this.svc.stop();}
  headerModel():PluginPageHeaderModel{return{name:'Crossplane',logo:LOGO,capability:'delivery.adapter',description:'GitOps와 병행하는 선택적 provisioning adapter. Provider와 managed Release의 수명주기를 관리합니다.',lifecycle:this.svc.phaseLabel(),lifecycleClass:this.svc.phaseLabel()==='Running'?'label-success':'label-warning',version:'v2.3.3',profile:'optional-adapter',namespace:'crossplane-system'};}
  select(tab:string):void{this.vr.setDetail(tab);} back():void{this.vr.setTab('overview');}
}
