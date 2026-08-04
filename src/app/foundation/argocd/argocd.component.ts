import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { ViewRouter } from '../../view-router';
import {
  PluginPageHeaderComponent,
  PluginPageHeaderModel,
  PluginPageTab,
  PluginTabsComponent,
  deliveryAdminTabs,
} from '../../shared/plugin-page-shell.component';
import { ArgoApplication, ArgoCdService, DeliveryProbeState } from './argocd.service';

const LOGO = 'https://logos.opl.io.kr/i/argocd';

@Component({
  selector: 'app-argocd',
  standalone: true,
  imports: [CommonModule, ClarityModule, PluginPageHeaderComponent, PluginTabsComponent],
  template: `
    <button class="btn btn-sm btn-link rm-back" type="button" (click)="back()">← Platform Delivery</button>
    <section class="pgp-page-frame" aria-label="Argo CD 관리자 설치와 운영">
      <osp-plugin-page-header [model]="headerModel()" headingId="argocd-plugin-title" />
      <osp-plugin-tabs [tabs]="tabs" [active]="active()" ariaLabel="Argo CD 관리자 메뉴" (selected)="select($event)" />
    </section>

    <clr-alert *ngIf="!svc.deliveryReady()" [clrAlertType]="svc.runtimeInstalled() ? 'warning' : 'danger'" [clrAlertClosable]="false">
      <clr-alert-item>
        <span class="alert-text"><b>{{ svc.phaseLabel() }}</b> — {{ svc.statusReason() }}</span>
        <div class="alert-actions">
          <button class="btn alert-action" type="button" (click)="select(svc.runtimeInstalled() ? 'install' : 'prerequisites')">원인과 복구</button>
        </div>
      </clr-alert-item>
    </clr-alert>

    <div class="vl-note" [class.vl-note--danger]="svc.actionState()==='error'" *ngIf="svc.actionMessage()">
      <div>
        <strong>{{ svc.actionState()==='error' ? '작업 실패' : '작업 결과' }}</strong>
        <p>{{ svc.actionMessage() }}</p>
        <button class="btn btn-sm" type="button" (click)="svc.dismissAction()">닫기</button>
      </div>
    </div>

    <ng-container *ngIf="active()==='overview'">
      <section class="pgp-steps" aria-label="Argo CD 관리자 운영 단계">
        <button type="button" class="pgp-step" [class.done]="svc.runtimeReady()" [class.current]="!svc.runtimeReady()" (click)="select('prerequisites')">
          <span class="pgp-step-n">1</span><span><b>Runtime 준비</b><small>CRD·API·필수 controller readiness</small></span>
        </button>
        <button type="button" class="pgp-step" [class.done]="svc.deliveryReady()" [class.current]="svc.runtimeReady()&&!svc.deliveryReady()" (click)="select('install')">
          <span class="pgp-step-n">2</span><span><b>Delivery 검증</b><small>Repository·Project·Source path·revision</small></span>
        </button>
        <button type="button" class="pgp-step" [class.done]="svc.deliveryReady()" [class.current]="svc.deliveryReady()" [disabled]="!svc.runtimeReady()" (click)="select('resources')">
          <span class="pgp-step-n">3</span><span><b>운영 관리</b><small>Application sync·health·event·rollback evidence</small></span>
        </button>
      </section>

      <section class="pgp-dashboard">
        <article class="pgp-panel">
          <h2>Runtime health</h2>
          <p>Argo CD 설치 여부와 controller 가용성입니다.</p>
          <dl>
            <dt>상태</dt><dd><span class="label" [ngClass]="svc.runtimeReady()?'label-success':(svc.runtimeInstalled()?'label-warning':'label-danger')">{{svc.runtimeReady()?'Ready':(svc.runtimeInstalled()?'Degraded':'Not Installed')}}</span></dd>
            <dt>Workloads</dt><dd>{{readyWorkloads()}}/4 Ready</dd>
            <dt>CRD/API</dt><dd><span class="label" [ngClass]="stateClass(svc.crdState())">{{stateLabel(svc.crdState())}}</span></dd>
          </dl>
          <button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">다시 확인</button>
        </article>
        <article class="pgp-panel">
          <h2>Platform Delivery</h2>
          <p>설치 완료와 실제 delivery 준비 상태를 분리한 최종 판정입니다.</p>
          <dl>
            <dt>종합</dt><dd><span class="label" [ngClass]="svc.phaseClass()">{{svc.phaseLabel()}}</span></dd>
            <dt>Sync</dt><dd>{{svc.verifyApplication()?.sync || '미수집'}}</dd>
            <dt>Health</dt><dd>{{svc.verifyApplication()?.health || '미수집'}}</dd>
          </dl>
          <button class="btn btn-sm btn-primary" type="button" (click)="select(svc.deliveryReady()?'resources':'install')">{{svc.deliveryReady()?'Applications 관리':'복구 경로 확인'}}</button>
        </article>
        <article class="pgp-panel">
          <h2>Governed source</h2>
          <p>검증 Application이 사용하는 repository와 불변 revision입니다.</p>
          <dl>
            <dt>Project</dt><dd>{{svc.verifyApplication()?.project || '—'}}</dd>
            <dt>Path</dt><dd class="os-mono">{{svc.verifyApplication()?.path || '—'}}</dd>
            <dt>Revision</dt><dd class="os-mono">{{shortRevision(svc.verifyApplication()?.revision)}}</dd>
          </dl>
        </article>
      </section>
    </ng-container>

    <section class="rm-work" *ngIf="active()==='prerequisites'">
      <div class="hc-section-head"><div><h2>Prerequisites</h2><p>정적 체크리스트가 아니라 live API와 Argo CR에서 계산합니다.</p></div><button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">다시 검사</button></div>
      <table class="table">
        <thead><tr><th>검사</th><th>상태</th><th>실증 근거</th><th>소유자</th></tr></thead>
        <tbody>
          <tr *ngFor="let item of svc.prerequisites()">
            <td>{{item.label}}</td>
            <td><span class="label" [ngClass]="stateClass(item.state)">{{stateLabel(item.state)}}</span></td>
            <td class="os-mono">{{item.evidence}}</td>
            <td>{{item.owner}}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="rm-work" *ngIf="active()==='install'">
      <h2>Install & Repair</h2>
      <ng-container *ngIf="!svc.runtimeInstalled()">
        <clr-alert clrAlertType="danger" [clrAlertClosable]="false">
          <clr-alert-item><span class="alert-text">Argo CD runtime은 Main Shell Platform Delivery bootstrap 소유입니다. Foundation 화면이 broad Kubernetes 권한으로 직접 설치하지 않습니다.</span></clr-alert-item>
        </clr-alert>
        <div class="pgp-dashboard">
          <article class="pgp-panel"><h3>1. 설치 소유자</h3><p>Main Shell의 서명 Release BOM과 exact image digest를 사용해야 합니다.</p></article>
          <article class="pgp-panel"><h3>2. 사전 계획</h3><p>CRD, namespace, RBAC, NetworkPolicy, repository SecretRef와 rollback target을 검토합니다.</p></article>
          <article class="pgp-panel"><h3>3. 설치 요청</h3><p>현재 이 subShell에는 승인된 bootstrap mutation API가 게시되지 않았습니다.</p><a class="btn btn-sm btn-primary" href="/manage/platform-control">Platform Control 확인</a></article>
        </div>
      </ng-container>

      <ng-container *ngIf="svc.runtimeInstalled()">
        <div class="pgp-dashboard">
          <article class="pgp-panel">
            <h3>Runtime</h3><p>필수 workload readiness</p>
            <div class="de-big">{{readyWorkloads()}}/4</div>
            <span class="label" [ngClass]="svc.runtimeReady()?'label-success':'label-warning'">{{svc.runtimeReady()?'Ready':'Repair required'}}</span>
          </article>
          <article class="pgp-panel">
            <h3>Delivery evidence</h3><p>{{svc.statusReason()}}</p>
            <dl><dt>Sync</dt><dd>{{svc.verifyApplication()?.sync || '—'}}</dd><dt>Health</dt><dd>{{svc.verifyApplication()?.health || '—'}}</dd></dl>
          </article>
          <article class="pgp-panel">
            <h3>안전한 복구 작업</h3><p>리소스를 삭제하거나 prune하지 않고 Argo cache와 source 상태를 다시 읽습니다.</p>
            <button class="btn btn-sm btn-primary" type="button" [disabled]="svc.actionState()==='running'||!svc.verifyApplication()" (click)="svc.hardRefresh()">Hard refresh 요청</button>
          </article>
        </div>
        <clr-alert *ngIf="svc.sourcePathMissing()" clrAlertType="danger" [clrAlertClosable]="false">
          <clr-alert-item>
            <span class="alert-text"><b>SourcePathMissing</b> — {{svc.verifyApplication()?.repoUrl}} 저장소에 <span class="os-mono">{{svc.verifyApplication()?.path}}</span> 경로를 승인된 PR로 추가해야 합니다. 이 화면은 branch protection을 우회해 파일을 직접 생성하지 않습니다.</span>
          </clr-alert-item>
        </clr-alert>
      </ng-container>
    </section>

    <section class="rm-work" *ngIf="active()==='resources'">
      <div class="hc-section-head"><div><h2>Applications & Projects</h2><p>Argo CD CR의 sync, health, source와 진행 상태입니다.</p></div><button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">새로고침</button></div>
      <h3>Applications</h3>
      <table class="table">
        <thead><tr><th>Application</th><th>Project</th><th>Sync</th><th>Health</th><th>Revision</th><th>Source</th><th>작업</th></tr></thead>
        <tbody>
          <tr *ngFor="let app of svc.applications()">
            <td>{{app.name}}</td><td>{{app.project}}</td>
            <td><span class="label" [ngClass]="app.sync==='Synced'?'label-success':'label-warning'">{{app.sync}}</span></td>
            <td><span class="label" [ngClass]="app.health==='Healthy'?'label-success':'label-danger'">{{app.health}}</span></td>
            <td class="os-mono">{{shortRevision(app.revision)}}</td>
            <td class="os-mono">{{app.path || app.repoUrl}}</td>
            <td>
              <button class="btn btn-sm" type="button" [disabled]="svc.actionState()==='running'" (click)="svc.hardRefresh(app.name)">Refresh</button>
              <button class="btn btn-sm btn-primary" type="button" [disabled]="!canSync(app)" (click)="confirmSync(app)">Sync</button>
            </td>
          </tr>
          <tr *ngIf="!svc.applications().length"><td colspan="7">Application이 없거나 읽기 권한이 없습니다.</td></tr>
        </tbody>
      </table>
      <h3>AppProjects</h3>
      <table class="table">
        <thead><tr><th>Project</th><th>Source repositories</th><th>Destinations</th><th>Description</th></tr></thead>
        <tbody><tr *ngFor="let project of svc.projects()"><td>{{project.name}}</td><td>{{project.sourceRepos}}</td><td>{{project.destinations}}</td><td>{{project.description}}</td></tr></tbody>
      </table>
    </section>

    <section class="rm-work" *ngIf="active()==='configuration'">
      <h2>Configuration</h2>
      <dl class="os-kv">
        <dt>Namespace</dt><dd class="os-mono">argocd</dd>
        <dt>Project</dt><dd>{{svc.verifyApplication()?.project || '—'}}</dd>
        <dt>Repository</dt><dd class="os-mono">{{svc.verifyApplication()?.repoUrl || '—'}}</dd>
        <dt>Path</dt><dd class="os-mono">{{svc.verifyApplication()?.path || '—'}}</dd>
        <dt>Target revision</dt><dd class="os-mono">{{svc.verifyApplication()?.targetRevision || '—'}}</dd>
        <dt>Resolved revision</dt><dd class="os-mono">{{svc.verifyApplication()?.revision || '—'}}</dd>
        <dt>Destination</dt><dd class="os-mono">{{svc.verifyApplication()?.destination || '—'}}</dd>
        <dt>Automated sync</dt><dd>{{svc.verifyApplication()?.automated ? 'Enabled' : 'Disabled'}}</dd>
      </dl>
      <clr-alert clrAlertType="info" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Repository credential 값은 화면이나 generic Kubernetes proxy에 노출하지 않습니다. 연결 성공과 SecretRef 존재만 owner evidence로 투영해야 합니다.</span></clr-alert-item></clr-alert>
    </section>

    <section class="rm-work" *ngIf="active()==='security'">
      <h2>Security & Policy</h2>
      <div class="rm-grid">
        <article class="rm-panel"><h3>Repository credential</h3><p>Gitea read-only token은 SecretRef로만 사용하고 Console write token과 분리합니다.</p><span class="label" [ngClass]="svc.verifyApplication()?.repoUrl?.includes('opensphere-gitea')?'label-success':'label-warning'">{{svc.verifyApplication()?.repoUrl?.includes('opensphere-gitea')?'Governed source':'검증 필요'}}</span></article>
        <article class="rm-panel"><h3>Project boundary</h3><p>AppProject source/destination allowlist로 Platform Delivery 경계를 제한합니다.</p><span class="label" [ngClass]="svc.projects().length?'label-success':'label-warning'">{{svc.projects().length}} projects</span></article>
        <article class="rm-panel"><h3>Revision integrity</h3><p>branch 이름이 아니라 Argo가 해소한 40자리 Git commit SHA를 readiness 증거로 사용합니다.</p><span class="label" [ngClass]="svc.revisionPinned()?'label-success':'label-danger'">{{svc.revisionPinned()?'Pinned':'Not pinned'}}</span></article>
        <article class="rm-panel"><h3>Destructive sync</h3><p>Console Sync는 prune=false, CreateNamespace=false로 제한합니다. 삭제·prune는 별도 승인 계약이 필요합니다.</p><span class="label label-info">Guarded</span></article>
      </div>
    </section>

    <section class="rm-work" *ngIf="active()==='upgrade'">
      <h2>Upgrade & Rollback</h2>
      <clr-alert clrAlertType="warning" [clrAlertClosable]="false"><clr-alert-item><span class="alert-text">Argo CD runtime upgrade는 mutable tag나 화면 입력 버전으로 실행하지 않습니다. 서명된 Platform Release BOM의 chart/source revision과 exact image digest를 Main Shell owner가 적용해야 합니다.</span></clr-alert-item></clr-alert>
      <table class="table">
        <thead><tr><th>Workload</th><th>Kind</th><th>Ready</th><th>현재 image</th></tr></thead>
        <tbody><tr *ngFor="let row of svc.workloads()"><td>{{row.name}}</td><td>{{row.kind}}</td><td>{{row.ready}}/{{row.desired}}</td><td class="os-mono">{{row.image || '—'}}</td></tr></tbody>
      </table>
      <h3>최근 배포 revision</h3>
      <table class="table">
        <thead><tr><th>ID</th><th>Revision</th><th>Deployed at</th><th>판정</th></tr></thead>
        <tbody>
          <tr *ngFor="let history of svc.verifyApplication()?.history || []"><td>{{history.id}}</td><td class="os-mono">{{history.revision}}</td><td>{{history.deployedAt}}</td><td>Rollback 후보 · 실행 전 diff/승인 필요</td></tr>
          <tr *ngIf="!(svc.verifyApplication()?.history?.length)"><td colspan="4">배포 history가 없습니다.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="rm-work" *ngIf="active()==='events'">
      <div class="hc-section-head"><div><h2>Events & Audit</h2><p>Kubernetes Event와 Console 작업 결과를 함께 확인합니다.</p></div><button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">새로고침</button></div>
      <table class="table">
        <thead><tr><th>Time</th><th>Type</th><th>Reason</th><th>Object</th><th>Message</th></tr></thead>
        <tbody>
          <tr *ngFor="let event of svc.events()"><td>{{event.time}}</td><td><span class="label" [ngClass]="event.type==='Warning'?'label-warning':''">{{event.type}}</span></td><td>{{event.reason}}</td><td>{{event.object}}</td><td>{{event.message}}</td></tr>
          <tr *ngIf="!svc.events().length"><td colspan="5">현재 읽을 수 있는 Kubernetes Event가 없습니다.</td></tr>
        </tbody>
      </table>
      <h3>이번 Console 세션 작업</h3>
      <div class="vl-log"><div *ngFor="let line of svc.actionLog()">{{line}}</div><div *ngIf="!svc.actionLog().length">아직 실행한 작업이 없습니다.</div></div>
    </section>
    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{svc.lastSync()}}</p>
  `,
})
export class ArgoCdComponent {
  readonly svc = inject(ArgoCdService);
  readonly vr = inject(ViewRouter);
  readonly tabs: PluginPageTab[] = deliveryAdminTabs('Applications & Projects');
  readonly active = computed(() => this.vr.detail());

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  select(tab: string): void { this.vr.setDetail(tab); }
  back(): void { this.vr.setTab('overview'); }
  readyWorkloads(): number { return this.svc.workloads().filter((row) => row.state === 'ready').length; }
  shortRevision(revision?: string): string { return revision ? revision.slice(0, 12) : '—'; }
  stateClass(state: DeliveryProbeState): string {
    if (state === 'ready') return 'label-success';
    if (state === 'degraded' || state === 'loading') return 'label-warning';
    if (state === 'noperm') return 'label-info';
    return 'label-danger';
  }
  stateLabel(state: DeliveryProbeState): string {
    return ({
      loading: '확인 중',
      ready: 'Ready',
      degraded: 'Degraded',
      missing: 'Missing',
      noperm: '권한 필요',
      error: 'Error',
    } as Record<DeliveryProbeState, string>)[state];
  }
  canSync(app: ArgoApplication): boolean {
    return this.svc.runtimeReady()
      && this.svc.actionState() !== 'running'
      && app.sync !== 'Synced'
      && !/app path does not exist|path.*does not exist/i.test(app.condition);
  }
  confirmSync(app: ArgoApplication): void {
    const message = `${app.name}을 ${app.targetRevision || 'HEAD'} revision으로 동기화하시겠습니까?\n\nprune과 namespace 자동 생성은 허용하지 않습니다.`;
    if (window.confirm(message)) void this.svc.syncApplication(app);
  }
  headerModel(): PluginPageHeaderModel {
    const version = this.svc.workloads().find((row) => row.image)?.image || 'runtime 미수집';
    return {
      name: 'Argo CD / ApplicationSet',
      logo: LOGO,
      stack: 'Platform Delivery',
      capability: 'delivery.gitops',
      description: '서명된 desired state를 동기화하는 기본 write-path. 설치 완료와 Delivery 준비 상태를 분리해 관리합니다.',
      lifecycle: this.svc.phaseLabel(),
      lifecycleClass: this.svc.phaseClass(),
      version,
      profile: 'primary-write-path',
      namespace: 'argocd',
    };
  }
}
