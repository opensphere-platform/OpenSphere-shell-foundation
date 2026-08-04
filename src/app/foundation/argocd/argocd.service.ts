import { Injectable, computed, signal } from '@angular/core';
import { apiBase, hostFetch } from '../../api-base';

export type DeliveryProbeState = 'loading' | 'ready' | 'degraded' | 'missing' | 'noperm' | 'error';

export interface DeliveryPrerequisite {
  id: string;
  label: string;
  state: DeliveryProbeState;
  evidence: string;
  owner: string;
}

export interface ArgoWorkload {
  id: string;
  name: string;
  kind: 'Deployment' | 'StatefulSet';
  ready: number;
  desired: number;
  updated: number;
  image: string;
  state: DeliveryProbeState;
}

export interface ArgoApplication {
  name: string;
  project: string;
  repoUrl: string;
  path: string;
  targetRevision: string;
  destination: string;
  sync: string;
  health: string;
  revision: string;
  automated: boolean;
  condition: string;
  operationPhase: string;
  history: Array<{ id: number; revision: string; deployedAt: string }>;
}

export interface ArgoProject {
  name: string;
  destinations: number;
  sourceRepos: number;
  description: string;
}

export interface DeliveryEvent {
  type: string;
  reason: string;
  object: string;
  message: string;
  time: string;
}

type K8sResult = { ok: boolean; status: number; body: any };

const NS = 'argocd';
const VERIFY_APP = 'opensphere-platform-delivery-verify';
const REQUIRED_WORKLOADS: Array<{ id: string; name: string; kind: 'Deployment' | 'StatefulSet' }> = [
  { id: 'application-controller', name: 'argocd-application-controller', kind: 'StatefulSet' },
  { id: 'repo-server', name: 'argocd-repo-server', kind: 'Deployment' },
  { id: 'server', name: 'argocd-server', kind: 'Deployment' },
  { id: 'applicationset-controller', name: 'argocd-applicationset-controller', kind: 'Deployment' },
];

@Injectable({ providedIn: 'root' })
export class ArgoCdService {
  readonly crdState = signal<DeliveryProbeState>('loading');
  readonly apiState = signal<DeliveryProbeState>('loading');
  readonly workloads = signal<ArgoWorkload[]>([]);
  readonly applications = signal<ArgoApplication[]>([]);
  readonly projects = signal<ArgoProject[]>([]);
  readonly events = signal<DeliveryEvent[]>([]);
  readonly lastSync = signal('');
  readonly busy = signal(false);
  readonly actionState = signal<'idle' | 'running' | 'error' | 'success'>('idle');
  readonly actionMessage = signal('');
  readonly actionLog = signal<string[]>([]);

