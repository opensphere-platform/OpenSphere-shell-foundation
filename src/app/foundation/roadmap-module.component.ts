import { CommonModule } from '@angular/common';
import { Component, Input, computed, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent, pfsPluginTabs } from '../shared/plugin-page-shell.component';
import { ViewRouter } from '../view-router';
import { EnginesService } from './engines.service';

export interface RoadmapModuleInput {
  id: string;
  name: string;
  provider: string;
  version: string;
  logo: string;
  mono: string;
  category: string;
  role: string;
  wiring: string;
  liveKey: string;
}

interface RoadmapDefinition {
  namespace: string;
  profile: string;
  docs: string;
  prerequisites: string[];
  components: string[];
  consumers: string[];
  protection: string[];
  gates: string[];
}

const LOGO_BASE = 'https://logos.opl.io.kr/i';
const FOUNDATION_NAMESPACE = 'opensphere-foundation';
const DEFAULT: RoadmapDefinition = {
  namespace: FOUNDATION_NAMESPACE, profile: 'managed', docs: '',
  prerequisites: ['서명된 OpenSphere BOM', 'Foundation Control Plane Ready', '필요 capability Claim Ready'],
  components: ['Foundation reconciler', '관리 대상 workload', 'ClusterIP 소비 endpoint', 'NetworkPolicy와 SecretRef'],
  consumers: ['FoundationClaim', 'FoundationBinding endpointRef', 'FoundationBinding secretRef'],
  protection: ['영구 데이터 식별', '백업·복구 계약', '업그레이드 전 검증'],
  gates: ['버전·이미지 digest 고정', 'Claim/Binding reconciler', 'RBAC·NetworkPolicy', '상태·회수 계약'],
};

