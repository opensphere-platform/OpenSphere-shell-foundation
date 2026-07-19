import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import { CarbonIcon } from '../../carbon-icon';
import { apiBase, hostFetch } from '../../api-base';
import { CnpgOperatorService } from '../../foundation/cnpgoperator/cnpgoperator.service';
import { FoundationRegistryService, PostgresInstallParameters } from '../../registry/foundation-registry.service';
import { ViewRouter } from '../../view-router';
import { CnpgService } from './cnpg.service';
import { PILL } from './cnpg.types';
import { PgOverviewTab } from './tabs/pg-overview.tab';
import { PgTopologyTab } from './tabs/pg-topology.tab';
import { PgConfigTab } from './tabs/pg-config.tab';
import { PgDatabasesTab } from './tabs/pg-databases.tab';
import { PgBackupsTab } from './tabs/pg-backups.tab';
import { PgEventsTab } from './tabs/pg-events.tab';
import { PgClaimsTab } from './tabs/pg-claims.tab';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';
import Download16 from '@carbon/icons/es/download/16';
import WarningAlt16 from '@carbon/icons/es/warning--alt/16';
import { PluginPageHeaderComponent, PluginPageHeaderModel, PluginPageTab, PluginTabsComponent } from '../../shared/plugin-page-shell.component';

type PackageTab = 'overview' | 'operator' | 'cluster' | 'topology' | 'config' | 'databases' | 'backups' | 'events' | 'claims' | 'upgrade' | 'documentation';
type Profile = 'development' | 'production' | 'custom';

interface StorageClassRow {
  name: string;
  provisioner: string;
  isDefault: boolean;
  allowExpansion: boolean;
  reclaimPolicy: string;
}

interface PgForm extends PostgresInstallParameters { profile: Profile }

const LOGO = 'https://logos.opl.io.kr/i/postgresql';
const MANUAL_SOURCE_ID = 'plugin:foundation/postgresql-operations-ko';
const VERSION_OPTIONS = [
  { value: '19beta2-standard-trixie', label: 'PostgreSQL 19 beta2 · standard-trixie' },
];

const DEFAULT_FORM: PgForm = {
  profile: 'development',
  instances: 1,
  imageTag: '19beta2-standard-trixie',
  namespace: 'opensphere-foundation',
  storageClass: 'standard',
  storageSize: '10Gi',
  walStorageSize: '',
  resourceProfile: 'small',
  cpuRequest: '250m',
  memoryRequest: '512Mi',
  cpuLimit: '1',
  memoryLimit: '1Gi',
  poolerEnabled: false,
  poolerMode: 'transaction',
  poolerInstances: 1,
  enableSuperuserAccess: false,
  monitoring: true,
  extensions: ['vector'],
  backup: { enabled: false, s3Endpoint: '', destinationPath: '', secretName: '', retentionPolicy: '30d' },
};

