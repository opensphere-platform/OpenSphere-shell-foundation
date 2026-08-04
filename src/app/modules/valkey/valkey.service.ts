import { Injectable, computed, inject, signal } from '@angular/core';
import { apiBase, hostFetch, writeHeaders } from '../../api-base';
import { DataEngineRuntimeService } from '../data-engine/data-engine-runtime.service';

export interface ValkeySummary {
  observedAt: string;
  version: string;
  role: string;
  uptimeSeconds: number;
  clients: number;
  blockedClients: number;
  usedMemory: number;
  usedMemoryHuman: string;
  peakMemoryHuman: string;
  maxmemoryPolicy: string;
  commandsProcessed: number;
  opsPerSec: number;
  hits: number;
  misses: number;
  evictedKeys: number;
  expiredKeys: number;
  connectedReplicas: number;
  masterLinkStatus: string;
  dbsize: number;
  databases: Array<{ name: string; keys?: string; expires?: string; avg_ttl?: string }>;
  config: Record<string, string>;
  persistence: { aofEnabled: boolean; aofRewriteStatus: string; rdbSaveStatus: string; loading: boolean };
  acl: string[];
  aclLog: unknown[];
  desired: Record<string, unknown>;
  secretRef: { namespace: string; name: string; key: string };
}

export interface ValkeyKeyRow { name: string; type: string; ttlMs: number; memoryBytes: number | null }
export interface ValkeyKeyDetail { db: number; key: string; type: string; ttlMs: number; memoryBytes: number | null; encoding: string; value: unknown; truncated: boolean }
export interface ValkeySeries { labels: string[]; ops: number[]; memory: number[]; clients: number[] }

const EMPTY_SERIES: ValkeySeries = { labels: [], ops: [], memory: [], clients: [] };

@Injectable({ providedIn: 'root' })
export class ValkeyService {
  readonly runtime = inject(DataEngineRuntimeService);
  readonly summary = signal<ValkeySummary | null>(null);
  readonly summaryState = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly summaryError = signal('');
  readonly metrics = signal<ValkeySeries>(EMPTY_SERIES);
  readonly metricsState = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly metricsHint = signal('Prometheus에서 Valkey exporter 시계열을 확인하고 있습니다.');
  readonly lastSync = signal('');
  readonly busy = signal(false);
  readonly keys = signal<ValkeyKeyRow[]>([]);
  readonly keyCursor = signal('0');
  readonly keyDetail = signal<ValkeyKeyDetail | null>(null);
  readonly operationError = signal('');
  readonly oneTimeCredential = signal('');
  private timer?: ReturnType<typeof setInterval>;
  private refs = 0;

  readonly rt = computed(() => this.runtime.runtime('valkey'));
  readonly exists = computed(() => this.rt().state === 'ok' && !!this.rt().resource);
  readonly ready = computed(() => this.runtime.ready('valkey'));
  readonly readyN = computed(() => this.runtime.readyN('valkey'));
  readonly totalN = computed(() => this.runtime.totalN('valkey'));
  readonly availability = computed(() => this.totalN() ? Math.round(this.readyN() / this.totalN() * 100) : 0);
  readonly hitRatio = computed(() => {
    const s = this.summary();
    const total = Number(s?.hits ?? 0) + Number(s?.misses ?? 0);
    return total ? Math.round(Number(s?.hits ?? 0) / total * 1000) / 10 : 0;
  });

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
    await this.runtime.refresh('valkey');
    await Promise.allSettled([this.loadSummary(), this.loadMetrics()]);
    this.lastSync.set(new Date().toLocaleTimeString());
    this.busy.set(false);
  }

  private api(path: string): string { return `${apiBase()}/api/foundation/valkey/${path}`; }
  private prom(path: string): string { return `${apiBase()}/api/prometheus/${path}`; }

  async loadSummary(): Promise<void> {
    if (!this.exists()) {
      this.summary.set(null);
      this.summaryState.set('empty');
      this.summaryError.set('Valkey StatefulSet이 생성되면 서버 상태를 표시합니다.');
      return;
    }
    try {
      const response = await hostFetch(this.api('summary'), { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      this.summary.set(body as ValkeySummary);
      this.summaryState.set('ok');
      this.summaryError.set('');
    } catch (error) {
      this.summaryState.set('error');
      this.summaryError.set(`Valkey 관리 API 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  async scan(db: number, pattern: string, count: number, type = '', cursor = '0'): Promise<void> {
    this.operationError.set('');
    const body = await this.post('scan', { db, pattern, count, type, cursor }, false);
    this.keys.set(body.keys ?? []);
    this.keyCursor.set(String(body.cursor ?? '0'));
    this.keyDetail.set(null);
  }

  async inspect(db: number, key: string): Promise<void> {
    this.operationError.set('');
    this.keyDetail.set(await this.post('key', { db, key }, false) as ValkeyKeyDetail);
  }

  async mutate(action: 'set' | 'delete' | 'expire' | 'persist', db: number, key: string, reason: string, value = '', ttlSeconds = 0): Promise<void> {
    this.operationError.set('');
    await this.post('mutation', { action, db, key, value, ttlSeconds, reason }, true);
    await Promise.allSettled([this.loadSummary(), this.inspect(db, key)]);
  }

  async manageAcl(action: 'setuser' | 'deluser', username: string, reason: string, password = '', keyPattern = '*', profile = 'readonly'): Promise<void> {
    this.operationError.set('');
    await this.post('acl', { action, username, password, keyPattern, profile, reason }, true);
    await this.loadSummary();
  }

  async createCredential(name: string, reason: string): Promise<void> {
    this.operationError.set('');
    const body = await this.post('credential', { name, reason }, true);
    this.oneTimeCredential.set(String(body.password || ''));
  }

  private async post(path: string, body: Record<string, unknown>, _write: boolean): Promise<any> {
    try {
      const response = await hostFetch(this.api(path), {
        method: 'POST', headers: writeHeaders(), body: JSON.stringify(body), cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      this.operationError.set(message);
      throw error;
    }
  }

  private async loadMetrics(): Promise<void> {
    if (!this.exists()) {
      this.metrics.set(EMPTY_SERIES);
      this.metricsState.set('empty');
      this.metricsHint.set('Valkey가 생성되면 exporter와 ServiceMonitor의 최근 1시간 시계열을 표시합니다.');
      return;
    }
    const end = Math.floor(Date.now() / 1000);
    const start = end - 3600;
    const match = '{namespace="opensphere-foundation",service="foundation-data-valkey-headless"}';
    try {
      const [ops, memory, clients] = await Promise.all([
        this.range(`sum(rate(redis_commands_processed_total${match}[5m]))`, start, end),
        this.range(`sum(redis_memory_used_bytes${match})`, start, end),
        this.range(`sum(redis_connected_clients${match})`, start, end),
      ]);
      const base = ops.length ? ops : memory.length ? memory : clients;
      if (!base.length) {
        this.metrics.set(EMPTY_SERIES);
        this.metricsState.set('empty');
        this.metricsHint.set('ServiceMonitor는 선언됐지만 Valkey exporter 시계열이 없습니다. Prometheus Targets와 exporter sidecar를 확인하세요.');
        return;
      }
      this.metrics.set({
        labels: base.map(([t]) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        ops: this.align(base, ops), memory: this.align(base, memory), clients: this.align(base, clients),
      });
      this.metricsState.set('ok');
      this.metricsHint.set('Valkey exporter · 최근 1시간 · 10분 간격');
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
