import { Injectable, computed, signal } from '@angular/core';
import { apiBase, hostFetch } from '../../api-base';

export type CrossplaneProbeState = 'loading' | 'ready' | 'degraded' | 'missing' | 'noperm' | 'error';

export interface CrossplanePrerequisite {
  id: string;
  label: string;
  state: CrossplaneProbeState;
  evidence: string;
  owner: string;
}

export interface CrossplaneWorkload {
  name: string;
  ready: number;
  desired: number;
  image: string;
  state: CrossplaneProbeState;
}

export interface ProviderRow {
  name: string;
  installed: boolean;
  healthy: boolean;
  package: string;
  revision: string;
  message: string;
}

export interface ReleaseRow {
  name: string;
  namespace: string;
  chart: string;
  synced: boolean;
  ready: boolean;
  state: string;
  message: string;
}

export interface CrossplaneEvent {
  type: string;
  reason: string;
  object: string;
  message: string;
  time: string;
}

type K8sResult = { ok: boolean; status: number; body: any };

const NS = 'crossplane-system';
const PROVIDER_CONFIG_PATHS = [
  'apis/helm.crossplane.io/v1beta1/providerconfigs',
  'apis/helm.m.crossplane.io/v1beta1/providerconfigs',
];
const RELEASE_PATHS = [
  'apis/helm.crossplane.io/v1beta1/releases',
  'apis/helm.m.crossplane.io/v1beta1/releases',
];

@Injectable({ providedIn: 'root' })
export class CrossplaneService {
  readonly crdState = signal<CrossplaneProbeState>('loading');
  readonly coreState = signal<CrossplaneProbeState>('loading');
  readonly rbacState = signal<CrossplaneProbeState>('loading');
  readonly providerApiState = signal<CrossplaneProbeState>('loading');
  readonly providerConfigState = signal<CrossplaneProbeState>('loading');
  readonly workloads = signal<CrossplaneWorkload[]>([]);
  readonly providers = signal<ProviderRow[]>([]);
  readonly providerConfigs = signal<string[]>([]);
  readonly releases = signal<ReleaseRow[]>([]);
  readonly events = signal<CrossplaneEvent[]>([]);
  readonly lastSync = signal('');
  readonly busy = signal(false);
  readonly actionState = signal<'idle' | 'running' | 'error' | 'success'>('idle');
  readonly actionMessage = signal('');
  readonly actionLog = signal<string[]>([]);

  private started = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private providerConfigApi = PROVIDER_CONFIG_PATHS[0];

