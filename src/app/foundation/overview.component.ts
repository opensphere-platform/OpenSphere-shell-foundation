import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FoundationDomainState, FoundationRegistryService } from '../registry/foundation-registry.service';
import { HisRequirementItem, HisRequirementsService, HisState } from './his-requirements.service';
import { ControlPlaneService } from './control-plane.service';
import { ViewRouter } from '../view-router';
import { CarbonIcon } from '../carbon-icon';
import { HostedPlugin } from '../registry/hosted-plugin';
import Db2Database20 from '@carbon/icons/es/db2--database/20';
import UserMultiple20 from '@carbon/icons/es/user--multiple/20';
import MachineLearningModel20 from '@carbon/icons/es/machine-learning-model/20';
import Chat20 from '@carbon/icons/es/chat/20';
import ChartLine20 from '@carbon/icons/es/chart--line/20';
import Renew20 from '@carbon/icons/es/renew/20';

// capability 도메인/시작하기 카드 아이콘(20·24px) — Carbon(@carbon/icons), shell-template/ai/base와 동일 관례.
const DOMAIN_ICON: Record<string, any> = {
  data: Db2Database20, identity: UserMultiple20, ai: MachineLearningModel20,
  comm: Chat20, observability: ChartLine20, backup: Renew20,
};

interface DomainCard {
  id: string; label: string; icon: any; desc: string;
  count: number; active: number; healthy: number;
  status: 'loading' | 'disabled' | 'progressing' | 'ready' | 'live' | 'degraded';
  modules: string; firstModule: string;
  opNote?: string;
  linkModule?: string;
}

interface SetupStep {
  n: string;
  title: string;
  body: string;
  action: string;
  module: string;
  tab?: string;
}

// PFS 정본 멤버는 제품명이 아니라 identity/data/ai/comm/observability/backup capability다.
// 각 capability의 실제 Operator/operand probe를 한 곳에서 집계한다.
const OPERATOR_DOMAINS: Record<string, { model: string; modules: string; engineIds: string[]; linkModule: string }> = {
  ai: { model: 'ai', modules: 'LiteLLM · Langfuse', engineIds: ['litellm', 'langfuse'], linkModule: 'litellm' },
  comm: { model: 'communication', modules: 'Stalwart(JMAP) · Novu · Mattermost', engineIds: ['stalwart', 'novu', 'mattermost'], linkModule: 'stalwart' },
  observability: { model: 'observability', modules: 'OpenTelemetry Collector · Tempo · Loki · Grafana Operator', engineIds: ['otel', 'tempo', 'loki', 'grafana'], linkModule: 'otel' },
  backup: { model: 'backup', modules: 'OpenSphere Backup · Velero · Restore', engineIds: ['ptm'], linkModule: 'ptm' },
};

const OBSERVATION_ID: Record<string, string> = {
  postgres: 'pg_up',
  psmdb: 'psmdb_up',
  valkey: 'valkey_up',
  opensearch: 'opensearch_up',
  rustfs: 'rustfs_up',
  keycloak: 'keycloak_up',
  samba: 'samba_up',
  syncope: 'syncope_up',
  opa: 'opa_up',
  litellm: 'litellm_up',
  langfuse: 'langfuse_up',
  stalwart: 'stalwart_up',
  novu: 'novu_up',
  mattermost: 'mattermost_up',
  otel: 'collector_up',
  tempo: 'tempo_up',
  loki: 'loki_up',
  grafana: 'grafana_up',
  ptm: 'ptm_operator_up',
};

