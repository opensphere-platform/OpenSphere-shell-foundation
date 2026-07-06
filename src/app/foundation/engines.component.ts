import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { EnginesService } from './engines.service';
import { ViewRouter } from '../view-router';
import { OtelComponent } from './otel/otel.component';
import { CnpgOperatorComponent } from './cnpgoperator/cnpgoperator.component';
import { CrossplaneComponent } from './crossplane/crossplane.component';
import { PlaceholderModuleComponent } from './placeholder-module.component';
import { OpenSearchEngineComponent } from './opensearch-engine.component';

const REAL_DETAIL_TABS = new Set(['otel', 'cnpg', 'crossplane', 'opensearch']);
const PLACEHOLDER_TABS = new Set(['tempo', 'loki', 'grafana']);
const DETAIL_TABS = new Set([...REAL_DETAIL_TABS, ...PLACEHOLDER_TABS]);

type Impl = 'real' | 'phase1' | 'stub' | 'absent';
const IMPL_LABEL: Record<Impl, string> = { real: '배선됨', phase1: 'Phase 1', stub: '스텁(TODO)', absent: '비간섭(설계)' };
const IMPL_PILL: Record<Impl, string> = { real: 'label-success', phase1: 'label-info', stub: 'label-warning', absent: '' };

interface EngineCard {
  id: string; name: string; provider: string; version: string; logo: string; mono: string;
  category: string; role: string; impl: Impl; liveKey: string; wiring: string; detail?: boolean;
}

interface MemberAction {
  label: string;
  module?: string;
  tab?: string;
}

interface FssMemberCard {
  id: string;
  name: string;
  osPdnn: string;
  purpose: string;
  engines: string;
  contract: string;
  perspectives: string;
  status: string;
  statusPill: string;
  actions: MemberAction[];
}

const LOGO_BASE = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos';

