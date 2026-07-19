import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FoundationRegistryService } from '../registry/foundation-registry.service';
import { EnginesService } from './engines.service';
import { HisRequirementItem, HisRequirementsService, HisState } from './his-requirements.service';
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
  id: string; label: string; icon: any; desc: string; live: boolean;
  count: number; healthy: number; degraded: boolean; modules: string; firstModule: string;
  opNote?: string;    // 로드맵 도메인 중 실제 설치 진행이 있는 PFS 모듈의 실시간 상태
  linkTab?: string;   // opNote가 있으면 클릭 시 이동할 탭(예: 'velero')
  linkModule?: 'modules';
  plannedNote?: string; // live 도메인 안에도 아직 미구현인 엔진이 있을 때(예: Identity의 Syncope) 표시
}

interface SetupStep {
  n: string;
  title: string;
  body: string;
  action: string;
  module: string;
  tab?: string;
}

// CONSTITUTION-0004 §2.0.4 PFS core module 기준 계획 제품명.
// 아직 capability 서비스(FOUNDATION_PLUGINS)로 등록되지 않은 4개 도메인도 정확한 제품명을 명시한다.
// liveKey가 있으면 PFS 구현 모듈의 실측 상태를 그대로 반영한다(하드코딩 금지).
// PFS 정본 멤버는 제품명이 아니라 identity/data/ai/comm/observability/backup capability 모듈이다.
const PLANNED: Record<string, { modules: string; liveKey?: string; liveLabel?: string; linkTab?: string; linkModule?: 'modules' }> = {
  ai: { modules: 'LiteLLM · Langfuse · Vector Retrieval' },
  comm: { modules: 'Stalwart(JMAP) · Novu · Mattermost' },
  observability: { modules: 'OpenTelemetry Collector · Tempo · Loki · Grafana Operator', liveKey: 'otel', liveLabel: 'OpenTelemetry Collector', linkTab: 'otel', linkModule: 'modules' },
  backup: { modules: 'BackupPolicy · Restore · Object/Volume protection' },
};

// Foundation Overview — subShell home(개요). 정체성(10 Perspective의 기둥) + capability 6-도메인 현황
// (Data/Identity 가동 · AI/Comm/Observability/Backup 로드맵) + at-a-glance KPI + 시작하기.
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
      <div class="ov-domain" *ngFor="let d of domains()" [class.ov-domain--planned]="!d.live"
           [class.ov-domain--clickable]="d.live || d.linkTab" (click)="goDomain(d)">
        <div class="ov-domain-h">
          <os-cicon [icon]="d.icon" [size]="20"/>
          <span class="ov-domain-name">{{ d.label }}</span>
          <span class="label os-ml-auto"
                [ngClass]="d.live ? (d.degraded ? 'label-danger' : 'label-success') : (d.opNote?.includes('설치·운영중') ? 'label-info' : '')">
            {{ d.live ? (d.degraded ? 'Degraded' : 'Live') : (d.opNote?.includes('설치·운영중') ? '일부 가동' : '로드맵') }}
          </span>
        </div>
        <p class="ov-domain-desc">{{ d.desc }}</p>
        <div class="ov-domain-foot" *ngIf="d.live">
          <span class="ov-domain-count">{{ d.healthy }}/{{ d.count }} 모듈 정상</span>
          <span class="ov-domain-mods">{{ d.modules }}</span>
          <span class="ov-domain-opnote" *ngIf="d.plannedNote">{{ d.plannedNote }}</span>
        </div>
        <div class="ov-domain-foot ov-domain-foot--planned" *ngIf="!d.live">
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
        설치된 PFS plugin이 없습니다. <button class="btn btn-link" type="button" (click)="go('modules')">PFS 모듈</button>에서 설치할 모듈을 선택하세요.
      </div>
    </div>
  `,
})
export class FoundationOverviewComponent {
  readonly reg = inject(FoundationRegistryService);
  readonly engines = inject(EnginesService);
  readonly his = inject(HisRequirementsService);
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
      body: 'OpenSearch, PostgreSQL(CloudNativePG) 같은 capability 구현 엔진을 설치 선언합니다.',
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

  ngOnInit(): void { this.engines.start(); this.his.start(); }

  readonly requiredHisItems = computed<HisRequirementItem[]>(() =>
    (this.his.status()?.items ?? []).filter((item) => item.effectiveRequired ?? item.required ?? item.profileSelected),
  );

  readonly domains = computed<DomainCard[]>(() => {
    const roll = (prefix: string): Omit<DomainCard, 'id' | 'label' | 'icon' | 'desc' | 'live'> => {
      const list = this.reg.all.filter((p) => p.capability.startsWith(prefix));
      const hs = list.map((p) => this.reg.health(p));
      return {
        count: list.length,
        healthy: hs.filter((h) => h.phase === 'ok').length,
        degraded: hs.some((h) => h.phase === 'bad'),
        modules: list.map((p) => p.name).join(' · '),
        firstModule: list[0]?.view.module ?? 'overview',
      };
    };
    const planned = (id: string): Omit<DomainCard, 'id' | 'label' | 'icon' | 'desc' | 'live'> => {
      const p = PLANNED[id];
      const base = { count: 0, healthy: 0, degraded: false, modules: p.modules, firstModule: 'overview' };
      if (!p.liveKey) { return base; }
      const state = this.engines.liveState(p.liveKey);
      if (state === 'loading') { return base; } // 확인 중엔 아무 것도 단정하지 않음(플리커 방지)
      const opNote = state === 'ok' ? `${p.liveLabel} 설치·운영중 — PFS 모듈에서 상태 확인` : `${p.liveLabel} 미설치 — PFS 모듈에서 설치 가능`;
      return { ...base, opNote, linkTab: p.linkTab, linkModule: p.linkModule };
    };
    return [
      { id: 'data', label: 'Data', icon: DOMAIN_ICON['data'], desc: '관계형 DB · 검색 · 오브젝트 스토리지', live: true, ...roll('data.') },
      { id: 'identity', label: 'Identity', icon: DOMAIN_ICON['identity'], desc: '사원·고객 신원 · SSO · 디렉터리', live: true, plannedNote: '+ Syncope(IGA) 예정', ...roll('identity.') },
      { id: 'ai', label: 'AI', icon: DOMAIN_ICON['ai'], desc: '모델 서빙 · 추론 · 벡터 메모리', live: false, ...planned('ai') },
      { id: 'comm', label: 'Comm', icon: DOMAIN_ICON['comm'], desc: '메시징 · 알림 · 협업', live: false, ...planned('comm') },
      { id: 'observability', label: 'Observability', icon: DOMAIN_ICON['observability'], desc: '메트릭 · 로그 · 트레이스', live: false, ...planned('observability') },
      { id: 'backup', label: 'Backup', icon: DOMAIN_ICON['backup'], desc: '백업 · 복구 · 보존', live: false, ...planned('backup') },
    ];
  });

  readonly liveDomains = computed(() => this.domains().filter((d) => d.live).length);

  go(id: string): void { this.vr.setModule(id); }
  goStep(step: SetupStep): void {
    if (step.module === 'his') { window.location.assign('/p/cluster-manager/his/his'); return; }
    this.vr.setModule(step.module);
    if (step.tab) { this.vr.setTab(step.tab); }
  }
  goDomain(d: DomainCard): void {
    if (d.live) { this.go(d.firstModule); return; }
    if (d.linkTab) { this.vr.setModule(d.linkModule ?? 'modules'); this.vr.setTab(d.linkTab); }
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