const DEFINITIONS: Record<string, Partial<RoadmapDefinition>> = {
  syncope: {
    namespace: FOUNDATION_NAMESPACE, profile: 'IGA', docs: 'https://syncope.apache.org/docs/',
    prerequisites: ['PostgreSQL capability', 'Keycloak OIDC', 'Samba/LDAP directory', 'SCIM 2.0 권위 결정'],
    components: ['Apache Syncope core', 'Syncope console/API', 'LDAP connector', 'SCIM 2.0 endpoint'],
    consumers: ['IdentityGovernanceClaim', 'SCIM endpoint Binding', '승인 workflow API'],
    protection: ['정체성 변경 영구 감사', 'Connector 자격 Secret', '정책·승인 데이터 백업'],
  },
  opa: {
    namespace: FOUNDATION_NAMESPACE, profile: 'authorization', docs: 'https://www.openpolicyagent.org/docs/',
    prerequisites: ['정책 bundle 저장소', '결정 로그 영구 감사', 'Console RBAC mapping'],
    components: ['OPA server', 'Bundle fetcher', 'Decision log exporter', 'Admission 연계 adapter'],
    consumers: ['PolicyDecisionClaim', 'REST decision endpoint', 'Bundle revision Binding'],
    protection: ['정책 bundle 서명', '결정 로그 보존', 'fail-open 금지'],
  },
  litellm: {
    namespace: FOUNDATION_NAMESPACE, profile: 'model-gateway', docs: 'https://docs.litellm.ai/',
    prerequisites: ['Provider credential Secret', 'PostgreSQL capability', 'OpenSearch vector capability', 'OAA Gateway 계약'],
    components: ['LiteLLM proxy', 'Provider registry', 'Budget/rate policy', 'Embedding route adapter'],
    consumers: ['FoundationClaim/Route', 'FoundationClaim/Access', 'endpointRef·secretRef Binding'],
    protection: ['Provider 키 화면 노출 금지', '요청/비용 감사', '모델별 rate limit'],
  },
  langfuse: {
    namespace: FOUNDATION_NAMESPACE, profile: 'llm-observability', docs: 'https://langfuse.com/docs',
    prerequisites: ['PostgreSQL capability', 'ClickHouse runtime', 'Valkey capability', 'S3 capability'],
    components: ['Langfuse web', 'Worker', 'PostgreSQL metadata', 'ClickHouse trace store'],
    consumers: ['FoundationClaim/Project', 'FoundationClaim/Access', 'endpointRef·secretRef Binding'],
    protection: ['Prompt/response 민감정보 마스킹', 'trace 보존기간', 'S3 export/restore'],
  },
  stalwart: {
    namespace: FOUNDATION_NAMESPACE, profile: 'mail-jmap', docs: 'https://stalw.art/docs/',
    prerequisites: ['DNS/MX 운영권', 'TLS certificate', 'S3 또는 영구 스토리지', 'Identity federation'],
    components: ['Stalwart mail server', 'JMAP endpoint', 'SMTP ingress/relay', 'DKIM/DMARC policy'],
    consumers: ['FoundationClaim/MailDomain', 'FoundationClaim/Mailbox', 'FoundationClaim/Access'],
    protection: ['메일 데이터 암호화', 'DKIM 키 Secret', '보존·eDiscovery 정책'],
  },
  novu: {
    namespace: FOUNDATION_NAMESPACE, profile: 'notification', docs: 'https://docs.novu.co/',
    prerequisites: ['PSMDB capability', 'Valkey capability', 'Provider credential Secret', 'OIDC'],
    components: ['Novu API', 'Worker', 'Web dashboard', 'Provider adapters'],
    consumers: ['FoundationClaim/Workflow', 'FoundationClaim/Access', 'Subscriber endpoint Binding'],
    protection: ['Provider 자격 회전', 'Template revision', 'delivery 감사·보존'],
  },
  mattermost: {
    namespace: FOUNDATION_NAMESPACE, profile: 'collaboration', docs: 'https://docs.mattermost.com/',
    prerequisites: ['PostgreSQL capability', 'S3 capability', 'OIDC', 'Ingress 정책'],
    components: ['Mattermost server', 'WebSocket endpoint', 'Plugin runtime', 'Object storage binding'],
    consumers: ['FoundationClaim/Workspace', 'FoundationClaim/Access', 'Webhook endpoint Binding'],
    protection: ['메시지 보존', '파일 백업', '외부 공개 OIDC+TLS'],
  },
  tempo: {
    namespace: FOUNDATION_NAMESPACE, profile: 'trace-store', docs: 'https://grafana.com/docs/tempo/latest/',
    prerequisites: ['OpenTelemetry Collector', 'S3 capability', 'HIS Shared Observability 연계'],
    components: ['Tempo distributor', 'Ingester', 'Querier', 'Compactor'],
    consumers: ['FoundationClaim/Tenant', 'FoundationClaim/Access', 'OTLP·query endpoint Binding'],
    protection: ['trace 보존기간', 'tenant 격리', 'S3 lifecycle'],
  },
  loki: {
    namespace: FOUNDATION_NAMESPACE, profile: 'log-store', docs: 'https://grafana.com/docs/loki/latest/',
    prerequisites: ['OpenTelemetry Collector', 'S3 capability', '로그 민감정보 정책'],
    components: ['Loki distributor', 'Ingester', 'Querier', 'Compactor'],
    consumers: ['FoundationClaim/Tenant', 'FoundationClaim/Access', 'OTLP·query endpoint Binding'],
    protection: ['로그 보존기간', 'tenant 격리', 'PII 마스킹'],
  },
  'grafana-operator': {
    namespace: FOUNDATION_NAMESPACE, profile: 'visualization', docs: 'https://grafana.github.io/grafana-operator/docs/',
    prerequisites: ['HIS Prometheus', 'Tempo/Loki datasource', 'OIDC', 'Ingress 정책'],
    components: ['Grafana Operator', 'Grafana instance', 'Datasource CR', 'Dashboard CR'],
    consumers: ['FoundationClaim/Instance', 'FoundationClaim/Dashboard', 'FoundationClaim/DataSource·Access'],
    protection: ['관리자 자격 Secret', 'dashboard GitOps', '외부 공개 TLS+OIDC'],
  },
  ptm: {
    namespace: FOUNDATION_NAMESPACE, profile: 'protection', docs: '',
    prerequisites: ['S3 capability', 'CSI snapshot capability', '영구 감사', '복구 승인 정책'],
    components: ['BackupPolicy controller', 'BackupRun reconciler', 'Restore workflow', '검증 job'],
    consumers: ['FoundationClaim/Policy', 'FoundationClaim/Run', 'FoundationClaim/Restore'],
    protection: ['불변 백업', '복구 리허설', 'RPO/RTO 증거'],
  },
  argocd: {
    namespace: 'argocd', profile: 'gitops', docs: 'https://argo-cd.readthedocs.io/',
    prerequisites: ['Git repository credential', 'OIDC', 'ApplicationSet 정책', '서명된 desired state'],
    components: ['Argo CD API/server', 'Application controller', 'Repo server', 'ApplicationSet controller'],
    consumers: ['ApplicationClaim', 'GitRepositoryBinding', 'SyncPolicy'],
    protection: ['Git commit 감사', 'sync 승인', 'credential Secret 회전'],
  },
};