// FSS 멤버 카탈로그 — 정본 멤버 6개(identity/data/ai/comm/observability/backup)를 1차 카드로 둔다.
// 정본(_DOCS_/Foundation/FS-구축계획서-2026-07-02.md §3.2): FS 모듈은 identity/data/ai/comm/observability/backup.
// OTel/CNPG/OpenSearch/Crossplane 등은 멤버가 아니라 §3.2의 "엔진 후보"와 HYBRID-WRAP 조달 수단이다.
// ※ tempo/loki/grafana는 착수 전 로드맵 카드 — PlaceholderModuleComponent로 로고/제목만 표시(2026-07-04).
@Component({
  selector: 'app-foundation-engines',
  standalone: true,
  imports: [CommonModule, ClarityModule, OtelComponent, CnpgOperatorComponent, CrossplaneComponent, OpenSearchEngineComponent, PlaceholderModuleComponent],
  template: `
    <app-otel *ngIf="vr.tab() === 'otel'"></app-otel>
    <app-cnpgoperator *ngIf="vr.tab() === 'cnpg'"></app-cnpgoperator>
    <app-crossplane *ngIf="vr.tab() === 'crossplane'"></app-crossplane>
    <app-opensearch-engine *ngIf="vr.tab() === 'opensearch'"></app-opensearch-engine>
    <app-placeholder-module *ngIf="placeholderCard() as pc" [name]="pc.name" [logo]="pc.logo" [mono]="pc.mono"
      [eyebrow]="'Foundation · ' + pc.category" backLabel="FSS 멤버" (back)="vr.setTab('overview')"></app-placeholder-module>

    <ng-container *ngIf="!isDetailTab()">
    <div class="os-title-row"><h2 class="os-h2">FSS 멤버 <span class="label label-info">FS 구축계획서 §3.2 정본</span></h2></div>
    <section class="stack-inline">
      <div>
        <span class="stack-kicker">Concept</span>
        <strong>Foundation Service Stack module catalog</strong>
        <p>이 화면의 1차 멤버는 계획서의 6개 capability 모듈이다. 제품·operator는 각 멤버의 구현 엔진 후보로 배치한다.</p>
      </div>
      <div class="stack-members">
        <span *ngFor="let m of fssMembers" class="stack-chip">{{ m }}</span>
      </div>
    </section>
    <p class="os-sub">
      Foundation Service Stack의 정본 정의는 사용자(사원·고객) 관리와 시스템 운영 관리이며,
      정본 모듈은 identity·data·ai·comm·observability·backup이다(FS 구축계획서 §3.1~§3.2).
      이 카탈로그는 그 모듈을 먼저 배치하고, 각 모듈 안에서 HYBRID-WRAP 엔진 후보와 관리 진입점을 연결한다.
    </p>

    <div class="hc-grid fss-grid">
      <div class="hc-card fss-card" *ngFor="let c of memberCards">
        <div class="hc-head">
          <div class="hc-logo"><span class="hc-mono">{{ c.name.slice(0, 1).toUpperCase() }}</span></div>
          <div class="hc-idblock">
            <div class="hc-name">{{ c.name }}</div>
            <div class="hc-provider">{{ c.osPdnn }} · {{ c.purpose }}</div>
          </div>
        </div>

        <p class="hc-role">{{ c.engines }}</p>
        <div class="fss-kv">
          <span>계약</span><b>{{ c.contract }}</b>
          <span>Perspective</span><b>{{ c.perspectives }}</b>
        </div>
        <div class="hc-wiring"><span class="hc-wiring-k">상태</span><span>{{ c.status }}</span></div>

        <div class="hc-foot">
          <span class="hc-cat"><span class="hc-cat-dot"></span>{{ c.id }}</span>
          <span class="hc-badges">
            <span class="label" [ngClass]="c.statusPill">{{ c.osPdnn }}</span>
            <button class="btn btn-sm" type="button" *ngFor="let a of c.actions" (click)="openAction(a)">{{ a.label }}</button>
          </span>
        </div>
      </div>
    </div>

    <div class="os-actions hc-refresh">
      <button class="btn btn-sm" (click)="svc.refresh()" [disabled]="svc.busy()">
        <span class="spinner spinner-inline" *ngIf="svc.busy()"></span> 새로고침
      </button>
      <span class="os-dim" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</span>
    </div>
    </ng-container>
  `,
})
export class FoundationEnginesComponent {
  readonly svc = inject(EnginesService);
  readonly vr = inject(ViewRouter);
  readonly IMPL_LABEL = IMPL_LABEL;
  readonly IMPL_PILL = IMPL_PILL;
  readonly failed = signal<Set<string>>(new Set());
  readonly fssMembers = ['identity', 'data', 'ai', 'comm', 'observability', 'backup'];

  ngOnInit(): void { this.svc.start(); }

  open(c: EngineCard): void { this.vr.setTab(c.id); }
  openAction(a: MemberAction): void {
    if (a.module) { this.vr.setModule(a.module); }
    if (a.tab) { this.vr.setTab(a.tab); }
  }
  goBss(): void { this.vr.setModule('bss'); }
  isDetailTab(): boolean { return DETAIL_TABS.has(this.vr.tab()); }
  /** 착수 전 3개(tempo/loki/grafana) 전용 — placeholder 페이지에 넘길 카드(없으면 undefined). */
  placeholderCard(): EngineCard | undefined {
    return PLACEHOLDER_TABS.has(this.vr.tab()) ? this.engineCandidates.find((c) => c.id === this.vr.tab()) : undefined;
  }
  logoUrl(name: string): string { return `${LOGO_BASE}/${name}.svg`; }
  markFailed(id: string): void { this.failed.update((s) => new Set(s).add(id)); }

  livePill(key: string): string {
    const s = this.svc.liveState(key);
    if (s === 'ok') { return 'label-success'; }
    if (s === 'loading') { return ''; }
    if (s === 'nocrd') { return 'label-warning'; }
    return 'label-danger';
  }
  liveLabel(key: string): string {
    const s = this.svc.liveState(key);
    return { loading: '확인 중…', ok: 'Live', empty: 'Live', nocrd: '미설치', noperm: '권한 없음', error: '조회 실패' }[s];
  }