  readonly runtimeInstalled = computed(() =>
    this.crdState() === 'ready' || this.workloads().some((row) => row.desired > 0));
  readonly runtimeReady = computed(() =>
    this.coreState() === 'ready' && this.rbacState() === 'ready' && this.crdState() === 'ready');
  readonly healthyProviderCount = computed(() =>
    this.providers().filter((provider) => provider.healthy).length);
  readonly providerHelm = computed(() =>
    this.providers().find((provider) => /provider-helm/i.test(`${provider.name} ${provider.package}`)) ?? null);
  readonly providerHelmReady = computed(() =>
    !!this.providerHelm()?.installed && !!this.providerHelm()?.healthy);
  readonly defaultProviderConfigReady = computed(() =>
    this.providerConfigs().includes('default'));
  readonly adapterReady = computed(() =>
    this.runtimeReady() && this.providerHelmReady() && this.defaultProviderConfigReady());
  readonly readyReleaseCount = computed(() =>
    this.releases().filter((release) => release.ready && release.synced).length);
  readonly phaseLabel = computed(() => {
    if (this.busy() && !this.lastSync()) return '확인 중';
    if (!this.runtimeInstalled()) return 'Not Installed';
    if (!this.runtimeReady()) return 'Runtime Degraded';
    return this.adapterReady() ? 'Adapter Ready' : 'Adapter Degraded';
  });
  readonly phaseClass = computed(() =>
    this.adapterReady() ? 'label-success' : (this.runtimeInstalled() ? 'label-danger' : 'label-warning'));
  readonly statusReason = computed(() => {
    if (!this.runtimeInstalled()) {
      return 'Crossplane core가 설치되지 않았습니다. 호스트 prerequisite 소유자인 Cluster Manager에서 설치해야 합니다.';
    }
    if (!this.runtimeReady()) return 'Crossplane core 또는 RBAC manager가 Ready가 아니거나 API discovery가 완료되지 않았습니다.';
    if (!this.providerHelm()) return '승인된 provider-helm package가 설치되지 않았습니다.';
    if (!this.providerHelmReady()) return `provider-helm이 Healthy가 아닙니다: ${this.providerHelm()?.message || 'condition 확인 필요'}`;
    if (!this.defaultProviderConfigReady()) return 'provider-helm default ProviderConfig가 없습니다.';
    return 'Crossplane core와 provider-helm adapter가 운영 준비되었습니다.';
  });
  readonly prerequisites = computed<CrossplanePrerequisite[]>(() => [
    {
      id: 'core-api',
      label: 'Crossplane core CRD/API',
      state: this.crdState(),
      evidence: this.crdState() === 'ready' ? 'providers.pkg.crossplane.io API 발견' : 'Crossplane package API 발견 필요',
      owner: 'Cluster Manager · HISS',
    },
    {
      id: 'runtime',
      label: 'Core 및 RBAC manager',
      state: this.runtimeReady() ? 'ready' : (this.runtimeInstalled() ? 'degraded' : 'missing'),
      evidence: `${this.workloads().filter((row) => row.state === 'ready').length}/2 workload Ready`,
      owner: 'Cluster Manager · HISS',
    },
    {
      id: 'provider',
      label: '승인 provider-helm package',
      state: this.providerHelmReady() ? 'ready' : (this.providerHelm() ? 'degraded' : 'missing'),
      evidence: this.providerHelm()?.package || 'provider-helm Provider 미발견',
      owner: 'HISS release BOM',
    },
    {
      id: 'provider-config',
      label: 'Default ProviderConfig',
      state: this.defaultProviderConfigReady() ? 'ready' : (this.providerHelmReady() ? 'missing' : 'degraded'),
      evidence: this.defaultProviderConfigReady() ? 'ProviderConfig/default · InjectedIdentity' : 'ProviderConfig/default 미발견',
      owner: 'Foundation Platform Delivery',
    },
    {
      id: 'write-path',
      label: 'GitOps primary write-path',
      state: 'ready',
      evidence: 'Crossplane은 optional adapter이며 Argo CD를 대체하지 않음',
      owner: 'Main Shell Platform Delivery',
    },
  ]);

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

