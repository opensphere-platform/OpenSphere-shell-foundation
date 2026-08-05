import { Injectable, computed, signal } from '@angular/core';
import { apiBase, hostFetch } from '../../api-base';

export interface OsMetricSeries {
  labels: string[];
  heap: number[];
  cpu: number[];
  diskAvailable: number[];
  documents: number[];
  storeBytes: number[];
  rejected: number[];
}

const EMPTY: OsMetricSeries = { labels: [], heap: [], cpu: [], diskAvailable: [], documents: [], storeBytes: [], rejected: [] };

@Injectable({ providedIn: 'root' })
export class OsMetricsService {
  readonly series = signal<OsMetricSeries>(EMPTY);
  readonly state = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly hint = signal('Prometheus에서 OpenSearch exporter 시계열을 확인하고 있습니다.');
  readonly target = signal<'checking' | 'up' | 'down' | 'missing'>('checking');
  readonly targetDetail = signal('ServiceMonitor target 확인 중');
  readonly busy = signal(false);
  readonly lastSync = signal('');
  readonly latestHeap = computed(() => this.last(this.series().heap));
  readonly latestCpu = computed(() => this.last(this.series().cpu));
  readonly latestDisk = computed(() => this.last(this.series().diskAvailable));
  readonly latestDocuments = computed(() => this.last(this.series().documents));
  readonly latestStore = computed(() => this.last(this.series().storeBytes));
  readonly latestRejected = computed(() => this.last(this.series().rejected));
  private timer?: ReturnType<typeof setInterval>;
  private refs = 0;

  start(): void {
    this.refs++;
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 15000);
  }

  stop(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs || !this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await Promise.all([this.loadTarget(), this.loadSeries()]);
      this.lastSync.set(new Date().toLocaleTimeString());
    } finally {
      this.busy.set(false);
    }
  }

  private prom(path: string): string { return `${apiBase()}/api/prometheus/${path}`; }

  private async loadTarget(): Promise<void> {
    try {
      const response = await hostFetch(this.prom('api/v1/targets?state=active'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const targets = (body.data?.activeTargets ?? []).filter((item: any) => {
        const labels = item.labels ?? item.discoveredLabels ?? {};
        return labels.namespace === 'opensphere-console' && (labels.service === 'opensearch' || String(labels.job ?? '').includes('opensphere-search'));
      });
      if (!targets.length) {
        this.target.set('missing');
        this.targetDetail.set('ServiceMonitor target 없음');
        return;
      }
      const down = targets.filter((item: any) => item.health !== 'up');
      this.target.set(down.length ? 'down' : 'up');
      this.targetDetail.set(down.length ? `${down.length}/${targets.length} target down` : `${targets.length}/${targets.length} target up`);
    } catch (error) {
      this.target.set('missing');
      this.targetDetail.set(`Targets 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  private async loadSeries(): Promise<void> {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 3600;
    const match = '{cluster="opensphere-search"}';
    this.state.set('loading');
    try {
      const [heap, cpu, diskAvailable, documents, storeBytes, rejected] = await Promise.all([
        this.range(`max(opensearch_jvm_mem_heap_used_percent${match})`, start, end),
        this.range(`max(opensearch_process_cpu_percent${match})`, start, end),
        this.range(`min(opensearch_filesystem_data_available_bytes${match})`, start, end),
        this.range(`max(opensearch_indices_docs${match})`, start, end),
        this.range(`max(opensearch_indices_store_size_bytes${match})`, start, end),
        this.range(`sum(increase(opensearch_thread_pool_rejected_count${match}[5m]))`, start, end),
      ]);
      const base = heap.length ? heap : cpu.length ? cpu : diskAvailable.length ? diskAvailable : documents.length ? documents : storeBytes;
      if (!base.length) {
        this.series.set(EMPTY);
        this.state.set('empty');
        this.hint.set('OpenSearch ServiceMonitor는 선언됐지만 시계열이 없습니다. Prometheus target과 플러그인 /metrics를 확인하세요.');
        return;
      }
      this.series.set({
        labels: base.map(([time]) => new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        heap: this.align(base, heap), cpu: this.align(base, cpu), diskAvailable: this.align(base, diskAvailable),
        documents: this.align(base, documents), storeBytes: this.align(base, storeBytes), rejected: this.align(base, rejected),
      });
      this.state.set('ok');
      this.hint.set('OpenSearch exporter · Prometheus · 최근 1시간 · 5분 간격');
    } catch (error) {
      this.series.set(EMPTY);
      this.state.set('error');
      this.hint.set(`Prometheus 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  private async range(expression: string, start: number, end: number): Promise<[number, number][]> {
    const query = new URLSearchParams({ query: expression, start: String(start), end: String(end), step: '300' });
    const response = await hostFetch(this.prom(`api/v1/query_range?${query.toString()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.status !== 'success') throw new Error(body.error || 'Prometheus query failed');
    return (body.data?.result?.[0]?.values ?? [])
      .map(([time, value]: [number, string]) => [Number(time), Number(value)] as [number, number])
      .filter(([, value]: [number, number]) => Number.isFinite(value));
  }

  private align(base: [number, number][], source: [number, number][]): number[] {
    const values = new Map(source.map(([time, value]) => [time, value]));
    return base.map(([time]) => values.get(time) ?? 0);
  }

  private last(values: number[]): number { return values.length ? values[values.length - 1] : 0; }
}
