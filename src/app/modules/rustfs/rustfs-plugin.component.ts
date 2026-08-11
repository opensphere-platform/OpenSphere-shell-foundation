import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import { CarbonIcon } from '../../carbon-icon';
import { apiBase, hostFetch } from '../../api-base';
import { DataEngineInstallParameters, FoundationRegistryService } from '../../registry/foundation-registry.service';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent } from '../../shared/plugin-page-shell.component';
import { ViewRouter } from '../../view-router';
import { DATA_ENGINE_SPECS } from '../data-engine/data-engine.spec';
import { RustFSAdminService, RustFSBucket } from './rustfs-admin.service';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';
import Renew16 from '@carbon/icons/es/renew/16';
import Password16 from '@carbon/icons/es/password/16';
import Add16 from '@carbon/icons/es/add/16';
import TrashCan16 from '@carbon/icons/es/trash-can/16';

type Tab = 'overview' | 'monitoring' | 'operator' | 'cluster' | 'topology' | 'config' | 'domain' | 'backups' | 'events' | 'claims' | 'upgrade' | 'documentation';
type Profile = 'development' | 'custom';
interface StorageClassRow { name: string; provisioner: string; isDefault: boolean; allowExpansion: boolean; reclaimPolicy: string }
interface RustFSForm extends DataEngineInstallParameters { profile: Profile }

const SPEC = DATA_ENGINE_SPECS.rustfs;
const DEFAULT_FORM: RustFSForm = {
  profile: 'development', version: '1.0.0-beta.10', namespace: SPEC.namespace, replicas: 1,
  storageClass: 'ceph-rbd', storageSize: '50Gi', resourceProfile: 'small',
  cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '1', memoryLimit: '1Gi',
  monitoring: false, tls: false, authSecret: 'rustfs-credentials',
  backup: { enabled: false, s3Endpoint: '', destinationPath: '', secretName: '', retentionPolicy: '30d' },
};

