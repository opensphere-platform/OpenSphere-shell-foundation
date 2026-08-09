import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { EnginesService } from './engines.service';
import { ViewRouter } from '../view-router';
import { OtelComponent } from './otel/otel.component';
import { OpaComponent } from '../modules/identity/opa.component';
import { SyncopeComponent } from '../modules/identity/syncope.component';
import { RoadmapModuleComponent } from './roadmap-module.component';
import { PluginPageHeaderComponent, PluginPageHeaderModel } from '../shared/plugin-page-shell.component';

const REAL_DETAIL_TABS = new Set(['otel', 'opa', 'syncope']);
const OPERATOR_DETAIL_TABS = new Set([
  'litellm', 'langfuse',
  'stalwart', 'novu', 'mattermost',
  'tempo', 'loki', 'grafana-operator',
  'ptm',
]);
const DETAIL_TABS = new Set([...REAL_DETAIL_TABS, ...OPERATOR_DETAIL_TABS]);

type Impl = 'real';
const IMPL_LABEL: Record<Impl, string> = { real: '배선됨' };
const IMPL_PILL: Record<Impl, string> = { real: 'label-success' };

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

const LOGO_BASE = 'https://logos.opl.io.kr/i';

// PFS 모듈 카탈로그 — CONSTITUTION-0004 §2.0.4의 6개 capability별 운영 엔진을 배치한다.
// identity/data/ai/comm/observability/backup만 PFS capability로 관리한다. Delivery는 별도 Platform Delivery 화면이 소유한다.
@Component({
  selector: 'app-foundation-engines',
  standalone: true,
  imports: [CommonModule, ClarityModule, OtelComponent, OpaComponent, SyncopeComponent, RoadmapModuleComponent, PluginPageHeaderComponent],
  template: `
    <app-otel *ngIf="currentId() === 'otel'"></app-otel>
    <app-opa *ngIf="currentId() === 'opa'"></app-opa>
    <app-syncope *ngIf="currentId() === 'syncope'"></app-syncope>
    <app-roadmap-module *ngIf="operatorCard() as pc" [module]="pc"></app-roadmap-module>

    <ng-container *ngIf="vr.module() === 'modules' && vr.tab() === 'overview'">
    <osp-plugin-page-header [model]="catalogHeader" headingId="pfs-module-catalog-title" />
    <section class="stack-inline">
      <div>
        <span class="stack-kicker">Concept</span>
        <strong>Foundation capability 구현 엔진</strong>
        <p>PFS의 6개 capability를 category로 두고, 각 capability를 구현하는 독립 extension을 관리한다.</p>
      </div>
      <div class="stack-members">
        <span *ngFor="let m of pfsMembers" class="stack-chip">{{ m }}</span>
      </div>
    </section>
    <p class="os-sub">
      Platform Foundation Service Stack의 정본 모듈은 identity·data·ai·comm·observability·backup이다.
      HIS add-on은 이 화면에 포함하지 않으며 Cluster Manager의 HIS 단일 관리 화면에서만 운영한다.
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
  readonly pfsMembers = ['identity', 'data', 'ai', 'comm', 'observability', 'backup'];
  readonly catalogHeader: PluginPageHeaderModel = {
    name: 'PFS Modules', logo: '', monogram: 'PFS', capability: 'platform.foundation',
    description: '6개 Foundation capability를 동일한 lifecycle·보안·소비 계약으로 관리합니다.',
    lifecycle: 'Managed Catalog', lifecycleClass: 'label-info', version: 'surface v1',
    profile: 'all sectors', namespace: 'opensphere-foundation',
  };
  readonly sections: EngineSection[] = [
    { id: 'identity', title: 'Identity / Access', summary: '사원·고객 신원, 디렉터리, 정책, SCIM 동기화 계층.' },
    { id: 'data', title: 'Data Plane', summary: 'PostgreSQL, object storage, cache, document DB, 검색 인덱스 등 데이터 capability.' },
    { id: 'ai', title: 'AI / Retrieval', summary: 'LLM 라우팅, 추론 관측, embedding route와 OpenSearch 기반 vector retrieval substrate.' },
    { id: 'comm', title: 'Communication', summary: '메일, 알림, 협업, ChatOps로 이어지는 커뮤니케이션 백본.' },
    { id: 'observability', title: 'Observability', summary: 'PFS workload의 telemetry 계약, 수집, 상관관계와 domain 관측 lifecycle.' },
    { id: 'backup', title: 'Backup / Restore', summary: 'PFS 데이터 보호 정책, 백업 이력과 검증된 복구 lifecycle.' },
  ];

  ngOnInit(): void { this.svc.start(); }

  open(c: EngineCard): void {
    if (c.module) { this.vr.setModule(c.module); }
    else { this.vr.setModule(c.id); }
    if (c.tab) { this.vr.setTab(c.tab); }
  }
  currentId(): string { return this.vr.module(); }
  isDetailTab(): boolean { return DETAIL_TABS.has(this.currentId()); }
  operatorCard(): EngineCard | undefined {
    const id = this.currentId();
    return OPERATOR_DETAIL_TABS.has(id) ? this.cards.find((c) => c.id === id) : undefined;
  }
  cardsFor(category: string): EngineCard[] { return this.cards.filter((c) => c.category === category); }
  logoUrl(name: string): string { return `${LOGO_BASE}/${name}`; }
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
    return { loading: '확인 중…', ok: 'Live', empty: 'Live', nocrd: '미배치', noperm: '권한 없음', error: '조회 실패' }[s];
  }

  readonly cards: EngineCard[] = [
    {
      id: 'keycloak', name: 'Keycloak', provider: 'keycloak.org', version: '26.x', logo: 'keycloak', mono: 'KC', detail: true, module: 'keycloak',
      category: 'identity', impl: 'real', liveKey: 'keycloak',
      role: '사원 workforce realm과 OIDC provider. customer realm은 별도 결정 항목으로 남아 있다.',
      wiring: 'Keycloak plugin 화면에서 realm, workload, federation 상태를 관리한다.',
    },
    {
      id: 'syncope', name: 'Apache Syncope', provider: 'syncope.apache.org', version: '4.0.7', logo: 'apache-2', mono: 'SY', detail: true,
      category: 'identity', impl: 'real', liveKey: 'syncope',
      role: 'IGA 단일 권위. 별도 SCIM gateway 권위를 두지 않고 Syncope 중심의 SCIM 2.0 endpoint/connector로 수렴한다.',
      wiring: 'FoundationModel/identity가 HA Core, CNPG DB/Role, TLS, ServiceMonitor와 감사 관측을 선언형으로 관리한다.',
    },
    {
      id: 'samba', name: 'Directory Providers', provider: 'managed or external', version: 'AD / LDAP', logo: 'samba-server', mono: 'AD', detail: true, module: 'directory',
      category: 'identity', impl: 'real', liveKey: 'samba',
      role: '사원 디렉터리 capability. Keycloak이 LDAP federation으로 연결한다.',
      wiring: 'Samba-AD plugin 화면에서 domain, LDAP, workload 상태를 관리한다.',
    },
    {
      id: 'opa', name: 'OPA', provider: 'openpolicyagent.org', version: '', logo: 'opa', mono: 'OPA', detail: true,
      category: 'identity', impl: 'real', liveKey: 'opa',
      role: 'Rego 정책 결정점. fail-closed 평가, 정책 공급망과 decision telemetry 경계를 관리한다.',
      wiring: 'FoundationModel/identity가 OPA, ServiceMonitor, 제한된 evaluation API를 선언형으로 관리한다.',
    },
    {
      id: 'postgres', name: 'PostgreSQL', provider: 'StackGres 1.19 managed plugin', version: 'PG 18', logo: 'postgresql', mono: 'PG', detail: true, module: 'postgres',
      category: 'data', impl: 'real', liveKey: 'postgres',
      role: '관계형 데이터베이스 capability. StackGres operator가 전용 SGCluster 수명주기를 운영·관리한다.',
      wiring: '한 plugin에서 Operator 준비 → Cluster 생성 → 토폴로지·DB·백업·이벤트 운영을 이어서 관리한다.',
    },
    {
      id: 'psmdb', name: 'Percona PSMDB', provider: 'percona.com', version: '8.0', logo: 'percona', mono: 'MDB', detail: true, module: 'psmdb',
      category: 'data', impl: 'real', liveKey: 'psmdb',
      role: 'MongoDB 호환 document database capability. Percona Operator 기반 확장 엔진.',
      wiring: 'Operator 준비 → ReplicaSet 생성 → 토폴로지·스토리지·보안 정책·이벤트를 한 plugin에서 관리한다.',
    },
    {
      id: 'valkey', name: 'Valkey', provider: 'valkey.io', version: '9.1', logo: 'valkey', mono: 'VK', detail: true, module: 'valkey',
      category: 'data', impl: 'real', liveKey: 'valkey',
      role: 'Redis 호환 cache capability. CacheClaim 계약의 기반.',
      wiring: '라이선스 회피 원칙에 따라 Redis 대신 Valkey를 채택하고 AOF·인증·PVC·소비 계약을 관리한다.',
    },
    {
      id: 'rustfs', name: 'RustFS', provider: 'rustfs.com', version: '1.0 beta', logo: 'rustfs', mono: 'S3', detail: true, module: 'rustfs',
      category: 'data', impl: 'real', liveKey: 'rustfs',
      role: 'S3 호환 object storage capability. BucketClaim과 정적 자산/백업 대상에 쓰인다.',
      wiring: 'RustFS plugin 화면에서 bucket, endpoint, workload 상태를 관리한다.',
    },
    {
      id: 'opensearch', name: 'OpenSearch', provider: 'opensearch.org', version: '3.7.0', logo: 'opensearch', mono: 'OS', detail: true, module: 'opensearch',
      category: 'data', impl: 'real', liveKey: 'opensearch',
      role: '공용 검색·인덱스 capability. manual, OAA retrieval, catalog search, logs, vector/search workload의 기반.',
      wiring: '버전·heap·스토리지 계획과 노드·PVC·이벤트·소비 계약을 한 plugin에서 관리한다.',
    },
    {
      id: 'litellm', name: 'LiteLLM', provider: 'litellm.ai', version: '1.93.0', logo: 'litlellm', mono: 'LLM', detail: true,
      category: 'ai', impl: 'real', liveKey: 'litellm',
      role: 'LLM provider routing capability. 모델 route, provider credential, budget와 접근권을 선언형으로 관리한다.',
      wiring: 'FoundationClaim Route/Access를 전용 endpoint·credential Binding으로 조정하고 PostgreSQL capability를 내부 상태 저장소로 사용한다.',
    },
    {
      id: 'langfuse', name: 'Langfuse', provider: 'langfuse.com', version: '3.221.1', logo: 'langfuse', mono: 'LF', detail: true,
      category: 'ai', impl: 'real', liveKey: 'langfuse',
      role: 'LLM trace·prompt·cost 관측 capability. 프로젝트와 접근권을 소비 계약으로 발급한다.',
      wiring: 'Web/worker와 전용 PostgreSQL·ClickHouse·Valkey·RustFS 의존성을 Foundation Control Plane이 함께 조정한다.',
    },
    {
      id: 'stalwart', name: 'Stalwart', provider: 'stalw.art', version: '0.16.13', logo: 'stalwart', mono: 'S', detail: true,
      category: 'comm', impl: 'real', liveKey: 'stalwart',
      role: 'SMTP·IMAP·JMAP 메일 capability. 도메인, 사서함과 제한된 접근권을 선언형으로 관리한다.',
      wiring: 'MailDomain/Mailbox Claim을 Stalwart 관리 API에 조정하고 자격은 SecretRef로만 전달한다.',
    },
    {
      id: 'novu', name: 'Novu', provider: 'novu.co', version: '3.18.0', logo: 'novu', mono: 'N', detail: true,
      category: 'comm', impl: 'real', liveKey: 'novu',
      role: '다중 채널 알림 orchestration capability. workflow와 소비자 접근권을 관리한다.',
      wiring: 'API·worker·websocket·dashboard와 PSMDB·Valkey 의존성을 함께 배치하고 Workflow/Access Claim을 조정한다.',
    },
    {
      id: 'mattermost', name: 'Mattermost', provider: 'mattermost.com', version: '11.9.0', logo: 'mattermost?variant=icon', mono: 'M', detail: true,
      category: 'comm', impl: 'real', liveKey: 'mattermost',
      role: '협업·ChatOps capability. workspace와 scoped access를 소비 계약으로 제공한다.',
      wiring: '전용 PostgreSQL과 RustFS bucket/access 의존성을 조정하고 Workspace/Access Claim을 실제 team·token에 연결한다.',
    },
    {
      id: 'otel', name: 'OpenTelemetry Collector', provider: 'opentelemetry.io (CNCF)', version: 'v0.111.0', logo: 'opentelemetry-non-typo', mono: 'O', detail: true,
      category: 'observability', impl: 'real', liveKey: 'otel',
      role: '각 PFS 모듈이 보내는 지표·로그·추적을 받아 승인된 HIS/PFS 관측 backend로 전달하는 중앙 수집기.',
      wiring: '카드를 클릭하면 전용 페이지에서 버전 선택·설치·상태를 관리한다.',
    },
    {
      id: 'tempo', name: 'Grafana Tempo', provider: 'grafana.com (CNCF)', version: '3.0.2', logo: 'grafana', mono: 'T', detail: true,
      category: 'observability', impl: 'real', liveKey: 'tempo',
      role: '분산 trace 저장·조회 capability. tenant 단위 OTLP ingest와 query 경계를 제공한다.',
      wiring: 'OTel Collector가 인증 gateway를 통해 tenant별 trace를 전달하고 Tenant/Access Claim이 scoped credential을 발급한다.',
    },
    {
      id: 'loki', name: 'Grafana Loki', provider: 'grafana.com (CNCF)', version: '3.7.3', logo: 'grafana', mono: 'L', detail: true,
      category: 'observability', impl: 'real', liveKey: 'loki',
      role: '로그 집계·조회 capability. tenant별 ingest와 query 경계를 제공한다.',
      wiring: 'OTel Collector와 인증 gateway를 연결하고 Tenant/Access Claim으로 tenant header와 자격을 제한한다.',
    },
    {
      id: 'grafana-operator', name: 'Grafana Operator', provider: 'grafana.com', version: '5.24.0', logo: 'grafana', mono: 'G', detail: true,
      category: 'observability', impl: 'real', liveKey: 'grafana',
      role: '메트릭·로그·trace 통합 시각화 capability. instance·datasource·dashboard와 접근권을 CR로 관리한다.',
      wiring: '공식 Grafana Operator CR과 Foundation Claim을 연결해 Prometheus·Tempo·Loki datasource와 dashboard를 선언형으로 조정한다.',
    },
    {
      id: 'ptm', name: 'OpenSphere Backup', provider: 'OpenSphere', version: 'operator v1', logo: 'velero', mono: 'B', detail: true,
      category: 'backup', impl: 'real', liveKey: 'backup',
      role: 'PFS 데이터 보호 capability. 백업 정책·실행·복구 요청과 외부 저장소 binding을 관리한다.',
      wiring: 'BackupPolicy/Run/Restore Claim을 Velero와 External Channel 대상에 조정하며 검증·보존·복구 상태를 Binding으로 반환한다.',
    },
  ];
}
