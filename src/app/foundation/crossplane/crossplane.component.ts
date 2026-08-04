import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { ViewRouter } from '../../view-router';
import {
  PluginPageHeaderComponent,
  PluginPageHeaderModel,
  PluginPageTab,
  PluginTabsComponent,
  deliveryAdminTabs,
} from '../../shared/plugin-page-shell.component';
import { CrossplaneProbeState, CrossplaneService } from './crossplane.service';

const LOGO = 'https://logos.opl.io.kr/i/crossplane-non-typo';

@Component({
  selector: 'app-crossplane',
  standalone: true,
  imports: [CommonModule, ClarityModule, PluginPageHeaderComponent, PluginTabsComponent],
  template: `
    <button class="btn btn-sm btn-link rm-back" type="button" (click)="back()">← Platform Delivery</button>
    <section class="pgp-page-frame" aria-label="Crossplane 관리자 설치와 운영">
      <osp-plugin-page-header [model]="headerModel()" headingId="crossplane-plugin-title" />
      <osp-plugin-tabs [tabs]="tabs" [active]="active()" ariaLabel="Crossplane 관리자 메뉴" (selected)="select($event)" />
    </section>

    <clr-alert *ngIf="!svc.adapterReady()" [clrAlertType]="svc.runtimeInstalled() ? 'warning' : 'danger'" [clrAlertClosable]="false">
      <clr-alert-item>
        <span class="alert-text"><b>{{svc.phaseLabel()}}</b> — {{svc.statusReason()}}</span>
        <div class="alert-actions"><button class="btn alert-action" type="button" (click)="select(svc.runtimeInstalled()?'install':'prerequisites')">원인과 복구</button></div>
      </clr-alert-item>
    </clr-alert>

    <div class="vl-note" [class.vl-note--danger]="svc.actionState()==='error'" *ngIf="svc.actionMessage()">
      <div><strong>{{svc.actionState()==='error'?'작업 실패':'작업 결과'}}</strong><p>{{svc.actionMessage()}}</p><button class="btn btn-sm" type="button" (click)="svc.dismissAction()">닫기</button></div>
    </div>

    <ng-container *ngIf="active()==='overview'">
      <section class="pgp-steps" aria-label="Crossplane 관리자 운영 단계">
        <button type="button" class="pgp-step" [class.done]="svc.runtimeReady()" [class.current]="!svc.runtimeReady()" (click)="select('prerequisites')">
          <span class="pgp-step-n">1</span><span><b>Host core 준비</b><small>HISS 설치·CRD·core·RBAC manager</small></span>
        </button>
        <button type="button" class="pgp-step" [class.done]="svc.adapterReady()" [class.current]="svc.runtimeReady()&&!svc.adapterReady()" (click)="select('install')">
          <span class="pgp-step-n">2</span><span><b>Adapter 준비</b><small>provider-helm·ProviderConfig</small></span>
        </button>
        <button type="button" class="pgp-step" [class.done]="svc.adapterReady()" [class.current]="svc.adapterReady()" [disabled]="!svc.adapterReady()" (click)="select('resources')">
          <span class="pgp-step-n">3</span><span><b>운영 관리</b><small>Provider·Release·events·upgrade evidence</small></span>
        </button>
      </section>

      <section class="pgp-dashboard">
        <article class="pgp-panel">
          <h2>Host runtime</h2><p>Crossplane core는 Kubernetes 호스트 capability이므로 HISS가 설치 수명주기를 소유합니다.</p>
          <dl>
            <dt>상태</dt><dd><span class="label" [ngClass]="svc.runtimeReady()?'label-success':(svc.runtimeInstalled()?'label-warning':'label-danger')">{{svc.runtimeReady()?'Ready':(svc.runtimeInstalled()?'Degraded':'Not Installed')}}</span></dd>
            <dt>Workloads</dt><dd>{{readyWorkloads()}}/2 Ready</dd>
            <dt>CRD/API</dt><dd><span class="label" [ngClass]="stateClass(svc.crdState())">{{stateLabel(svc.crdState())}}</span></dd>
          </dl>
          <button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">다시 확인</button>
        </article>
        <article class="pgp-panel">
          <h2>Provisioning adapter</h2><p>Foundation은 승인된 Provider와 ProviderConfig, managed Release를 운영합니다.</p>
          <dl>
            <dt>종합</dt><dd><span class="label" [ngClass]="svc.phaseClass()">{{svc.phaseLabel()}}</span></dd>
            <dt>Provider</dt><dd>{{svc.healthyProviderCount()}}/{{svc.providers().length}} Healthy</dd>
            <dt>ProviderConfig</dt><dd>{{svc.defaultProviderConfigReady()?'default Ready':'미구성'}}</dd>
          </dl>
          <button class="btn btn-sm btn-primary" type="button" (click)="select(svc.adapterReady()?'resources':'install')">{{svc.adapterReady()?'Provider 운영':'복구 경로 확인'}}</button>
        </article>
        <article class="pgp-panel">
          <h2>Managed releases</h2><p>Crossplane provider-helm이 실제 reconcile하는 Release 상태입니다.</p>
          <div class="de-big">{{svc.readyReleaseCount()}}/{{svc.releases().length}}</div>
          <p>Synced & Ready</p>
        </article>
      </section>
    </ng-container>

    <section class="rm-work" *ngIf="active()==='prerequisites'">
      <div class="hc-section-head"><div><h2>Prerequisites</h2><p>설치 가정이 아니라 현재 Kubernetes API와 Crossplane condition으로 계산합니다.</p></div><button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">다시 검사</button></div>
      <table class="table">
        <thead><tr><th>검사</th><th>상태</th><th>실증 근거</th><th>설치·운영 소유자</th></tr></thead>
        <tbody><tr *ngFor="let item of svc.prerequisites()"><td>{{item.label}}</td><td><span class="label" [ngClass]="stateClass(item.state)">{{stateLabel(item.state)}}</span></td><td class="os-mono">{{item.evidence}}</td><td>{{item.owner}}</td></tr></tbody>
      </table>
    </section>

    <section class="rm-work" *ngIf="active()==='install'">
      <h2>Install & Repair</h2>
      <clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text"><b>관리 경계:</b> Crossplane core·CRD·RBAC manager·provider package의 Helm lifecycle은 Cluster Manager HISS가 담당하고, Foundation은 ProviderConfig와 Release 운영을 담당합니다.</span></clr-alert-item></clr-alert>
      <section class="pgp-dashboard">
        <article class="pgp-panel">
          <h3>1. Host core</h3><p>{{svc.runtimeReady()?'Crossplane core가 Ready입니다.':'Cluster Manager에서 계획·설치·실검증을 실행해야 합니다.'}}</p>
          <span class="label" [ngClass]="svc.runtimeReady()?'label-success':'label-danger'">{{svc.runtimeReady()?'Ready':'Action required'}}</span>
          <div><button class="btn btn-sm btn-primary" type="button" (click)="openClusterManager()">{{svc.runtimeInstalled()?'HISS 설치 관리':'HISS에서 설치'}}</button></div>
        </article>
        <article class="pgp-panel">
          <h3>2. Approved provider</h3><p>provider-helm package는 HISS release BOM의 exact digest로 설치해야 합니다.</p>
          <span class="label" [ngClass]="svc.providerHelmReady()?'label-success':'label-warning'">{{svc.providerHelmReady()?'Healthy':'HISS repair required'}}</span>
          <p class="os-mono">{{svc.providerHelm()?.package || 'provider-helm 미발견'}}</p>
        </article>
        <article class="pgp-panel">
          <h3>3. ProviderConfig</h3><p>동일 클러스터 Helm reconcile을 위한 InjectedIdentity default 설정입니다.</p>
          <span class="label" [ngClass]="svc.defaultProviderConfigReady()?'label-success':'label-warning'">{{svc.defaultProviderConfigReady()?'Ready':'미구성'}}</span>
          <div><button class="btn btn-sm btn-primary" type="button" [disabled]="!svc.providerHelmReady()||svc.defaultProviderConfigReady()||svc.actionState()==='running'" (click)="svc.createDefaultProviderConfig()">Default 구성 생성</button></div>
        </article>
      </section>
      <clr-alert *ngIf="!svc.runtimeInstalled()" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Foundation이 broad cluster 권한으로 Crossplane을 직접 Helm 설치하지 않습니다. 위 HISS 링크에서 관리자가 계획을 검토하고 설치를 승인합니다.</span></clr-alert-item></clr-alert>
    </section>

    <section class="rm-work" *ngIf="active()==='resources'">
      <div class="hc-section-head"><div><h2>Providers & Managed Releases</h2><p>Package condition과 실제 Release reconciliation 상태입니다.</p></div><button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">새로고침</button></div>
      <h3>Providers</h3>
      <table class="table">
        <thead><tr><th>Provider</th><th>Package</th><th>Revision</th><th>Installed</th><th>Healthy</th><th>Condition</th></tr></thead>
        <tbody>
          <tr *ngFor="let provider of svc.providers()"><td>{{provider.name}}</td><td class="os-mono">{{provider.package}}</td><td class="os-mono">{{provider.revision||'—'}}</td><td><span class="label" [ngClass]="provider.installed?'label-success':'label-danger'">{{provider.installed?'Installed':'Pending'}}</span></td><td><span class="label" [ngClass]="provider.healthy?'label-success':'label-warning'">{{provider.healthy?'Healthy':'Degraded'}}</span></td><td>{{provider.message||'—'}}</td></tr>
          <tr *ngIf="!svc.providers().length"><td colspan="6">Provider가 없거나 읽기 권한이 없습니다.</td></tr>
        </tbody>
      </table>
      <h3>Managed Releases</h3>
      <table class="table">
        <thead><tr><th>Release</th><th>Chart</th><th>Namespace</th><th>Synced</th><th>Ready</th><th>State</th></tr></thead>
        <tbody>
          <tr *ngFor="let release of svc.releases()"><td>{{release.name}}</td><td>{{release.chart}}</td><td>{{release.namespace}}</td><td><span class="label" [ngClass]="release.synced?'label-success':'label-warning'">{{release.synced?'Synced':'Pending'}}</span></td><td><span class="label" [ngClass]="release.ready?'label-success':'label-warning'">{{release.ready?'Ready':'Pending'}}</span></td><td>{{release.state||release.message||'—'}}</td></tr>
          <tr *ngIf="!svc.releases().length"><td colspan="6">Managed Release가 없습니다.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="rm-work" *ngIf="active()==='configuration'">
      <h2>Configuration</h2>
      <dl class="os-kv">
        <dt>Core namespace</dt><dd class="os-mono">crossplane-system</dd>
        <dt>Profile</dt><dd>optional-adapter</dd>
        <dt>Core owner</dt><dd>Cluster Manager · HISS HelmManaged</dd>
        <dt>Adapter owner</dt><dd>Foundation Platform Delivery</dd>
        <dt>Approved provider</dt><dd class="os-mono">{{svc.providerHelm()?.package||'미설치'}}</dd>
        <dt>ProviderConfig</dt><dd>{{svc.defaultProviderConfigReady()?'default · InjectedIdentity':'미구성'}}</dd>
        <dt>Primary write-path</dt><dd>Argo CD · Crossplane은 optional</dd>
      </dl>
    </section>

    <section class="rm-work" *ngIf="active()==='security'">
      <h2>Security & Policy</h2>
      <div class="rm-grid">
        <article class="rm-panel"><h3>Package integrity</h3><p>provider package는 tag가 아니라 승인 BOM의 OCI digest로 고정합니다.</p><span class="label" [ngClass]="providerDigestPinned()?'label-success':'label-danger'">{{providerDigestPinned()?'Digest pinned':'검증 필요'}}</span></article>
        <article class="rm-panel"><h3>Credential boundary</h3><p>InjectedIdentity 또는 SecretRef만 사용하며 자격 값은 Console API에 반환하지 않습니다.</p><span class="label label-info">Secretless UI</span></article>
        <article class="rm-panel"><h3>Field ownership</h3><p>Argo CD가 primary desired-state를 소유하고 Crossplane은 승인된 managed resource만 reconcile합니다.</p><span class="label label-success">Separated</span></article>
        <article class="rm-panel"><h3>Mutation scope</h3><p>Foundation 관리자 권한은 ProviderConfig 생성으로 제한하고 core·CRD·Provider 설치는 HISS에 위임합니다.</p><span class="label label-info">Least privilege</span></article>
      </div>
    </section>

    <section class="rm-work" *ngIf="active()==='upgrade'">
      <h2>Upgrade & Rollback</h2>
      <clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Core와 provider package를 동시에 올리지 않습니다. HISS에서 core compatibility와 retained resource를 검토한 뒤 ProviderRevision condition·managed resource 호환성을 별도 검증해야 합니다.</span></clr-alert-item></clr-alert>
      <table class="table"><thead><tr><th>Layer</th><th>현재 근거</th><th>실행 소유자</th><th>Rollback gate</th></tr></thead><tbody>
        <tr><td>Crossplane core</td><td class="os-mono">{{svc.workloads()[0]?.image||'미수집'}}</td><td>Cluster Manager HISS</td><td>Helm revision + CRD compatibility</td></tr>
        <tr><td>RBAC manager</td><td class="os-mono">{{svc.workloads()[1]?.image||'미수집'}}</td><td>Cluster Manager HISS</td><td>Core와 동일 revision</td></tr>
        <tr><td>provider-helm</td><td class="os-mono">{{svc.providerHelm()?.package||'미설치'}}</td><td>HISS release BOM</td><td>ProviderRevision Healthy + Release compatibility</td></tr>
      </tbody></table>
      <button class="btn btn-sm btn-primary" type="button" (click)="openClusterManager()">HISS Upgrade 관리</button>
    </section>

    <section class="rm-work" *ngIf="active()==='events'">
      <div class="hc-section-head"><div><h2>Events & Audit</h2><p>Crossplane namespace Event와 이번 Console 세션 작업입니다.</p></div><button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">새로고침</button></div>
      <table class="table">
        <thead><tr><th>Time</th><th>Type</th><th>Reason</th><th>Object</th><th>Message</th></tr></thead>
        <tbody>
          <tr *ngFor="let event of svc.events()"><td>{{event.time}}</td><td><span class="label" [ngClass]="event.type==='Warning'?'label-warning':''">{{event.type}}</span></td><td>{{event.reason}}</td><td>{{event.object}}</td><td>{{event.message}}</td></tr>
          <tr *ngIf="!svc.events().length"><td colspan="5">현재 읽을 수 있는 Kubernetes Event가 없습니다.</td></tr>
        </tbody>
      </table>
      <h3>이번 Console 세션 작업</h3>
      <div class="vl-log"><div *ngFor="let line of svc.actionLog()">{{line}}</div><div *ngIf="!svc.actionLog().length">아직 실행한 작업이 없습니다.</div></div>
    </section>
    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{svc.lastSync()}}</p>
  `,
})
export class CrossplaneComponent {
  readonly svc = inject(CrossplaneService);
  readonly vr = inject(ViewRouter);
  readonly tabs: PluginPageTab[] = deliveryAdminTabs('Providers & Releases');
  readonly active = computed(() => this.vr.detail());

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  select(tab: string): void { this.vr.setDetail(tab); }
  back(): void { this.vr.setTab('overview'); }
  readyWorkloads(): number { return this.svc.workloads().filter((row) => row.state === 'ready').length; }
  openClusterManager(): void { window.location.assign('/p/cluster-manager/his/his?focus=crossplane-core'); }
  providerDigestPinned(): boolean { return /@sha256:[a-f0-9]{64}$/i.test(this.svc.providerHelm()?.package || ''); }
  stateClass(state: CrossplaneProbeState): string {
    if (state === 'ready') return 'label-success';
    if (state === 'degraded' || state === 'loading') return 'label-warning';
    if (state === 'noperm') return 'label-info';
    return 'label-danger';
  }
  stateLabel(state: CrossplaneProbeState): string {
    return ({
      loading: '확인 중',
      ready: 'Ready',
      degraded: 'Degraded',
      missing: 'Missing',
      noperm: '권한 필요',
      error: 'Error',
    } as Record<CrossplaneProbeState, string>)[state];
  }
  headerModel(): PluginPageHeaderModel {
    return {
      name: 'Crossplane',
      logo: LOGO,
      stack: 'Platform Delivery',
      capability: 'delivery.adapter',
      description: 'GitOps와 병행하는 선택적 provisioning adapter. 호스트 코어와 Provider 운영 경계를 분리합니다.',
      lifecycle: this.svc.phaseLabel(),
      lifecycleClass: this.svc.phaseClass(),
      version: this.svc.workloads()[0]?.image || 'v2.3.3 planned',
      profile: 'optional-adapter',
      namespace: 'crossplane-system',
    };
  }
}