@Component({
  selector: 'app-roadmap-module',
  standalone: true,
  imports: [CommonModule, ClarityModule, PluginPageHeaderComponent, PluginTabsComponent],
  template: `
    <button class="btn btn-sm btn-link rm-back" type="button" (click)="back()">← PFS 모듈</button>
    <section class="pgp-page-frame" [attr.aria-label]="module.name + ' plugin 개요와 메뉴'">
      <osp-plugin-page-header [model]="headerModel()" [headingId]="module.id + '-plugin-title'" />
      <osp-plugin-tabs [tabs]="tabs" [active]="active()" [ariaLabel]="module.name + ' 관리 메뉴'" (selected)="select($event)" />
    </section>

    <clr-alert [clrAlertType]="runtimeAlertType()" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text"><b>Operator 관리 표면</b> — Foundation Control Plane이 서명 BOM, 의존성 Claim, workload와 소비자 Binding을 하나의 수명주기로 조정합니다. <span class="label" [ngClass]="runtimePill()">{{runtimeLabel()}}</span></span></clr-alert-item>
    </clr-alert>

    <ng-container *ngIf="active()==='overview'">
      <section class="pgp-steps" [attr.aria-label]="module.name + ' 구현 단계'">
        <button type="button" class="pgp-step current" (click)="select('operator')"><span class="pgp-step-n">1</span><span><b>Operator 계약</b><small>서명 BOM과 Control Plane 소유권</small></span></button>
        <button type="button" class="pgp-step" (click)="select('cluster')"><span class="pgp-step-n">2</span><span><b>의존성 조정</b><small>버전·digest·리소스·보호 정책</small></span></button>
        <button type="button" class="pgp-step" (click)="select('claims')"><span class="pgp-step-n">3</span><span><b>소비 계약</b><small>Claim → Binding → endpoint·SecretRef</small></span></button>
      </section>
    <section class="pgp-dashboard">
      <article class="pgp-panel"><h2>Capability</h2><p>{{module.role}}</p><dl><dt>연결</dt><dd>{{module.wiring}}</dd><dt>소유 섹터</dt><dd>{{module.category}}</dd><dt>관리 수준</dt><dd>PostgreSQL surface v1</dd></dl></article>
      <article class="pgp-panel"><h2>구현 계약</h2><ol class="rm-list"><li *ngFor="let gate of def().gates">{{gate}}</li></ol><span class="label label-success">reconciler 배선됨</span></article>
      <article class="pgp-panel"><h2>운영 경로</h2><p>플랫폼 릴리스가 Operator를 공급하고 FoundationModel과 FoundationClaim이 operand 및 소비자 연결을 선언합니다.</p><button class="btn btn-sm btn-primary" type="button" (click)="select('claims')">소비 계약 확인</button></article>
    </section>
    </ng-container>

    <section class="rm-work" *ngIf="active()==='operator'">
      <h2>Operator</h2><p class="os-sub">플랫폼 릴리스와 Foundation reconciler가 소유하는 실행 기반입니다.</p>
      <table class="table"><thead><tr><th>요구조건</th><th>계약 상태</th><th>근거</th></tr></thead><tbody><tr *ngFor="let item of def().prerequisites"><td>{{item}}</td><td><span class="label label-success">배선됨</span></td><td>Platform Release · Foundation Control Plane</td></tr></tbody></table>
    </section>

    <section class="rm-work" *ngIf="active()==='cluster'">
      <h2>Release & dependency plan</h2>
      <div class="rm-form"><label><span>Channel</span><select disabled><option>edge · exact digest</option></select></label><label><span>Profile</span><input [value]="def().profile" disabled /></label><label><span>Namespace</span><input [value]="def().namespace" disabled /></label></div>
      <clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Operator 설치·업데이트는 Platform Release가, operand 설정과 의존성 Claim은 FoundationModel이 소유합니다. 이 페이지는 별도의 우회 설치 경로를 만들지 않습니다.</span></clr-alert-item></clr-alert>
    </section>

    <section class="rm-work" *ngIf="active()==='topology'">
      <h2>Topology & workloads</h2><div class="rm-topology"><article *ngFor="let item of def().components"><span class="rm-node">{{item}}</span><span class="label label-success">Managed</span></article></div>
    </section>

    <section class="rm-work" *ngIf="active()==='config'">
      <h2>Configuration</h2><p>버전과 이미지 digest는 플랫폼 릴리스에, 서비스 파라미터는 FoundationModel에 고정합니다.</p><dl class="os-kv"><dt>Channel</dt><dd>edge · exact digest</dd><dt>Profile</dt><dd>{{def().profile}}</dd><dt>Namespace</dt><dd class="os-mono">{{def().namespace}}</dd><dt>Apply owner</dt><dd>Foundation Control Plane</dd></dl><button class="btn btn-primary" type="button" (click)="select('cluster')">Release & dependency 확인</button>
    </section>

    <section class="rm-work" *ngIf="active()==='domain'">
      <h2>{{domainLabel()}}</h2><table class="table"><thead><tr><th>영역</th><th>계약</th><th>소유 주체</th></tr></thead><tbody><tr *ngFor="let item of def().components"><td>{{item}}</td><td><span class="label label-success">Managed</span></td><td>Foundation Control Plane · {{module.name}}</td></tr></tbody></table>
    </section>

    <section class="rm-work" *ngIf="active()==='backups'">
      <h2>Backups</h2><div class="rm-grid"><article class="rm-panel" *ngFor="let item of def().protection"><h3>{{item}}</h3><p>정책·SecretRef·상태 증거를 OpenSphere Backup 계약과 각 엔진의 보호 방식에 연결합니다.</p></article></div>
    </section>

    <section class="rm-work" *ngIf="active()==='events'">
      <h2>Events</h2><div class="rm-empty"><b>최근 경고 이벤트 없음</b><span>Kubernetes Event와 FoundationClaim condition은 Operator 및 Foundation Control Plane의 동일한 대상 상태를 기준으로 합니다.</span></div>
    </section>

    <section class="rm-work" *ngIf="active()==='upgrade'">
      <h2>Upgrade & rollback</h2><table class="table"><thead><tr><th>Channel</th><th>용도</th><th>승격 조건</th></tr></thead><tbody><tr><td>stable</td><td>운영</td><td>감사 통과·rollback 증거</td></tr><tr><td>candidate</td><td>승격 검증</td><td>E2E·호환성·보안 검사</td></tr><tr><td>edge</td><td>개발</td><td>기능 검증 전용</td></tr></tbody></table>
    </section>

    <section class="rm-work" *ngIf="active()==='claims'">
      <h2>Claims</h2><table class="table"><thead><tr><th>계약</th><th>지원 상태</th><th>발급 주체</th></tr></thead><tbody><tr *ngFor="let item of def().consumers"><td>{{item}}</td><td><span class="label label-success">지원</span></td><td>Foundation Control Plane</td></tr></tbody></table>
    </section>

    <section class="rm-work" *ngIf="active()==='documentation'">
      <h2>Documentation</h2><p>plugin 한글 안내서는 Foundation package 활성화 시 Console Manual Registry와 통합 검색에 자동 등록됩니다. 제품 공식 문서는 구현 세부의 1차 자료로 사용합니다.</p><dl class="os-kv"><dt>문서 ID</dt><dd class="os-mono">plugin:foundation/{{manualId()}}</dd><dt>상태</dt><dd><span class="label label-success">Operator 계약 반영</span></dd></dl><a class="btn btn-sm btn-primary" [href]="manualUrl()">한글 안내서 열기</a><a *ngIf="def().docs" class="btn btn-sm" [href]="def().docs" target="_blank" rel="noreferrer">공식 문서 열기</a><span *ngIf="!def().docs" class="label label-warning">공식 문서 연결 검토 필요</span>
    </section>
  `,
})
export class RoadmapModuleComponent {
  @Input({ required: true }) module!: RoadmapModuleInput;
  readonly vr = inject(ViewRouter);
  readonly engines = inject(EnginesService);
  get tabs(): PluginPageTab[] { return pfsPluginTabs(this.domainLabel()); }
  readonly active = computed(() => this.vr.module() === 'delivery' ? this.vr.detail() : this.vr.tab());
  readonly def = computed<RoadmapDefinition>(() => ({ ...DEFAULT, ...(DEFINITIONS[this.module.id] ?? {}) }));

