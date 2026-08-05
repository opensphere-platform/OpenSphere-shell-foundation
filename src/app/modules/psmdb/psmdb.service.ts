import { Injectable, computed, inject, signal } from '@angular/core';
import { apiBase, hostFetch, writeHeaders } from '../../api-base';
import { DataEngineRuntimeService } from '../data-engine/data-engine-runtime.service';

export interface PsmdbDatabase {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
  collections: Array<{ name: string; type: string }>;
  users: Array<{ user: string; db: string; roles: Array<{ role?: string; name?: string; db: string }> }>;
}

export interface PsmdbSummary {
  observedAt: string;
  version: string;
  process: string;
  uptimeSeconds: number;
  connections: { current: number; available: number; active: number };
  opcounters: Record<string, number>;
  memory: Record<string, number>;
  network: Record<string, number>;
  replicaSet: null | { set: string; state: number; members: Array<{ name: string; state: string; health: number; uptime: number; optimeDate?: string }> };
  databaseCount: number;
  databases: PsmdbDatabase[];
  desiredUsers: Array<{ name: string; db: string; roles: Array<{ name: string; db: string }> }>;
  image: string;
  crVersion: string;
}

export interface PsmdbSeries { labels: string[]; cpu: number[]; memory: number[]; restarts: number[]; pvc: number[] }
const EMPTY_SERIES: PsmdbSeries = { labels: [], cpu: [], memory: [], restarts: [], pvc: [] };

@Injectable({ providedIn: 'root' })
export class PsmdbService {
  readonly runtime = inject(DataEngineRuntimeService);
  readonly summary = signal<PsmdbSummary | null>(null);
  readonly summaryState = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly summaryError = signal('');
  readonly metrics = signal<PsmdbSeries>(EMPTY_SERIES);
  readonly metricsState = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly metricsHint = signal('Prometheus에서 PSMDB Kubernetes 런타임 시계열을 확인하고 있습니다.');
  readonly busy = signal(false);
  readonly operationError = signal('');
  readonly lastSync = signal('');
  private timer?: ReturnType<typeof setInterval>;
  private refs = 0;

  readonly rt = computed(() => this.runtime.runtime('psmdb'));
  readonly exists = computed(() => this.rt().state === 'ok' && !!this.rt().resource);
  readonly ready = computed(() => this.runtime.ready('psmdb'));
  readonly readyN = computed(() => this.runtime.readyN('psmdb'));
  readonly totalN = computed(() => this.runtime.totalN('psmdb'));
  readonly availability = computed(() => this.totalN() ? Math.round(this.readyN() / this.totalN() * 100) : 0);
  readonly collectionCount = computed(() => this.summary()?.databases.reduce((n, db) => n + db.collections.length, 0) ?? 0);

  start(): void {
    this.refs++;
    this.runtime.start();
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 15000);
  }

  stop(): void {
    this.refs = Math.max(0, this.refs - 1);
    this.runtime.stop();
    if (this.refs || !this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.runtime.refresh('psmdb');
      await Promise.allSettled([this.loadSummary(), this.loadMetrics()]);
      this.lastSync.set(new Date().toLocaleTimeString());
    } finally {
      this.busy.set(false);
    }
  }

  async mutateCollection(action: 'create' | 'drop', database: string, collection: string, reason: string): Promise<void> {
    this.operationError.set('');
    await this.post('collection', { action, database, collection, reason });
    await this.loadSummary();
  }

  async manageUser(action: 'set' | 'delete', username: string, database: string, role: string, reason: string): Promise<void> {
    this.operationError.set('');
    await this.post('user', { action, username, database, role, reason });
    await this.loadSummary();
  }

  private api(path: string): string { return `${apiBase()}/api/foundation/psmdb/${path}`; }
  private prom(path: string): string { return `${apiBase()}/api/prometheus/${path}`; }

  private async loadSummary(): Promise<void> {
    if (!this.exists()) {
      this.summary.set(null);
      this.summaryState.set('empty');
      this.summaryError.set('PerconaServerMongoDB가 생성되면 실제 database·collection·replica 상태를 표시합니다.');
      return;
    }
    try {
      const response = await hostFetch(this.api('summary'), { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      this.summary.set(body as PsmdbSummary);
      this.summaryState.set('ok');
      this.summaryError.set('');
    } catch (error) {
      this.summaryState.set('error');
      this.summaryError.set(`PSMDB 관리 API 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    try {
      const response = await hostFetch(this.api(path), { method: 'POST', headers: writeHeaders(), body: JSON.stringify(body), cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    } catch (error) {
      this.operationError.set(String((error as Error)?.message ?? error));
      throw error;
    }
  }

  private async loadMetrics(): Promise<void> {
    if (!this.exists()) {
      this.metrics.set(EMPTY_SERIES);
      this.metricsState.set('empty');
      this.metricsHint.set('PSMDB가 생성되면 Prometheus의 Pod·컨테이너·PVC 최근 1시간 시계열을 표시합니다.');
      return;
    }
    const end = Math.floor(Date.now() / 1000), start = end - 3600;
    const pod = 'pod=~"foundation-data-mongodb-rs0-.*"';
    try {
      const [cpu, memory, restarts, pvc] = await Promise.all([
        this.range(`sum(rate(container_cpu_usage_seconds_total{namespace="opensphere-foundation",${pod},container!="",container!="POD"}[5m]))`, start, end),
        this.range(`sum(container_memory_working_set_bytes{namespace="opensphere-foundation",${pod},container!="",container!="POD"})`, start, end),
        this.range(`sum(increase(kube_pod_container_status_restarts_total{namespace="opensphere-foundation",${pod}}[10m]))`, start, end),
        this.range('sum(kubelet_volume_stats_used_bytes{namespace="opensphere-foundation",persistentvolumeclaim=~"mongod-data-foundation-data-mongodb-rs0-.*"})', start, end),
      ]);
      const base = cpu.length ? cpu : memory.length ? memory : restarts.length ? restarts : pvc;
      if (!base.length) {
        this.metrics.set(EMPTY_SERIES);
        this.metricsState.set('empty');
        this.metricsHint.set('Prometheus 연결은 가능하지만 PSMDB Pod/PVC 시계열이 없습니다. Targets와 kubelet/cAdvisor 수집을 확인하세요.');
        return;
      }
      this.metrics.set({
        labels: base.map(([time]) => new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        cpu: this.align(base, cpu), memory: this.align(base, memory), restarts: this.align(base, restarts), pvc: this.align(base, pvc),
      });
      this.metricsState.set('ok');
      this.metricsHint.set('Prometheus Kubernetes runtime metrics · 최근 1시간 · 10분 간격');
    } catch (error) {
      this.metrics.set(EMPTY_SERIES);
      this.metricsState.set('error');
      this.metricsHint.set(`Prometheus 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  private async range(expr: string, start: number, end: number): Promise<[number, number][]> {
    const query = new URLSearchParams({ query: expr, start: String(start), end: String(end), step: '600' });
    const response = await hostFetch(this.prom(`api/v1/query_range?${query.toString()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.status !== 'success') throw new Error(body.error || 'Prometheus query failed');
    return (body.data?.result?.[0]?.values ?? []).map(([time, value]: [number, string]) => [Number(time), Number(value)] as [number, number]).filter(([, value]: [number, number]) => Number.isFinite(value));
  }

  private align(base: [number, number][], source: [number, number][]): number[] {
    const values = new Map(source.map(([time, value]) => [time, value]));
    return base.map(([time]) => values.get(time) ?? 0);
  }
}