// Foundation Overview — subShell home(개요). 정체성(10 Perspective의 기둥) + capability 6-도메인 현황
// 6개 capability의 Operator/operand live 상태 + at-a-glance KPI + 시작하기.
// ※ 소비 엔드포인트·plugin별 상세는 각 모듈 자신의 페이지에 있다(중복이라 별도 Services 메뉴는 폐기, 2026-07-04). 여기는 '한눈에'만.
@Component({
  selector: 'app-foundation-overview',
  standalone: true,
  imports: [CommonModule, CarbonIcon],
  template: `
    <!-- Hero: 정체성 + at-a-glance -->
    <section class="ov-hero">
      <div class="ov-hero-copy">
        <span class="ov-eyebrow">Platform Foundation Service Stack</span>
        <h1 class="ov-h1">플랫폼 운영의 기둥</h1>
        <p class="ov-lead">
          사원·고객 신원과 모든 시스템 운영을 관장하는 Foundation. OpenSphere 10개 Perspective를 지탱하는
          <strong>capability 모듈</strong>을 설치·운영하고, 다른 subShell이 소비할 백킹서비스를 호스팅합니다.
        </p>
        <div class="ov-hero-actions">
          <button class="btn btn-primary" (click)="go('modules')">PFS 모듈 관리</button>
        </div>
      </div>
      <div class="ov-hero-stat">
        <div class="ov-stat-big">{{ liveDomains() }}<span>/6</span></div>
        <div class="ov-stat-cap">capability 도메인 가동</div>
        <ul class="ov-stat-list">
          <li><span>설치 모듈</span><b>{{ s().hosted }}</b></li>
          <li><span>런타임 정상</span><b [class.ov-warn]="s().degraded">{{ s().healthy }}<i>/{{ s().hosted }}</i></b></li>
          <li><span>제공 capability</span><b>{{ s().capabilities }}</b></li>
        </ul>
      </div>
    </section>

    <div class="os-sech">PFS 설립 상태 <span class="os-dim">— UI 활성화와 Control Plane 준비 상태를 분리해 표시</span></div>
    <section class="pfs-establishment">
      <div class="pfs-stage">
        <span>Foundation UI</span>
        <strong [ngClass]="pfsConditionReady('foundation-shell') ? 'pfs-stage--ready' : 'pfs-stage--blocked'">
          {{ cp.establishment()?.extension?.phase || '확인 중' }}
        </strong>
        <small>Extension 상태이며 PFS 설립 상태와 별도</small>
      </div>
      <div class="pfs-stage">
        <span>Platform Support Profile</span>
        <strong [ngClass]="cp.establishment()?.supportProfile?.ready ? 'pfs-stage--ready' : 'pfs-stage--blocked'">
          {{ cp.establishment()?.supportProfile?.phase || '확인 중' }}
        </strong>
        <small>HIS와 4개 지원 capability의 live evidence</small>
      </div>
      <div class="pfs-stage">
        <span>설립 적용기</span>
        <strong [ngClass]="pfsConditionReady('foundation-bootstrap-owner') ? 'pfs-stage--ready' : 'pfs-stage--blocked'">
          {{ pfsConditionState('foundation-bootstrap-owner') }}
        </strong>
        <small>검토된 변경만 실행하는 전용 reconciler</small>
      </div>
      <div class="pfs-stage">
        <span>Foundation Control Plane</span>
        <strong [ngClass]="pfsConditionReady('foundation-control-plane') ? 'pfs-stage--ready' : 'pfs-stage--blocked'">
          {{ pfsConditionState('foundation-control-plane') }}
        </strong>
        <small>계약 CRD · controller · model · binding</small>
      </div>
      <div class="pfs-establishment-result">
        <b>{{ pfsStage() }}</b>
        <span>
          {{ pfsStageDetail() }}
          <small *ngIf="bootstrapProgressDetail()">{{ bootstrapProgressDetail() }}</small>
        </span>
        <div class="pfs-establishment-actions">
          <button class="btn btn-sm" type="button" (click)="go('control-plane')">Control Plane 상태</button>
          <button
            *ngIf="!cp.establishment()?.pfs?.established"
            class="btn btn-sm btn-primary"
            type="button"
            [disabled]="bootstrapActionDisabled()"
            (click)="openBootstrapChange()">
            {{ bootstrapActionLabel() }}
          </button>
        </div>
      </div>
    </section>

    <!-- HIS/PFS 소유권 경계의 현행 권위: CONSTITUTION-0004 §2.0 -->
    <div class="os-sech">HIS / PFS 소유권 경계 <span class="os-dim">— CONSTITUTION-0004 §2.0</span></div>
    <section class="stack-defs">
      <article class="stack-def stack-def--his">
        <div class="stack-def-h">
          <span class="label label-info">HIS</span>
          <h3>Host Infrastructure Service Stack</h3>
          <span class="label os-ml-auto" [ngClass]="statePill(his.status()?.state)">{{ his.status()?.state || '확인 중' }}</span>
        </div>
        <p>
          클러스터 전체가 소비하는 호스트 공통 인프라입니다. Cluster Manager가 진단과 lifecycle을 소유하며,
          Foundation은 PFS 설립에 필요한 상태를 읽기 전용으로 소비합니다.
        </p>
        <div class="stack-members">
          <span class="stack-chip">{{ his.status()?.summary?.coreReady || 0 }}/{{ his.status()?.summary?.coreTotal || 0 }} core ready</span>
          <span class="stack-chip">{{ his.status()?.summary?.selectedProfilesReady || 0 }}/{{ his.status()?.summary?.selectedProfilesTotal || 0 }} profile ready</span>
        </div>
        <div class="stack-actions">
          <a class="btn btn-sm" href="/p/cluster-manager/his/his">Cluster Manager에서 HIS 관리</a>
          <span class="os-dim">Foundation에서는 변경할 수 없습니다.</span>
        </div>
      </article>

      <article class="stack-def stack-def--pfs" (click)="go('modules')" role="button" tabindex="0" (keydown.enter)="go('modules')">
        <div class="stack-def-h">
          <span class="label label-success">PFS</span>
          <h3>Platform Foundation Service Stack</h3>
        </div>
        <p>
          사용자(사원·고객) 관리와 이를 위한 모든 시스템 운영 관리 서비스입니다.
          10 Perspective를 지탱하며, Foundation subShell이 capability 모듈의 lifecycle을 소유합니다.
        </p>
        <div class="stack-members">
          <span *ngFor="let m of pfsMembers" class="stack-chip">{{ m }}</span>
        </div>
      </article>
    </section>

    <div class="os-sech">HIS 요구조건 <span class="os-dim">— Cluster Manager 단일 read model · 읽기 전용</span></div>
    <section class="his-req">
      <div class="his-req-head">
        <div><strong>PFS 선행 인프라</strong><span *ngIf="his.lastSync()">마지막 확인 {{ his.lastSync() }}</span></div>
        <button class="btn btn-sm" type="button" (click)="his.refresh()" [disabled]="his.busy()">{{ his.busy() ? '확인 중…' : '새로고침' }}</button>
      </div>
      <div class="his-req-row his-req-row--head">
        <span>Capability</span><span>Mode</span><span>Ownership</span><span>State</span><span>Evidence</span>
      </div>
      <div class="his-req-row" *ngFor="let item of requiredHisItems()">
        <span class="his-req-name">{{ item.displayName }}</span>
        <span>{{ item.mode }}</span>
        <span>{{ item.ownership }}</span>
        <span><span class="label" [ngClass]="statePill(item.check.state)">{{ item.check.state }}</span></span>
        <span class="his-req-message">{{ item.check.message || item.check.reason }}<small *ngIf="item.check.observedVersion"> · {{ item.check.observedVersion }}</small></span>
      </div>
      <div class="his-req-empty" *ngIf="!his.busy() && !his.error() && requiredHisItems().length === 0">선택된 HIS 요구조건이 없습니다.</div>
      <div class="his-req-error" *ngIf="his.error()">{{ his.error() }} · PFS 준비 완료로 간주하지 않습니다.</div>
    </section>

    <!-- Capability 6-도메인 현황 -->
    <div class="os-sech">Capability 도메인</div>
    <div class="ov-domains">
      <div class="ov-domain" *ngFor="let d of domains()" [class.ov-domain--planned]="d.status === 'disabled'"
           [class.ov-domain--clickable]="true" (click)="goDomain(d)">
        <div class="ov-domain-h">
          <os-cicon [icon]="d.icon" [size]="20"/>
          <span class="ov-domain-name">{{ d.label }}</span>
          <span class="label os-ml-auto" [ngClass]="domainStatusPill(d)">
            {{ domainStatusLabel(d) }}
          </span>
        </div>
        <p class="ov-domain-desc">{{ d.desc }}</p>
        <div class="ov-domain-foot">
          <span class="ov-domain-count">{{ d.active }}/{{ d.count }} 활성 · {{ d.healthy }}/{{ d.active }} 정상</span>
          <span class="ov-domain-mods">{{ d.modules }}</span>
          <span class="ov-domain-opnote" *ngIf="d.opNote">{{ d.opNote }}</span>
        </div>
      </div>
    </div>

    <!-- 운영 경로 -->
    <div class="os-sech">0단계 운영 경로 <span class="os-dim">— 하나의 Foundation subShell 안에서 진행</span></div>
    <div class="ov-steps">
      <button class="ov-step" type="button" *ngFor="let step of setupSteps" (click)="goStep(step)">
        <span class="ov-step-n">{{ step.n }}</span>
        <span class="ov-step-copy">
          <b>{{ step.title }}</b>
          <span>{{ step.body }}</span>
        </span>
        <span class="ov-step-action">{{ step.action }}</span>
      </button>
    </div>

    <!-- 설치 완료 plugin 경로 -->
    <div class="os-sech">Installed Foundation plugins <span class="os-dim">— 설치 완료 후 메뉴와 관리 화면으로 진입하는 목록</span></div>
    <div class="ov-registry">
      <div class="ov-reg-row ov-reg-head">
        <span>Plugin</span><span>Capability</span><span>Lifecycle</span><span>Runtime</span><span>Consume point</span><span></span>
      </div>
      <div class="ov-reg-row" *ngFor="let p of installedPlugins()">
        <span class="ov-reg-name">{{ p.name }}</span>
        <span>{{ p.capabilityLabel }}</span>
        <span><span class="label" [ngClass]="lifecyclePill(p)">{{ lifecycleLabel(p) }}</span></span>
        <span><span class="label" [ngClass]="reg.health(p).pill">{{ reg.health(p).label }}</span></span>
        <span class="os-mono">{{ p.consumePoint }}</span>
        <span class="ov-reg-actions">
          <button class="btn btn-sm" type="button" (click)="openPlugin(p)">Open</button>
        </span>
      </div>
      <div class="ov-empty" *ngIf="installedPlugins().length === 0">
        <ng-container *ngIf="reg.modelsLoaded() === 'ok'; else registryUnavailable">
          선언된 PFS plugin이 없습니다. <button class="btn btn-link" type="button" (click)="go('modules')">PFS 모듈</button>에서 설치할 모듈을 선택하세요.
        </ng-container>
        <ng-template #registryUnavailable>
          Foundation Control Plane과 FoundationModel API가 준비되지 않아 설치 모듈을 판정할 수 없습니다.
        </ng-template>
      </div>
    </div>
  `,
})
export class FoundationOverviewComponent {
  readonly reg = inject(FoundationRegistryService);
  readonly his = inject(HisRequirementsService);
  readonly cp = inject(ControlPlaneService);
  private vr = inject(ViewRouter);
  readonly s = this.reg.summary;
  readonly installedPlugins = this.reg.enabledPlugins;
  readonly pfsMembers = ['identity', 'data', 'ai', 'comm', 'observability', 'backup'];
  readonly setupSteps: SetupStep[] = [
    {
      n: '0',
      title: 'HIS 요구조건 확인',
      body: 'Cluster Manager가 제공하는 host 공통 인프라의 준비 상태를 확인합니다.',
      action: 'Cluster Manager',
      module: 'his',
    },
    {
      n: '1',
      title: 'PFS 모듈 선언',
      body: 'OpenSearch, PostgreSQL(StackGres) 같은 capability 구현 엔진을 설치 선언합니다.',
      action: 'Engines',
      module: 'modules',
    },
    {
      n: '2',
      title: 'Plugin 진입',
      body: '설치된 plugin은 registry에서 자기 메뉴와 관리 화면을 얻습니다.',
      action: 'Registry',
      module: 'overview',
    },
    {
      n: '3',
      title: '소비 계약 확인',
      body: '다른 subShell은 Claim, Binding, service DNS로 capability를 소비합니다.',
      action: 'Claims',
      module: 'postgres',
      tab: 'claims',
    },
  ];