@Component({
  selector: 'app-postgres-plugin',
  standalone: true,
  styles: [':host { display: block; min-width: 0; }'],
  imports: [
    CommonModule, FormsModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent, PluginTabsComponent,
    PgOverviewTab, PgTopologyTab, PgConfigTab, PgDatabasesTab, PgBackupsTab, PgEventsTab, PgClaimsTab,
  ],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> PFS 모듈
    </a>

    <section class="pgp-page-frame" aria-label="PostgreSQL plugin 개요와 메뉴">
      <osp-plugin-page-header [model]="headerModel()" headingId="postgres-plugin-title" />
      <osp-plugin-tabs [tabs]="tabsForUi()" [active]="tab()" ariaLabel="PostgreSQL plugin 메뉴" (selected)="openTab($event)" />
    </section>

    <ng-container *ngIf="tab() === 'overview'">
      <section class="pgp-steps" aria-label="PostgreSQL plugin 설치 단계">
        <button type="button" class="pgp-step" [class.done]="op.ready()" [class.current]="!op.ready()" (click)="openTab('operator')">
          <span class="pgp-step-n">1</span><span><b>Operator 준비</b><small>{{ op.ready() ? 'CloudNativePG Running' : '설치 및 CRD 확인 필요' }}</small></span>
        </button>
        <button type="button" class="pgp-step" [class.done]="clusterExists()" [class.current]="op.ready() && !clusterExists()" (click)="openTab('cluster')">
          <span class="pgp-step-n">2</span><span><b>Cluster 생성</b><small>{{ clusterExists() ? pg.name + ' 생성됨' : '토폴로지·스토리지·백업 구성' }}</small></span>
        </button>
        <button type="button" class="pgp-step" [class.done]="pg.allReady()" [class.current]="clusterExists() && !pg.allReady()" [disabled]="!clusterExists()" (click)="clusterExists() && openTab('topology')">
          <span class="pgp-step-n">3</span><span><b>운영 관리</b><small>{{ pg.allReady() ? '모든 인스턴스 Ready' : '상태·DB·백업·이벤트 관리' }}</small></span>
        </button>
      </section>

      <section class="pgp-dashboard">
        <article class="pgp-panel">
          <h2>Package readiness</h2>
          <p>설치 수명주기의 실제 상태만 표시합니다.</p>
          <div class="pgp-status-list">
            <div><span>PFS Control Plane</span><b [class.ok]="op.installerReady()">{{ op.installerReady() ? 'Ready' : 'Required' }}</b></div>
            <div><span>CloudNativePG Operator</span><b [class.ok]="op.ready()">{{ op.phaseLabel() }}</b></div>
            <div><span>PostgreSQL Cluster</span><b [class.ok]="clusterExists()">{{ clusterExists() ? pg.phase() : '미생성' }}</b></div>
            <div><span>Managed instances</span><b [class.ok]="pg.allReady()">{{ pg.readyN() }} / {{ pg.totalN() }}</b></div>
          </div>
          <button class="btn btn-sm btn-primary" type="button" *ngIf="!op.ready()" (click)="openTab('operator')">{{ op.installerReady() ? 'Operator 설치' : 'Control Plane 확인' }}</button>
          <button class="btn btn-sm btn-primary" type="button" *ngIf="op.ready() && !clusterExists()" (click)="openTab('cluster')">Cluster 구성</button>
          <button class="btn btn-sm" type="button" *ngIf="clusterExists()" (click)="refreshAll()">상태 새로고침</button>
        </article>

        <article class="pgp-panel">
          <h2>Cluster health</h2>
          <p>CloudNativePG가 보고한 인스턴스 가용성과 현재 Primary입니다.</p>
          <div class="pgp-health">
            <strong>{{ availability() }}%</strong><span>instances ready</span>
            <progress [value]="pg.readyN()" [max]="pg.totalN() || 1" aria-label="PostgreSQL 인스턴스 가용성"></progress>
          </div>
          <dl class="os-kv">
            <dt>Primary</dt><dd class="os-mono">{{ pg.primary() || '—' }}</dd>
            <dt>Storage</dt><dd>{{ pg.storage() }} · {{ pg.storageClass() }}</dd>
            <dt>Image</dt><dd class="os-mono">{{ pg.image() || '—' }}</dd>
          </dl>
        </article>

        <article class="pgp-panel">
          <h2>Operations policy</h2>
          <p>생성 선언에 포함된 보호·접속·관측 정책입니다.</p>
          <div class="pgp-policy-grid">
            <div><span>TLS</span><b class="ok">CNPG managed</b></div>
            <div><span>Monitoring</span><b [class.ok]="form().monitoring">{{ form().monitoring ? 'Enabled' : 'Disabled' }}</b></div>
            <div><span>Backup</span><b [class.ok]="form().backup.enabled">{{ form().backup.enabled ? 'S3 configured' : 'Not configured' }}</b></div>
            <div><span>Superuser</span><b [class.ok]="!form().enableSuperuserAccess">{{ form().enableSuperuserAccess ? 'External access' : 'Restricted' }}</b></div>
            <div><span>Pooler</span><b [class.ok]="form().poolerEnabled">{{ form().poolerEnabled ? 'PgBouncer' : 'Direct service' }}</b></div>
            <div><span>Extensions</span><b>{{ form().extensions.join(', ') || 'None' }}</b></div>
          </div>
        </article>
      </section>

      <section class="pgp-description">
        <div>
          <h2>Description</h2>
          <p>PostgreSQL plugin은 내부 의존성인 CloudNativePG Operator를 확인한 뒤, FoundationModel/data 선언으로 Cluster를 생성합니다. 운영자는 같은 화면에서 토폴로지, 설정, 데이터베이스·역할, 백업, 이벤트와 Claim을 관리합니다.</p>
        </div>
        <div>
          <h2>Documentation</h2>
          <a [href]="manualUrl">OpenSphere PostgreSQL 19 설치·운영 안내서 (한글)</a>
          <a href="https://cloudnative-pg.io/documentation/" target="_blank" rel="noreferrer">CloudNativePG documentation</a>
          <a href="https://www.postgresql.org/docs/19/" target="_blank" rel="noreferrer">PostgreSQL 19 beta documentation</a>
          <button class="btn btn-sm btn-link" type="button" (click)="openTab('cluster')">OpenSphere 설치 계약 보기</button>
        </div>
      </section>

      <pg-overview *ngIf="clusterExists()" (jump)="openTab($event)"></pg-overview>
    </ng-container>

    <section *ngIf="tab() === 'operator'" class="pgp-workspace">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Internal dependency</span><h2>CloudNativePG Operator</h2></div><span class="label" [ngClass]="op.ready() ? 'label-success' : 'label-warning'">{{ op.phaseLabel() }}</span></div>
      <clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Operator는 PostgreSQL plugin이 공유하는 내부 실행 기반입니다. 사용자에게 별도 plugin으로 등록하지 않습니다.</span></clr-alert-item></clr-alert>
      <clr-alert *ngIf="!op.installerReady()" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{ op.installerReason() }}</span><div class="alert-actions"><button type="button" class="btn alert-action" (click)="openControlPlane()">Control Plane으로 이동</button></div></clr-alert-item></clr-alert>

      <div class="pgp-operator-grid" *ngIf="op.installed()">
        <div class="card"><div class="card-header">Deployment</div><div class="card-block"><dl class="os-kv"><dt>Ready</dt><dd>{{ op.readyN() }}/{{ op.totalN() }}</dd><dt>Namespace</dt><dd class="os-mono">cnpg-system</dd><dt>Image</dt><dd class="os-mono">{{ op.installedImage() }}</dd></dl></div></div>
        <div class="card"><div class="card-header">Managed clusters</div><div class="card-block"><strong class="pgp-big">{{ op.clusters().length }}</strong><p>클러스터 전체에서 Operator가 관찰한 PostgreSQL Cluster</p></div></div>
      </div>

      <div *ngIf="!op.installed() && op.installState() === 'idle'" class="pgp-install-box">
        <label class="vl-field"><span class="vl-field-l">Operator chart</span><select class="os-filter" (change)="selectOperator($event)"><option *ngFor="let v of op.versions" [value]="v.chart">{{ v.chart }} · app {{ v.app }}</option></select></label>
        <dl class="os-kv"><dt>설치 방식</dt><dd>Crossplane provider-helm · Release/cnpg</dd><dt>대상</dt><dd class="os-mono">cnpg-system</dd><dt>Mirror</dt><dd class="os-mono">{{ op.plan().image }}</dd></dl>
        <button class="btn btn-primary" type="button" (click)="op.install()" [disabled]="!op.canInstall()"><os-cicon [icon]="iDownload" [size]="16" /> Operator 설치</button>
      </div>
      <div class="vl-note vl-note--danger" *ngIf="op.installState() === 'error'"><os-cicon [icon]="iWarning" [size]="20" /><div><strong>Operator 설치 실패</strong><p>{{ op.installError() }}</p><button class="btn btn-sm" type="button" (click)="op.dismissError()">다시 시도</button></div></div>
      <div class="vl-progress-wrap" *ngIf="op.installState() === 'installing'">
        <div class="vl-progress-head"><span>Operator 설치 진행</span><span class="vl-progress-pct">{{ op.progress() }}%</span></div>
        <div class="vl-progress-track"><div class="vl-progress-bar" [style.width.%]="op.progress()"></div></div>
        <div class="vl-log"><div class="vl-log-line" *ngFor="let line of op.logs()">{{ line }}</div></div>
      </div>
    </section>

    <section *ngIf="tab() === 'cluster'" class="pgp-workspace">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Desired state</span><h2>PostgreSQL Cluster 구성</h2></div><span class="label" [ngClass]="clusterExists() ? 'label-success' : 'label-warning'">{{ clusterExists() ? 'Managed' : 'Not created' }}</span></div>
      <clr-alert *ngIf="!op.ready()" clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Cluster를 생성하려면 CloudNativePG Operator가 먼저 Ready여야 합니다.</span><div class="alert-actions"><button class="btn alert-action" type="button" (click)="openTab('operator')">Operator로 이동</button></div></clr-alert-item></clr-alert>

      <form class="pgp-form" (ngSubmit)="applyCluster()">
        <fieldset [disabled]="applying()">
          <legend>Topology & version</legend>
          <div class="pgp-form-grid">
            <label><span>운영 프로파일</span><select name="profile" [ngModel]="form().profile" (ngModelChange)="setProfile($event)"><option value="development">Development · 1 instance</option><option value="production">Production HA · 3 instances</option><option value="custom">Custom</option></select></label>
            <label><span>PostgreSQL 19 image</span><select name="imageTag" [ngModel]="form().imageTag" (ngModelChange)="patchForm({ imageTag: $event })" [disabled]="clusterExists()"><option *ngFor="let v of versions" [value]="v.value">{{ v.label }}</option></select></label>
            <label><span>Instances</span><input name="instances" type="number" min="1" max="9" [ngModel]="form().instances" (ngModelChange)="patchForm({ instances: +$event, profile: 'custom' })" /></label>
            <label><span>Resource profile</span><select name="resourceProfile" [ngModel]="form().resourceProfile" (ngModelChange)="setResourceProfile($event)"><option value="small">Small · 250m / 512Mi</option><option value="medium">Medium · 500m / 1Gi</option><option value="large">Large · 1 / 2Gi</option></select></label>
          </div>
        </fieldset>

        <fieldset [disabled]="applying()">
          <legend>Persistent storage</legend>
          <div class="pgp-form-grid">
            <label><span>StorageClass</span><select name="storageClass" [ngModel]="form().storageClass" (ngModelChange)="patchForm({ storageClass: $event })" [disabled]="clusterExists()"><option *ngFor="let sc of storageClasses()" [value]="sc.name">{{ sc.name }}{{ sc.isDefault ? ' (default)' : '' }}</option></select><small>{{ selectedStorageHint() }}</small></label>
            <label><span>Data volume</span><input name="storageSize" [ngModel]="form().storageSize" (ngModelChange)="patchForm({ storageSize: $event })" placeholder="10Gi" /><small>기존 PVC는 증가만 허용될 수 있습니다.</small></label>
            <label><span>WAL volume</span><input name="walStorageSize" [ngModel]="form().walStorageSize" (ngModelChange)="patchForm({ walStorageSize: $event })" placeholder="비우면 data volume 공유" /></label>
            <label><span>Namespace</span><input name="namespace" [ngModel]="form().namespace" disabled /></label>
          </div>
        </fieldset>

        <fieldset [disabled]="applying()">
          <legend>Operations policy</legend>
          <div class="pgp-check-grid">
            <label><input type="checkbox" name="monitoring" [ngModel]="form().monitoring" (ngModelChange)="patchForm({ monitoring: $event })" /> PodMonitor 활성화</label>
            <label><input type="checkbox" name="pooler" [ngModel]="form().poolerEnabled" (ngModelChange)="patchForm({ poolerEnabled: $event })" /> PgBouncer Pooler</label>
            <label><input type="checkbox" name="superuser" [ngModel]="form().enableSuperuserAccess" (ngModelChange)="patchForm({ enableSuperuserAccess: $event })" /> superuser 외부 접근</label>
            <label><input type="checkbox" name="backup" [ngModel]="form().backup.enabled" (ngModelChange)="patchBackup({ enabled: $event })" /> S3 연속 백업</label>
          </div>
          <div class="pgp-form-grid" *ngIf="form().backup.enabled">
            <label><span>S3 endpoint</span><input name="s3Endpoint" [ngModel]="form().backup.s3Endpoint" (ngModelChange)="patchBackup({ s3Endpoint: $event })" placeholder="https://s3.example.com" /></label>
            <label><span>Destination</span><input name="destinationPath" [ngModel]="form().backup.destinationPath" (ngModelChange)="patchBackup({ destinationPath: $event })" placeholder="s3://bucket/foundation-pg" /></label>
            <label><span>Credentials Secret</span><input name="secretName" [ngModel]="form().backup.secretName" (ngModelChange)="patchBackup({ secretName: $event })" placeholder="cnpg-backup-credentials" /></label>
            <label><span>Retention</span><input name="retentionPolicy" [ngModel]="form().backup.retentionPolicy" (ngModelChange)="patchBackup({ retentionPolicy: $event })" placeholder="30d" /></label>
          </div>
        </fieldset>

        <clr-alert *ngIf="validationError()" clrAlertType="danger" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">{{ validationError() }}</span></clr-alert-item></clr-alert>
        <div class="os-actions">
          <button class="btn btn-primary" type="submit" [disabled]="!canApply()">{{ clusterExists() ? '운영 구성 적용' : 'PostgreSQL Cluster 생성' }}</button>
          <span class="os-dim">FoundationModel/data → control-plane SSA → Cluster/{{ pg.name }}</span>
        </div>
      </form>

      <div class="vl-progress-wrap" *ngIf="applyState() !== 'idle'">
        <div class="vl-progress-head"><span>{{ applyState() === 'error' ? '설치 실패' : applyState() === 'done' ? 'Cluster 준비 완료' : 'Cluster 적용 진행' }}</span><span class="vl-progress-pct">{{ applyProgress() }}%</span></div>
        <div class="vl-progress-track"><div class="vl-progress-bar" [class.pgp-progress-error]="applyState() === 'error'" [style.width.%]="applyProgress()"></div></div>
        <div class="vl-log"><div class="vl-log-line" *ngFor="let line of applyLogs()">{{ line }}</div></div>
      </div>
    </section>

    <pg-topology *ngIf="tab() === 'topology' && clusterExists()"></pg-topology>
    <pg-config *ngIf="tab() === 'config' && clusterExists()"></pg-config>
    <pg-databases *ngIf="tab() === 'databases' && clusterExists()"></pg-databases>
    <pg-backups *ngIf="tab() === 'backups' && clusterExists()"></pg-backups>
    <pg-events *ngIf="tab() === 'events' && clusterExists()"></pg-events>
    <pg-claims *ngIf="tab() === 'claims' && clusterExists()"></pg-claims>

    <section *ngIf="tab() === 'upgrade'" class="pgp-workspace">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Controlled lifecycle</span><h2>PostgreSQL 19 upgrade & rollback</h2></div><span class="label label-info">19 beta line</span></div>
      <clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">이 plugin은 PostgreSQL 19 계열만 지원합니다. 이미지 변경은 CloudNativePG rolling update, catalog 호환성, 백업과 복구 지점을 확인한 뒤 실행합니다.</span></clr-alert-item></clr-alert>
      <table class="table"><thead><tr><th>채널</th><th>이미지</th><th>상태</th><th>승격 조건</th></tr></thead><tbody><tr *ngFor="let v of versions"><td>edge</td><td class="os-mono">{{v.value}}</td><td><span class="label" [ngClass]="form().imageTag===v.value?'label-info':''">{{form().imageTag===v.value?'Selected':'Available'}}</span></td><td>CNPG compatibility · backup/restore · rolling update 증거</td></tr></tbody></table>
      <button class="btn btn-primary" type="button" (click)="openTab('cluster')">Cluster plan에서 버전 검토</button>
    </section>

    <section *ngIf="tab() === 'documentation'" class="pgp-workspace">
      <div class="pgp-section-head"><div><span class="vl-eyebrow">Console Manual Registry</span><h2>Documentation</h2></div><span class="label label-success">자동 등록</span></div>
      <p>PostgreSQL 19 한글 설치·운영 안내서는 Foundation package 활성화 시 Console Manual Registry와 통합 검색에 자동 등록됩니다.</p>
      <dl class="os-kv"><dt>문서 ID</dt><dd class="os-mono">{{manualSourceId}}</dd><dt>화면 경로</dt><dd class="os-mono">/p/foundation/postgres</dd><dt>정본 수준</dt><dd>Tier 2 · 제품/운영 안내서</dd></dl>
      <a class="btn btn-sm btn-primary" [href]="manualUrl">한글 안내서 열기</a><a class="btn btn-sm" href="https://www.postgresql.org/docs/19/" target="_blank" rel="noreferrer">PostgreSQL 19 공식 문서</a><a class="btn btn-sm" href="https://cloudnative-pg.io/documentation/current/" target="_blank" rel="noreferrer">CloudNativePG 공식 문서</a>
    </section>
  `,
})
export class PostgresPluginComponent implements OnInit, OnDestroy {
  readonly op = inject(CnpgOperatorService);
  readonly pg = inject(CnpgService);
  readonly reg = inject(FoundationRegistryService);
  readonly vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly manualSourceId = MANUAL_SOURCE_ID;
  readonly manualUrl = `/manual?doc=${encodeURIComponent(MANUAL_SOURCE_ID)}`;
  readonly versions = VERSION_OPTIONS;
  readonly iBack = ArrowLeft16;
  readonly iDownload = Download16;
  readonly iWarning = WarningAlt16;

  readonly form = signal<PgForm>(structuredClone(DEFAULT_FORM));
  readonly storageClasses = signal<StorageClassRow[]>([]);
  readonly applying = signal(false);
  readonly applyState = signal<'idle' | 'applying' | 'done' | 'error'>('idle');
  readonly applyProgress = signal(0);
  readonly applyLogs = signal<string[]>([]);
  private installTimer: ReturnType<typeof setInterval> | undefined;

  readonly tabs: { id: PackageTab; label: string; requiresCluster?: boolean; badge?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'operator', label: 'Operator' },
    { id: 'cluster', label: 'Cluster plan' },
    { id: 'topology', label: 'Topology', requiresCluster: true },
    { id: 'config', label: 'Configuration', requiresCluster: true },
    { id: 'databases', label: 'Databases & Roles', requiresCluster: true, badge: true },
    { id: 'backups', label: 'Backups', requiresCluster: true, badge: true },
    { id: 'events', label: 'Events', requiresCluster: true, badge: true },
    { id: 'claims', label: 'Claims', requiresCluster: true },
    { id: 'upgrade', label: 'Upgrade' },
    { id: 'documentation', label: 'Documentation' },
  ];

  readonly tab = computed<PackageTab>(() => {
    const t = this.vr.tab() as PackageTab;
    return this.tabs.some((x) => x.id === t) ? t : 'overview';
  });
  readonly clusterExists = computed(() => this.pg.clusterState() === 'ok' && !!this.pg.cluster());
  readonly validationError = computed(() => {
    const f = this.form();
    if (f.instances < 1 || f.instances > 9) return '인스턴스 수는 1~9여야 합니다.';
    if (!/^\d+(Gi|Ti)$/.test(f.storageSize)) return 'Data volume은 10Gi 또는 1Ti 형식이어야 합니다.';
    if (f.walStorageSize && !/^\d+(Gi|Ti)$/.test(f.walStorageSize)) return 'WAL volume은 10Gi 또는 1Ti 형식이어야 합니다.';
    if (!f.storageClass) return 'StorageClass를 선택해야 합니다.';
    if (f.backup.enabled && (!f.backup.s3Endpoint || !f.backup.destinationPath || !f.backup.secretName)) return 'S3 백업을 사용하려면 endpoint, destination, Secret이 모두 필요합니다.';
    return '';
  });
  readonly canApply = computed(() => this.op.ready() && !this.applying() && !this.validationError());

  ngOnInit(): void {
    this.op.start();
    void this.loadStorageClasses();
  }
  ngOnDestroy(): void {
    this.op.stop();
    if (this.installTimer) clearInterval(this.installTimer);
  }

  back(): void { this.vr.setModule('modules'); }
  openControlPlane(): void { this.vr.setModule('control-plane'); }
  openTab(id: string): void { this.vr.setTab(id); }
  selectOperator(e: Event): void { this.op.selectChart((e.target as HTMLSelectElement).value); }
  patchForm(patch: Partial<PgForm>): void { this.form.update((f) => ({ ...f, ...patch })); }
  patchBackup(patch: Partial<PgForm['backup']>): void { this.form.update((f) => ({ ...f, backup: { ...f.backup, ...patch } })); }

  setProfile(profile: Profile): void {
    if (profile === 'production') {
      this.form.update((f) => ({ ...f, profile, instances: 3, storageSize: '50Gi', resourceProfile: 'medium', cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '2Gi', poolerEnabled: true, poolerInstances: 2, monitoring: true }));
      return;
    }
    if (profile === 'development') {
      this.form.update((f) => ({ ...f, profile, instances: 1, storageSize: '10Gi', resourceProfile: 'small', cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '1', memoryLimit: '1Gi', poolerEnabled: false, poolerInstances: 1, monitoring: true }));
      return;
    }
    this.patchForm({ profile });
  }

  setResourceProfile(profile: string): void {
    const presets: Record<string, Partial<PgForm>> = {
      small: { resourceProfile: 'small', cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '1', memoryLimit: '1Gi' },
      medium: { resourceProfile: 'medium', cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '2Gi' },
      large: { resourceProfile: 'large', cpuRequest: '1', memoryRequest: '2Gi', cpuLimit: '4', memoryLimit: '4Gi' },
    };
    this.patchForm({ ...(presets[profile] ?? {}), profile: 'custom' });
  }

  lifecycleLabel(): string {
    if (!this.op.ready()) return 'Operator required';
    if (!this.clusterExists()) return 'Cluster required';
    return this.pg.allReady() ? 'Ready' : 'Progressing';
  }
  lifecyclePill(): string {
    return this.pg.allReady() ? 'label-success' : 'label-warning';
  }
  headerModel(): PluginPageHeaderModel {
    return {
      name: 'PostgreSQL', logo: LOGO, capability: 'data.sql.postgres',
      description: 'CloudNativePG 기반의 설치·고가용성·백업·운영 관리를 하나로 제공하는 Foundation plugin',
      lifecycle: this.lifecycleLabel(), lifecycleClass: this.lifecyclePill(), versionLabel: 'PostgreSQL',
      version: this.pg.pgMajor() === '—' ? '19 beta2' : this.pg.pgMajor(), profile: this.form().profile, namespace: this.pg.ns,
    };
  }
  tabsForUi(): PluginPageTab[] {
    return this.tabs.map((t) => ({ id: t.id, label: t.label, disabled: !!t.requiresCluster && !this.clusterExists(), badge: t.badge ? this.badge(t.id) : '' }));
  }
  availability(): number {
    return this.pg.totalN() ? Math.round((this.pg.readyN() / this.pg.totalN()) * 100) : 0;
  }
  badge(id: PackageTab): string {
    if (id === 'databases') return String(this.pg.databases().length + this.pg.managedRoles().length || '');
    if (id === 'backups') return String(this.pg.backups().length || '');
    if (id === 'events') return String(this.pg.events().filter((e: any) => e.type === 'Warning').length || '');
    return '';
  }
  selectedStorageHint(): string {
    const sc = this.storageClasses().find((x) => x.name === this.form().storageClass);
    if (!sc) return 'StorageClass 상태를 확인 중입니다.';
    return `${sc.provisioner} · ${sc.allowExpansion ? '온라인 확장 지원' : '확장 미지원'} · reclaim ${sc.reclaimPolicy}`;
  }

  async refreshAll(): Promise<void> {
    await Promise.allSettled([this.op.refresh(), this.pg.refresh(), this.reg.refreshModels(), this.loadStorageClasses()]);
  }

  async applyCluster(): Promise<void> {
    if (!this.canApply()) return;
    this.applying.set(true);
    this.applyState.set('applying');
    this.applyProgress.set(10);
    this.applyLogs.set([]);
    this.log('FoundationModel/data PostgreSQL 설치 선언을 제출합니다.');
    const { profile: _profile, ...parameters } = this.form();
    const ok = await this.reg.configurePostgres(parameters);
    if (!ok) {
      this.applyState.set('error');
      this.applyProgress.set(100);
      this.applying.set(false);
      this.log(`실패: ${this.reg.lastError()}`);
      return;
    }
    this.applyProgress.set(25);
    this.log('설치 선언이 승인되었습니다. Foundation control-plane reconcile을 기다립니다.');
    this.pg.forceRefresh();
    this.watchCluster();
  }

  private watchCluster(): void {
    if (this.installTimer) clearInterval(this.installTimer);
    let ticks = 0;
    this.installTimer = setInterval(async () => {
      ticks++;
      await this.pg.refresh();
      if (this.clusterExists()) {
        this.applyProgress.set(Math.max(this.applyProgress(), 55));
        this.logOnce('cluster', `Cluster/${this.pg.name}가 생성되었습니다.`);
      }
      if (this.pg.instances().length) {
        this.applyProgress.set(Math.max(this.applyProgress(), 75));
        this.logOnce('pods', `PostgreSQL Pod ${this.pg.instances().length}개를 확인했습니다.`);
      }
      if (this.pg.allReady()) {
        this.applyProgress.set(100);
        this.applyState.set('done');
        this.applying.set(false);
        this.logOnce('ready', '모든 PostgreSQL 인스턴스가 Ready입니다.');
        if (this.installTimer) clearInterval(this.installTimer);
        this.installTimer = undefined;
      } else if (ticks >= 100) {
        this.applyState.set('error');
        this.applyProgress.set(100);
        this.applying.set(false);
        this.log('5분 안에 Ready가 되지 않았습니다. Events 탭과 control-plane 상태를 확인하세요.');
        if (this.installTimer) clearInterval(this.installTimer);
        this.installTimer = undefined;
      }
    }, 3000);
  }

  private async loadStorageClasses(): Promise<void> {
    try {
      const r = await hostFetch(`${apiBase()}/api/k8s/apis/storage.k8s.io/v1/storageclasses`, { cache: 'no-store' });
      if (!r.ok) return;
      const rows: StorageClassRow[] = ((await r.json()).items ?? []).map((x: any) => ({
        name: String(x.metadata?.name ?? ''),
        provisioner: String(x.provisioner ?? ''),
        isDefault: x.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
        allowExpansion: x.allowVolumeExpansion === true,
        reclaimPolicy: String(x.reclaimPolicy ?? 'Delete'),
      })).filter((x: StorageClassRow) => !!x.name).sort((a: StorageClassRow, b: StorageClassRow) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
      this.storageClasses.set(rows);
      if (!rows.some((x) => x.name === this.form().storageClass)) {
        const selected = rows.find((x) => x.isDefault) ?? rows[0];
        if (selected) this.patchForm({ storageClass: selected.name });
      }
    } catch { /* 상태 표시는 selectedStorageHint에서 처리 */ }
  }

  private log(message: string): void {
    const time = new Date().toLocaleTimeString();
    this.applyLogs.update((lines) => [...lines, `[${time}] ${message}`]);
  }
  private logOnce(key: string, message: string): void {
    if (this.applyLogs().some((x) => x.includes(`[${key}]`))) return;
    this.log(`[${key}] ${message}`);
  }
}