  readonly memberCards: FssMemberCard[] = [
    {
      id: 'identity',
      name: 'identity',
      osPdnn: 'OS-2101',
      purpose: '사원·고객 신원 관리',
      engines: 'Keycloak Operator+config-cli · Syncope · Samba AD · OPA · SCIM-GW',
      contract: 'OIDC · SCIM',
      perspectives: '3 User · 7 Workspace · 8 Customer · 4 Developer',
      status: 'Keycloak workforce realm과 Samba AD는 실구현, Syncope IGA와 customer realm은 후속 결정/구현 대상.',
      statusPill: 'label-success',
      actions: [{ label: 'Keycloak', module: 'keycloak' }, { label: 'Samba-AD', module: 'samba' }, { label: 'Syncope', module: 'syncope' }],
    },
    {
      id: 'data',
      name: 'data',
      osPdnn: 'OS-2201',
      purpose: '사용자 서비스 데이터 평면',
      engines: 'CloudNativePG(1차) · Percona PSMDB · Valkey · RustFS(Helm→SSA) · OpenSearch operator',
      contract: 'PgClaim · BucketClaim · CacheClaim · IndexClaim',
      perspectives: '4 Developer · 5 AI · 7 Workspace · 10 WebSite',
      status: 'CNPG hybrid-wrap과 OpenSearch shared endpoint가 관리 경로에 연결됨. RustFS와 추가 데이터 엔진은 후속 확장.',
      statusPill: 'label-info',
      actions: [{ label: 'CNPG', tab: 'cnpg' }, { label: 'OpenSearch', tab: 'opensearch' }, { label: 'RustFS', module: 'rustfs' }],
    },
    {
      id: 'ai',
      name: 'ai',
      osPdnn: 'OS-2301',
      purpose: '추론 라우팅·임베딩·벡터 RAG substrate',
      engines: 'LiteLLM · Langfuse(ClickHouse 미결) · Novu 연계 · Embed',
      contract: 'LLMRoute · VectorRetrieval',
      perspectives: '5 AI Level',
      status: '코드 스캐폴드와 vectorretrievalclaims CRD 일부가 존재. 실제 provider/ingestion 연결은 후속.',
      statusPill: 'label-warning',
      actions: [{ label: 'LiteLLM', module: 'litellm' }, { label: 'Langfuse', module: 'langfuse' }, { label: 'Embed', module: 'embed' }],
    },
    {
      id: 'comm',
      name: 'comm',
      osPdnn: 'OS-2401',
      purpose: '메일·알림·협업 백본',
      engines: 'Stalwart(JMAP) · Novu · Mattermost(협업/ChatOps)',
      contract: 'Novu · JMAP · Chat',
      perspectives: '7 Workspace',
      status: 'README/descriptor 수준. Stalwart, Novu, Mattermost 구현은 후속 plugin/module 단계.',
      statusPill: 'label-warning',
      actions: [{ label: 'Stalwart', module: 'stalwart' }, { label: 'Novu', module: 'novu' }, { label: 'Mattermost', module: 'mattermost' }],
    },
    {
      id: 'observability',
      name: 'observability',
      osPdnn: 'OS-2501',
      purpose: '시스템 운영 관측',
      engines: 'OTel · Prometheus · Tempo · Loki · Grafana Operator(operator-of-operators)',
      contract: 'OTLP · ServiceMonitor',
      perspectives: '1 기반 · 전 perspective',
      status: 'OTel Collector는 실구현, Prometheus는 BSS 위임. Tempo/Loki/Grafana는 착수 전 로드맵.',
      statusPill: 'label-info',
      actions: [{ label: 'OTel', tab: 'otel' }, { label: 'Tempo', tab: 'tempo' }, { label: 'Loki', tab: 'loki' }, { label: 'Grafana', tab: 'grafana' }],
    },
    {
      id: 'backup',
      name: 'backup',
      osPdnn: 'OS-2601',
      purpose: '시스템 운영 백업(pre-upgrade 게이트)',
      engines: 'Velero 계열 · .ptm',
      contract: 'BackupPolicy · Run · Restore',
      perspectives: 'INV-3 전 upgrade',
      status: 'CRD와 reconciler 뼈대가 있고, 현재 Velero host 연결 관리 화면으로 상태를 확인한다.',
      statusPill: 'label-info',
      actions: [{ label: 'Velero', module: 'bss', tab: 'velero' }],
    },
  ];