  private async request(path: string, init?: RequestInit): Promise<K8sResult> {
    try {
      const response = await hostFetch(this.k(path), { cache: 'no-store', ...init });
      const text = await response.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
      return { ok: response.ok, status: response.status, body };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }

  private stateFor(result: K8sResult): CrossplaneProbeState {
    if (result.ok) return 'ready';
    if (result.status === 403) return 'noperm';
    if (result.status === 404) return 'missing';
    return 'error';
  }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await Promise.all([
        this.loadCrds(),
        this.loadWorkloads(),
        this.loadProviders(),
        this.loadProviderConfigs(),
        this.loadReleases(),
        this.loadEvents(),
      ]);
      this.lastSync.set(new Date().toLocaleTimeString());
    } finally {
      this.busy.set(false);
    }
  }

  private async loadCrds(): Promise<void> {
    const result = await this.request('apis/apiextensions.k8s.io/v1/customresourcedefinitions/providers.pkg.crossplane.io');
    this.crdState.set(this.stateFor(result));
  }

  private async loadWorkloads(): Promise<void> {
    const names = ['crossplane', 'crossplane-rbac-manager'];
    const rows = await Promise.all(names.map(async (name): Promise<CrossplaneWorkload> => {
      const result = await this.request(`apis/apps/v1/namespaces/${NS}/deployments/${name}`);
      if (!result.ok) return { name, ready: 0, desired: 0, image: '', state: this.stateFor(result) };
      const desired = Number(result.body?.spec?.replicas ?? 0);
      const ready = Number(result.body?.status?.readyReplicas ?? 0);
      const updated = Number(result.body?.status?.updatedReplicas ?? 0);
      return {
        name,
        desired,
        ready,
        image: String(result.body?.spec?.template?.spec?.containers?.[0]?.image || ''),
        state: desired > 0 && ready >= desired && updated >= desired ? 'ready' : 'degraded',
      };
    }));
    this.workloads.set(rows);
    this.coreState.set(rows[0]?.state ?? 'missing');
    this.rbacState.set(rows[1]?.state ?? 'missing');
  }

  private async loadProviders(): Promise<void> {
    const result = await this.request('apis/pkg.crossplane.io/v1/providers');
    this.providerApiState.set(this.stateFor(result));
    if (!result.ok) {
      this.providers.set([]);
      return;
    }
    this.providers.set((result.body?.items || []).map((item: any): ProviderRow => {
      const conditions: any[] = item.status?.conditions || [];
      const installed = conditions.some((condition) => condition.type === 'Installed' && condition.status === 'True');
      const healthy = conditions.some((condition) => condition.type === 'Healthy' && condition.status === 'True');
      const message = conditions
        .filter((condition) => condition.status !== 'True')
        .map((condition) => condition.message || condition.reason)
        .filter(Boolean).join(' · ');
      return {
        name: String(item.metadata?.name || ''),
        installed,
        healthy,
        package: String(item.spec?.package || ''),
        revision: String(item.status?.currentRevision || ''),
        message,
      };
    }));
  }

  private async firstAvailable(paths: string[]): Promise<{ path: string; result: K8sResult }> {
    let last: K8sResult = { ok: false, status: 404, body: {} };
    for (const path of paths) {
      const result = await this.request(path);
      if (result.ok || result.status !== 404) return { path, result };
      last = result;
    }
    return { path: paths[0], result: last };
  }

  private async loadProviderConfigs(): Promise<void> {
    const { path, result } = await this.firstAvailable(PROVIDER_CONFIG_PATHS);
    this.providerConfigApi = path;
    this.providerConfigState.set(this.stateFor(result));
    this.providerConfigs.set(result.ok
      ? (result.body?.items || []).map((item: any) => String(item.metadata?.name || '')).filter(Boolean)
      : []);
  }

  private async loadReleases(): Promise<void> {
    const { result } = await this.firstAvailable(RELEASE_PATHS);
    if (!result.ok) {
      this.releases.set([]);
      return;
    }
    this.releases.set((result.body?.items || []).map((item: any): ReleaseRow => {
      const conditions: any[] = item.status?.conditions || [];
      const synced = conditions.some((condition) => condition.type === 'Synced' && condition.status === 'True');
      const ready = conditions.some((condition) => condition.type === 'Ready' && condition.status === 'True');
      return {
        name: String(item.metadata?.name || ''),
        namespace: String(item.spec?.forProvider?.namespace || ''),
        chart: String(item.spec?.forProvider?.chart?.name || ''),
        synced,
        ready,
        state: String(item.status?.atProvider?.state || ''),
        message: conditions.map((condition) => condition.message).filter(Boolean).join(' · '),
      };
    }));
  }

  private async loadEvents(): Promise<void> {
    const result = await this.request(`api/v1/namespaces/${NS}/events?limit=60`);
    if (!result.ok) {
      this.events.set([]);
      return;
    }
    const rows: CrossplaneEvent[] = (result.body?.items || []).map((item: any) => ({
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

  async createDefaultProviderConfig(): Promise<void> {
    if (this.actionState() === 'running' || !this.providerHelmReady()) return;
    this.actionState.set('running');
    this.actionMessage.set('');
    this.log('ProviderConfig/default 생성 요청 · InjectedIdentity');
    const apiVersion = this.providerConfigApi.startsWith('apis/helm.m.')
      ? 'helm.m.crossplane.io/v1beta1'
      : 'helm.crossplane.io/v1beta1';
    const result = await this.request(this.providerConfigApi, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiVersion,
        kind: 'ProviderConfig',
        metadata: { name: 'default', labels: { 'opensphere.io/managed-by': 'foundation-platform-delivery' } },
        spec: { credentials: { source: 'InjectedIdentity' } },
      }),
    });
    if (!result.ok && result.status !== 409) {
      const reason = result.status === 403
        ? 'Console 관리자에게 ProviderConfig 생성 권한이 없습니다.'
        : `ProviderConfig 생성 실패 HTTP ${result.status}: ${String(result.body?.message || '').slice(0, 240)}`;
      this.actionState.set('error');
      this.actionMessage.set(reason);
      this.log(reason);
      return;
    }
    this.actionState.set('success');
    this.actionMessage.set(result.status === 409
      ? 'ProviderConfig/default가 이미 존재합니다.'
      : 'ProviderConfig/default를 InjectedIdentity 방식으로 생성했습니다.');
    this.log(this.actionMessage());
    await this.refresh();
  }

  dismissAction(): void {
    this.actionState.set('idle');
    this.actionMessage.set('');
  }
}
