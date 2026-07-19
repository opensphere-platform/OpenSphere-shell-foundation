import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import { apiBase, hostFetch, writeHeaders } from '../../api-base';
import { CarbonIcon } from '../../carbon-icon';
import { FoundationRegistryService, DataEngineInstallParameters } from '../../registry/foundation-registry.service';
import { ViewRouter } from '../../view-router';
import { DATA_ENGINE_SPECS, DataEngineId, DataEngineSpec } from './data-engine.spec';
import { DataEngineRuntimeService } from './data-engine-runtime.service';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';
import Download16 from '@carbon/icons/es/download/16';
import Renew16 from '@carbon/icons/es/renew/16';
import Password16 from '@carbon/icons/es/password/16';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent } from '../../shared/plugin-page-shell.component';

type Tab = 'overview' | 'dependency' | 'plan' | 'topology' | 'consumers' | 'protection' | 'events' | 'upgrade' | 'documentation';
type Profile = 'development' | 'production' | 'custom';
interface StorageClassRow { name: string; provisioner: string; isDefault: boolean; allowExpansion: boolean; reclaimPolicy: string }
interface EngineForm extends DataEngineInstallParameters { profile: Profile; approval: string }

function defaultForm(spec: DataEngineSpec): EngineForm {
  return {
    profile: 'development', version: spec.defaultVersion, namespace: spec.namespace, replicas: spec.defaultReplicas === 3 ? 1 : spec.defaultReplicas,
    storageClass: 'standard', storageSize: spec.defaultStorage, resourceProfile: 'small',
    cpuRequest: '250m', memoryRequest: spec.id === 'opensearch' ? '1Gi' : '512Mi', cpuLimit: '1', memoryLimit: spec.id === 'opensearch' ? '2Gi' : '1Gi',
    monitoring: false, tls: spec.id === 'psmdb', authSecret: spec.id === 'valkey' ? 'foundation-data-valkey-auth' : spec.id === 'rustfs' ? 'rustfs-credentials' : '',
    heap: spec.id === 'opensearch' ? '-Xms1g -Xmx1g' : '', persistenceMode: spec.id === 'valkey' ? 'aof-everysec' : '',
    backup: { enabled: false, s3Endpoint: '', destinationPath: '', secretName: '', retentionPolicy: '30d' }, approval: '',
  };
}