  private started = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  readonly runtimeInstalled = computed(() =>
    this.crdState() === 'ready' || this.workloads().some((row) => row.desired > 0));
  readonly runtimeReady = computed(() => {
    const rows = this.workloads();
    return rows.length === REQUIRED_WORKLOADS.length && rows.every((row) => row.state === 'ready');
  });
  readonly verifyApplication = computed(() =>
    this.applications().find((app) => app.name === VERIFY_APP) ?? null);
  readonly deliveryReady = computed(() => {
    const app = this.verifyApplication();
    return this.runtimeReady() && !!app
      && app.sync === 'Synced'
      && app.health === 'Healthy'
      && /^[a-f0-9]{40}$/i.test(app.revision);
  });
  readonly sourcePathMissing = computed(() =>
    /app path does not exist|path.*does not exist/i.test(this.verifyApplication()?.condition || ''));
  readonly revisionPinned = computed(() =>
    /^[a-f0-9]{40}$/i.test(this.verifyApplication()?.revision || ''));
  readonly phaseLabel = computed(() => {
    if (this.busy() && !this.lastSync()) return '확인 중';
    if (!this.runtimeInstalled()) return 'Not Installed';
    if (!this.runtimeReady()) return 'Runtime Degraded';
    return this.deliveryReady() ? 'Delivery Ready' : 'Delivery Degraded';
  });
  readonly phaseClass = computed(() => {
    if (this.deliveryReady()) return 'label-success';
    if (!this.runtimeInstalled()) return 'label-warning';
    return 'label-danger';
  });
  readonly statusReason = computed(() => {
    if (!this.runtimeInstalled()) return 'Argo CD runtime이 설치되지 않았습니다.';
    if (!this.runtimeReady()) {
      const failed = this.workloads().filter((row) => row.state !== 'ready').map((row) => row.name);
      return `필수 workload가 Ready가 아닙니다: ${failed.join(', ') || '상태 확인 필요'}`;
    }
    const app = this.verifyApplication();
    if (!app) return `${VERIFY_APP} 검증 Application이 없습니다.`;
    if (this.sourcePathMissing()) return `선언 저장소 경로 ${app.path || 'platform-delivery/verification'}가 없습니다.`;
    if (app.sync !== 'Synced') return `검증 Application sync 상태가 ${app.sync || 'Unknown'}입니다.`;
    if (app.health !== 'Healthy') return `검증 Application health 상태가 ${app.health || 'Unknown'}입니다.`;
    if (!this.revisionPinned()) return '검증 Application이 해소된 Git commit SHA를 보고하지 않습니다.';
    return 'Argo CD runtime과 검증 Application이 모두 준비되었습니다.';
  });
  readonly prerequisites = computed<DeliveryPrerequisite[]>(() => {
    const app = this.verifyApplication();
    return [
      {
        id: 'crds',
        label: 'Argo CD CRD/API',
        state: this.crdState(),
        evidence: this.crdState() === 'ready' ? 'Application · AppProject · ApplicationSet API 발견' : 'CRD/API discovery 필요',
        owner: 'Main Shell Platform Delivery',
      },
      {
        id: 'runtime',
        label: '필수 controller runtime',
        state: this.runtimeReady() ? 'ready' : (this.runtimeInstalled() ? 'degraded' : 'missing'),
        evidence: `${this.workloads().filter((row) => row.state === 'ready').length}/${REQUIRED_WORKLOADS.length} workload Ready`,
        owner: 'Main Shell Platform Delivery',
      },
      {
        id: 'repository',
        label: 'Governed Gitea repository',
        state: app?.repoUrl?.includes('opensphere-gitea') ? 'ready' : (app ? 'degraded' : 'missing'),
        evidence: app?.repoUrl || '검증 Application source 미발견',
        owner: 'CBS Gitea · read-only SecretRef',
      },
      {
        id: 'project',
        label: 'AppProject 경계',
        state: app && this.projects().some((project) => project.name === app.project) ? 'ready' : 'missing',
        evidence: app?.project || '검증 AppProject 미발견',
        owner: 'Platform Delivery policy',
      },
      {
        id: 'source-path',
        label: '서명 desired-state 경로',
        state: this.sourcePathMissing() ? 'degraded' : (app?.path ? 'ready' : 'missing'),
        evidence: this.sourcePathMissing() ? this.statusReason() : (app?.path || 'source path 미발견'),
        owner: 'Gitea Change Control',
      },
      {
        id: 'revision',
        label: '불변 Git revision',
        state: this.revisionPinned() ? 'ready' : (app ? 'degraded' : 'missing'),
        evidence: this.revisionPinned() ? app!.revision : `현재 revision: ${app?.targetRevision || '미수집'}`,
        owner: 'Argo CD reconciliation',
      },
    ];
  });

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 15000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.started = false;
  }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  private async get(path: string): Promise<K8sResult> {
    try {
      const response = await hostFetch(this.k(path), { cache: 'no-store' });
      const text = await response.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
      return { ok: response.ok, status: response.status, body };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await Promise.all([
        this.loadCrds(),
        this.loadWorkloads(),
        this.loadApplications(),
        this.loadProjects(),
        this.loadEvents(),
      ]);
      this.lastSync.set(new Date().toLocaleTimeString());
    } finally {
      this.busy.set(false);
    }
  }

  private async loadCrds(): Promise<void> {
    const paths = [
      'apis/apiextensions.k8s.io/v1/customresourcedefinitions/applications.argoproj.io',
      'apis/apiextensions.k8s.io/v1/customresourcedefinitions/appprojects.argoproj.io',
      'apis/apiextensions.k8s.io/v1/customresourcedefinitions/applicationsets.argoproj.io',
    ];
    const results = await Promise.all(paths.map((path) => this.get(path)));
    if (results.some((result) => result.status === 403)) this.crdState.set('noperm');
    else if (results.every((result) => result.ok)) this.crdState.set('ready');
    else if (results.every((result) => result.status === 404)) this.crdState.set('missing');
    else this.crdState.set(results.some((result) => result.status === 0) ? 'error' : 'degraded');
  }

  private async loadWorkloads(): Promise<void> {
    const rows = await Promise.all(REQUIRED_WORKLOADS.map(async (workload): Promise<ArgoWorkload> => {
      const plural = workload.kind === 'Deployment' ? 'deployments' : 'statefulsets';
      const result = await this.get(`apis/apps/v1/namespaces/${NS}/${plural}/${workload.name}`);
      if (!result.ok) {
        return {
          ...workload,
          ready: 0,
          desired: 0,
          updated: 0,
          image: '',
          state: result.status === 403 ? 'noperm' : (result.status === 404 ? 'missing' : 'error'),
        };
      }
      const desired = Number(result.body?.spec?.replicas ?? 0);
      const ready = Number(result.body?.status?.readyReplicas ?? 0);
      const updated = Number(result.body?.status?.updatedReplicas ?? 0);
      const image = String(result.body?.spec?.template?.spec?.containers?.[0]?.image ?? '');
      return {
        ...workload,
        ready,
        desired,
        updated,
        image,
        state: desired > 0 && ready >= desired && updated >= desired ? 'ready' : 'degraded',
      };
    }));
    this.workloads.set(rows);
  }

  private applicationRow(item: any): ArgoApplication {
    const status = item.status || {};
    const spec = item.spec || {};
    const conditions = (status.conditions || []).map((condition: any) =>
      `${condition.type || 'Condition'}: ${condition.message || ''}`).join(' · ');
    return {
      name: String(item.metadata?.name || ''),
      project: String(spec.project || 'default'),
      repoUrl: String(spec.source?.repoURL || ''),
      path: String(spec.source?.path || ''),
      targetRevision: String(spec.source?.targetRevision || ''),
      destination: String(spec.destination?.namespace || spec.destination?.server || ''),
      sync: String(status.sync?.status || 'Unknown'),
      health: String(status.health?.status || 'Unknown'),
      revision: String(status.sync?.revision || ''),
      automated: !!spec.syncPolicy?.automated,
      condition: conditions,
      operationPhase: String(status.operationState?.phase || ''),
      history: (status.history || []).slice(-5).reverse().map((history: any) => ({
        id: Number(history.id ?? 0),
        revision: String(history.revision || ''),
        deployedAt: String(history.deployedAt || ''),
      })),
    };
  }

  private async loadApplications(): Promise<void> {
    const result = await this.get(`apis/argoproj.io/v1alpha1/namespaces/${NS}/applications`);
    if (!result.ok) {
      this.apiState.set(result.status === 403 ? 'noperm' : (result.status === 404 ? 'missing' : 'error'));
      this.applications.set([]);
      return;
    }
    this.apiState.set('ready');
    this.applications.set((result.body?.items || []).map((item: any) => this.applicationRow(item)));
  }

  private async loadProjects(): Promise<void> {
    const result = await this.get(`apis/argoproj.io/v1alpha1/namespaces/${NS}/appprojects`);
    if (!result.ok) {
      this.projects.set([]);
      return;
    }
    this.projects.set((result.body?.items || []).map((item: any) => ({
      name: String(item.metadata?.name || ''),
      destinations: Number(item.spec?.destinations?.length || 0),
      sourceRepos: Number(item.spec?.sourceRepos?.length || 0),
      description: String(item.spec?.description || ''),
    })));
  }

  private async loadEvents(): Promise<void> {
    const result = await this.get(`api/v1/namespaces/${NS}/events?limit=60`);
    if (!result.ok) {
      this.events.set([]);
      return;
    }
    const rows: DeliveryEvent[] = (result.body?.items || []).map((item: any) => ({
      type: String(item.type || 'Normal'),
      reason: String(item.reason || ''),
      object: `${item.involvedObject?.kind || ''}/${item.involvedObject?.name || ''}`,
      message: String(item.message || ''),
      time: String(item.eventTime || item.lastTimestamp || item.metadata?.creationTimestamp || ''),
    }));
    this.events.set(rows.sort((left, right) => right.time.localeCompare(left.time)).slice(0, 40));
  }

  private log(message: string): void {
    this.actionLog.update((rows) => [...rows.slice(-30), `${new Date().toLocaleTimeString()} · ${message}`]);
  }

  private async patchApplication(name: string, body: Record<string, unknown>): Promise<boolean> {
    const response = await hostFetch(this.k(`apis/argoproj.io/v1alpha1/namespaces/${NS}/applications/${encodeURIComponent(name)}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      const reason = response.status === 403
        ? 'Console 관리자에게 Argo CD Application patch 권한이 없습니다.'
        : `Application 변경 실패 HTTP ${response.status}: ${text.slice(0, 240)}`;
      this.actionState.set('error');
      this.actionMessage.set(reason);
      this.log(reason);
      return false;
    }
    return true;
  }

  async hardRefresh(name = VERIFY_APP): Promise<void> {
    if (this.actionState() === 'running') return;
    this.actionState.set('running');
    this.actionMessage.set('');
    this.log(`${name} hard refresh 요청`);
    try {
      const ok = await this.patchApplication(name, {
        metadata: { annotations: { 'argocd.argoproj.io/refresh': 'hard' } },
      });
      if (!ok) return;
      this.actionState.set('success');
      this.actionMessage.set('Argo CD에 hard refresh를 요청했습니다. 최신 condition을 다시 확인합니다.');
      this.log('hard refresh 요청 승인');
      await this.refresh();
    } catch {
      this.actionState.set('error');
      this.actionMessage.set('Argo CD refresh 요청 중 네트워크 오류가 발생했습니다.');
    }
  }

  async syncApplication(app: ArgoApplication): Promise<void> {
    if (this.actionState() === 'running' || !app.name || this.sourcePathMissing()) return;
    this.actionState.set('running');
    this.actionMessage.set('');
    this.log(`${app.name} sync 요청 · prune=false`);
    try {
      const ok = await this.patchApplication(app.name, {
        operation: {
          initiatedBy: { username: 'opensphere-console' },
          sync: {
            revision: app.targetRevision || 'HEAD',
            prune: false,
            syncOptions: ['CreateNamespace=false'],
          },
        },
      });
      if (!ok) return;
      this.actionState.set('success');
      this.actionMessage.set('동기화를 요청했습니다. prune과 namespace 생성은 허용하지 않았습니다.');
      this.log('sync 요청 승인');
      await this.refresh();
    } catch {
      this.actionState.set('error');
      this.actionMessage.set('Argo CD sync 요청 중 네트워크 오류가 발생했습니다.');
    }
  }

  dismissAction(): void {
    this.actionState.set('idle');
    this.actionMessage.set('');
  }
}