  readonly engineCandidates: EngineCard[] = [
    {
      id: 'otel', name: 'OpenTelemetry Collector', provider: 'opentelemetry.io (CNCF)', version: 'v0.111.0', logo: 'opentelemetry-non-typo', mono: 'O', detail: true,
      category: '관측', impl: 'real', liveKey: 'otel',
      role: '각 FSS 모듈이 보내는 지표·로그·추적을 한곳에서 받아 BSS Prometheus 쪽으로 넘기는 중앙 게이트웨이 수집기. Foundation 전용.',
      wiring: '카드를 클릭하면 전용 페이지에서 버전 선택·설치·상태를 관리한다.',
    },
    {
      id: 'cnpg', name: 'CloudNativePG', provider: 'cloudnative-pg', version: 'PG 17', logo: 'postgresql', mono: 'PG', detail: true,
      category: 'data', impl: 'real', liveKey: 'cnpg',
      role: 'PostgreSQL 데이터베이스를 운영·관리하는 operator. FSS data 모듈이 이 위에서 PostgreSQL capability를 제공한다.',
      wiring: '카드를 클릭하면 전용 페이지에서 버전 선택·설치·상태·관리 Cluster 목록을 볼 수 있다.',
    },
    {
      id: 'opensearch', name: 'OpenSearch', provider: 'opensearch.org', version: '2.17.0', logo: 'opensearch', mono: 'OS', detail: true,
      category: 'data', impl: 'phase1', liveKey: 'opensearch',
      role: 'Shared search and index engine for manuals, OAA retrieval, catalog search, logs, and future vector/search workloads.',
      wiring: 'Open this card first to declare FoundationModel/data parameters.engines.opensearch, then reconcile the shared endpoint.',
    },
    {
      id: 'crossplane', name: 'Crossplane', provider: 'crossplane.io (CNCF)', version: 'v2.3.3', logo: 'crossplane-non-typo', mono: 'X', detail: true,
      category: '전달', impl: 'real', liveKey: 'crossplane',
      role: 'FSS 구현 엔진 후보들을 선언형 API로 설치·관리하는 OpenSphere 자체 delivery 엔진(방향 전환, 2026-07-03).',
      wiring: '카드를 클릭하면 provider·관리 중인 Release 목록을 볼 수 있다.',
    },
    {
      id: 'tempo', name: 'Grafana Tempo', provider: 'grafana.com (CNCF)', version: '', logo: 'tempo', mono: 'T', detail: true,
      category: '관측', impl: 'stub', liveKey: '',
      role: '분산 트레이스 저장·조회 백엔드. OTel Collector가 수집한 추적을 여기로 넘길 계획(착수 전).',
      wiring: '아직 착수 전 — 카드를 클릭하면 로드맵 placeholder 페이지가 열린다.',
    },
    {
      id: 'loki', name: 'Grafana Loki', provider: 'grafana.com (CNCF)', version: '', logo: 'loki', mono: 'L', detail: true,
      category: '관측', impl: 'stub', liveKey: '',
      role: '로그 집계·저장 백엔드. Foundation 모듈들의 로그를 인덱싱할 계획(착수 전).',
      wiring: '아직 착수 전 — 카드를 클릭하면 로드맵 placeholder 페이지가 열린다.',
    },
    {
      id: 'grafana', name: 'Grafana', provider: 'grafana.com', version: '', logo: 'grafana', mono: 'G', detail: true,
      category: '관측', impl: 'stub', liveKey: '',
      role: '메트릭·로그·트레이스 통합 대시보드. BSS Prometheus·Tempo·Loki를 한 화면에서 시각화할 계획(착수 전).',
      wiring: '아직 착수 전 — 카드를 클릭하면 로드맵 placeholder 페이지가 열린다.',
    },
  ];
}
