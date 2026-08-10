import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { ViewRouter } from '../view-router';
import { PluginPageHeaderComponent, PluginPageHeaderModel } from '../shared/plugin-page-shell.component';
import { RoadmapModuleInput } from './roadmap-module.component';
import { ArgoCdComponent } from './argocd/argocd.component';
import { CrossplaneComponent } from './crossplane/crossplane.component';

interface DeliveryEngine extends RoadmapModuleInput {
  lifecycle: string;
  lifecycleClass: string;
}

@Component({
  selector: 'app-foundation-delivery',
  standalone: true,
  imports: [CommonModule, ClarityModule, PluginPageHeaderComponent, ArgoCdComponent, CrossplaneComponent],
  template: `
    <app-argocd *ngIf="vr.tab()==='argocd'" />
    <app-crossplane *ngIf="vr.tab()==='crossplane'" />
    <clr-alert *ngIf="!['overview','argocd','crossplane'].includes(vr.tab())" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">존재하지 않는 Platform Delivery 경로입니다.</span></clr-alert-item></clr-alert>

    <ng-container *ngIf="vr.tab()==='overview'">
      <osp-plugin-page-header [model]="header" headingId="platform-delivery-title" />
      <clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Argo CD는 기본 GitOps 경로이고 Crossplane은 Provider가 필요한 영역에서만 사용하는 선택적 adapter입니다. 둘을 PFS capability로 계산하지 않습니다.</span></clr-alert-item></clr-alert>

      <section class="hc-section">
        <div class="hc-section-head"><div><span class="stack-kicker">Delivery engines</span><h3>Platform Delivery</h3></div><p>설치 상태, provider, sync 정책, upgrade와 rollback을 엔진별 화면에서 관리합니다.</p></div>
        <div class="hc-grid">
          <button class="hc-card hc-clickable delivery-card" type="button" *ngFor="let engine of engines" (click)="open(engine.id)">
            <div class="hc-head"><div class="hc-logo"><img [src]="logoUrl(engine.logo)" [alt]="engine.name" /></div><div class="hc-idblock"><div class="hc-name">{{engine.name}}<span class="hc-open">관리 →</span></div><div class="hc-provider">{{engine.provider}}<span *ngIf="engine.version"> · {{engine.version}}</span></div></div></div>
            <p class="hc-role">{{engine.role}}</p><div class="hc-wiring"><span class="hc-wiring-k">경계</span><span>{{engine.wiring}}</span></div>
            <div class="hc-foot"><span class="hc-cat"><span class="hc-cat-dot"></span>{{engine.category}}</span><span class="label" [ngClass]="engine.lifecycleClass">{{engine.lifecycle}}</span></div>
          </button>
        </div>
      </section>
    </ng-container>
  `,
})
export class FoundationDeliveryComponent {
  readonly vr = inject(ViewRouter);
  readonly argocd: DeliveryEngine = {
    id:'argocd', name:'Argo CD / ApplicationSet', provider:'argo-cd.readthedocs.io', version:'GitOps',
    logo:'argocd', mono:'CD', category:'delivery.gitops', liveKey:'argocd',
    role:'Git repository의 서명된 desired state를 target cluster에 동기화하는 Foundation의 기본 write-path.',
    wiring:'PFSS 모듈이 아니며 Foundation Control Plane의 배포 경로로 동작합니다.',
    lifecycle:'Managed', lifecycleClass:'label-success',
  };
  readonly crossplane: DeliveryEngine = {
    id:'crossplane', name:'Crossplane', provider:'crossplane.io (CNCF)', version:'v2.3.3',
    logo:'crossplane-non-typo', mono:'X', category:'delivery.adapter', liveKey:'crossplane',
    role:'외부 managed resource와 Provider가 강한 영역을 위한 선택적 provisioning adapter.',
    wiring:'GitOps 기본 경로를 대체하지 않으며 승인된 Provider만 사용합니다.',
    lifecycle:'Runtime', lifecycleClass:'label-success',
  };
  readonly engines: DeliveryEngine[] = [this.argocd, this.crossplane];
  readonly header: PluginPageHeaderModel = {
    name:'Platform Delivery', logo:'', stack:'Foundation', capability:'foundation.delivery',
    logos:[
      { src:'https://logos.opl.io.kr/i/argocd', alt:'Argo CD' },
      { src:'https://logos.opl.io.kr/i/crossplane-non-typo', alt:'Crossplane' },
    ],
    description:'PFS capability가 아닌 Foundation 배포 실행 계층으로, Argo CD 기본 write-path와 Crossplane 선택적 provisioning adapter를 관리합니다.',
    lifecycle:'Foundation native', lifecycleClass:'label-info', version:'contract v1', profile:'primary + optional', namespace:'argocd · crossplane-system',
  };
  logoUrl(logo:string):string{return /^https?:\/\//.test(logo)?logo:`https://logos.opl.io.kr/i/${logo}`;}
  open(id:string):void{this.vr.setTab(id);}
}
