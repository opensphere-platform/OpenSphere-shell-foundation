import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import { CarbonIcon } from '../../carbon-icon';
import { FoundationRegistryService, OpaInstallParameters } from '../../registry/foundation-registry.service';
import { CarbonLineChart, CarbonLineSeries } from '../../shared/carbon-line-chart';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent, pfsPluginTabs } from '../../shared/plugin-page-shell.component';
import { ViewRouter } from '../../view-router';
import { OpaMetricsService, OpaService } from './opa.service';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';
import Renew16 from '@carbon/icons/es/renew/16';

const MANUAL_ID = 'opa-operations-ko';
const DEFAULT_FORM: OpaInstallParameters = {
  version: '1.18.2-static', profile: 'production', replicas: 2,
  cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '512Mi',
  monitoring: true, policyMode: 'signed-bundle-fail-closed', ingressMode: 'cluster-internal-mtls',
};

@Component({
  selector: 'app-opa',
  standalone: true,
  imports: [CommonModule, FormsModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent, PluginTabsComponent, CarbonLineChart],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0"><os-cicon [icon]="iBack" [size]="16" /> PFS 모듈</a>
    <section class="pgp-page-frame" aria-label="OPA plugin 개요와 메뉴">
      <osp-plugin-page-header [model]="headerModel()" headingId="opa-plugin-title" />
      <osp-plugin-tabs [tabs]="tabsForUi()" [active]="tab()" ariaLabel="OPA plugin 메뉴" (selected)="openTab($event)" />
    </section>

    <ng-container *ngIf="tab()==='overview'">
      <section class="pgp-steps" aria-label="OPA 설치 단계">
        <button class="pgp-step done" (click)="openTab('operator')"><span class="pgp-step-n">1</span><span><b>Control Plane</b><small>선언형 OPA bundle</small></span></button>
        <button class="pgp-step" [class.done]="exists()" [class.current]="!exists()" (click)="openTab('cluster')"><span class="pgp-step-n">2</span><span><b>OPA 생성</b><small>fail-closed bootstrap</small></span></button>
        <button class="pgp-step" [class.done]="productionReady()" [class.current]="svc.ready()&&!productionReady()" (click)="openTab('config')"><span class="pgp-step-n">3</span><span><b>운영 승격</b><small>signed bundle · decision log</small></span></button>
      </section>
      <div class="pgp-dashboard">
        <article class="opa-panel"><h2>Package readiness</h2><p>실제 Deployment와 정책 보호 상태를 분리합니다.</p><dl class="opa-kv"><dt>FoundationModel/identity</dt><dd>{{svc.modelPhase()}}</dd><dt>OPA Deployment</dt><dd [class.ok]="svc.ready()">{{svc.phase()}}</dd><dt>Replicas</dt><dd>{{svc.readyN()}} / {{svc.totalN()}}</dd><dt>Policy mode</dt><dd class="warn">{{svc.policyMode()}}</dd></dl></article>
        <article class="opa-panel"><h2>Decision point</h2><p>소비자에게 노출되는 제한된 평가 endpoint입니다.</p><dl class="opa-kv"><dt>Endpoint</dt><dd class="os-mono">{{svc.endpoint}}</dd><dt>Allowed API</dt><dd class="os-mono">POST /v1/data/opensphere/**</dd><dt>Mutation API</dt><dd class="ok">Denied</dd><dt>Default decision</dt><dd class="ok">Deny</dd></dl></article>
        <article class="opa-panel"><h2>Production gates</h2><p>데이터 모듈과 다른 정책 엔진의 필수 판정입니다.</p><dl class="opa-kv"><dt>Signed bundle</dt><dd class="ok">ES256 verified</dd><dt>Durable decision log</dt><dd class="ok">CloudNativePG · 30d</dd><dt>Evaluation transport</dt><dd class="ok">mTLS</dd><dt>Raw decision input</dt><dd class="ok">Erased</dd></dl></article>
      </div>
		<clr-alert [clrAlertType]="productionReady()?'success':'warning'" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{productionReady()?'서명 bundle, mTLS 평가 경로, 이중화 decision-log sink와 30일 영속 보존이 모두 준비되었습니다.':'OPA production gate를 조정하고 있습니다.'}}</span></clr-alert-item></clr-alert>
    </ng-container>

    <section class="opa-work" *ngIf="tab()==='operator'">
      <h2>Foundation Control Plane</h2><p>별도 Operator 없이 FoundationModel/identity 선언을 Deployment, Service, ServiceMonitor, NetworkPolicy로 SSA 적용합니다.</p>
      <dl class="opa-kv"><dt>Desired-state owner</dt><dd class="os-mono">FoundationModel/identity</dd><dt>Workload</dt><dd class="os-mono">Deployment/foundation-identity-opa</dd><dt>Metrics</dt><dd class="os-mono">diagnostic :8282/metrics</dd><dt>Image</dt><dd class="os-mono">ghcr.io/opensphere-platform/mirror/opa:1.18.2-static</dd></dl>
    </section>

    <section class="opa-work" *ngIf="tab()==='cluster'">
      <div class="opa-head"><div><span class="vl-eyebrow">Install plan</span><h2>OPA policy decision point</h2></div><span class="label label-info">explicit opt-in</span></div>
      <form class="opa-form" (ngSubmit)="apply()">
        <label>Version<input name="version" [ngModel]="form().version" disabled /></label>
		<label>Replicas<input name="replicas" type="number" min="2" max="5" [ngModel]="form().replicas" (ngModelChange)="patch({replicas:+$event})" /></label>
        <label>CPU request<input name="cpuRequest" [ngModel]="form().cpuRequest" (ngModelChange)="patch({cpuRequest:$event})" /></label>
        <label>Memory request<input name="memoryRequest" [ngModel]="form().memoryRequest" (ngModelChange)="patch({memoryRequest:$event})" /></label>
        <label><input name="monitoring" type="checkbox" [ngModel]="form().monitoring" (ngModelChange)="patch({monitoring:$event})" /> Prometheus Monitoring</label>
        <div class="opa-actions"><span class="os-dim">설치 시 기본 정책은 deny이며 runtime policy mutation은 차단됩니다.</span><button class="btn btn-primary" type="submit" [disabled]="applying()">{{exists()?'운영 구성 적용':'OPA 설치'}}</button></div>
      </form>
      <div *ngIf="applying()" class="opa-progress"><div [style.width.%]="progress()"></div></div>
      <pre *ngIf="logs().length" class="opa-log">{{logs().join('\n')}}</pre>
    </section>

    <section class="opa-work" *ngIf="tab()==='monitoring'">
      <div class="opa-head"><div><span class="vl-eyebrow">Operations · Prometheus</span><h2>OPA Monitoring</h2><p>OPA native Prometheus endpoint의 최근 1시간 시계열입니다.</p></div><button class="btn btn-sm" type="button" (click)="metrics.refresh()" [disabled]="metrics.busy()"><os-cicon [icon]="iRenew" [size]="16" /> 새로고침</button></div>
      <div class="opa-target"><span class="opa-dot" [class.up]="metrics.target()==='up'" [class.down]="metrics.target()==='down'"></span><div><b>Prometheus target</b><span>{{metrics.targetDetail()}}</span></div><span class="label" [ngClass]="metrics.target()==='up'?'label-success':metrics.target()==='down'?'label-danger':'label-warning'">{{metrics.target()}}</span></div>
      <clr-alert *ngIf="metrics.state()!=='ok'" [clrAlertType]="metrics.state()==='error'?'danger':'info'" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{metrics.hint()}}</span></clr-alert-item></clr-alert>
      <div class="opa-kpis">
        <article><span>Evaluations</span><strong>{{number(metrics.latestEvaluations(),3)}}/s</strong><small>5m rate</small></article>
        <article><span>Decision p95</span><strong>{{number(metrics.latestP95(),2)}} ms</strong><small>v1/data</small></article>
        <article><span>HTTP errors</span><strong>{{number(metrics.latestError(),2)}}%</strong><small>4xx + 5xx</small></article>
        <article><span>Heap</span><strong>{{number(metrics.latestHeap(),1)}} MiB</strong><small>allocated</small></article>
        <article><span>Goroutines</span><strong>{{number(metrics.latestGoroutines(),0)}}</strong><small>runtime</small></article>
		<article><span>Allow / Deny</span><strong>{{number(metrics.latestAllow(),3)}} / {{number(metrics.latestDeny(),3)}}</strong><small>durable 5m rate /s</small></article>
      </div>
      <div class="opa-charts" *ngIf="metrics.state()==='ok'">
        <article><h3>Evaluation throughput</h3><p>5분 이동평균, 초당 평가 요청</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="evaluationSeries()" valueAxisTitle="Evaluations / s" ariaLabel="OPA 평가 처리량" /></article>
        <article><h3>Decision latency</h3><p>v1/data 평가 요청 p95</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="latencySeries()" valueAxisTitle="Milliseconds" ariaLabel="OPA 평가 지연" /></article>
        <article><h3>HTTP error ratio</h3><p>평가 API 4xx·5xx 비율</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="errorSeries()" valueAxisTitle="Percent" ariaLabel="OPA HTTP 오류율" /></article>
        <article><h3>Runtime resources</h3><p>Go heap과 goroutine 수</p><os-carbon-line-chart [labels]="metrics.series().labels" [series]="runtimeSeries()" valueAxisTitle="MiB / count" ariaLabel="OPA runtime 자원" /></article>
      </div>
		<clr-alert clrAlertType="success" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">allow/deny 결과는 CloudNativePG에 영속 기록한 뒤 제한된 outcome 차원으로만 집계합니다. 원문 input과 non-deterministic cache는 OPA에서 제거하며 sink도 원문 input이 포함된 batch를 거부합니다.</span></clr-alert-item></clr-alert>
      <p class="os-dim">{{metrics.hint()}} · 마지막 확인 {{metrics.lastSync() || '—'}}</p>
    </section>

    <section class="opa-work" *ngIf="tab()==='topology'">
      <h2>Topology</h2><dl class="opa-kv"><dt>Deployment</dt><dd>{{svc.readyN()}} / {{svc.totalN()}} ready</dd><dt>Node</dt><dd>{{svc.node()}}</dd><dt>Image</dt><dd class="os-mono">{{svc.image() || '—'}}</dd><dt>Restarts</dt><dd>{{svc.restarts()}}</dd></dl>
    </section>
	<section class="opa-work" *ngIf="tab()==='config'"><h2>Security & configuration</h2><div class="opa-gates"><article><b>API authorization</b><p>mTLS client만 POST /v1/data/opensphere/**를 호출하며 mutation API는 거부합니다.</p></article><article><b>Decision privacy</b><p>원문 input은 OPA mask와 sink whitelist 양쪽에서 차단합니다.</p></article><article><b>Policy supply chain</b><p>ES256 서명, scope와 revision을 검증하고 검증 실패 시 기존 bundle을 유지합니다.</p></article><article><b>Failure mode</b><p>정책 부재·undefined·bundle 검증 실패를 allow로 전환하지 않습니다.</p></article></div></section>
    <section class="opa-work" *ngIf="tab()==='domain'"><h2>Policies & Decisions</h2><p>bootstrap 정책은 <span class="os-mono">data.opensphere.authz.allow=false</span>입니다. Console에서 Rego 원문을 직접 편집하지 않으며 승인된 Git/bundle pipeline을 정본으로 사용합니다.</p></section>
	<section class="opa-work" *ngIf="tab()==='backups'"><h2>Bundle recovery</h2><p>서명 bundle은 exact-digest Control Plane artifact와 revision으로 복구하며 decision log는 CloudNativePG 백업 정책을 따릅니다. 현재 보존기간은 30일입니다.</p></section>
    <section class="opa-work" *ngIf="tab()==='events'"><h2>Events</h2><table class="table"><thead><tr><th>Type</th><th>Reason</th><th>Message</th><th>Time</th></tr></thead><tbody><tr *ngFor="let e of svc.events()"><td>{{e.type}}</td><td>{{e.reason}}</td><td>{{e.message}}</td><td>{{e.lastTimestamp || e.eventTime}}</td></tr><tr *ngIf="!svc.events().length"><td colspan="4">관련 이벤트 없음</td></tr></tbody></table></section>
    <section class="opa-work" *ngIf="tab()==='claims'"><h2>Claims</h2><p>정책 소비자는 임의 endpoint 공유가 아니라 PolicyDecisionClaim과 제한된 decision path Binding을 통해 연결해야 합니다.</p></section>
    <section class="opa-work" *ngIf="tab()==='upgrade'"><h2>Upgrade & rollback</h2><p>엔진 image digest와 policy bundle revision을 독립적으로 pin하고 rollback합니다. 새 bundle은 서명 검증, Rego test, shadow evaluation을 통과해야 합니다.</p></section>
    <section class="opa-work" *ngIf="tab()==='documentation'"><h2>Documentation</h2><a [href]="manualUrl">OpenSphere OPA 설치·운영 안내서 (한글)</a><br/><a href="https://www.openpolicyagent.org/docs/monitoring" target="_blank" rel="noreferrer">OPA Monitoring 공식 문서</a></section>
  `,
  styles: [`
    :host{display:block;min-width:0}.opa-work{display:grid;gap:16px;background:#fff;border:1px solid #d0d0d0;padding:18px}.opa-work h2{margin:0}.opa-panel{background:#fff;border:1px solid #d0d0d0;padding:16px}.opa-panel h2{margin:0 0 5px;font-size:1rem}.opa-panel p,.opa-work>p{color:#525252}.opa-kv{display:grid;grid-template-columns:minmax(9rem,.7fr) minmax(0,1.6fr);gap:8px 14px}.opa-kv dt{color:#6f6f6f}.opa-kv dd{margin:0;overflow-wrap:anywhere}.ok{color:#198038}.warn{color:#8e6a00}.bad{color:#da1e28}.opa-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.opa-head h2{margin:3px 0 4px}.opa-head p{margin:0;color:#525252}.opa-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.opa-form label{display:grid;gap:6px}.opa-actions{grid-column:1/-1;display:flex;justify-content:flex-end;align-items:center;gap:12px}.opa-log{max-height:180px;overflow:auto;background:#161616;color:#f4f4f4;padding:12px}.opa-progress{height:6px;background:#e0e0e0}.opa-progress div{height:100%;background:#0f62fe}.opa-target{display:flex;align-items:center;gap:10px;border:1px solid #d0d0d0;padding:12px 14px}.opa-target div{display:grid;flex:1}.opa-target div span{color:#6f6f6f;font-size:.78rem}.opa-dot{width:10px;height:10px;border-radius:50%;background:#f1c21b}.opa-dot.up{background:#24a148}.opa-dot.down{background:#da1e28}.opa-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.opa-kpis article,.opa-charts article,.opa-gates article{border:1px solid #d0d0d0;padding:14px;min-width:0}.opa-kpis span,.opa-kpis small{display:block;color:#6f6f6f}.opa-kpis strong{display:block;margin:7px 0 3px;font-size:1.3rem}.opa-charts,.opa-gates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.opa-charts h3{margin:0 0 3px;font-size:1rem}.opa-charts p,.opa-gates p{margin:0 0 8px;color:#6f6f6f;font-size:.8rem}@media(max-width:1050px){.opa-kpis{grid-template-columns:repeat(3,1fr)}}@media(max-width:720px){.opa-form,.opa-kpis,.opa-charts,.opa-gates{grid-template-columns:1fr}.opa-actions{grid-column:auto}.opa-head{display:block}}
  `],
})
export class OpaComponent implements OnInit, OnDestroy {
  readonly svc = inject(OpaService);
  readonly metrics = inject(OpaMetricsService);
  private readonly reg = inject(FoundationRegistryService);
  private readonly vr = inject(ViewRouter);
  readonly iBack = ArrowLeft16; readonly iRenew = Renew16;
  readonly form = signal<OpaInstallParameters>({ ...DEFAULT_FORM });
  readonly applying = signal(false); readonly progress = signal(0); readonly logs = signal<string[]>([]);
  readonly manualUrl = `/api/manual/${MANUAL_ID}`;
  readonly tab = computed(() => this.vr.tab());
  readonly exists = computed(() => this.svc.state() === 'ok');
	readonly productionReady = computed(() => this.svc.fm()?.status?.opaProductionReady === true && this.svc.ready());
  readonly headerModel = computed<PluginPageHeaderModel>(() => ({
    name: 'Open Policy Agent', logo: 'https://logos.opl.io.kr/i/opa', monogram: 'OPA', capability: 'identity.policy.opa',
    description: 'Rego 정책 결정점, 안전한 정책 공급망과 결정 관측 경계를 관리합니다.',
		lifecycle: this.productionReady() ? 'Production Ready' : this.svc.ready() ? 'Production gates pending' : this.exists() ? 'Progressing' : 'Not installed',
		lifecycleClass: this.productionReady() ? 'label-success' : 'label-warning', version: this.svc.fm()?.spec?.parameters?.identityEngines?.opa?.version || '1.18.2-static',
		profile: 'production · fail-closed', namespace: 'opensphere-foundation',
  }));
  private readonly tabs: PluginPageTab[] = (() => { const tabs = pfsPluginTabs('Policies & Decisions'); tabs.splice(1, 0, { id: 'monitoring', label: 'Monitoring' }); return tabs; })();

  ngOnInit(): void { this.svc.start(); this.metrics.start(); this.hydrate(); }
  ngOnDestroy(): void { this.svc.stop(); this.metrics.stop(); }
  back(): void { this.vr.setModule('modules'); this.vr.setTab('overview'); }
  openTab(id: string): void { this.vr.setTab(id); }
  tabsForUi(): PluginPageTab[] { return this.tabs.map(t => ({ ...t, disabled: t.id === 'monitoring' && !this.exists(), badge: t.id === 'events' ? this.svc.events().filter(e => e.type === 'Warning').length : undefined })); }
  patch(next: Partial<OpaInstallParameters>): void { this.form.update(v => ({ ...v, ...next })); }
  private hydrate(): void { const cfg = (this.reg.parametersOf('opa') as any)?.identityEngines?.opa; if (cfg) this.form.update(v => ({ ...v, ...cfg })); }
  async apply(): Promise<void> {
    if (this.applying()) return;
    this.applying.set(true); this.progress.set(10); this.logs.set(['FoundationModel/identity OPA 선언 제출']);
    const ok = await this.reg.configureIdentityEngine('opa', this.form());
    if (!ok) { this.logs.update(v => [...v, `실패: ${this.reg.lastError()}`]); this.progress.set(100); this.applying.set(false); return; }
    this.progress.set(35); this.logs.update(v => [...v, '선언 승인 · control-plane reconcile 관찰']);
    let n = 0; const timer = setInterval(async () => {
      n++; await this.svc.refresh();
      if (this.exists()) this.progress.set(Math.max(70, this.progress()));
      if (this.svc.ready() || n >= 60) { clearInterval(timer); this.progress.set(100); this.logs.update(v => [...v, this.svc.ready() ? 'OPA Ready · bootstrap fail-closed' : '5분 내 Ready 미도달 · Events 확인 필요']); this.applying.set(false); }
    }, 5000);
  }
  number(value: number, digits: number): string { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
  evaluationSeries(): CarbonLineSeries[] { return [{ label: 'evaluations / s', data: this.metrics.series().evaluations, color: '#0f62fe' }]; }
  latencySeries(): CarbonLineSeries[] { return [{ label: 'p95 ms', data: this.metrics.series().p95Milliseconds, color: '#8a3ffc' }]; }
  errorSeries(): CarbonLineSeries[] { return [{ label: 'HTTP errors %', data: this.metrics.series().errorPercent, color: '#da1e28' }]; }
  runtimeSeries(): CarbonLineSeries[] { const s = this.metrics.series(); return [{ label: 'heap MiB', data: s.heapMiB, color: '#24a148' }, { label: 'goroutines', data: s.goroutines, color: '#f1c21b' }]; }
}