  ngOnInit(): void { this.his.start(); this.cp.start(); }

  readonly controlPlaneReady = computed(() =>
    this.cp.workloads().some((item) => item.id === 'foundation-control-plane' && item.state === 'pass'),
  );
  readonly requiredContractTotal = computed(() => this.cp.contracts().filter((item) => item.required).length);
  readonly requiredContractPass = computed(() =>
    this.cp.contracts().filter((item) => item.required && item.state === 'pass').length,
  );
  readonly requiredContractsReady = computed(() =>
    this.requiredContractTotal() > 0 && this.requiredContractPass() === this.requiredContractTotal(),
  );
  readonly pfsStage = computed(() => {
    if (this.cp.busy() && !this.cp.lastSync()) { return '상태 확인 중'; }
    if (this.cp.establishmentError()) { return 'Blocked · PFS 상태 권위 조회 실패'; }
    const phase = this.cp.establishment()?.pfs?.phase;
    if (!phase) { return 'Blocked · PFS 상태 계약 없음'; }
    const labels: Record<string, string> = {
      NotEstablished: '설립 전',
      Establishing: '설립 진행 중',
      Established: '설립 완료',
      Blocked: '증거 조회 차단',
    };
    return `${phase} · ${labels[phase] || phase}`;
  });
  readonly pfsStageDetail = computed(() => {
    if (this.cp.establishmentError()) { return this.cp.establishmentError(); }
    const pfs = this.cp.establishment()?.pfs;
    if (!pfs) { return 'Console Platform Readiness의 versioned PFS 상태 계약이 필요합니다.'; }
    if (pfs.established) {
      return 'Support Profile, Foundation 계약·Control Plane, 보호된 Claim→Binding live evidence가 모두 확인되었습니다.';
    }
    return pfs.blockers?.[0]?.detail || 'PFS 설립에 필요한 live evidence가 아직 완성되지 않았습니다.';
  });
  readonly bootstrapProgressDetail = computed(() => {
    if (this.cp.bootstrapPlanError()) { return ` · 설립 변경 경로: ${this.cp.bootstrapPlanError()}`; }
    const request = this.cp.bootstrapPlan()?.request;
    if (!request) { return ''; }
    const error = request.lastError ? ` · ${request.lastError}` : '';
    return ` · 변경 요청 ${request.requestId} · ${request.phase}: ${request.message}${error}`;
  });
  readonly bootstrapActionDisabled = computed(() => {
    const plan = this.cp.bootstrapPlan();
    if (!plan) { return true; }
    return !plan.readyToRequest && !plan.request && plan.gate.reason !== 'PlatformSupportProfileRequired';
  });
  readonly bootstrapActionLabel = computed(() => {
    const plan = this.cp.bootstrapPlan();
    if (!plan) { return '설립 경로 확인 중'; }
    if (plan.request && !['Completed', 'Failed', 'NeedsAttention'].includes(plan.request.phase)) {
      return '변경 요청 상태 보기';
    }
    if (plan.gate.reason === 'PlatformSupportProfileRequired') { return 'Support Profile 구성'; }
    if (plan.request?.phase === 'Failed' || plan.request?.phase === 'NeedsAttention') { return '설립 변경 다시 요청'; }
    return '설립 변경 요청';
  });