  headerModel(): PluginPageHeaderModel {
    const runtime = this.runtimeLabel();
    return {
      name: this.module.name,
      logo: this.module.logo ? `${LOGO_BASE}/${this.module.logo}` : `${LOGO_BASE}/opensphere`,
      capability: this.module.category,
      description: this.module.role,
      lifecycle: runtime, lifecycleClass: this.runtimePill(),
      version: this.module.version || 'release BOM', profile: this.def().profile, namespace: this.def().namespace,
    };
  }
  runtimeLabel(): string {
    const state = this.engines.liveState(this.module.liveKey);
    return ({ loading: '확인 중', ok: 'Ready', empty: 'Ready', nocrd: '미배치', noperm: '권한 없음', error: '조회 실패' })[state];
  }
  runtimePill(): string {
    const state = this.engines.liveState(this.module.liveKey);
    if (state === 'ok' || state === 'empty') { return 'label-success'; }
    if (state === 'loading') { return 'label-info'; }
    if (state === 'nocrd') { return 'label-warning'; }
    return 'label-danger';
  }
  runtimeAlertType(): 'success' | 'info' | 'warning' | 'danger' {
    const state = this.engines.liveState(this.module.liveKey);
    if (state === 'ok' || state === 'empty') { return 'success'; }
    if (state === 'loading') { return 'info'; }
    if (state === 'nocrd') { return 'warning'; }
    return 'danger';
  }
  select(tab: string): void {
    if (this.vr.module() === 'delivery') { this.vr.setDetail(tab); return; }
    this.vr.setTab(tab);
  }
  back(): void {
    if (this.vr.module() === 'delivery') { this.vr.setTab('overview'); return; }
    this.vr.setModule('modules');
  }
  manualId(): string { return `${this.module.id}-operations-ko`; }
  manualUrl(): string { return `/manual?doc=${encodeURIComponent(`plugin:foundation/${this.manualId()}`)}`; }
  domainLabel(): string {
    return ({
      syncope:'Users & Workflows', opa:'Policies & Decisions', litellm:'Models & Routes', langfuse:'Traces & Prompts',
      stalwart:'Domains & Mailboxes', novu:'Workflows & Templates', mattermost:'Workspaces & Channels',
      tempo:'Traces & Tenants', loki:'Logs & Tenants', 'grafana-operator':'Dashboards & Datasources',
      ptm:'Policies & Restore Points', argocd:'Applications & Projects',
    } as Record<string,string>)[this.module.id] || 'Resources & Access';
  }
}