@Component({
  selector: 'app-data-engine-plugin',
  standalone: true,
  imports: [CommonModule, FormsModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent, PluginTabsComponent],
  styles: [`
    :host{display:block;min-width:0}.de-head{display:flex;justify-content:space-between;gap:24px;padding:20px 0 18px;border-bottom:1px solid #d9d9d9}.de-brand{display:flex;gap:18px;align-items:center}.de-logo{width:72px;height:72px;border:1px solid #ddd;background:#fff;display:flex;align-items:center;justify-content:center}.de-logo img{max-width:56px;max-height:56px}.de-brand h1{margin:2px 0;font-size:1.55rem}.de-brand p{margin:4px 0;color:#525252}.de-meta{display:grid;grid-template-columns:auto auto;gap:6px 20px;margin:0;min-width:280px}.de-meta div{display:contents}.de-meta dt{color:#6f6f6f}.de-meta dd{margin:0;font-weight:600}.de-tabs{display:flex;overflow:auto;border-bottom:1px solid #d0d0d0;background:#fff}.de-tab{border:0;background:transparent;padding:12px 15px;white-space:nowrap;border-bottom:3px solid transparent}.de-tab.active{border-color:#4c6fff;color:#161616;font-weight:600}.de-step-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.de-step{display:flex;text-align:left;gap:10px;border:1px solid #d0d0d0;background:#fff;padding:14px}.de-step.done{border-color:#24a148}.de-step.current{border-color:#4c6fff;background:#f3f5ff}.de-step-n{width:26px;height:26px;border-radius:50%;background:#e0e0e0;display:flex;align-items:center;justify-content:center;font-weight:700}.de-step.done .de-step-n{background:#24a148;color:#fff}.de-step small{display:block;color:#6f6f6f;margin-top:3px}.de-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.de-panel{background:#fff;border:1px solid #d0d0d0;padding:16px}.de-panel h2,.de-work h2{font-size:1.05rem;margin:0 0 8px}.de-big{font-size:2rem;font-weight:600}.de-work{background:#fff;border:1px solid #d0d0d0;padding:18px;margin-top:18px}.de-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.de-form fieldset{border:1px solid #d0d0d0;padding:15px;margin:0 0 14px}.de-form legend{padding:0 6px;font-weight:600}.de-form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.de-form label>span{display:block;font-weight:600;margin-bottom:5px}.de-form input,.de-form select,.de-form textarea{width:100%;min-height:34px;border:0;border-bottom:1px solid #8d8d8d;background:#f4f4f4;padding:6px}.de-form small{display:block;color:#6f6f6f;margin-top:4px}.de-checks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.de-checks label{padding:10px;background:#f4f4f4}.de-actions{display:flex;align-items:center;gap:12px;justify-content:flex-end}.de-log{background:#161616;color:#f4f4f4;padding:12px;max-height:180px;overflow:auto;font-family:monospace;margin-top:12px}.de-progress{height:6px;background:#e0e0e0;margin-top:10px}.de-progress>div{height:100%;background:#4c6fff}.de-kv{display:grid;grid-template-columns:minmax(120px,.4fr) 1fr;gap:7px 16px}.de-kv dt{font-weight:600}.de-kv dd{margin:0;overflow-wrap:anywhere}.de-table{width:100%;border-collapse:collapse}.de-table th,.de-table td{text-align:left;padding:8px;border-bottom:1px solid #e0e0e0}.de-policy{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.de-policy>div{border:1px solid #d0d0d0;padding:12px}.de-docs{display:flex;gap:14px;margin-top:18px}.de-once{background:#fff8e1;border:1px solid #f1c21b;padding:12px;overflow-wrap:anywhere}.ok{color:#198038}.bad{color:#da1e28}.warn{color:#8e6a00}@media(max-width:1000px){.de-grid,.de-form-grid,.de-policy{grid-template-columns:repeat(2,minmax(0,1fr))}.de-head{display:block}.de-meta{margin-top:14px}}@media(max-width:650px){.de-step-row,.de-grid,.de-form-grid,.de-policy,.de-checks{grid-template-columns:1fr}}
  `],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0"><os-cicon [icon]="iBack" [size]="16"/> PFS 모듈</a>
    <section class="pgp-page-frame" [attr.aria-label]="spec.name + ' plugin 개요와 메뉴'">
      <osp-plugin-page-header [model]="headerModel()" [headingId]="engine + '-plugin-title'" />
      <osp-plugin-tabs [tabs]="tabsForUi()" [active]="tab()" [ariaLabel]="spec.name + ' plugin 메뉴'" (selected)="openTab($event)" />
    </section>

    <section *ngIf="tab()==='overview'">
      <div class="pgp-steps">
        <button class="pgp-step" [class.done]="dependencyReady()" [class.current]="!dependencyReady()" (click)="openTab('dependency')"><span class="pgp-step-n">1</span><span><b>실행 기반 준비</b><small>{{dependencyLabel()}}</small></span></button>
        <button class="pgp-step" [class.done]="exists()" [class.current]="dependencyReady()&&!exists()" (click)="openTab('plan')"><span class="pgp-step-n">2</span><span><b>서비스 구성</b><small>버전·토폴로지·스토리지·보안</small></span></button>
        <button class="pgp-step" [class.done]="ready()" [class.current]="exists()&&!ready()" [disabled]="!exists()" (click)="openTab('topology')"><span class="pgp-step-n">3</span><span><b>운영 관리</b><small>상태·소비자·보호·이벤트</small></span></button>
      </div>
      <div class="pgp-dashboard">
        <article class="pgp-panel"><h2>Package readiness</h2><p>설치 수명주기의 실제 상태만 표시합니다.</p><dl class="de-kv"><dt>PFS Control Plane</dt><dd [class.ok]="controlPlaneReady()">{{controlPlaneReady()?'Ready':'Required'}}</dd><dt>{{spec.operator?.name||'Reconciler'}}</dt><dd [class.ok]="dependencyReady()">{{dependencyLabel()}}</dd><dt>Managed resource</dt><dd [class.ok]="exists()">{{runtimePhase()}}</dd></dl><button class="btn btn-sm btn-primary" (click)="openTab(dependencyReady()?'plan':'dependency')">{{dependencyReady()?'서비스 구성':'전제조건 확인'}}</button></article>
        <article class="pgp-panel"><h2>Service health</h2><p>관리 workload와 Pod가 보고한 실제 가용성입니다.</p><div class="pgp-health"><strong [class.ok]="ready()">{{availability()}}%</strong><span>replicas ready · {{readyN()}}/{{totalN()}}</span><progress [value]="readyN()" [max]="totalN()||1"></progress></div><dl class="de-kv"><dt>Endpoint</dt><dd class="os-mono">{{spec.endpoint}}:{{spec.port}}</dd><dt>Storage</dt><dd>{{runtime.storage(engine)}}</dd></dl></article>
        <article class="pgp-panel"><h2>Operations policy</h2><p>선언된 보호·관측·인증 정책입니다.</p><dl class="de-kv"><dt>TLS</dt><dd>{{form().tls?'Enabled':'Disabled'}}</dd><dt>Monitoring</dt><dd>{{form().monitoring?'Enabled':'Disabled'}}</dd><dt>Backup</dt><dd>{{form().backup.enabled?'Configured':'Not configured'}}</dd><dt>Auth Secret</dt><dd class="os-mono">{{form().authSecret||'Operator managed / none'}}</dd></dl></article>
      </div>
      <div class="de-docs"><a [href]="manualUrl()">OpenSphere {{spec.name}} 설치·운영 안내서 (한글)</a><a [href]="spec.docs" target="_blank" rel="noreferrer">공식 문서</a><button class="btn btn-sm btn-link" (click)="openTab('plan')">OpenSphere 설치 계약</button></div>
    </section>

    <section class="de-work" *ngIf="tab()==='dependency'">
      <div class="de-section-head"><div><span class="vl-eyebrow">Internal dependency</span><h2>{{spec.operator?.name||'Foundation Control Plane'}}</h2></div><span class="label" [ngClass]="dependencyReady()?'label-success':'label-warning'">{{dependencyLabel()}}</span></div>
      <clr-alert *ngIf="!controlPlaneReady()" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Foundation Control Plane이 먼저 Ready여야 선언형 설치를 실행할 수 있습니다.</span><div class="alert-actions"><button class="btn alert-action" (click)="openControlPlane()">Control Plane</button></div></clr-alert-item></clr-alert>
      <ng-container *ngIf="spec.operator">
        <p>Operator는 이 plugin의 내부 실행 기반이며 별도 PFS plugin으로 노출하지 않습니다.</p>
        <dl class="de-kv"><dt>Chart</dt><dd>{{spec.operator.chart}} {{spec.operator.chartVersion}}</dd><dt>Repository</dt><dd class="os-mono">{{spec.operator.repository}}</dd><dt>Namespace</dt><dd class="os-mono">{{spec.operator.namespace}}</dd><dt>CRD</dt><dd class="os-mono">{{spec.operator.crd}}</dd></dl>
        <button class="btn btn-primary" [disabled]="!canInstallOperator()" (click)="installOperator()"><os-cicon [icon]="iDownload" [size]="16"/> Operator 설치</button>
      </ng-container>
      <ng-container *ngIf="!spec.operator"><p>이 엔진은 Foundation Control Plane의 SSA reconciler가 StatefulSet·Service·NetworkPolicy를 관리합니다. 별도 Operator를 설치하지 않습니다.</p></ng-container>
      <div class="de-panel" *ngIf="spec.hostPrerequisites?.length"><h2>Host prerequisites</h2><ul><li *ngFor="let item of spec.hostPrerequisites">{{item}}</li></ul></div>
      <div class="de-log" *ngIf="operatorLogs().length"><div *ngFor="let line of operatorLogs()">{{line}}</div></div>
    </section>

    <section class="de-work" *ngIf="tab()==='plan'">
      <div class="de-section-head"><div><span class="vl-eyebrow">Desired state</span><h2>{{spec.name}} 운영 구성</h2></div><span class="label" [ngClass]="exists()?'label-success':'label-warning'">{{exists()?'Managed':'Not created'}}</span></div>
      <clr-alert *ngIf="!dependencyReady()" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">설정은 미리 작성할 수 있지만 적용하려면 {{dependencyLabel()}} 상태가 필요합니다.</span></clr-alert-item></clr-alert>
      <form class="de-form" (ngSubmit)="apply()">
        <fieldset [disabled]="applying()"><legend>Topology & version</legend><div class="de-form-grid">
          <label><span>운영 프로파일</span><select name="profile" [ngModel]="form().profile" (ngModelChange)="setProfile($event)"><option value="development">Development</option><option value="production">Production HA</option><option value="custom">Custom</option></select></label>
          <label><span>Engine version</span><select name="version" [ngModel]="form().version" (ngModelChange)="patch({version:$event,profile:'custom'})"><option *ngFor="let v of spec.versions" [value]="v.value">{{v.label}}</option></select><small>버전 계획은 전제조건 준비 전에도 선택할 수 있습니다.</small></label>
          <label><span>Replicas</span><input name="replicas" type="number" min="1" max="9" [ngModel]="form().replicas" (ngModelChange)="patch({replicas:+$event,profile:'custom'})"/></label>
          <label><span>Resource profile</span><select name="resourceProfile" [ngModel]="form().resourceProfile" (ngModelChange)="setResourceProfile($event)"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
        </div></fieldset>
        <fieldset [disabled]="applying()"><legend>Persistent storage</legend><div class="de-form-grid">
          <label><span>StorageClass</span><select name="storageClass" [ngModel]="form().storageClass" (ngModelChange)="patch({storageClass:$event})"><option *ngFor="let sc of storageClasses()" [value]="sc.name">{{sc.name}}{{sc.isDefault?' (default)':''}}</option></select><small>{{storageHint()}}</small></label>
          <label><span>Data volume</span><input name="storageSize" [ngModel]="form().storageSize" (ngModelChange)="patch({storageSize:$event})"/></label>
          <label><span>CPU request / limit</span><input name="cpu" [ngModel]="form().cpuRequest" (ngModelChange)="patch({cpuRequest:$event})"/><small>limit {{form().cpuLimit}}</small></label>
          <label><span>Memory request / limit</span><input name="memory" [ngModel]="form().memoryRequest" (ngModelChange)="patch({memoryRequest:$event})"/><small>limit {{form().memoryLimit}}</small></label>
        </div></fieldset>
        <fieldset [disabled]="applying()"><legend>Security, observability & durability</legend>
          <div class="de-checks"><label><input type="checkbox" name="monitoring" [ngModel]="form().monitoring" disabled/> Metrics connector pending</label><label><input type="checkbox" name="tls" [ngModel]="form().tls" disabled/> {{engine==='psmdb'?'Operator-managed TLS':'TLS connector pending'}}</label><label><input type="checkbox" name="backup" [ngModel]="form().backup.enabled" disabled/> Backup connector pending</label></div>
          <div class="de-form-grid" *ngIf="engine==='valkey'||engine==='rustfs'"><label><span>Credentials Secret</span><input name="authSecret" [ngModel]="form().authSecret" (ngModelChange)="patch({authSecret:$event})"/></label><label><span>보안 자격 생성</span><button type="button" class="btn btn-sm" (click)="generateCredential()"><os-cicon [icon]="iPassword" [size]="16"/> Secret 생성</button></label></div>
          <div class="de-form-grid" *ngIf="engine==='opensearch'"><label><span>JVM heap</span><input name="heap" [ngModel]="form().heap" (ngModelChange)="patch({heap:$event})"/><small>-Xms/-Xmx 동일 권장</small></label></div>
        </fieldset>
        <fieldset *ngIf="upgradeRequiresApproval()"><legend>Upgrade change control</legend><clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">실행 중인 버전 변경입니다. 백업·호환성 검토 후 승인 문구를 입력하세요.</span></clr-alert-item></clr-alert><label><span>승인 문구</span><input name="approval" [ngModel]="form().approval" (ngModelChange)="patch({approval:$event})" placeholder="UPGRADE {{spec.name}} TO {{form().version}}"/></label></fieldset>
        <clr-alert *ngIf="validationError()" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{validationError()}}</span></clr-alert-item></clr-alert>
        <div class="de-once" *ngIf="credentialOnce()"><b>한 번만 표시되는 자격 증명</b><div class="os-mono">{{credentialOnce()}}</div></div>
        <div class="de-progress" *ngIf="applying()||applyProgress()"><div [style.width.%]="applyProgress()"></div></div><div class="de-log" *ngIf="applyLogs().length"><div *ngFor="let line of applyLogs()">{{line}}</div></div>
        <div class="de-actions"><span class="os-dim">FoundationModel/data → dataEngines.{{engine}} → control-plane SSA</span><button class="btn btn-primary" type="submit" [disabled]="!canApply()">{{exists()?'운영 구성 적용':'서비스 생성'}}</button></div>
      </form>
    </section>

    <section class="de-work" *ngIf="tab()==='topology'">
      <div class="de-section-head"><h2>Topology & workloads</h2><button class="btn btn-sm" (click)="refresh()" [disabled]="runtime.busy()[engine]"><os-cicon [icon]="iRenew" [size]="16"/> 새로고침</button></div>
      <clr-alert *ngIf="rt().state==='loading'" clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{spec.name}} 관리 리소스와 workload 상태를 확인하고 있습니다.</span></clr-alert-item></clr-alert>
      <clr-alert *ngIf="rt().state==='noperm'" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">현재 사용자에게 {{spec.name}} 관리 리소스를 조회할 권한이 없습니다. Foundation 권한 프로파일과 impersonation 경로를 확인하세요.</span></clr-alert-item></clr-alert>
      <clr-alert *ngIf="rt().state==='nocrd'" clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{spec.name}} 서비스가 아직 생성되지 않았습니다. 설치·운영 구성에서 desired state를 제출하세요.</span><div class="alert-actions"><button class="btn alert-action" (click)="openTab('plan')">설치·운영 구성</button></div></clr-alert-item></clr-alert>
      <clr-alert *ngIf="rt().state==='error'" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{spec.name}} 런타임 상태 조회에 실패했습니다. API 경로와 control-plane 상태를 확인한 뒤 다시 시도하세요.</span></clr-alert-item></clr-alert>
      <div class="de-grid"><article class="de-panel"><h2>Managed resource</h2><dl class="de-kv"><dt>Kind/name</dt><dd class="os-mono">{{spec.workloadKind==='psmdb'?'PerconaServerMongoDB':'StatefulSet'}}/{{spec.workloadName}}</dd><dt>Image</dt><dd class="os-mono">{{runtime.image(engine)||'—'}}</dd><dt>Ready</dt><dd>{{readyN()}}/{{totalN()}}</dd></dl></article><article class="de-panel"><h2>Storage</h2><p>{{runtime.storage(engine)}}</p></article><article class="de-panel"><h2>Endpoint</h2><p class="os-mono">{{spec.endpoint}}:{{spec.port}}</p><p>ClusterIP 전용 소비점</p></article></div>
      <table class="de-table"><thead><tr><th>Pod</th><th>Phase</th><th>Ready</th><th>Node</th><th>Restarts</th></tr></thead><tbody><tr *ngFor="let p of rt().pods"><td class="os-mono">{{p.metadata?.name}}</td><td>{{p.status?.phase}}</td><td>{{podReady(p)?'Ready':'Not Ready'}}</td><td>{{p.spec?.nodeName||'—'}}</td><td>{{restarts(p)}}</td></tr><tr *ngIf="!rt().pods.length"><td colspan="5">관찰된 Pod가 없습니다.</td></tr></tbody></table>
    </section>

    <section class="de-work" *ngIf="tab()==='consumers'"><h2>Consumer contracts</h2><table class="de-table"><thead><tr><th>Contract</th><th>Status</th><th>Description</th></tr></thead><tbody><tr *ngFor="let c of spec.claims"><td>{{c.name}}</td><td><span class="label" [ngClass]="c.status==='available'?'label-success':'label-warning'">{{c.status}}</span></td><td>{{c.description}}</td></tr></tbody></table><dl class="de-kv"><dt>Service endpoint</dt><dd class="os-mono">{{spec.endpoint}}:{{spec.port}}</dd><dt>Credential source</dt><dd class="os-mono">{{form().authSecret||'Operator generated Secret'}}</dd></dl></section>
    <section class="de-work" *ngIf="tab()==='protection'"><h2>Protection & security</h2><div class="de-policy"><div *ngFor="let p of spec.policies"><b>{{p.name}}</b><p>{{p.description}}</p></div></div><clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">자격 증명 값은 FoundationModel·ConfigMap·화면 상태에 저장하지 않고 Secret 이름만 선언합니다. 외부 공개는 별도 Ingress/OIDC 승인 절차를 사용합니다.</span></clr-alert-item></clr-alert></section>
    <section class="de-work" *ngIf="tab()==='events'"><div class="de-section-head"><h2>Events</h2><button class="btn btn-sm" (click)="refresh()">새로고침</button></div><table class="de-table"><thead><tr><th>Time</th><th>Type</th><th>Reason</th><th>Object</th><th>Message</th></tr></thead><tbody><tr *ngFor="let e of rt().events"><td>{{e.lastTimestamp||e.eventTime||'—'}}</td><td [class.bad]="e.type==='Warning'">{{e.type}}</td><td>{{e.reason}}</td><td>{{e.involvedObject?.kind}}/{{e.involvedObject?.name}}</td><td>{{e.message}}</td></tr><tr *ngIf="!rt().events.length"><td colspan="5">관련 이벤트가 없습니다.</td></tr></tbody></table></section>

    <section class="de-work" *ngIf="tab()==='upgrade'">
      <div class="de-section-head"><div><span class="vl-eyebrow">Controlled lifecycle</span><h2>Upgrade & rollback</h2></div><span class="label" [ngClass]="upgradeRequiresApproval()?'label-warning':'label-info'">{{upgradeRequiresApproval()?'승인 필요':'변경 없음'}}</span></div>
      <p>설치 이미지에서 확인된 버전과 서명 BOM에서 선택한 채널 버전을 비교합니다. 실행 중인 major/minor 변경은 보호 상태와 rollback 근거를 확인한 뒤에만 적용합니다.</p>
      <table class="de-table"><thead><tr><th>채널</th><th>버전</th><th>현재</th><th>용도</th></tr></thead><tbody><tr *ngFor="let v of spec.versions"><td>{{v.channel}}</td><td>{{v.value}}</td><td><span class="label" [ngClass]="installedVersion()===v.value?'label-success':''">{{installedVersion()===v.value?'Running':form().version===v.value?'Selected':'Available'}}</span></td><td>{{v.channel==='stable'?'운영 승인 채널':v.channel==='candidate'?'승격 검증 채널':'개발 검증 채널'}}</td></tr></tbody></table>
      <clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">StorageClass 변경과 데이터 형식 major 변경은 in-place rollback으로 간주하지 않습니다. 백업·복구 검증과 별도 마이그레이션 계획이 필요합니다.</span></clr-alert-item></clr-alert>
      <button class="btn btn-primary" type="button" (click)="openTab('plan')">설치·운영 구성에서 버전 검토</button>
    </section>

    <section class="de-work" *ngIf="tab()==='documentation'">
      <div class="de-section-head"><div><span class="vl-eyebrow">Console Manual Registry</span><h2>Documentation</h2></div><span class="label label-success">자동 등록</span></div>
      <p>이 plugin이 소유한 한글 설치·운영 안내서는 Foundation package 활성화 시 Console Manual Registry와 통합 검색에 자동 등록됩니다.</p>
      <dl class="de-kv"><dt>문서 ID</dt><dd class="os-mono">plugin:foundation/{{spec.manualId}}</dd><dt>화면 경로</dt><dd class="os-mono">/p/foundation/{{engine}}</dd><dt>정본 수준</dt><dd>Tier 2 · 제품/운영 안내서</dd></dl>
      <div class="de-docs"><a class="btn btn-sm btn-primary" [href]="manualUrl()">한글 안내서 열기</a><a class="btn btn-sm" [href]="spec.docs" target="_blank" rel="noreferrer">제품 공식 문서</a></div>
    </section>
  `,
})
export class DataEnginePluginComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) engine: DataEngineId = 'psmdb';
  readonly runtime = inject(DataEngineRuntimeService);
  readonly reg = inject(FoundationRegistryService);
  readonly vr = inject(ViewRouter);
  readonly tab = signal<Tab>('overview');
  readonly form = signal<EngineForm>(defaultForm(DATA_ENGINE_SPECS.psmdb));
  readonly storageClasses = signal<StorageClassRow[]>([]);
  readonly controlPlaneReady = signal(false);
  readonly providerHelmReady = signal(false);
  readonly applying = signal(false);
  readonly applyProgress = signal(0);
  readonly applyLogs = signal<string[]>([]);
  readonly operatorLogs = signal<string[]>([]);
  readonly credentialOnce = signal('');
  readonly iBack = ArrowLeft16; readonly iDownload = Download16; readonly iRenew = Renew16; readonly iPassword = Password16;
  private watchTimer: ReturnType<typeof setInterval> | undefined;
  readonly tabs: {id:Tab;label:string;runtime?:boolean}[] = [
    {id:'overview',label:'Overview'},{id:'dependency',label:'실행 기반'},{id:'plan',label:'설치·운영 구성'},
    {id:'topology',label:'Topology',runtime:true},{id:'consumers',label:'Consumers'},{id:'protection',label:'Backup & Security'},{id:'events',label:'Events',runtime:true},
    {id:'upgrade',label:'Upgrade'},{id:'documentation',label:'Documentation'},
  ];
  get spec(): DataEngineSpec { return DATA_ENGINE_SPECS[this.engine]; }
  readonly validationError = computed(() => {
    const f=this.form();
    if (!/^\d+(Ei|Pi|Ti|Gi|Mi)$/.test(f.storageSize)) return '스토리지 용량은 10Gi와 같은 Kubernetes quantity여야 합니다.';
    if (f.replicas<1||f.replicas>9) return 'Replica는 1~9 범위여야 합니다.';
    if ((this.engine==='valkey'||this.engine==='rustfs')&&!f.authSecret.trim()) return 'Credentials Secret 이름이 필요합니다.';
    if (f.backup.enabled&&(!f.backup.s3Endpoint||!f.backup.destinationPath||!f.backup.secretName)) return '백업을 활성화하면 S3 endpoint, destination, Secret이 모두 필요합니다.';
    if (this.upgradeRequiresApproval()&&f.approval!==`UPGRADE ${this.spec.name} TO ${f.version}`) return `승인 문구를 정확히 입력하세요: UPGRADE ${this.spec.name} TO ${f.version}`;
    return '';
  });
  readonly canApply = computed(()=>this.dependencyReady()&&!this.applying()&&!this.validationError());

  ngOnInit():void{this.runtime.start();void this.initialize();}
  ngOnChanges(ch:SimpleChanges):void{if(ch['engine']&&!ch['engine'].firstChange){this.form.set(defaultForm(this.spec));this.tab.set('overview');void this.initialize();}}
  ngOnDestroy():void{this.runtime.stop();if(this.watchTimer)clearInterval(this.watchTimer);}
  private async initialize():Promise<void>{this.form.set(defaultForm(this.spec));await Promise.allSettled([this.reg.refreshModels(),this.runtime.refresh(this.engine),this.loadPrereqs(),this.loadStorageClasses()]);this.hydrate();}
  rt(){return this.runtime.runtime(this.engine);} exists(){return this.rt().state==='ok'&&!!this.rt().resource;} ready(){return this.runtime.ready(this.engine);} readyN(){return this.runtime.readyN(this.engine);} totalN(){return this.runtime.totalN(this.engine);} runtimePhase(){return this.runtime.phase(this.engine);} installedVersion(){const i=this.runtime.image(this.engine);return this.spec.versions.find(v=>i.includes(v.value))?.value||'';} availability(){return this.totalN()?Math.round(this.readyN()/this.totalN()*100):0;}
  lifecycle():string{if(!this.dependencyReady())return 'Dependency required';if(!this.exists())return 'Service required';return this.ready()?'Ready':'Progressing';}
  headerModel():PluginPageHeaderModel{return{name:this.spec.name,logo:this.spec.logo,capability:this.spec.capability,description:this.spec.description,lifecycle:this.lifecycle(),lifecycleClass:this.ready()?'label-success':'label-warning',version:this.installedVersion()||this.form().version,profile:this.form().profile,namespace:this.spec.namespace};}
  tabsForUi():PluginPageTab[]{return this.tabs.map(t=>({id:t.id,label:t.label,disabled:!!t.runtime&&!this.exists(),badge:t.id==='events'?this.warningCount():''}));}
  dependencyReady():boolean{return this.controlPlaneReady()&&this.runtime.operatorReady(this.engine);}
  dependencyLabel():string{if(!this.controlPlaneReady())return 'PFS Control Plane required';if(this.spec.operator&&!this.runtime.operatorReady(this.engine))return `${this.spec.operator.name} required`;return this.spec.operator?`${this.spec.operator.name} Ready`:'Foundation reconciler Ready';}
  canInstallOperator():boolean{return !!this.spec.operator&&this.controlPlaneReady()&&this.providerHelmReady()&&!this.runtime.operatorReady(this.engine);}
  warningCount():number{return this.rt().events.filter(e=>e.type==='Warning').length;}
  podReady(p:any):boolean{return(p.status?.conditions??[]).some((c:any)=>c.type==='Ready'&&c.status==='True');} restarts(p:any):number{return(p.status?.containerStatuses??[]).reduce((a:number,c:any)=>a+Number(c.restartCount??0),0);}
  back(){this.vr.setModule('modules');} openControlPlane(){this.vr.setModule('control-plane');} openTab(id:string){this.tab.set(id as Tab);this.vr.setTab(id);} manualUrl():string{return `/manual?doc=${encodeURIComponent(`plugin:foundation/${this.spec.manualId}`)}`;} patch(p:Partial<EngineForm>){this.form.update(f=>({...f,...p}));} patchBackup(p:Partial<EngineForm['backup']>){this.form.update(f=>({...f,backup:{...f.backup,...p}}));}
  setProfile(profile:Profile):void{const s=this.spec;if(profile==='production'){this.form.update(f=>({...f,profile,replicas:s.id==='rustfs'?4:3,storageSize:s.id==='rustfs'?'200Gi':'50Gi',resourceProfile:'medium',cpuRequest:'500m',memoryRequest:s.id==='opensearch'?'2Gi':'1Gi',cpuLimit:'2',memoryLimit:s.id==='opensearch'?'4Gi':'2Gi',monitoring:false,tls:s.id==='psmdb'}));return;}if(profile==='development'){this.form.set({...defaultForm(s),profile});return;}this.patch({profile});}
  setResourceProfile(p:string):void{const v:Record<string,Partial<EngineForm>>={small:{resourceProfile:'small',cpuRequest:'250m',memoryRequest:this.engine==='opensearch'?'1Gi':'512Mi',cpuLimit:'1',memoryLimit:this.engine==='opensearch'?'2Gi':'1Gi'},medium:{resourceProfile:'medium',cpuRequest:'500m',memoryRequest:this.engine==='opensearch'?'2Gi':'1Gi',cpuLimit:'2',memoryLimit:this.engine==='opensearch'?'4Gi':'2Gi'},large:{resourceProfile:'large',cpuRequest:'1',memoryRequest:this.engine==='opensearch'?'4Gi':'2Gi',cpuLimit:'4',memoryLimit:this.engine==='opensearch'?'8Gi':'4Gi'}};this.patch({...v[p],profile:'custom'});}
  storageHint():string{const sc=this.storageClasses().find(x=>x.name===this.form().storageClass);return sc?`${sc.provisioner} · ${sc.allowExpansion?'온라인 확장 지원':'확장 미지원'} · reclaim ${sc.reclaimPolicy}`:'StorageClass 확인 중';}
  upgradeRequiresApproval():boolean{return this.exists()&&!!this.installedVersion()&&this.installedVersion()!==this.form().version;}
  async refresh(){await Promise.allSettled([this.runtime.refresh(this.engine),this.loadPrereqs(),this.reg.refreshModels()]);}
  private log(m:string){this.applyLogs.update(a=>[...a,`[${new Date().toLocaleTimeString()}] ${m}`]);}
  private opLog(m:string){this.operatorLogs.update(a=>[...a,`[${new Date().toLocaleTimeString()}] ${m}`]);}
  async apply():Promise<void>{if(!this.canApply())return;this.applying.set(true);this.applyProgress.set(10);this.applyLogs.set([]);this.log(`${this.spec.name} desired state 제출`);const{profile:_p,approval:_a,...params}=this.form();const ok=await this.reg.configureDataEngine(this.engine,params);if(!ok){this.log(`실패: ${this.reg.lastError()}`);this.applyProgress.set(100);this.applying.set(false);return;}this.applyProgress.set(30);this.log('FoundationModel/data 선언 승인 · reconciler 관찰 시작');this.startWatch();}
  private startWatch(){if(this.watchTimer)clearInterval(this.watchTimer);let n=0;this.watchTimer=setInterval(async()=>{n++;await this.runtime.refresh(this.engine);if(this.exists()){this.applyProgress.set(Math.max(55,this.applyProgress()));this.logOnce('resource',`${this.spec.workloadName} 생성 확인`);}if(this.rt().pods.length){this.applyProgress.set(Math.max(75,this.applyProgress()));this.logOnce('pods',`Pod ${this.rt().pods.length}개 관찰`);}if(this.ready()){this.applyProgress.set(100);this.logOnce('ready','모든 replica Ready');this.applying.set(false);if(this.watchTimer)clearInterval(this.watchTimer);this.watchTimer=undefined;}else if(n>=100){this.applyProgress.set(100);this.log('5분 내 Ready 미도달 · Events 확인 필요');this.applying.set(false);if(this.watchTimer)clearInterval(this.watchTimer);this.watchTimer=undefined;}},3000);}
  private logOnce(k:string,m:string){if(!this.applyLogs().some(x=>x.includes(`[${k}]`)))this.log(`[${k}] ${m}`);}
  async installOperator():Promise<void>{const op=this.spec.operator;if(!op||!this.canInstallOperator())return;this.operatorLogs.set([]);this.opLog(`${op.chart} ${op.chartVersion} 설치 요청`);const body={apiVersion:'helm.crossplane.io/v1beta1',kind:'Release',metadata:{name:'psmdb-operator'},spec:{forProvider:{namespace:op.namespace,chart:{name:op.chart,repository:op.repository,version:op.chartVersion},values:{image:{repository:'ghcr.io/opensphere-platform/mirror/percona-server-mongodb-operator',tag:op.chartVersion}}},providerConfigRef:{name:'default'}}};try{const r=await hostFetch(`${apiBase()}/api/k8s/apis/helm.crossplane.io/v1beta1/releases`,{method:'POST',headers:writeHeaders(),body:JSON.stringify(body)});if(r.status===409)this.opLog('Release가 이미 존재 · 상태 확인');else if(!r.ok)throw new Error(`HTTP ${r.status}`);else this.opLog('Release/psmdb-operator 생성');for(let i=0;i<60;i++){await new Promise(x=>setTimeout(x,3000));await this.runtime.refresh(this.engine);if(this.runtime.operatorReady(this.engine)){this.opLog('Operator Deployment Ready');return;}}this.opLog('3분 내 Ready 미도달 · Events 확인 필요');}catch(e){this.opLog(`설치 실패: ${String((e as Error)?.message??e)}`);}}
  async generateCredential():Promise<void>{const name=this.form().authSecret.trim();if(!name)return;const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);const secret=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');const data=this.engine==='valkey'?{password:btoa(secret)}:{access_key:btoa('opensphere'),secret_key:btoa(secret)};const obj={apiVersion:'v1',kind:'Secret',metadata:{name,namespace:this.spec.namespace,labels:{'foundation.opensphere.io/engine':this.engine}},type:'Opaque',data};const r=await hostFetch(`${apiBase()}/api/k8s/api/v1/namespaces/${this.spec.namespace}/secrets`,{method:'POST',headers:writeHeaders(),body:JSON.stringify(obj)});if(r.ok){this.credentialOnce.set(this.engine==='valkey'?`password=${secret}`:`accessKey=opensphere · secretKey=${secret}`);}else if(r.status===409){this.credentialOnce.set('Secret이 이미 존재합니다. 값은 다시 표시하지 않습니다. 새 이름을 사용하거나 별도 회전 절차를 실행하세요.');}else this.credentialOnce.set(`Secret 생성 실패 HTTP ${r.status}`);}
  private async loadPrereqs():Promise<void>{try{const cp=await hostFetch(`${apiBase()}/api/k8s/apis/apps/v1/namespaces/opensphere-system/deployments/foundation-control-plane`,{cache:'no-store'});if(cp.ok){const b=await cp.json();this.controlPlaneReady.set(Number(b.status?.readyReplicas??0)>0);}else this.controlPlaneReady.set(false);const [crd,provider,cfg]=await Promise.all([hostFetch(`${apiBase()}/api/k8s/apis/apiextensions.k8s.io/v1/customresourcedefinitions/releases.helm.crossplane.io`),hostFetch(`${apiBase()}/api/k8s/apis/pkg.crossplane.io/v1/providers/provider-helm`),hostFetch(`${apiBase()}/api/k8s/apis/helm.crossplane.io/v1beta1/providerconfigs/default`)]);this.providerHelmReady.set(crd.ok&&provider.ok&&cfg.ok);}catch{this.controlPlaneReady.set(false);this.providerHelmReady.set(false);}}
  private async loadStorageClasses():Promise<void>{try{const r=await hostFetch(`${apiBase()}/api/k8s/apis/storage.k8s.io/v1/storageclasses`,{cache:'no-store'});if(!r.ok)return;const rows:StorageClassRow[]=((await r.json()).items??[]).map((x:any)=>({name:String(x.metadata?.name??''),provisioner:String(x.provisioner??''),isDefault:x.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class']==='true',allowExpansion:x.allowVolumeExpansion===true,reclaimPolicy:String(x.reclaimPolicy??'Delete')})).filter((x:StorageClassRow)=>!!x.name).sort((a:StorageClassRow,b:StorageClassRow)=>Number(b.isDefault)-Number(a.isDefault)||a.name.localeCompare(b.name));this.storageClasses.set(rows);if(!rows.some(x=>x.name===this.form().storageClass)){const x=rows.find(x=>x.isDefault)||rows[0];if(x)this.patch({storageClass:x.name});}}catch{/* rendered as checking */}}
  private hydrate():void{const p=this.reg.parametersOf(this.engine) as any;const cfg=p?.dataEngines?.[this.engine];if(!cfg)return;this.form.update(f=>({...f,...cfg,backup:{...f.backup,...(cfg.backup??{})}}));}
}
