import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';
import Renew16 from '@carbon/icons/es/renew/16';
import { CarbonIcon } from '../../carbon-icon';
import { FoundationRegistryService, SyncopeInstallParameters } from '../../registry/foundation-registry.service';
import { CarbonLineChart, CarbonLineSeries } from '../../shared/carbon-line-chart';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent, pfsPluginTabs } from '../../shared/plugin-page-shell.component';
import { ViewRouter } from '../../view-router';
import { SyncopeMetricsService, SyncopeService } from './syncope.service';

const DEFAULT_FORM: SyncopeInstallParameters = {
  version: '4.0.7', profile: 'production', replicas: 2,
  cpuRequest: '250m', memoryRequest: '768Mi', cpuLimit: '1', memoryLimit: '2Gi',
  monitoring: true, databaseMode: 'stackgres-dedicated', tls: true,
};

@Component({
  selector: 'app-syncope',
  standalone: true,
  imports: [CommonModule, FormsModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent, PluginTabsComponent, CarbonLineChart],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0"><os-cicon [icon]="iBack" [size]="16" /> PFSS 모듈</a>
    <section class="sy-frame"><osp-plugin-page-header [model]="headerModel()" headingId="syncope-plugin-title" (managementSelected)="openTab($event)" /><osp-plugin-tabs [tabs]="tabsForUi()" [active]="tab()" ariaLabel="Apache Syncope plugin 메뉴" (selected)="openTab($event)" /></section>

    <ng-container *ngIf="tab()==='overview'">
      <section class="sy-steps">
        <button class="sy-step done" (click)="openTab('operator')"><b>1</b><span>Control Plane<small>선언형 IGA bundle</small></span></button>
        <button class="sy-step" [class.done]="exists()" (click)="openTab('cluster')"><b>2</b><span>Core + DB<small>2 replicas · dedicated StackGres</small></span></button>
        <button class="sy-step" [class.done]="svc.productionReady()" (click)="openTab('config')"><b>3</b><span>Production gates<small>TLS · audit · monitoring</small></span></button>
      </section>
      <div class="sy-grid">
        <article><h2>IGA authority</h2><p>Workforce identity의 프로비저닝 단일 권위입니다.</p><dl><dt>Role</dt><dd>IGA source of truth</dd><dt>SCIM</dt><dd class="mono">/syncope/rest/scim/v2</dd><dt>Direct admin</dt><dd class="ok">Disabled after bootstrap</dd><dt>Downstream</dt><dd>Keycloak · Samba-AD</dd></dl></article>
        <article><h2>Runtime</h2><p>실제 StatefulSet과 전용 StackGres DB 상태입니다.</p><dl><dt>Core</dt><dd [class.ok]="svc.ready()">{{svc.readyN()}} / {{svc.totalN()}} Ready</dd><dt>Database</dt><dd>{{svc.database()}}</dd><dt>API</dt><dd class="mono">TLS :8443</dd><dt>Version</dt><dd>4.0.7 security-fixed</dd></dl></article>
        <article><h2>Production gates</h2><p>일반 data module 외 IGA 고유 판정입니다.</p><dl><dt>HA cache propagation</dt><dd class="ok">OpenJPA TCP</dd><dt>Credential defaults</dt><dd class="ok">Rejected</dd><dt>Durable audit</dt><dd class="ok">AuditEvent / PG</dd><dt>Network boundary</dt><dd class="ok">Namespace allowlist</dd></dl></article>
      </div>
      <clr-alert [clrAlertType]="svc.productionReady()?'success':'warning'" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{svc.productionReady()?'2개 Core, 전용 StackGres PostgreSQL, TLS, HA cache propagation, durable audit와 Prometheus target이 운영 프로필로 선언되었습니다.':'Syncope Production Ready gate를 준비하고 있습니다. 설치 탭의 사전조건과 Events를 확인하세요.'}}</span></clr-alert-item></clr-alert>
    </ng-container>

    <section class="sy-work" *ngIf="tab()==='operator'">
      <h2>Foundation Control Plane</h2><p>FoundationModel/identity의 <span class="mono">engines.syncope</span> 선언을 PostgresClaim, StatefulSet, Certificate, ServiceMonitor와 NetworkPolicy로 적용합니다.</p>
      <dl><dt>Desired-state owner</dt><dd class="mono">FoundationModel/identity</dd><dt>Workload</dt><dd class="mono">StatefulSet/foundation-identity-syncope</dd><dt>Image</dt><dd class="mono">ghcr.io/opensphere-platform/mirror/syncope:4.0.7</dd><dt>Credential installer</dt><dd class="mono">scripts/Initialize-SyncopeSecrets.ps1</dd></dl>
    </section>

    <section class="sy-work" *ngIf="tab()==='cluster'">
      <div class="sy-head"><div><span class="vl-eyebrow">Production installation</span><h2>Apache Syncope Core</h2></div><span class="label label-info">explicit opt-in</span></div>
      <clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">전용 PostgresClaim이 StackGres SGCluster와 binding Secret을 자동 생성합니다. Secret 값은 브라우저 폼이나 FoundationModel에 저장하지 않습니다.</span></clr-alert-item></clr-alert>
      <form class="sy-form" (ngSubmit)="apply()">
        <label>Version<input name="version" [ngModel]="form().version" disabled /></label>
        <label>Profile<input name="profile" [ngModel]="form().profile" disabled /></label>
        <label>Core replicas<input name="replicas" type="number" min="2" max="5" [ngModel]="form().replicas" (ngModelChange)="patch({replicas:+$event})" /></label>
        <label>Database<input name="database" value="StackGres dedicated / syncope" disabled /></label>
        <label>CPU request<input name="cpuRequest" [ngModel]="form().cpuRequest" (ngModelChange)="patch({cpuRequest:$event})" /></label>
        <label>Memory request<input name="memoryRequest" [ngModel]="form().memoryRequest" (ngModelChange)="patch({memoryRequest:$event})" /></label>
        <label>CPU limit<input name="cpuLimit" [ngModel]="form().cpuLimit" (ngModelChange)="patch({cpuLimit:$event})" /></label>
        <label>Memory limit<input name="memoryLimit" [ngModel]="form().memoryLimit" (ngModelChange)="patch({memoryLimit:$event})" /></label>
        <label class="check"><input name="monitoring" type="checkbox" [ngModel]="form().monitoring" (ngModelChange)="patch({monitoring:$event})" /> Prometheus Monitoring</label>
        <div class="sy-actions"><span>최소 2 replicas와 TLS는 운영 프로필에서 강제됩니다.</span><button class="btn btn-primary" type="submit" [disabled]="applying()">{{exists()?'운영 구성 적용':'Syncope 설치'}}</button></div>
      </form>
      <div *ngIf="applying()" class="sy-progress"><div [style.width.%]="progress()"></div></div><pre *ngIf="logs().length" class="sy-log">{{logs().join('\n')}}</pre>
    </section>

    <section class="sy-work" *ngIf="tab()==='monitoring'">
      <div class="sy-head"><div><span class="vl-eyebrow">Operations · Prometheus</span><h2>Syncope Monitoring</h2><p>실제 Core health와 durable PostgreSQL IGA 지표의 최근 1시간입니다.</p></div><button class="btn btn-sm" (click)="metrics.refresh()" [disabled]="metrics.busy()"><os-cicon [icon]="iRenew" [size]="16" /> 새로고침</button></div>
      <div class="sy-target"><span class="dot" [class.up]="metrics.target()==='up'" [class.down]="metrics.target()==='down'"></span><div><b>Prometheus target</b><small>{{metrics.targetDetail()}}</small></div><span class="label" [ngClass]="metrics.target()==='up'?'label-success':metrics.target()==='down'?'label-danger':'label-warning'">{{metrics.target()}}</span></div>
      <clr-alert *ngIf="metrics.state()!=='ok'" [clrAlertType]="metrics.state()==='error'?'danger':'info'" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{metrics.hint()}}</span></clr-alert-item></clr-alert>
      <div class="sy-kpis"><article><span>Availability</span><strong>{{number(metrics.latestAvailability(),1)}}%</strong><small>Core probes</small></article><article><span>Probe p95</span><strong>{{number(metrics.latestP95(),1)}} ms</strong><small>Actuator health</small></article><article><span>Users / Groups</span><strong>{{number(metrics.latestUsers(),0)}} / {{number(metrics.latestGroups(),0)}}</strong><small>durable DB</small></article><article><span>Resources</span><strong>{{number(metrics.latestResources(),0)}}</strong><small>connectors</small></article><article><span>Audit events</span><strong>{{number(metrics.latestAuditEvents(),0)}}</strong><small>durable rows</small></article></div>
      <div class="sy-charts" *ngIf="metrics.state()==='ok'"><article><h3>Core availability</h3><p>replica health probe 성공률</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="availabilitySeries()" valueAxisTitle="Percent" ariaLabel="Syncope 가용성" /></article><article><h3>Core latency</h3><p>Actuator probe p95</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="latencySeries()" valueAxisTitle="Milliseconds" ariaLabel="Syncope 지연" /></article><article><h3>Runtime resources</h3><p>Core 컨테이너 CPU와 memory</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="runtimeSeries()" valueAxisTitle="Cores / MiB" ariaLabel="Syncope runtime 자원" /></article><article><h3>IGA inventory</h3><p>PostgreSQL의 사용자·그룹·리소스</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="inventorySeries()" valueAxisTitle="Count" ariaLabel="Syncope IGA inventory" /></article><article><h3>Durable audit</h3><p>AuditEvent 누적 행 수</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="auditSeries()" valueAxisTitle="Events" ariaLabel="Syncope 감사 이벤트" /></article></div>
      <p class="dim">{{metrics.hint()}} · 마지막 확인 {{metrics.lastSync() || '—'}}</p>
    </section>

    <section class="sy-work" *ngIf="tab()==='topology'"><h2>Topology</h2><dl><dt>StatefulSet</dt><dd>{{svc.readyN()}} / {{svc.totalN()}} Ready</dd><dt>Service</dt><dd class="mono">foundation-identity-syncope:8443</dd><dt>Database</dt><dd>{{svc.database()}}</dd><dt>Image</dt><dd class="mono">{{svc.image() || '—'}}</dd><dt>Restarts</dt><dd>{{svc.restarts()}}</dd></dl></section>
    <section class="sy-work" *ngIf="tab()==='config'"><h2>Security & configuration</h2><div class="sy-gates"><article><b>Default credentials</b><p>Apache 기본 admin, anonymous, JWS 값을 허용하지 않습니다.</p></article><article><b>Encrypted transport</b><p>Core API와 PostgreSQL 연결은 TLS입니다.</p></article><article><b>HA coherence</b><p>두 Core가 OpenJPA TCP remote commit으로 캐시 무효화를 전파합니다.</p></article><article><b>Authority boundary</b><p>사용자 쓰기는 Syncope 중심 워크플로를 통하며 Keycloak/Samba는 downstream입니다.</p></article></div></section>
    <section class="sy-work" *ngIf="tab()==='domain'"><h2>Users & Groups</h2><p>현재 inventory는 Syncope PostgreSQL에서 읽은 실측 집계입니다. 사용자·그룹 변경은 임의 Core REST 호출이 아니라 승인된 IdentityProvisioningClaim과 IGA workflow로 처리합니다.</p><dl><dt>Users</dt><dd>{{number(metrics.latestUsers(),0)}}</dd><dt>Groups</dt><dd>{{number(metrics.latestGroups(),0)}}</dd><dt>External resources</dt><dd>{{number(metrics.latestResources(),0)}}</dd></dl></section>
    <section class="sy-work" *ngIf="tab()==='backups'"><h2>Backup & restore</h2><p>Syncope 상태는 전용 StackGres <b>syncope</b> database의 backup/PITR plan으로 보호합니다. 설정 Secret과 Connector 설정도 별도 복구 증거에 포함해야 합니다.</p></section>
    <section class="sy-work" *ngIf="tab()==='events'"><h2>Events</h2><table class="table"><thead><tr><th>Type</th><th>Reason</th><th>Message</th><th>Time</th></tr></thead><tbody><tr *ngFor="let event of svc.events()"><td>{{event.type}}</td><td>{{event.reason}}</td><td>{{event.message}}</td><td>{{event.lastTimestamp || event.eventTime}}</td></tr><tr *ngIf="!svc.events().length"><td colspan="4">관련 이벤트 없음</td></tr></tbody></table></section>
    <section class="sy-work" *ngIf="tab()==='claims'"><h2>Claims</h2><p>소비자는 IdentityProvisioningClaim으로 SCIM scope와 destination을 요청합니다. Core 관리자 endpoint나 DB credential은 Binding으로 배포하지 않습니다.</p></section>
    <section class="sy-work" *ngIf="tab()==='upgrade'"><h2>Upgrade & rollback</h2><p>4.0.7 미만은 2026 보안 취약점 때문에 운영 허용 목록에서 제외합니다. upgrade는 DB backup, schema compatibility, 두 Core 순차 rollout과 audit 연속성을 함께 검증합니다.</p></section>
    <section class="sy-work" *ngIf="tab()==='documentation'"><h2>Documentation</h2><a href="https://syncope.apache.org/docs/4.0/reference-guide.html" target="_blank" rel="noreferrer">Apache Syncope 4.0 Reference Guide</a><br/><a href="https://syncope.apache.org/security" target="_blank" rel="noreferrer">Apache Syncope Security</a></section>
  `,
  styles: [`
    :host{display:block;min-width:0}.sy-frame,.sy-work,.sy-grid article{background:#fff;border:1px solid #d0d0d0}.sy-work{display:grid;gap:16px;padding:18px}.sy-work h2,.sy-grid h2{margin:0}.sy-work>p,.sy-grid p,.dim{color:#525252}.sy-steps{display:grid;grid-template-columns:repeat(3,1fr);margin:16px 0}.sy-step{border:1px solid #d0d0d0;background:#fff;padding:12px;display:flex;gap:10px;text-align:left}.sy-step>b{background:#e0e0e0;width:26px;height:26px;display:grid;place-items:center;border-radius:50%}.sy-step.done>b{background:#198038;color:white}.sy-step span{display:grid}.sy-step small{color:#6f6f6f}.sy-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.sy-grid article{padding:16px}.sy-grid h2{font-size:1rem}.sy-grid p{min-height:38px}.sy-work dl,.sy-grid dl{display:grid;grid-template-columns:minmax(9rem,.7fr) minmax(0,1.6fr);gap:8px 14px}.sy-work dt,.sy-grid dt{color:#6f6f6f}.sy-work dd,.sy-grid dd{margin:0;overflow-wrap:anywhere}.mono{font-family:var(--cds-code-01-font-family,monospace)}.ok{color:#198038}.sy-head,.sy-actions,.sy-target{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.sy-head h2{margin:3px 0}.sy-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.sy-form label{display:grid;gap:6px}.sy-form .check{display:flex;align-items:center}.sy-actions{grid-column:1/-1;align-items:center}.sy-progress{height:6px;background:#e0e0e0}.sy-progress div{height:100%;background:#0f62fe}.sy-log{background:#161616;color:#f4f4f4;padding:12px;max-height:180px;overflow:auto}.sy-target{align-items:center;border:1px solid #d0d0d0;padding:12px}.sy-target div{display:grid;flex:1}.dot{width:10px;height:10px;border-radius:50%;background:#f1c21b}.dot.up{background:#24a148}.dot.down{background:#da1e28}.sy-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.sy-kpis article,.sy-charts article,.sy-gates article{border:1px solid #d0d0d0;padding:14px;min-width:0}.sy-kpis span,.sy-kpis small{display:block;color:#6f6f6f}.sy-kpis strong{display:block;font-size:1.25rem;margin:6px 0}.sy-charts,.sy-gates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sy-charts h3{margin:0;font-size:1rem}.sy-charts p,.sy-gates p{color:#6f6f6f;margin:3px 0 8px}@media(max-width:950px){.sy-grid,.sy-kpis{grid-template-columns:1fr 1fr}}@media(max-width:650px){.sy-steps,.sy-grid,.sy-form,.sy-kpis,.sy-charts,.sy-gates{grid-template-columns:1fr}.sy-actions{grid-column:auto}}
  `],
})
export class SyncopeComponent implements OnInit, OnDestroy {
  readonly svc = inject(SyncopeService); readonly metrics = inject(SyncopeMetricsService);
  private readonly registry = inject(FoundationRegistryService); private readonly router = inject(ViewRouter);
  readonly iBack = ArrowLeft16; readonly iRenew = Renew16;
  readonly form = signal<SyncopeInstallParameters>({ ...DEFAULT_FORM }); readonly applying = signal(false); readonly progress = signal(0); readonly logs = signal<string[]>([]);
  readonly tab = computed(() => this.router.tab()); readonly exists = computed(() => this.svc.state() === 'ok');
  readonly headerModel = computed<PluginPageHeaderModel>(() => ({ name: 'Apache Syncope', logo: 'https://logos.opl.io.kr/i/apache-2', monogram: 'SY', capability: 'identity.iga.syncope', description: this.exists() ? 'Workforce IGA 단일 권위, SCIM provisioning, connector와 durable audit를 운영합니다.' : 'Namespace를 선택하거나 Apache Syncope 서비스를 생성하세요.', lifecycle: !this.exists() ? 'Bootstrap 대기' : this.svc.productionReady() ? 'Production Ready' : this.svc.ready() ? 'Production gates pending' : 'Progressing', lifecycleClass: this.svc.productionReady() ? 'label-success' : 'label-warning', version: this.exists() ? '4.0.7' : '—', profile: this.exists() ? 'production · HA' : '미선택', namespace: 'opensphere-foundation' }));
  private readonly tabs: PluginPageTab[] = pfsPluginTabs('Users & Groups');
  ngOnInit(): void { this.svc.start(); this.metrics.start(); const cfg = (this.registry.parametersOf('syncope') as any)?.identityEngines?.syncope; if (cfg) this.form.update(value => ({ ...value, ...cfg })); }
  ngOnDestroy(): void { this.svc.stop(); this.metrics.stop(); }
  back(): void { this.router.setModule('modules'); this.router.setTab('overview'); }
  openTab(id: string): void { this.router.setTab(id); }
  tabsForUi(): PluginPageTab[] { return this.tabs.map(item => ({ ...item, disabled: item.id === 'monitoring' && !this.exists(), badge: item.id === 'events' ? this.svc.events().filter(event => event.type === 'Warning').length : undefined })); }
  patch(next: Partial<SyncopeInstallParameters>): void { this.form.update(value => ({ ...value, ...next })); }
  async apply(): Promise<void> {
    if (this.applying()) return; this.applying.set(true); this.progress.set(10); this.logs.set(['FoundationModel/identity Syncope production 선언 제출']);
    const ok = await this.registry.configureIdentityEngine('syncope', this.form());
    if (!ok) { this.logs.update(value => [...value, `실패: ${this.registry.lastError()}`]); this.progress.set(100); this.applying.set(false); return; }
    this.progress.set(35); this.logs.update(value => [...value, '선언 승인 · StackGres PostgresClaim, binding Secret, TLS certificate와 Core reconcile 관찰']);
    for (let index = 0; index < 90; index++) { await new Promise(resolve => setTimeout(resolve, 5000)); await this.svc.refresh(); if (this.exists()) this.progress.set(Math.max(65, this.progress())); if (this.svc.productionReady()) { this.progress.set(100); this.logs.update(value => [...value, 'Apache Syncope Production Ready']); this.applying.set(false); return; } }
    this.progress.set(100); this.logs.update(value => [...value, '7분 30초 내 Production Ready 미도달 · Events와 prerequisite를 확인하세요']); this.applying.set(false);
  }
  number(value: number, digits: number): string { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
  availabilitySeries(): CarbonLineSeries[] { return [{ label: 'availability %', data: this.metrics.series().availability, color: '#198038' }]; }
  latencySeries(): CarbonLineSeries[] { return [{ label: 'p95 ms', data: this.metrics.series().p95Milliseconds, color: '#8a3ffc' }]; }
  runtimeSeries(): CarbonLineSeries[] { const series = this.metrics.series(); return [{ label: 'CPU cores', data: series.cpuCores, color: '#0f62fe' }, { label: 'memory MiB', data: series.memoryMiB, color: '#fa4d56' }]; }
  inventorySeries(): CarbonLineSeries[] { const series = this.metrics.series(); return [{ label: 'users', data: series.users, color: '#0f62fe' }, { label: 'groups', data: series.groups, color: '#8a3ffc' }, { label: 'resources', data: series.resources, color: '#009d9a' }]; }
  auditSeries(): CarbonLineSeries[] { return [{ label: 'audit events', data: this.metrics.series().auditEvents, color: '#a56eff' }]; }
}