@Component({
  selector: 'app-rustfs-plugin',
  standalone: true,
  imports: [CommonModule, FormsModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent, PluginTabsComponent],
  styles: [`
    :host{display:block;min-width:0}.rf-work{max-width:82rem}.rf-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.rf-card{background:#fff;border:1px solid #d0d0d0;padding:16px;min-width:0}.rf-card h2,.rf-card h3{margin:0 0 8px;font-size:1rem}.rf-card p{color:#525252;font-size:.76rem;line-height:1.5}.rf-table{width:100%;border-collapse:collapse;background:#fff}.rf-table th,.rf-table td{padding:8px 10px;border:1px solid #e0e0e0;text-align:left;vertical-align:top;font-size:.76rem}.rf-table th{background:#f4f4f4}.rf-mono{font-family:monospace;word-break:break-all}.rf-note{padding:10px 12px;background:#edf5ff;border-left:3px solid #4589ff;color:#1f3b5b;font-size:.76rem}.rf-warning{padding:10px 12px;background:#fff8e1;border-left:3px solid #f1c21b;color:#5c3b00;font-size:.76rem}.rf-once{padding:12px;background:#fff8e1;border:1px solid #f1c21b;word-break:break-all;margin-top:12px}.rf-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.rf-bucket-form{display:grid;grid-template-columns:minmax(14rem,1fr) minmax(20rem,2fr) auto;gap:10px;align-items:end;margin:0 0 14px}.rf-bucket-form label{display:flex;flex-direction:column;gap:4px;font-size:.7rem}.rf-bucket-form input{width:100%;min-height:2rem;border:0;border-bottom:1px solid #8d8d8d;background:#f4f4f4;padding:5px}.rf-empty{padding:18px;background:#fff;border:1px dashed #8d8d8d;color:#525252}.rf-log{max-height:13rem;overflow:auto;background:#0f2230;color:#cfe0e6;padding:12px;font-family:monospace;font-size:.72rem}.rf-progress{height:7px;background:#e0e0e0}.rf-progress>div{height:100%;background:#4c6fff}.rf-policy{display:grid;border-top:1px solid #e0e0e0}.rf-policy div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e0e0e0;padding:9px 0;font-size:.76rem}.rf-policy b.ok{color:#198038}.rf-kpi{font-size:2rem;font-weight:300}.rf-kpi small{display:block;font-size:.68rem;color:#667193;text-transform:uppercase}@media(max-width:1000px){.rf-grid{grid-template-columns:1fr}.rf-bucket-form{grid-template-columns:1fr}}
  `],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0"><os-cicon [icon]="iBack" [size]="16"/> PFSS 모듈</a>
    <section class="pgp-page-frame" aria-label="RustFS plugin 개요와 메뉴">
      <osp-plugin-page-header [model]="headerModel()" headingId="rustfs-plugin-title" (managementSelected)="openTab($event)" (namespaceAdd)="openTab('claims')" (refreshRequested)="refresh()" />
      <osp-plugin-tabs [tabs]="tabsForUi()" [active]="tab()" ariaLabel="RustFS plugin 메뉴" (selected)="openTab($event)" />
    </section>

    <ng-container *ngIf="tab()==='overview'">
      <section class="pgp-steps" aria-label="RustFS 설치 단계">
        <button type="button" class="pgp-step" [class.done]="controlPlaneReady()" [class.current]="!controlPlaneReady()" (click)="openTab('operator')"><span class="pgp-step-n">1</span><span><b>실행 기반</b><small>{{controlPlaneReady()?'Foundation Control Plane Ready':'Control Plane 확인 필요'}}</small></span></button>
        <button type="button" class="pgp-step" [class.done]="rf.exists()" [class.current]="controlPlaneReady()&&!rf.exists()" (click)="openTab('cluster')"><span class="pgp-step-n">2</span><span><b>RustFS 생성</b><small>정확 Secret·단일 노드·PVC 구성</small></span></button>
        <button type="button" class="pgp-step" [class.done]="rf.ready()" [class.current]="rf.exists()&&!rf.ready()" [disabled]="!rf.exists()" (click)="openTab('domain')"><span class="pgp-step-n">3</span><span><b>운영 관리</b><small>S3 버킷·토폴로지·이벤트</small></span></button>
      </section>
      <section class="pgp-dashboard">
        <article class="pgp-panel"><h2>Package readiness</h2><p>설치 수명주기의 실제 상태만 표시합니다.</p><div class="pgp-status-list"><div><span>Foundation Control Plane</span><b [class.ok]="controlPlaneReady()">{{controlPlaneReady()?'Ready':'Required'}}</b></div><div><span>RustFS credential</span><b [class.ok]="rf.credentialState()?.validKeys">{{rf.credentialState()?.validKeys?'Ready':'Required'}}</b></div><div><span>StatefulSet</span><b [class.ok]="rf.exists()">{{rf.exists()?'Managed':'Not created'}}</b></div><div><span>S3 management API</span><b [class.ok]="rf.summaryState()==='ok'">{{rf.summaryState()==='ok'?'Connected':rf.summaryState()==='error'?'Error':'Waiting'}}</b></div></div><button class="btn btn-sm" (click)="refresh()"><os-cicon [icon]="iRenew" [size]="16"/> 상태 새로고침</button></article>
        <article class="pgp-panel"><h2>Storage health</h2><p>StatefulSet과 PVC가 보고한 현재 가용성입니다.</p><div class="pgp-health"><strong>{{rf.availability()}}%</strong><span>instances ready</span><progress [value]="rf.readyN()" [max]="rf.totalN()||1"></progress></div><dl class="os-kv"><dt>Instance</dt><dd>{{rf.readyN()}} / {{rf.totalN()}}</dd><dt>Storage</dt><dd>{{rf.capacity()}} · {{rf.storageClass()}}</dd><dt>Buckets</dt><dd>{{rf.summary()?.bucketCount??'—'}}</dd><dt>Version</dt><dd>{{rf.summary()?.version||form().version}}</dd></dl></article>
        <article class="pgp-panel"><h2>Operations policy</h2><p>현재 구현된 보호·접속·내구성 계약입니다.</p><div class="pgp-policy-grid"><div><span>Topology</span><b>Single node</b></div><div><span>Credentials</span><b class="ok">Exact Secret</b></div><div><span>Exposure</span><b class="ok">ClusterIP</b></div><div><span>Bucket API</span><b class="ok">Allowlisted</b></div><div><span>Prometheus</span><b>Not configured</b></div><div><span>Backup</span><b>Not configured</b></div></div></article>
      </section>
      <div class="rf-warning">현재 control-plane은 RustFS 분산 endpoint set과 erasure topology를 만들지 않습니다. 따라서 복제 수를 늘려 HA처럼 보이게 하지 않고, 검증된 단일 노드 계약만 제공합니다.</div>
    </ng-container>

    <section *ngIf="tab()==='monitoring'" class="rf-work">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Operations · truthful evidence</span><h2>RustFS Monitoring</h2></div><button class="btn btn-sm" (click)="refresh()" [disabled]="rf.busy()"><os-cicon [icon]="iRenew" [size]="16"/> 새로고침</button></div>
      <clr-alert [clrAlertType]="rf.summaryState()==='error'?'danger':'info'" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{rf.summaryState()==='ok'?'S3 SigV4 관리 연결과 Kubernetes workload 상태를 확인했습니다.':rf.summaryError()}}</span></clr-alert-item></clr-alert>
      <div class="rf-grid"><article class="rf-card"><div class="rf-kpi">{{rf.availability()}}%<small>Instance availability</small></div><p>{{rf.readyN()}} / {{rf.totalN()}} Ready</p></article><article class="rf-card"><div class="rf-kpi">{{rf.summary()?.bucketCount??'—'}}<small>S3 buckets</small></div><p>서버 측 SigV4 ListBuckets 결과</p></article><article class="rf-card"><div class="rf-kpi">{{rf.capacity()}}<small>Persistent volume</small></div><p>{{rf.storageClass()}}</p></article></div>
      <p class="rf-warning">고정된 RustFS 1.0.0-beta.10에 대해 OpenSphere가 검증한 Prometheus exporter/metrics endpoint가 아직 없습니다. 메트릭이 없는 상태를 차트 0값으로 위장하지 않습니다.</p>
    </section>

    <section *ngIf="tab()==='operator'" class="pgp-workspace">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Foundation native</span><h2>Runtime dependency</h2></div><span class="label" [ngClass]="controlPlaneReady()?'label-success':'label-warning'">{{controlPlaneReady()?'Ready':'Required'}}</span></div>
      <p>RustFS는 별도 Kubernetes Operator를 요구하지 않습니다. Foundation Control Plane이 StatefulSet, Service, NetworkPolicy와 PVC를 하나의 bundle로 서버 측 적용합니다.</p>
      <dl class="os-kv"><dt>Reconciler</dt><dd>foundation-control-plane</dd><dt>Workload</dt><dd class="rf-mono">StatefulSet/opensphere-rustfs</dd><dt>Credential</dt><dd class="rf-mono">Secret/opensphere-foundation/rustfs-credentials</dd><dt>관리 경계</dt><dd>Console identity → exact Secret + S3 allowlist</dd></dl>
    </section>

    <section *ngIf="tab()==='cluster'" class="pgp-workspace">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Desired state</span><h2>RustFS Cluster plan</h2></div><span class="label" [ngClass]="rf.exists()?'label-success':'label-warning'">{{rf.exists()?'Managed':'Not created'}}</span></div>
      <form class="pgp-form" (ngSubmit)="apply()">
        <fieldset [disabled]="applying()"><legend>Topology & version</legend><div class="pgp-form-grid"><label><span>운영 프로파일</span><select name="profile" [ngModel]="form().profile" (ngModelChange)="setProfile($event)"><option value="development">Development · single node</option><option value="custom">Custom · single node</option></select><small>분산 HA는 구현 후 별도 프로파일로 제공합니다.</small></label><label><span>RustFS version</span><select name="version" [ngModel]="form().version" (ngModelChange)="patch({version:$event,profile:'custom'})"><option value="1.0.0-beta.10">RustFS 1.0.0-beta.10 · candidate</option></select></label><label><span>Instances</span><input name="replicas" type="number" [ngModel]="1" disabled/><small>현재 관리 계약은 정확히 1개입니다.</small></label><label><span>Resource profile</span><select name="resource" [ngModel]="form().resourceProfile" (ngModelChange)="setResource($event)"><option value="small">Small · 250m / 512Mi</option><option value="medium">Medium · 500m / 1Gi</option><option value="large">Large · 1 / 2Gi</option></select></label></div></fieldset>
        <fieldset [disabled]="applying()"><legend>Persistent storage</legend><div class="pgp-form-grid"><label><span>StorageClass</span><select name="storageClass" [ngModel]="form().storageClass" (ngModelChange)="patch({storageClass:$event})"><option *ngFor="let sc of storageClasses()" [value]="sc.name">{{sc.name}}{{sc.isDefault?' (default)':''}}</option></select><small>{{storageHint()}}</small></label><label><span>Data volume</span><input name="storageSize" [ngModel]="form().storageSize" (ngModelChange)="patch({storageSize:$event})" placeholder="50Gi"/></label><label><span>Namespace</span><input name="namespace" [ngModel]="form().namespace" disabled/></label></div></fieldset>
        <fieldset [disabled]="applying()"><legend>Security & credentials</legend><div class="pgp-form-grid"><label><span>Authentication Secret</span><input name="authSecret" [ngModel]="form().authSecret" disabled/><small>초기 Secret은 Setup이 생성하며 임의 이름은 허용하지 않습니다.</small></label><label><span>Secret 작업 사유</span><input name="secretReason" [(ngModel)]="secretReason" placeholder="8자 이상 자격 회전 사유"/></label><div class="rf-actions"><button type="button" class="btn btn-sm" (click)="createCredential()" [disabled]="secretReason.trim().length<8"><os-cicon [icon]="iPassword" [size]="16"/> Secret 회전</button></div><label><span>Monitoring</span><input value="Exporter 미구성" disabled/><small>지원되지 않는 설정은 활성화하지 않습니다.</small></label></div><div class="rf-once" *ngIf="rf.oneTimeCredential() as c"><b>한 번만 표시되는 RustFS 자격</b><div class="rf-mono">Access key: {{c.accessKey}}</div><div class="rf-mono">Secret key: {{c.secretKey}}</div></div></fieldset>
        <clr-alert *ngIf="validationError()" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{validationError()}}</span></clr-alert-item></clr-alert>
        <clr-alert *ngIf="rf.operationError()" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{rf.operationError()}}</span></clr-alert-item></clr-alert>
        <div class="os-actions"><button class="btn btn-primary" type="submit" [disabled]="!canApply()">{{rf.exists()?'운영 구성 적용':'RustFS 생성'}}</button><span class="os-dim">FoundationModel/data → control-plane SSA → StatefulSet/opensphere-rustfs</span></div>
        <div class="rf-progress" *ngIf="applyProgress()"><div [style.width.%]="applyProgress()"></div></div><div class="rf-log" *ngIf="applyLogs().length"><div *ngFor="let line of applyLogs()">{{line}}</div></div>
      </form>
    </section>

    <section *ngIf="tab()==='topology'" class="rf-work"><div class="pgp-section-head"><div><span class="vl-eyebrow">Runtime evidence</span><h2>Topology</h2></div><button class="btn btn-sm" (click)="refresh()"><os-cicon [icon]="iRenew" [size]="16"/> 새로고침</button></div><div class="rf-grid"><article class="rf-card" *ngFor="let pod of rf.rt().pods"><h3>{{pod.metadata?.name}}</h3><dl class="os-kv"><dt>Status</dt><dd>{{podReady(pod)?'Ready':pod.status?.phase}}</dd><dt>Node</dt><dd>{{pod.spec?.nodeName||'—'}}</dd><dt>Restarts</dt><dd>{{restarts(pod)}}</dd><dt>Pod IP</dt><dd>{{pod.status?.podIP||'—'}}</dd></dl></article></div><h3 class="os-sech">Services</h3><table class="rf-table"><thead><tr><th>Name</th><th>Cluster IP</th><th>Ports</th></tr></thead><tbody><tr *ngFor="let svc of rf.rt().services"><td class="rf-mono">{{svc.metadata?.name}}</td><td>{{svc.spec?.clusterIP}}</td><td>{{ports(svc)}}</td></tr></tbody></table></section>

    <section *ngIf="tab()==='config'" class="rf-work"><div class="pgp-section-head"><div><span class="vl-eyebrow">Effective configuration</span><h2>Configuration</h2></div></div><div class="rf-grid"><article class="rf-card"><h3>RustFS</h3><dl class="os-kv"><dt>Version</dt><dd>{{rf.summary()?.version||form().version}}</dd><dt>Endpoint</dt><dd class="rf-mono">opensphere-rustfs.opensphere-foundation.svc:9000</dd><dt>Console</dt><dd class="rf-mono">opensphere-rustfs.opensphere-foundation.svc:9001</dd></dl></article><article class="rf-card"><h3>Storage</h3><dl class="os-kv"><dt>Capacity</dt><dd>{{rf.capacity()}}</dd><dt>StorageClass</dt><dd>{{rf.storageClass()}}</dd><dt>PVC</dt><dd class="rf-mono">{{rf.rt().pvcs[0]?.metadata?.name||'—'}}</dd></dl></article><article class="rf-card"><h3>Image</h3><p><b>RustFS {{rf.summary()?.version||form().version}}</b> · OpenSphere verified mirror</p><details><summary>이미지 근거</summary><code class="rf-mono">{{rf.image()||'—'}}</code></details></article></div></section>

    <section *ngIf="tab()==='domain'" class="rf-work"><div class="pgp-section-head"><div><span class="vl-eyebrow">Allowlisted S3 administration</span><h2>Buckets & Policies</h2></div><span class="label label-info">No raw S3 requests</span></div><clr-alert *ngIf="rf.summaryState()==='error'" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{rf.summaryError()}}</span></clr-alert-item></clr-alert><div class="rf-bucket-form"><label><span>Bucket name</span><input [(ngModel)]="bucketName" placeholder="lowercase-dns-name"/></label><label><span>작업 사유</span><input [(ngModel)]="bucketReason" placeholder="8자 이상 생성·삭제 사유"/></label><button class="btn btn-sm btn-primary" (click)="mutateBucket('create')" [disabled]="bucketName.trim().length<3||bucketReason.trim().length<8"><os-cicon [icon]="iAdd" [size]="16"/> Bucket 생성</button></div><table class="rf-table"><thead><tr><th>Bucket</th><th>Created</th><th>Policy</th><th>Action</th></tr></thead><tbody><tr *ngFor="let bucket of rf.summary()?.buckets||[]"><td class="rf-mono">{{bucket.name}}</td><td>{{bucket.createdAt||'—'}}</td><td>Private · credential scoped</td><td><button class="btn btn-sm btn-danger-outline" (click)="deleteBucket(bucket)" [disabled]="bucketReason.trim().length<8"><os-cicon [icon]="iTrash" [size]="16"/> 빈 Bucket 삭제</button></td></tr></tbody></table><div class="rf-empty" *ngIf="!(rf.summary()?.buckets?.length)">관찰된 Bucket이 없습니다.</div><p class="rf-note">브라우저가 RustFS 자격이나 임의 S3 요청을 받지 않습니다. 서버가 exact Secret으로 SigV4 서명하고 ListBuckets, CreateBucket, DeleteBucket만 허용합니다.</p></section>

    <section *ngIf="tab()==='backups'" class="rf-work"><div class="pgp-section-head"><h2>Backups</h2></div><p class="rf-warning">PVC는 백업이 아닙니다. 현재 RustFS 데이터에 대한 버전관리·외부 replication·restore drill connector는 구성되지 않았습니다.</p><table class="rf-table"><thead><tr><th>Capability</th><th>Status</th><th>Required next evidence</th></tr></thead><tbody><tr><td>Persistent volume</td><td>Configured</td><td>{{rf.capacity()}} · {{rf.storageClass()}}</td></tr><tr><td>External object replication</td><td>Not configured</td><td>대상 endpoint, immutable retention, restore 검증</td></tr><tr><td>Volume snapshot</td><td>Not configured</td><td>CSI snapshot class와 복구 실증</td></tr></tbody></table></section>

    <section *ngIf="tab()==='events'" class="rf-work"><div class="pgp-section-head"><h2>Events</h2></div><table class="rf-table"><thead><tr><th>Type</th><th>Reason</th><th>Object</th><th>Message</th><th>Time</th></tr></thead><tbody><tr *ngFor="let e of rf.rt().events"><td><span class="label" [ngClass]="e.type==='Warning'?'label-danger':'label-info'">{{e.type}}</span></td><td>{{e.reason}}</td><td class="rf-mono">{{e.involvedObject?.kind}}/{{e.involvedObject?.name}}</td><td>{{e.message}}</td><td>{{e.lastTimestamp||e.eventTime}}</td></tr></tbody></table><div class="rf-empty" *ngIf="!rf.rt().events.length">RustFS 관련 이벤트가 없습니다.</div></section>
    <section *ngIf="tab()==='claims'" class="rf-work"><div class="pgp-section-head"><h2>Claims</h2></div><table class="rf-table"><thead><tr><th>Contract</th><th>Status</th><th>Description</th></tr></thead><tbody><tr *ngFor="let claim of SPEC.claims"><td>{{claim.name}}</td><td><span class="label label-warning">{{claim.status}}</span></td><td>{{claim.description}}</td></tr></tbody></table><p class="rf-note">Bucket의 수동 관리 기능은 제공하지만 앱별 access key/policy Secret을 자동 발급하는 BucketClaim은 아직 구현되지 않았습니다.</p></section>
    <section *ngIf="tab()==='upgrade'" class="rf-work"><div class="pgp-section-head"><div><span class="vl-eyebrow">Controlled lifecycle</span><h2>Upgrade</h2></div><span class="label label-warning">1.0.0-beta.10 candidate</span></div><p>사람이 보는 제품 버전은 RustFS 1.0.0-beta.10입니다. OCI digest는 공급망 검증 근거이며 버전 대신 표시하지 않습니다.</p><table class="rf-table"><thead><tr><th>Version</th><th>Channel</th><th>State</th><th>Rollout</th></tr></thead><tbody><tr><td>1.0.0-beta.10</td><td>candidate</td><td>{{rf.exists()?'Running':'Selected'}}</td><td>StatefulSet rolling update · 데이터 호환성 확인</td></tr></tbody></table></section>
    <section *ngIf="tab()==='documentation'" class="rf-work"><div class="pgp-section-head"><div><span class="vl-eyebrow">Console Manual Registry</span><h2>Documentation</h2></div></div><dl class="os-kv"><dt>문서 ID</dt><dd class="rf-mono">plugin:foundation/rustfs-operations-ko</dd><dt>화면 경로</dt><dd class="rf-mono">/pfss/rustfs</dd><dt>관리 API</dt><dd>ListBuckets · CreateBucket · DeleteBucket allowlist</dd></dl><a class="btn btn-sm btn-primary" [href]="manualUrl">한글 안내서</a><a class="btn btn-sm" [href]="SPEC.docs" target="_blank" rel="noreferrer">RustFS 공식 문서</a></section>
  `,
})
export class RustFSPluginComponent implements OnInit, OnDestroy {
  readonly rf = inject(RustFSAdminService);
  readonly reg = inject(FoundationRegistryService);
  readonly vr = inject(ViewRouter);
  readonly form = signal<RustFSForm>(structuredClone(DEFAULT_FORM));
  readonly storageClasses = signal<StorageClassRow[]>([]);
  readonly controlPlaneReady = signal(false);
  readonly applying = signal(false);
  readonly applyProgress = signal(0);
  readonly applyLogs = signal<string[]>([]);
  readonly SPEC = SPEC;
  readonly iBack = ArrowLeft16; readonly iRenew = Renew16; readonly iPassword = Password16; readonly iAdd = Add16; readonly iTrash = TrashCan16;
  readonly manualUrl = `/manual?doc=${encodeURIComponent('plugin:foundation/rustfs-operations-ko')}`;
  secretReason = ''; bucketName = ''; bucketReason = '';
  private watch?: ReturnType<typeof setInterval>;
  readonly tabs: PluginPageTab[] = [
    {id:'overview',label:'Overview'},{id:'monitoring',label:'Monitoring'},{id:'operator',label:'Runtime'},{id:'cluster',label:'Cluster plan'},
    {id:'topology',label:'Topology'},{id:'config',label:'Configuration'},{id:'domain',label:'Buckets & Policies'},
    {id:'backups',label:'Backups'},{id:'events',label:'Events'},{id:'claims',label:'Claims'},{id:'upgrade',label:'Upgrade'},{id:'documentation',label:'Documentation'},
  ];
  readonly tab = computed<Tab>(() => this.tabs.some((item) => item.id === this.vr.tab()) ? this.vr.tab() as Tab : 'overview');
  readonly validationError = computed(() => {
    const f = this.form();
    if (f.replicas !== 1) return '현재 RustFS 관리 계약은 단일 인스턴스만 지원합니다.';
    if (!/^\d+(Gi|Ti)$/.test(f.storageSize)) return '용량은 50Gi 또는 1Ti 형식이어야 합니다.';
    if (f.authSecret !== 'rustfs-credentials') return 'Authentication Secret은 rustfs-credentials여야 합니다.';
    if (!f.storageClass) return 'StorageClass를 선택해야 합니다.';
    return '';
  });
  readonly canApply = computed(() => this.controlPlaneReady() && !!this.rf.credentialState()?.validKeys && !this.applying() && !this.validationError());

  ngOnInit(): void { this.rf.start(); void this.initialize(); }
  ngOnDestroy(): void { this.rf.stop(); if (this.watch) clearInterval(this.watch); }
  private async initialize(): Promise<void> { await Promise.allSettled([this.reg.refreshModels(), this.loadStorageClasses(), this.loadControlPlane()]); this.hydrate(); await this.rf.refresh(); }
  back(): void { this.vr.setModule('modules'); }
  openTab(id: string): void { this.vr.setTab(id); }
  patch(value: Partial<RustFSForm>): void { this.form.update((form) => ({ ...form, ...value, replicas: 1, authSecret: 'rustfs-credentials', monitoring: false })); }
  headerModel(): PluginPageHeaderModel { const exists=this.rf.exists(); return { name:'RustFS', logo:SPEC.logo, capability:SPEC.capability, description:exists?'S3 호환 오브젝트 스토리지의 버킷·자격과 운영 증거를 관리합니다.':'Namespace를 선택하거나 RustFS 서비스를 생성하세요.', lifecycle:!exists?'Bootstrap 대기':this.rf.ready()?'Ready':'Progressing', lifecycleClass:this.rf.ready()?'label-success':'label-warning', versionLabel:'RustFS', version:exists?(this.rf.summary()?.version||this.form().version):'—', profile:exists?this.form().profile:'미선택', namespace:SPEC.namespace }; }
  tabsForUi(): PluginPageTab[] { return this.tabs.map((item) => ({ ...item, disabled:['monitoring','topology','config','domain','backups','events'].includes(item.id)&&!this.rf.exists(), badge:item.id==='events'?(this.rf.rt().events.filter((e:any)=>e.type==='Warning').length||''):'' })); }
  setProfile(profile: Profile): void { if (profile === 'development') this.form.set({ ...structuredClone(DEFAULT_FORM), storageClass:this.form().storageClass }); else this.patch({ profile }); }
  setResource(profile: string): void { const map: Record<string, Partial<RustFSForm>> = { small:{resourceProfile:'small',cpuRequest:'250m',memoryRequest:'512Mi',cpuLimit:'1',memoryLimit:'1Gi'}, medium:{resourceProfile:'medium',cpuRequest:'500m',memoryRequest:'1Gi',cpuLimit:'2',memoryLimit:'2Gi'}, large:{resourceProfile:'large',cpuRequest:'1',memoryRequest:'2Gi',cpuLimit:'4',memoryLimit:'4Gi'} }; this.patch({ ...map[profile], profile:'custom' }); }
  storageHint(): string { const row = this.storageClasses().find((item) => item.name === this.form().storageClass); return row ? `${row.provisioner} · ${row.allowExpansion?'확장 지원':'확장 미지원'} · reclaim ${row.reclaimPolicy}` : 'StorageClass 확인 중'; }
  async refresh(): Promise<void> { await Promise.allSettled([this.rf.refresh(), this.reg.refreshModels(), this.loadControlPlane()]); }
  async createCredential(): Promise<void> { try { await this.rf.createCredential(this.secretReason); } catch { /* exact error rendered */ } }
  async mutateBucket(action: 'create' | 'delete'): Promise<void> { try { await this.rf.mutateBucket(action, this.bucketName.trim(), this.bucketReason); if (action === 'create') this.bucketName = ''; } catch { /* exact error rendered */ } }
  async deleteBucket(bucket: RustFSBucket): Promise<void> { this.bucketName = bucket.name; await this.mutateBucket('delete'); }
  async apply(): Promise<void> { if (!this.canApply()) return; this.applying.set(true); this.applyProgress.set(10); this.applyLogs.set([]); this.log('FoundationModel/data RustFS 선언을 제출합니다.'); const { profile:_profile, ...parameters } = this.form(); const ok = await this.reg.configureDataEngine('rustfs', parameters); if (!ok) { this.log(`실패: ${this.reg.lastError()}`); this.applyProgress.set(100); this.applying.set(false); return; } this.applyProgress.set(30); this.log('선언 승인 · control-plane reconcile 대기'); this.watchReady(); }
  private watchReady(): void { if (this.watch) clearInterval(this.watch); let count = 0; this.watch = setInterval(async () => { count++; await this.rf.refresh(); if (this.rf.exists()) { this.applyProgress.set(Math.max(55, this.applyProgress())); this.logOnce('resource', 'StatefulSet/opensphere-rustfs 생성 확인'); } if (this.rf.rt().pods.length) { this.applyProgress.set(Math.max(75, this.applyProgress())); this.logOnce('pods', `Pod ${this.rf.rt().pods.length}개 관찰`); } if (this.rf.ready() && this.rf.summaryState() === 'ok') { this.applyProgress.set(100); this.logOnce('ready', 'RustFS workload와 S3 관리 API가 Ready입니다.'); this.applying.set(false); if (this.watch) clearInterval(this.watch); this.watch = undefined; } else if (count >= 100) { this.applyProgress.set(100); this.log(`5분 내 Ready 미도달: ${this.rf.summaryError() || 'Events 탭을 확인하세요.'}`); this.applying.set(false); if (this.watch) clearInterval(this.watch); this.watch = undefined; } }, 3000); }
  private log(message: string): void { this.applyLogs.update((rows) => [...rows, `[${new Date().toLocaleTimeString()}] ${message}`]); }
  private logOnce(key: string, message: string): void { if (!this.applyLogs().some((row) => row.includes(`[${key}]`))) this.log(`[${key}] ${message}`); }
  podReady(pod: any): boolean { return (pod.status?.conditions ?? []).some((condition: any) => condition.type === 'Ready' && condition.status === 'True'); }
  restarts(pod: any): number { return (pod.status?.containerStatuses ?? []).reduce((sum: number, item: any) => sum + Number(item.restartCount ?? 0), 0); }
  ports(service: any): string { return (service.spec?.ports ?? []).map((port: any) => `${port.name}:${port.port}`).join(' · '); }
  private async loadControlPlane(): Promise<void> { try { const response = await hostFetch(`${apiBase()}/api/k8s/apis/apps/v1/namespaces/opensphere-system/deployments/foundation-control-plane`, { cache:'no-store' }); if (!response.ok) { this.controlPlaneReady.set(false); return; } const body = await response.json(); this.controlPlaneReady.set(Number(body.status?.readyReplicas ?? 0) > 0); } catch { this.controlPlaneReady.set(false); } }
  private async loadStorageClasses(): Promise<void> { try { const response = await hostFetch(`${apiBase()}/api/k8s/apis/storage.k8s.io/v1/storageclasses`, { cache:'no-store' }); if (!response.ok) return; const rows: StorageClassRow[] = ((await response.json()).items ?? []).map((item:any) => ({ name:String(item.metadata?.name??''), provisioner:String(item.provisioner??''), isDefault:item.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class']==='true', allowExpansion:item.allowVolumeExpansion===true, reclaimPolicy:String(item.reclaimPolicy??'Delete') })).filter((item:StorageClassRow) => !!item.name).sort((a:StorageClassRow,b:StorageClassRow) => Number(b.name==='ceph-rbd')-Number(a.name==='ceph-rbd') || Number(b.isDefault)-Number(a.isDefault) || a.name.localeCompare(b.name)); this.storageClasses.set(rows); if (!rows.some((item) => item.name === this.form().storageClass)) { const selected = rows.find((item) => item.name === 'ceph-rbd') || rows.find((item) => item.isDefault) || rows[0]; if (selected) this.patch({ storageClass:selected.name }); } } catch { /* rendered by missing options */ } }
  private hydrate(): void { const parameters = this.reg.parametersOf('rustfs') as any; const current = parameters?.dataEngines?.rustfs; if (current) this.form.update((form) => ({ ...form, ...current, profile:current.profile === 'custom' ? 'custom' : 'development', replicas:1, authSecret:'rustfs-credentials', monitoring:false, backup:{ ...form.backup, ...(current.backup ?? {}) } })); }
}