  pfsConditionReady(key: string): boolean {
    return this.cp.establishment()?.pfs?.conditions?.find((item) => item.key === key)?.ready === true;
  }
  pfsConditionState(key: string): string {
    const condition = this.cp.establishment()?.pfs?.conditions?.find((item) => item.key === key);
    return condition?.ready ? 'Ready' : (condition?.state || '확인 중');
  }
  openBootstrapChange(): void {
    if (this.cp.bootstrapPlan()?.gate.reason === 'PlatformSupportProfileRequired') {
      window.location.assign('/manage/platform-control?tab=readiness');
      return;
    }
    const url = this.cp.bootstrapPlan()?.changeControlUrl || '';
    if (!url.startsWith('/manage/change-control?template=foundation-control-plane-bootstrap')) { return; }
    window.location.assign(url);
  }

  readonly requiredHisItems = computed<HisRequirementItem[]>(() =>
    (this.his.status()?.items ?? []).filter((item) => item.effectiveRequired ?? item.required ?? item.profileSelected),
  );

  readonly domains = computed<DomainCard[]>(() => {
    const modelDomain = (model: string): Omit<DomainCard, 'id' | 'label' | 'icon' | 'desc'> => {
      const list = this.reg.all.filter((p) => p.model === model);
      const state = this.reg.domainState(model);
      const activeIds = this.activeEngineIds(state, list.map((p) => p.id));
      const healthy = activeIds.filter((id) => this.observedHealthy(state, id)).length;
      return {
        count: list.length,
        active: activeIds.length,
        healthy,
        status: this.domainStatus(state, activeIds.length, healthy),
        modules: list.map((p) => p.name).join(' · '),
        firstModule: list[0]?.view.module ?? 'overview',
        opNote: this.domainEvidenceNote(state),
      };
    };
    const operatorDomain = (id: string): Omit<DomainCard, 'id' | 'label' | 'icon' | 'desc'> => {
      const spec = OPERATOR_DOMAINS[id];
      const state = this.reg.domainState(spec.model);
      const activeIds = this.activeEngineIds(state, spec.engineIds);
      const healthy = activeIds.filter((engineId) => this.observedHealthy(state, engineId)).length;
      return {
        count: spec.engineIds.length,
        active: activeIds.length,
        healthy,
        status: this.domainStatus(state, activeIds.length, healthy),
        modules: spec.modules,
        firstModule: spec.linkModule,
        linkModule: spec.linkModule,
        opNote: this.domainEvidenceNote(state),
      };
    };
    return [
      { id: 'data', label: 'Data', icon: DOMAIN_ICON['data'], desc: '관계형 DB · 검색 · 오브젝트 스토리지', ...modelDomain('data') },
      { id: 'identity', label: 'Identity', icon: DOMAIN_ICON['identity'], desc: 'IGA · SSO · 디렉터리 · 정책', ...modelDomain('identity') },
      { id: 'ai', label: 'AI', icon: DOMAIN_ICON['ai'], desc: '모델 서빙 · 추론 · 벡터 메모리', ...operatorDomain('ai') },
      { id: 'comm', label: 'Comm', icon: DOMAIN_ICON['comm'], desc: '메시징 · 알림 · 협업', ...operatorDomain('comm') },
      { id: 'observability', label: 'Observability', icon: DOMAIN_ICON['observability'], desc: '메트릭 · 로그 · 트레이스', ...operatorDomain('observability') },
      { id: 'backup', label: 'Backup', icon: DOMAIN_ICON['backup'], desc: '백업 · 복구 · 보존', ...operatorDomain('backup') },
    ];
  });

