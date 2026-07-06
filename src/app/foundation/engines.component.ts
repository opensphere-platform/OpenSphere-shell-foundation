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
const PLACEHOLDER_TABS = new Set([
  'syncope', 'opa', 'scim-gw',
  'psmdb', 'valkey',
  'litellm', 'langfuse', 'embed',
  'stalwart', 'novu', 'mattermost',
  'tempo', 'loki', 'grafana-operator',
  'ptm',
]);
const DETAIL_TABS = new Set([...REAL_DETAIL_TABS, ...PLACEHOLDER_TABS]);

type Impl = 'real' | 'phase1' | 'stub' | 'absent';
const IMPL_LABEL: Record<Impl, string> = { real: '배선됨', phase1: 'Phase 1', stub: '스텁(TODO)', absent: '비간섭(설계)' };
const IMPL_PILL: Record<Impl, string> = { real: 'label-success', phase1: 'label-info', stub: 'label-warning', absent: '' };

interface EngineCard {
  id: string;
  name: string;
  provider: string;
  version: string;
  logo: string;
  mono: string;
  category: string;
  role: string;
  impl: Impl;
  liveKey: string;
  wiring: string;
  detail?: boolean;
  module?: string;
  tab?: string;
}

interface EngineSection {
  id: string;
  title: string;
  summary: string;
}

const LOGO_BASE = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos';

