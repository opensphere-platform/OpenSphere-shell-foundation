import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import { CarbonIcon } from '../../carbon-icon';
import { apiBase, hostFetch } from '../../api-base';
import { IdentityEngineInstallParameters, FoundationRegistryService } from '../../registry/foundation-registry.service';
import { PfsPluginTabId, PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent, pfsPluginTabs } from '../../shared/plugin-page-shell.component';
import { ViewRouter } from '../../view-router';
import { KcService } from './identity.services';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

type Tab = PfsPluginTabId;
type KeycloakForm = IdentityEngineInstallParameters;

const LOGO = 'https://logos.opl.io.kr/i/keycloak';
const MANUAL_ID = 'keycloak-operations-ko';
const DEFAULT_FORM: KeycloakForm = {
  version: '26.0', profile: 'development', replicas: 1, resourceProfile: 'small',
  cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '1', memoryLimit: '1536Mi',
  monitoring: false, ingressMode: 'cluster-internal', databaseMode: 'embedded-h2',
};

@Component({
  selector: 'app-keycloak',
  standalone: true,
  imports: [CommonModule, FormsModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent, PluginTabsComponent],
  styles: [`
    :host{display:block;min-width:0}.kc-work{max-width:82rem}.kc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.kc-panel{background:#fff;border:1px solid var(--os-border);padding:16px}.kc-panel h2{font-size:1rem;margin:0 0 8px}.kc-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px}.kc-log{margin-top:12px;max-height:190px;overflow:auto;padding:12px;background:#161616;color:#f4f4f4;font-family:monospace}.kc-progress{height:6px;background:#e0e0e0;margin-top:10px}.kc-progress>div{height:100%;background:#4c6fff}.kc-once{padding:12px;border:1px solid #f1c21b;background:#fff8e1}.ok{color:#198038}.warn{color:#8e6a00}@media(max-width:900px){.kc-grid{grid-template-columns:1fr}}
  `],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0"><os-cicon [icon]="iBack" [size]="16" /> PFS 모듈</a>
    <section class="pgp-page-frame" aria-label="Keycloak plugin 개요와 메뉴">
      <osp-plugin-page-header [model]="headerModel()" headingId="keycloak-plugin-title" />
      <osp-plugin-tabs [tabs]="tabsForUi()" [active]="tab()" ariaLabel="Keycloak plugin 메뉴" (selected)="openTab($event)" />
    </section>

    <ng-container *ngIf="tab()==='overview'">
      <section class="pgp-steps" aria-label="Keycloak plugin 설치 단계">
        <button class="pgp-step" [class.done]="controlPlaneReady()" [class.current]="!controlPlaneReady()" (click)="openTab('operator')"><span class="pgp-step-n">1</span><span><b>Operator 준비</b><small>Foundation control-plane</small></span></button>
        <button class="pgp-step" [class.done]="exists()" [class.current]="controlPlaneReady()&&!exists()" (click)="openTab('cluster')"><span class="pgp-step-n">2</span><span><b>Cluster 생성</b><small>버전·리소스·접근 정책</small></span></button>
        <button class="pgp-step" [class.done]="svc.ready()" [class.current]="exists()&&!svc.ready()" [disabled]="!exists()" (click)="openTab('topology')"><span class="pgp-step-n">3</span><span><b>운영 관리</b><small>상태·소비자·보안·이벤트</small></span></button>
      </section>
      <div class="pgp-dashboard">
        <article class="pgp-panel"><h2>Package readiness</h2><p>설치 수명주기의 실제 상태만 표시합니다.</p><div class="pgp-status-list"><div><span>PFS Control Plane</span><b [class.ok]="controlPlaneReady()">{{controlPlaneReady()?'Ready':'Required'}}</b></div><div><span>FoundationModel/identity</span><b>{{modelState()}}</b></div><div><span>Keycloak Deployment</span><b [class.ok]="svc.ready()">{{svc.phase()}}</b></div><div><span>Managed replicas</span><b [class.ok]="svc.ready()">{{svc.readyN()}} / {{svc.totalN()}}</b></div></div><button class="btn btn-sm btn-primary" (click)="openTab(controlPlaneReady()?'cluster':'operator')">{{controlPlaneReady()?'Cluster plan':'Operator 확인'}}</button></article>
        <article class="pgp-panel"><h2>Service health</h2><p>Deployment와 Pod가 보고한 실제 가용성입니다.</p><div class="pgp-health"><strong>{{availability()}}%</strong><span>replicas ready</span><progress [value]="svc.readyN()" [max]="svc.totalN()||1" aria-label="Keycloak replica 가용성"></progress></div><dl class="os-kv"><dt>Issuer</dt><dd class="os-mono">{{svc.issuer()}}</dd><dt>Image</dt><dd class="os-mono">{{svc.image()||'—'}}</dd><dt>Restarts</dt><dd>{{svc.restarts()}}</dd></dl></article>
        <article class="pgp-panel"><h2>Operations policy</h2><p>선언된 신원 서비스의 보호·접근 경계입니다.</p><div class="pgp-policy-grid"><div><span>Registration</span><b>Disabled</b></div><div><span>Direct grants</span><b>Disabled</b></div><div><span>PKCE</span><b class="ok">S256</b></div><div><span>Ingress</span><b>{{form().ingressMode}}</b></div><div><span>Database</span><b class="warn">Embedded H2</b></div><div><span>Monitoring</span><b>{{form().monitoring?'Enabled':'Pending'}}</b></div></div></article>
      </div>
      <section class="pgp-description"><div><h2>Description</h2><p>Keycloak plugin은 Console 인증용 Kanidm과 분리된 workforce IAM입니다. FoundationModel/identity 선언으로 OIDC realm, workload, 소비 계약과 보안 경계를 운영합니다.</p></div><div><h2>Documentation</h2><a [href]="manualUrl">OpenSphere Keycloak 설치·운영 안내서 (한글)</a><a href="https://www.keycloak.org/documentation" target="_blank" rel="noreferrer">Keycloak 공식 문서</a><button class="btn btn-sm btn-link" type="button" (click)="openTab('documentation')">문서 등록 계약 보기</button></div></section>
    </ng-container>

    <section class="pgp-workspace" *ngIf="tab()==='operator'">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Internal dependency</span><h2>Foundation Control Plane</h2></div><span class="label" [ngClass]="controlPlaneReady()?'label-success':'label-warning'">{{controlPlaneReady()?'Ready':'Required'}}</span></div>
      <clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Keycloak은 FoundationModel/identity 선언을 foundation-control-plane이 SSA로 적용합니다. 별도 Operator는 없습니다.</span></clr-alert-item></clr-alert>
      <dl class="os-kv"><dt>Desired-state owner</dt><dd class="os-mono">FoundationModel/identity</dd><dt>Managed workload</dt><dd class="os-mono">Deployment/foundation-identity-keycloak</dd><dt>Realm import</dt><dd class="os-mono">opensphere-workforce</dd><dt>Image source</dt><dd class="os-mono">ghcr.io/opensphere-platform/mirror/keycloak</dd></dl>
    </section>

    <section class="pgp-workspace" *ngIf="tab()==='cluster'">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Desired state</span><h2>Keycloak 설치·운영 구성</h2></div><span class="label" [ngClass]="exists()?'label-success':'label-warning'">{{exists()?'Managed':'Not created'}}</span></div>
      <form class="pgp-form" (ngSubmit)="apply()">
        <fieldset [disabled]="applying()"><legend>Version & profile</legend><div class="pgp-form-grid">
          <label><span>운영 프로파일</span><select name="profile" [ngModel]="form().profile" (ngModelChange)="setProfile($event)"><option value="development">Development</option><option value="custom">Custom</option><option value="production" disabled>Production · external PostgreSQL required</option></select><small>현재 번들은 start-dev/H2이며 Production은 명시적으로 차단합니다.</small></label>
          <label><span>Keycloak image tag</span><select name="version" [ngModel]="form().version" (ngModelChange)="patch({version:$event})"><option value="26.0">26.0 · mirrored stable</option></select><small>검증·미러링된 태그만 선택할 수 있습니다.</small></label>
          <label><span>Replicas</span><input name="replicas" type="number" min="1" max="1" [ngModel]="form().replicas" (ngModelChange)="patch({replicas:+$event,profile:'custom'})"/><small>Embedded H2에서는 단일 replica만 허용합니다.</small></label>
          <label><span>Resource profile</span><select name="resourceProfile" [ngModel]="form().resourceProfile" (ngModelChange)="setResourceProfile($event)"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
        </div></fieldset>
        <fieldset [disabled]="applying()"><legend>Resources & access</legend><div class="pgp-form-grid">
          <label><span>CPU request</span><input name="cpuRequest" [ngModel]="form().cpuRequest" (ngModelChange)="patch({cpuRequest:$event})"/></label><label><span>Memory request</span><input name="memoryRequest" [ngModel]="form().memoryRequest" (ngModelChange)="patch({memoryRequest:$event})"/></label><label><span>CPU limit</span><input name="cpuLimit" [ngModel]="form().cpuLimit" (ngModelChange)="patch({cpuLimit:$event})"/></label><label><span>Memory limit</span><input name="memoryLimit" [ngModel]="form().memoryLimit" (ngModelChange)="patch({memoryLimit:$event})"/></label>
          <label><span>접근 정책</span><select name="ingressMode" [ngModel]="form().ingressMode" (ngModelChange)="patch({ingressMode:$event})"><option value="cluster-internal">Cluster internal</option><option value="private-ingress" disabled>Private ingress · OIDC/TLS connector pending</option></select></label>
        </div></fieldset>
        <clr-alert *ngIf="validationError()" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{validationError()}}</span></clr-alert-item></clr-alert>
        <div class="kc-actions"><span class="os-dim">FoundationModel/identity → control-plane SSA → Deployment</span><button class="btn btn-primary" type="submit" [disabled]="!canApply()">{{exists()?'운영 구성 적용':'Keycloak 설치'}}</button></div>
        <div class="kc-progress" *ngIf="applying()"><div [style.width.%]="progress()"></div></div><div class="kc-log" *ngIf="logs().length"><div *ngFor="let line of logs()">{{line}}</div></div>
      </form>
    </section>

    <section class="pgp-workspace" *ngIf="tab()==='topology'"><div class="pgp-section-head"><div><span class="vl-eyebrow">Runtime</span><h2>Topology</h2></div><button class="btn btn-sm" (click)="refresh()">새로고침</button></div><clr-alert *ngIf="svc.state()==='loading'" clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Keycloak Deployment와 Pod 상태를 확인하고 있습니다.</span></clr-alert-item></clr-alert><clr-alert *ngIf="svc.state()==='noperm'" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">현재 사용자에게 Keycloak workload 조회 권한이 없습니다. Foundation 권한 프로파일을 확인하세요.</span></clr-alert-item></clr-alert><clr-alert *ngIf="svc.state()==='nocrd'" clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Keycloak workload가 아직 설치되지 않았습니다.</span><div class="alert-actions"><button class="btn alert-action" (click)="openTab('cluster')">Cluster plan</button></div></clr-alert-item></clr-alert><clr-alert *ngIf="svc.state()==='error'" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Keycloak 런타임 상태 조회에 실패했습니다. API 경로와 control-plane 상태를 확인하세요.</span></clr-alert-item></clr-alert><div class="kc-grid"><article class="kc-panel"><h2>Deployment</h2><dl class="os-kv"><dt>Name</dt><dd class="os-mono">{{svc.name}}</dd><dt>Ready</dt><dd>{{svc.readyN()}}/{{svc.totalN()}}</dd><dt>Image</dt><dd class="os-mono">{{svc.image()||'—'}}</dd></dl></article><article class="kc-panel"><h2>Pod</h2><dl class="os-kv"><dt>Node</dt><dd class="os-mono">{{svc.node()}}</dd><dt>Restarts</dt><dd>{{svc.restarts()}}</dd><dt>Phase</dt><dd>{{svc.phase()}}</dd></dl></article><article class="kc-panel"><h2>Service</h2><dl class="os-kv"><dt>Endpoint</dt><dd class="os-mono">{{svc.http}}</dd><dt>Port</dt><dd>8080/TCP</dd><dt>Exposure</dt><dd>ClusterIP</dd></dl></article></div></section>

    <section class="pgp-workspace" *ngIf="tab()==='config'"><div class="pgp-section-head"><div><span class="vl-eyebrow">Desired state</span><h2>Configuration</h2></div></div><dl class="os-kv"><dt>Version</dt><dd>{{form().version}}</dd><dt>Profile</dt><dd>{{form().profile}}</dd><dt>Replicas</dt><dd>{{form().replicas}}</dd><dt>Ingress</dt><dd>{{form().ingressMode}}</dd><dt>Database</dt><dd>Embedded H2 · development only</dd><dt>Monitoring</dt><dd>{{form().monitoring?'Enabled':'Pending'}}</dd></dl><button class="btn btn-primary" type="button" (click)="openTab('cluster')">Cluster plan에서 변경</button></section>

    <section class="pgp-workspace" *ngIf="tab()==='domain'"><div class="pgp-section-head"><div><span class="vl-eyebrow">Identity domain</span><h2>Realms & Roles</h2></div></div><div class="kc-grid"><article class="kc-panel"><h2>OIDC issuer</h2><dl class="os-kv"><dt>Issuer</dt><dd class="os-mono">{{svc.issuer()}}</dd><dt>JWKS</dt><dd class="os-mono">{{svc.jwks()}}</dd><dt>Client flow</dt><dd>Authorization Code + PKCE S256</dd></dl></article><article class="kc-panel"><h2>Directory federation</h2><dl class="os-kv"><dt>Provider</dt><dd>Samba-AD</dd><dt>Protocol</dt><dd>LDAP :389</dd><dt>Status</dt><dd class="warn">Configuration managed in Keycloak Admin UI</dd></dl></article><article class="kc-panel"><h2>Provisioning authority</h2><p>사용자 프로비저닝 권위는 Syncope(IGA)입니다. JIT 사용자 생성은 허용하지 않습니다.</p></article></div></section>

    <section class="pgp-workspace" *ngIf="tab()==='backups'"><div class="pgp-section-head"><div><span class="vl-eyebrow">Protection policy</span><h2>Backups</h2></div></div><clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">현재 Keycloak 26.0 번들은 start-dev/embedded H2입니다. 운영 데이터 내구성·다중 replica·백업을 충족하지 않으므로 Production 승격 대상이 아닙니다. 외부 PostgreSQL 연결이 구현되기 전까지 이 경계를 숨기지 않습니다.</span></clr-alert-item></clr-alert><div class="kc-grid"><article class="kc-panel"><h2>Realm policy</h2><dl class="os-kv"><dt>Self registration</dt><dd>Disabled</dd><dt>Direct access grants</dt><dd>Disabled</dd><dt>Identity providers</dt><dd>None</dd></dl></article><article class="kc-panel"><h2>Container security</h2><dl class="os-kv"><dt>Service account token</dt><dd>Not mounted</dd><dt>Privilege escalation</dt><dd>Denied</dd><dt>Capabilities</dt><dd>ALL dropped</dd></dl></article><article class="kc-panel"><h2>Data protection</h2><dl class="os-kv"><dt>Database</dt><dd>Embedded H2</dd><dt>Persistent volume</dt><dd>None</dd><dt>Backup</dt><dd class="warn">Not supported in this profile</dd></dl></article></div></section>

    <section class="pgp-workspace" *ngIf="tab()==='events'"><div class="pgp-section-head"><div><span class="vl-eyebrow">Kubernetes signals</span><h2>Events</h2></div><button class="btn btn-sm" (click)="refresh()">새로고침</button></div><table class="table" *ngIf="svc.events().length; else noEvents"><thead><tr><th>Type</th><th>Reason</th><th>Message</th><th>Time</th></tr></thead><tbody><tr *ngFor="let e of svc.events()"><td>{{e.type}}</td><td>{{e.reason}}</td><td>{{e.message}}</td><td>{{e.lastTimestamp||e.eventTime||'—'}}</td></tr></tbody></table><ng-template #noEvents><p class="os-dim">최근 Keycloak 이벤트가 없습니다.</p></ng-template></section>

    <section class="pgp-workspace" *ngIf="tab()==='upgrade'">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Controlled lifecycle</span><h2>Upgrade & rollback</h2></div><span class="label label-warning">Production gate</span></div>
      <clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">현재 Keycloak 26.0 개발 프로파일은 embedded H2를 사용합니다. 외부 PostgreSQL, realm export/restore, 호환성 검증이 준비되기 전에는 운영 승격과 in-place upgrade를 허용하지 않습니다.</span></clr-alert-item></clr-alert>
      <dl class="os-kv"><dt>현재 선택</dt><dd>Keycloak {{form().version}}</dd><dt>업그레이드 단위</dt><dd>image digest + realm schema + provider compatibility</dd><dt>Rollback 근거</dt><dd>realm export와 외부 PostgreSQL 복구 시점</dd><dt>채널</dt><dd>서명 BOM의 stable / candidate / edge</dd></dl>
      <button class="btn btn-primary" type="button" (click)="openTab('cluster')">Cluster plan 검토</button>
    </section>

    <section class="pgp-workspace" *ngIf="tab()==='claims'"><div class="pgp-section-head"><div><span class="vl-eyebrow">Northbound contracts</span><h2>Claims</h2></div></div><table class="table"><thead><tr><th>Claim</th><th>Endpoint</th><th>Authority</th></tr></thead><tbody><tr><td>OIDCClientClaim</td><td class="os-mono">{{svc.issuer()}}</td><td>Foundation Control Plane</td></tr><tr><td>DirectoryFederationBinding</td><td>LDAP :389</td><td>Samba-AD</td></tr><tr><td>IdentityProvisioningClaim</td><td>SCIM 2.0</td><td>Syncope IGA</td></tr></tbody></table></section>

    <section class="pgp-workspace" *ngIf="tab()==='documentation'">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Console Manual Registry</span><h2>Documentation</h2></div><span class="label label-success">자동 등록</span></div>
      <p>Foundation package 활성화 시 Keycloak 한글 설치·운영 안내서를 Console Manual Registry와 통합 검색에 등록합니다.</p>
      <dl class="os-kv"><dt>문서 ID</dt><dd class="os-mono">plugin:foundation/{{manualId}}</dd><dt>화면 경로</dt><dd class="os-mono">/p/foundation/keycloak</dd><dt>정본 수준</dt><dd>Tier 2 · 제품/운영 안내서</dd></dl>
      <a class="btn btn-sm btn-primary" [href]="manualUrl">한글 안내서 열기</a><a class="btn btn-sm" href="https://www.keycloak.org/documentation" target="_blank" rel="noreferrer">Keycloak 공식 문서</a>
    </section>
  `,
})
export class KeycloakComponent implements OnInit, OnDestroy {
  readonly svc = inject(KcService); private readonly reg = inject(FoundationRegistryService); private readonly vr = inject(ViewRouter);
  readonly iBack = ArrowLeft16; readonly manualId = MANUAL_ID; readonly manualUrl = `/manual?doc=${encodeURIComponent(`plugin:foundation/${MANUAL_ID}`)}`; readonly tab = signal<Tab>('overview'); readonly form = signal<KeycloakForm>({...DEFAULT_FORM}); readonly controlPlaneReady = signal(false); readonly applying = signal(false); readonly progress = signal(0); readonly logs = signal<string[]>([]);
  private timer: ReturnType<typeof setInterval>|undefined;
  readonly tabs: {id:Tab;label:string;runtime?:boolean}[]=pfsPluginTabs('Realms & Roles').map(tab=>({...tab,id:tab.id as Tab,runtime:['topology','events'].includes(tab.id)}));
  readonly validationError=computed(()=>{const f=this.form();if(f.version!=='26.0')return'검증된 Keycloak 26.0만 설치할 수 있습니다.';if(f.replicas!==1)return'Embedded H2 프로파일에서는 replica 1만 허용합니다.';if(f.profile==='production')return'Production은 외부 PostgreSQL 연결 구현 전까지 사용할 수 없습니다.';return'';});
  readonly canApply=computed(()=>this.controlPlaneReady()&&!this.applying()&&!this.validationError());
  ngOnInit():void{const wanted=this.vr.tab() as Tab;if(this.tabs.some(t=>t.id===wanted))this.tab.set(wanted);void this.initialize();}
  ngOnDestroy():void{if(this.timer)clearInterval(this.timer);}
  private async initialize(){await Promise.allSettled([this.reg.refreshModels(),this.svc.refresh(),this.loadControlPlane()]);const p=this.reg.parametersOf('keycloak') as any;const cfg=p?.identityEngines?.keycloak;if(cfg)this.form.update(f=>({...f,...cfg}));}
  exists(){return this.svc.state()==='ok'&&!!this.svc.deploy();} modelState(){return this.reg.modelOf('keycloak')||'확인 중';} availability(){return this.svc.totalN()?Math.round(this.svc.readyN()/this.svc.totalN()*100):0;}
  lifecycle(){if(!this.controlPlaneReady())return'Dependency required';if(!this.exists())return'Service required';return this.svc.ready()?'Ready':'Progressing';}
  headerModel():PluginPageHeaderModel{return{name:'Keycloak',logo:LOGO,capability:'identity.iam.workspace',description:'Workforce IAM·SSO capability. OIDC realm, 실행 상태, 소비 계약과 보안 경계를 운영합니다.',lifecycle:this.lifecycle(),lifecycleClass:this.svc.ready()?'label-success':'label-warning',version:this.form().version,profile:this.form().profile,namespace:this.svc.ns};}
  tabsForUi():PluginPageTab[]{return this.tabs.map(t=>({id:t.id,label:t.label,disabled:!!t.runtime&&!this.exists(),badge:t.id==='events'?this.svc.events().filter((e:any)=>e.type==='Warning').length:''}));}
  back(){this.vr.setModule('modules');} openTab(id:string){this.tab.set(id as Tab);this.vr.setTab(id);} patch(p:Partial<KeycloakForm>){this.form.update(f=>({...f,...p}));}
  setProfile(profile:KeycloakForm['profile']){if(profile==='development'){this.form.set({...DEFAULT_FORM});return;}this.patch({profile,replicas:1});}
  setResourceProfile(p:string){const x:any={small:{cpuRequest:'250m',memoryRequest:'512Mi',cpuLimit:'1',memoryLimit:'1536Mi'},medium:{cpuRequest:'500m',memoryRequest:'1Gi',cpuLimit:'2',memoryLimit:'2Gi'},large:{cpuRequest:'1',memoryRequest:'2Gi',cpuLimit:'4',memoryLimit:'4Gi'}};this.patch({resourceProfile:p,...(x[p]||{}),profile:'custom'});}
  async refresh(){await Promise.allSettled([this.svc.refresh(),this.reg.refreshModels(),this.loadControlPlane()]);}
  private async loadControlPlane(){try{const r=await hostFetch(`${apiBase()}/api/k8s/apis/apps/v1/namespaces/opensphere-system/deployments/foundation-control-plane`,{cache:'no-store'});const b=r.ok?await r.json():null;this.controlPlaneReady.set(Number(b?.status?.readyReplicas||0)>0);}catch{this.controlPlaneReady.set(false);}}
  private log(m:string){this.logs.update(a=>[...a,`[${new Date().toLocaleTimeString()}] ${m}`]);}
  async apply(){if(!this.canApply())return;this.applying.set(true);this.progress.set(10);this.logs.set([]);this.log('FoundationModel/identity Keycloak 선언 제출');const ok=await this.reg.configureIdentityEngine('keycloak',this.form());if(!ok){this.log(`실패: ${this.reg.lastError()}`);this.progress.set(100);this.applying.set(false);return;}this.progress.set(35);this.log('선언 승인 · control-plane reconcile 관찰');let n=0;this.timer=setInterval(async()=>{n++;await this.svc.refresh();if(this.exists()){this.progress.set(Math.max(65,this.progress()));this.logOnce('deployment','Keycloak Deployment 생성 확인');}if(this.svc.ready()){this.progress.set(100);this.logOnce('ready','Keycloak Ready');this.applying.set(false);if(this.timer)clearInterval(this.timer);this.timer=undefined;}else if(n>=100){this.progress.set(100);this.log('5분 내 Ready 미도달 · Events 확인 필요');this.applying.set(false);if(this.timer)clearInterval(this.timer);this.timer=undefined;}},3000);}
  private logOnce(k:string,m:string){if(!this.logs().some(x=>x.includes(`[${k}]`)))this.log(`[${k}] ${m}`);}
}