  readonly liveDomains = computed(() => this.domains().filter((d) => d.status === 'live').length);

  private activeEngineIds(state: FoundationDomainState | null, engineIds: string[]): string[] {
    if (!state || state.desired !== 'Installed') { return []; }
    const configured = Object.keys(state.engines);
    if (configured.length === 0) { return engineIds; }
    return engineIds.filter((id) => state.engines[id] === 'enabled');
  }

  private observedHealthy(state: FoundationDomainState | null, engineId: string): boolean {
    if (!state) { return false; }
    const observationId = OBSERVATION_ID[engineId] ?? `${engineId}_up`;
    return state.observed.some((item) => item.id === observationId && item.healthy);
  }

  private domainStatus(
    state: FoundationDomainState | null,
    active: number,
    healthy: number,
  ): DomainCard['status'] {
    if (!state) { return 'loading'; }
    if (state.desired !== 'Installed' || state.phase === 'Disabled') { return 'disabled'; }
    if (['Failed', 'Blocked', 'Degraded'].includes(state.phase)) { return 'degraded'; }
    if (state.phase !== 'Installed') { return 'progressing'; }
    if (!state.operatorDeployed) { return 'degraded'; }
    if (active === 0) { return 'ready'; }
    return healthy === active ? 'live' : 'degraded';
  }