// FSS 엔진 카탈로그 — 기존 카드형 구조를 유지하되, FS 구축계획서 §3.2의 6개 모듈별 엔진 후보를 빠짐없이 배치한다.
// identity/data/ai/comm/observability/backup은 상단 칩과 카드 category로 드러내고, Crossplane은 HYBRID-WRAP delivery 엔진으로 별도 유지한다.
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
      [eyebrow]="'Foundation · ' + pc.category" backLabel="FSS 엔진" (back)="vr.setTab('overview')"></app-placeholder-module>

    <ng-container *ngIf="!isDetailTab()">
    <div class="os-title-row"><h2 class="os-h2">FSS 엔진 <span class="label label-info">FS 구축계획서 §3.2 엔진 후보</span></h2></div>
    <section class="stack-inline">
      <div>
        <span class="stack-kicker">Concept</span>
        <strong>Foundation capability 구현 엔진</strong>
        <p>계획서의 6개 FSS 멤버를 category로 두고, 각 멤버의 엔진 후보를 카드로 배치한다.</p>
      </div>
      <div class="stack-members">
        <span *ngFor="let m of fssMembers" class="stack-chip">{{ m }}</span>
      </div>
    </section>
    <p class="os-sub">
      Foundation Service Stack의 정본 모듈은 identity·data·ai·comm·observability·backup이다.
      아래 카드는 FS 구축계획서 §3.2의 엔진 후보와 HYBRID-WRAP delivery 엔진을 관리 진입점으로 배열한 것이다.
    </p>

    <section class="hc-section" *ngFor="let section of sections">
      <div class="hc-section-head">
        <div>
          <span class="stack-kicker">{{ section.id }}</span>
          <h3>{{ section.title }}</h3>
        </div>
        <p>{{ section.summary }}</p>
      </div>

      <div class="hc-grid">
        <div class="hc-card" *ngFor="let c of cardsFor(section.id)"
             [class.hc-clickable]="c.detail" (click)="c.detail && open(c)"
             [attr.role]="c.detail ? 'button' : null" [attr.tabindex]="c.detail ? 0 : null"
             (keydown.enter)="c.detail && open(c)">
          <div class="hc-head">
            <div class="hc-logo">
              <img *ngIf="c.logo && !failed().has(c.id)" [src]="logoUrl(c.logo)" [alt]="c.name" loading="lazy" (error)="markFailed(c.id)" />
              <span *ngIf="!c.logo || failed().has(c.id)" class="hc-mono">{{ c.mono }}</span>
            </div>
            <div class="hc-idblock">
              <div class="hc-name">{{ c.name }}<span *ngIf="c.detail" class="hc-open">관리 →</span></div>
              <div class="hc-provider">{{ c.provider }}<span *ngIf="c.version"> · {{ c.version }}</span></div>
            </div>
          </div>

          <p class="hc-role">{{ c.role }}</p>
          <div class="hc-wiring"><span class="hc-wiring-k">연결</span><span>{{ c.wiring }}</span></div>

          <div class="hc-foot">
            <span class="hc-cat"><span class="hc-cat-dot"></span>{{ c.category }}</span>
            <span class="hc-badges">
              <span class="label" [ngClass]="IMPL_PILL[c.impl]">{{ IMPL_LABEL[c.impl] }}</span>
              <span *ngIf="c.liveKey" class="label" [ngClass]="livePill(c.liveKey)">{{ liveLabel(c.liveKey) }}</span>
            </span>
          </div>
        </div>
      </div>
    </section>

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
  readonly sections: EngineSection[] = [
    { id: 'identity', title: 'Identity / Access', summary: '사원·고객 신원, 디렉터리, 정책, SCIM 동기화 계층.' },
    { id: 'data', title: 'Data Plane', summary: 'PostgreSQL, object storage, cache, document DB, 검색 인덱스 등 데이터 capability.' },
    { id: 'ai', title: 'AI / Retrieval', summary: 'LLM 라우팅, 추론 관측, 임베딩과 벡터 검색 substrate.' },
    { id: 'comm', title: 'Communication', summary: '메일, 알림, 협업, ChatOps로 이어지는 커뮤니케이션 백본.' },
    { id: 'observability', title: 'Observability', summary: '메트릭·로그·트레이스 수집, 저장, 조회, 대시보드 계층.' },
    { id: 'backup', title: 'Backup / Recovery', summary: '백업 정책, 실행, 복구와 pre-upgrade gate를 담당하는 계층.' },
    { id: 'delivery', title: 'Delivery / HYBRID-WRAP', summary: 'FSS 엔진 후보를 선언형 API와 operator-of-operators 방식으로 설치·관리.' },
  ];

  ngOnInit(): void { this.svc.start(); }

  open(c: EngineCard): void {
    if (c.module) { this.vr.setModule(c.module); }
    if (c.tab) { this.vr.setTab(c.tab); return; }
    this.vr.setTab(c.id);
  }
  goBss(): void { this.vr.setModule('bss'); }
  isDetailTab(): boolean { return DETAIL_TABS.has(this.vr.tab()); }
  placeholderCard(): EngineCard | undefined {
    return PLACEHOLDER_TABS.has(this.vr.tab()) ? this.cards.find((c) => c.id === this.vr.tab()) : undefined;
  }
  cardsFor(category: string): EngineCard[] { return this.cards.filter((c) => c.category === category); }
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

  readonly cards: EngineCard[] = [
    {
      id: 'keycloak', name: 'Keycloak', provider: 'keycloak.org', version: '26.x', logo: 'keycloak', mono: 'KC', detail: true, module: 'keycloak',
      category: 'identity', impl: 'real', liveKey: '',
      role: '사원 workforce realm과 OIDC provider. customer realm은 별도 결정 항목으로 남아 있다.',
      wiring: 'Keycloak plugin 화면에서 realm, workload, federation 상태를 관리한다.',
    },
    {
      id: 'syncope', name: 'Apache Syncope', provider: 'syncope.apache.org', version: '', logo: 'syncope', mono: 'SY', detail: true,
      category: 'identity', impl: 'stub', liveKey: '',
      role: 'IGA 단일 권위. ADR-FND-002의 JIT 금지와 SCIM 동기화 경계를 담당할 예정.',
      wiring: '아직 미구현 — 로드맵 placeholder에서 범위만 확인한다.',
    },
    {
      id: 'samba', name: 'Samba AD', provider: 'samba.org', version: 'AD DC', logo: 'samba', mono: 'AD', detail: true, module: 'samba',
      category: 'identity', impl: 'real', liveKey: '',
      role: '사원 디렉터리 capability. Keycloak이 LDAP federation으로 연결한다.',
      wiring: 'Samba-AD plugin 화면에서 domain, LDAP, workload 상태를 관리한다.',
    },
    {
      id: 'opa', name: 'OPA', provider: 'openpolicyagent.org', version: '', logo: 'opa', mono: 'OPA', detail: true,
      category: 'identity', impl: 'stub', liveKey: '',
      role: '정책 평가 엔진 후보. identity와 authorization 경계의 정책 결정을 담당할 예정.',
      wiring: '아직 착수 전 — 정책 bundle과 admission 연동 설계가 필요하다.',
    },
    {
      id: 'scim-gw', name: 'SCIM Gateway', provider: 'OpenSphere', version: '', logo: '', mono: 'SC', detail: true,
      category: 'identity', impl: 'stub', liveKey: '',
      role: '외부/내부 신원 동기화를 위한 SCIM facade 후보.',
      wiring: 'Syncope 구현과 함께 SCIM contract를 제공한다.',
    },
    {
      id: 'cnpg', name: 'CloudNativePG', provider: 'cloudnative-pg', version: 'PG 17', logo: 'postgresql', mono: 'PG', detail: true,
      category: 'data', impl: 'real', liveKey: 'cnpg',
      role: 'PostgreSQL 데이터베이스를 운영·관리하는 1차 operator. PgClaim capability의 기반.',
      wiring: '카드를 클릭하면 전용 페이지에서 버전 선택·설치·상태·관리 Cluster 목록을 볼 수 있다.',
    },
    {
      id: 'psmdb', name: 'Percona PSMDB', provider: 'percona.com', version: '', logo: 'percona', mono: 'MDB', detail: true,
      category: 'data', impl: 'stub', liveKey: '',
      role: 'MongoDB 호환 document database 후보. data 모듈의 확장 엔진.',
      wiring: '아직 착수 전 — Claim contract와 operator 채택 결정을 기다린다.',
    },
    {
      id: 'valkey', name: 'Valkey', provider: 'valkey.io', version: '', logo: 'valkey', mono: 'VK', detail: true,
      category: 'data', impl: 'stub', liveKey: '',
      role: 'Redis 대체 cache engine 후보. CacheClaim capability의 기반.',
      wiring: '라이선스 회피 원칙에 따라 Redis 대신 Valkey를 채택한다.',
    },
    {
      id: 'rustfs', name: 'RustFS', provider: 'rustfs.com', version: 'S3', logo: 'rustfs', mono: 'S3', detail: true, module: 'rustfs',
      category: 'data', impl: 'real', liveKey: '',
      role: 'S3 호환 object storage capability. BucketClaim과 정적 자산/백업 대상에 쓰인다.',
      wiring: 'RustFS plugin 화면에서 bucket, endpoint, workload 상태를 관리한다.',
    },
    {
      id: 'opensearch', name: 'OpenSearch', provider: 'opensearch.org', version: '2.17.0', logo: 'opensearch', mono: 'OS', detail: true,
      category: 'data', impl: 'phase1', liveKey: 'opensearch',
      role: '공용 검색·인덱스 capability. manual, OAA retrieval, catalog search, logs, vector/search workload의 기반.',
      wiring: '카드를 클릭하면 FoundationModel/data parameters.engines.opensearch 선언과 endpoint 상태를 관리한다.',
    },
    {
      id: 'litellm', name: 'LiteLLM', provider: 'litellm.ai', version: '', logo: 'litellm', mono: 'LLM', detail: true,
      category: 'ai', impl: 'stub', liveKey: '',
      role: 'LLM provider routing 후보. OAA와 AI Level 추론 경로를 통합한다.',
      wiring: 'OAA Gateway/LLMRoute와 연결할 후속 엔진.',
    },
    {
      id: 'langfuse', name: 'Langfuse', provider: 'langfuse.com', version: '', logo: 'langfuse', mono: 'LF', detail: true,
      category: 'ai', impl: 'stub', liveKey: '',
      role: 'LLM observability 후보. ClickHouse 의존성 결정이 남아 있다.',
      wiring: '추론 trace, prompt, cost 관측 경로로 연결할 예정이다.',
    },
    {
      id: 'embed', name: 'Embed', provider: 'OpenSphere', version: '', logo: '', mono: 'E', detail: true,
      category: 'ai', impl: 'stub', liveKey: '',
      role: '임베딩과 VectorRetrieval substrate 후보.',
      wiring: 'pgvector/OpenSearch 등 retrieval backend와 연결한다.',
    },
    {
      id: 'stalwart', name: 'Stalwart', provider: 'stalw.art', version: 'JMAP', logo: 'stalwart', mono: 'S', detail: true,
      category: 'comm', impl: 'stub', liveKey: '',
      role: '메일/JMAP 엔진 후보. comm 모듈의 메시징 기반.',
      wiring: '아직 착수 전 — domain, mailbox, auth 연동 설계가 필요하다.',
    },
    {
      id: 'novu', name: 'Novu', provider: 'novu.co', version: '', logo: 'novu', mono: 'N', detail: true,
      category: 'comm', impl: 'stub', liveKey: '',
      role: '알림 orchestration 후보. comm 모듈과 AI/운영 알림 연계를 담당한다.',
      wiring: '통합 알림 경로가 확정되면 provider와 template을 관리한다.',
    },
    {
      id: 'mattermost', name: 'Mattermost', provider: 'mattermost.com', version: '', logo: 'mattermost', mono: 'M', detail: true,
      category: 'comm', impl: 'stub', liveKey: '',
      role: '협업/ChatOps 엔진 후보. Workspace perspective의 협업 채널.',
      wiring: '아직 착수 전 — workspace, team, bot integration 경로가 필요하다.',
    },
    {
      id: 'otel', name: 'OpenTelemetry Collector', provider: 'opentelemetry.io (CNCF)', version: 'v0.111.0', logo: 'opentelemetry-non-typo', mono: 'O', detail: true,
      category: 'observability', impl: 'real', liveKey: 'otel',
      role: '각 FSS 모듈이 보내는 지표·로그·추적을 한곳에서 받아 BSS Prometheus/trace backend 쪽으로 넘기는 중앙 수집기.',
      wiring: '카드를 클릭하면 전용 페이지에서 버전 선택·설치·상태를 관리한다.',
    },
    {
      id: 'prometheus', name: 'Prometheus', provider: 'prometheus.io', version: 'BSS 위임', logo: 'prometheus', mono: 'P', detail: true, module: 'bss', tab: 'prometheus',
      category: 'observability', impl: 'real', liveKey: '',
      role: '관측 저장/조회 계층. FS가 소유하지 않고 Basic Service Stack의 host Prometheus에 위임한다.',
      wiring: 'BSS Host 연결 화면에서 Prometheus 상태를 확인한다.',
    },
    {
      id: 'tempo', name: 'Grafana Tempo', provider: 'grafana.com (CNCF)', version: '', logo: 'tempo', mono: 'T', detail: true,
      category: 'observability', impl: 'stub', liveKey: '',
      role: '분산 트레이스 저장·조회 백엔드. OTel Collector가 수집한 추적을 여기로 넘길 계획.',
      wiring: '아직 착수 전 — 로드맵 placeholder에서 범위만 확인한다.',
    },
    {
      id: 'loki', name: 'Grafana Loki', provider: 'grafana.com (CNCF)', version: '', logo: 'loki', mono: 'L', detail: true,
      category: 'observability', impl: 'stub', liveKey: '',
      role: '로그 집계·저장 백엔드. Foundation 모듈들의 로그를 인덱싱할 계획.',
      wiring: '아직 착수 전 — 로드맵 placeholder에서 범위만 확인한다.',
    },
    {
      id: 'grafana-operator', name: 'Grafana Operator', provider: 'grafana.com', version: '', logo: 'grafana', mono: 'G', detail: true,
      category: 'observability', impl: 'stub', liveKey: '',
      role: '메트릭·로그·트레이스 통합 대시보드와 datasource/dashboard 선언 관리를 담당할 후보.',
      wiring: 'Tempo/Loki/Prometheus datasource 구성이 확정되면 operator로 관리한다.',
    },
    {
      id: 'velero', name: 'Velero', provider: 'velero.io', version: '', logo: 'velero', mono: 'V', detail: true, module: 'bss', tab: 'velero',
      category: 'backup', impl: 'real', liveKey: '',
      role: '시스템 운영 백업과 pre-upgrade gate의 기반. 클러스터 범용 DR 도구로 BSS 쪽 상태를 소비한다.',
      wiring: 'BSS Host 연결 화면의 Velero 관리 페이지로 이동한다.',
    },
    {
      id: 'ptm', name: '.ptm', provider: 'OpenSphere', version: '', logo: '', mono: 'PTM', detail: true,
      category: 'backup', impl: 'stub', liveKey: '',
      role: 'backup 모듈의 정책/이력/복구 절차를 보강할 내부 엔진 후보.',
      wiring: 'BackupPolicy/Run/Restore contract와 함께 구체화한다.',
    },
    {
      id: 'crossplane', name: 'Crossplane', provider: 'crossplane.io (CNCF)', version: 'v2.3.3', logo: 'crossplane-non-typo', mono: 'X', detail: true,
      category: 'delivery', impl: 'real', liveKey: 'crossplane',
      role: 'FSS 엔진 후보들을 선언형 API로 설치·관리하는 HYBRID-WRAP delivery 엔진.',
      wiring: '카드를 클릭하면 provider·관리 중인 Release 목록을 볼 수 있다.',
    },
  ];
}