  private domainEvidenceNote(state: FoundationDomainState | null): string {
    if (!state) { return 'FoundationModel 상태 확인 중'; }
    if (state.desired !== 'Installed' || state.phase === 'Disabled') { return 'FoundationModel에서 비활성'; }
    if (!state.operatorDeployed) { return 'Operator 제어 계층 미확인'; }
    const version = state.operatorVersion ? ` · ${state.operatorVersion}` : '';
    return `Operator Ready${version}`;
  }

  domainStatusLabel(d: DomainCard): string {
    const labels: Record<DomainCard['status'], string> = {
      loading: '확인 중', disabled: 'Disabled', progressing: 'Progressing',
      ready: 'Ready', live: 'Live', degraded: 'Degraded',
    };
    return labels[d.status];
  }

  domainStatusPill(d: DomainCard): string {
    if (d.status === 'live') { return 'label-success'; }
    if (d.status === 'degraded') { return 'label-danger'; }
    if (d.status === 'disabled') { return ''; }
    return 'label-info';
  }

  go(id: string): void { this.vr.setModule(id); }
  goStep(step: SetupStep): void {
    if (step.module === 'his') { window.location.assign('/p/cluster-manager/his/his'); return; }
    this.vr.setModule(step.module);
    if (step.tab) { this.vr.setTab(step.tab); }
  }
  goDomain(d: DomainCard): void {
    this.go(d.linkModule || d.firstModule);
  }
  openPlugin(p: HostedPlugin): void { this.vr.setModule(p.view.module); }
  preparePlugin(p: HostedPlugin): void {
    const install = p.activation;
    if (install?.installModule) {
      this.vr.setModule(install.installModule);
      if (install.installTab) { this.vr.setTab(install.installTab); }
      return;
    }
    void this.reg.setEnabled(p.id, true);
  }
  lifecycleLabel(p: HostedPlugin): string {
    const s = this.reg.modelOf(p.id);
    if (s === null) { return '확인 중'; }
    return s;
  }
  lifecyclePill(p: HostedPlugin): string {
    const s = this.reg.modelOf(p.id);
    if (s === 'Installed') { return 'label-success'; }
    if (s === 'Disabled') { return 'label-warning'; }
    if (s === null) { return ''; }
    return 'label-info';
  }

  statePill(state?: HisState): string {
    if (state === 'Ready') { return 'label-success'; }
    if (state === 'Blocked') { return 'label-danger'; }
    if (state === 'Degraded') { return 'label-warning'; }
    return '';
  }
}
