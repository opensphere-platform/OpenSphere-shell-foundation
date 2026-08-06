import { Injectable, computed, inject, signal } from '@angular/core';
import { apiBase, hostFetch } from '../../api-base';
import { DataEngineRuntimeService } from '../data-engine/data-engine-runtime.service';
import { OsService } from './os.service';

type MetricPoint = [number, number];
interface PrometheusSeries { metric: Record<string, string>; values: MetricPoint[] }

export interface OsMetricSeries {
  timestamps: number[];
  labels: string[];
  heap: (number | null)[];
  cpu: (number | null)[];
  diskAvailable: (number | null)[];
  documents: (number | null)[];
  storeBytes: (number | null)[];
  rejected: (number | null)[];
}

export interface OsNodeMetricSeries {
  node: string;
  configured: boolean;
  podReady: boolean;
  podPhase: string;
  podIP: string;
  joined: boolean;
  roles: string;
  master: boolean;
  metricsObserved: boolean;
  timestamps: number[];
  labels: string[];
  heap: (number | null)[];
  cpu: (number | null)[];
  diskAvailable: (number | null)[];
}

const EMPTY: OsMetricSeries = { timestamps: [], labels: [], heap: [], cpu: [], diskAvailable: [], documents: [], storeBytes: [], rejected: [] };

@Injectable({ providedIn: 'root' })
export class OsMetricsService {
  private readonly os = inject(OsService);
  private readonly runtime = inject(DataEngineRuntimeService);
  readonly series = signal<OsMetricSeries>(EMPTY);
  readonly nodeSeries = signal<OsNodeMetricSeries[]>([]);
  readonly state = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly hint = signal('Prometheus에서 OpenSearch exporter 시계열을 확인하고 있습니다.');
  readonly target = signal<'checking' | 'up' | 'down' | 'missing'>('checking');
  readonly targetDetail = signal('ServiceMonitor target 확인 중');
  readonly busy = signal(false);
  readonly lastSync = signal('');
  readonly nodes = computed(() => this.nodeSeries());
  readonly configuredNodeCount = computed(() => this.nodeSeries().filter((node) => node.configured).length);
  readonly joinedNodeCount = computed(() => this.nodeSeries().filter((node) => node.joined).length);
  readonly metricsNodeCount = computed(() => this.nodeSeries().filter((node) => node.metricsObserved).length);
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
    if (!this.series().timestamps.length) this.state.set('loading');
    try {
      const [heapSet, cpuSet, diskSet, documentsSet, storeSet, rejectedSet, nodeHeapSet, nodeCpuSet, nodeDiskSet] = await Promise.all([
        this.range(`max(opensearch_jvm_mem_heap_used_percent${match})`, start, end),
        this.range(`max(opensearch_process_cpu_percent${match})`, start, end),
        this.range(`min(opensearch_filesystem_data_available_bytes${match})`, start, end),
        this.range(`max(opensearch_indices_docs${match})`, start, end),
        this.range(`max(opensearch_indices_store_size_bytes${match})`, start, end),
        this.range(`sum(increase(opensearch_thread_pool_rejected_count${match}[5m]))`, start, end),
        this.range(`max by(node) (opensearch_jvm_mem_heap_used_percent${match})`, start, end),
        this.range(`max by(node) (opensearch_process_cpu_percent${match})`, start, end),
        this.range(`min by(node) (opensearch_filesystem_data_available_bytes${match})`, start, end),
      ]);
      const heap = heapSet[0]?.values ?? [];
      const cpu = cpuSet[0]?.values ?? [];
      const diskAvailable = diskSet[0]?.values ?? [];
      const documents = documentsSet[0]?.values ?? [];
      const storeBytes = storeSet[0]?.values ?? [];
      const rejected = rejectedSet[0]?.values ?? [];
      const timestamps = this.timestamps(heap, cpu, diskAvailable, documents, storeBytes, rejected);
      const nodeSeries = this.buildNodeSeries(nodeHeapSet, nodeCpuSet, nodeDiskSet);
      if (!timestamps.length && !nodeSeries.some((node) => node.timestamps.length)) {
        this.series.set(EMPTY);
        this.nodeSeries.set(nodeSeries);
        this.state.set('empty');
        this.hint.set('OpenSearch ServiceMonitor는 선언됐지만 시계열이 없습니다. Prometheus target과 플러그인 /metrics를 확인하세요.');
        return;
      }
      this.series.set({
        timestamps,
        labels: this.labels(timestamps),
        heap: this.align(timestamps, heap), cpu: this.align(timestamps, cpu), diskAvailable: this.align(timestamps, diskAvailable),
        documents: this.align(timestamps, documents), storeBytes: this.align(timestamps, storeBytes), rejected: this.align(timestamps, rejected),
      });
      this.nodeSeries.set(nodeSeries);
      this.state.set('ok');
      this.hint.set(`OpenSearch exporter · Prometheus · 최근 1시간 · 5분 간격 · 구성 ${nodeSeries.filter((node) => node.configured).length} · 합류 ${nodeSeries.filter((node) => node.joined).length} · metrics ${nodeSeries.filter((node) => node.metricsObserved).length}`);
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (this.series().timestamps.length) {
        this.state.set('ok');
        this.hint.set(`Prometheus 조회 실패 · 마지막 정상 시계열 유지: ${message}`);
      } else {
        this.series.set(EMPTY);
        this.nodeSeries.set(this.buildNodeSeries([], [], []));
        this.state.set('error');
        this.hint.set(`Prometheus 조회 실패: ${message}`);
      }
    }
  }

  private async range(expression: string, start: number, end: number): Promise<PrometheusSeries[]> {
    const query = new URLSearchParams({ query: expression, start: String(start), end: String(end), step: '300' });
    const response = await hostFetch(this.prom(`api/v1/query_range?${query.toString()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.status !== 'success') throw new Error(body.error || 'Prometheus query failed');
    return (body.data?.result ?? []).map((item: any) => ({
      metric: item.metric ?? {},
      values: (item.values ?? [])
        .map(([time, value]: [number, string]) => [Number(time), Number(value)] as MetricPoint)
        .filter(([, value]: MetricPoint) => Number.isFinite(value)),
    }));
  }

  private buildNodeSeries(heapSet: PrometheusSeries[], cpuSet: PrometheusSeries[], diskSet: PrometheusSeries[]): OsNodeMetricSeries[] {
    const pods = this.runtime.runtime('opensearch').pods;
    const configured = pods.map((pod) => String(pod.metadata?.name ?? '').trim()).filter(Boolean);
    const inventory = this.os.nodes();
    const joined = inventory.map((item) => String(item.name ?? '').trim()).filter(Boolean);
    const observed = [...heapSet, ...cpuSet, ...diskSet].map((item) => item.metric['node'] ?? '').filter(Boolean);
    const names = [...new Set([...configured, ...joined, ...observed])].sort((a, b) => a.localeCompare(b));
    const select = (set: PrometheusSeries[], node: string) => set.find((item) => item.metric['node'] === node)?.values ?? [];
    return names.map((node) => {
      const pod = pods.find((item) => item.metadata?.name === node);
      const joinedNode = inventory.find((item) => String(item.name ?? '').trim() === node);
      const heap = select(heapSet, node);
      const cpu = select(cpuSet, node);
      const diskAvailable = select(diskSet, node);
      const timestamps = this.timestamps(heap, cpu, diskAvailable);
      return {
        node,
        configured: Boolean(pod),
        podReady: Boolean((pod?.status?.conditions ?? []).some((condition: any) => condition.type === 'Ready' && condition.status === 'True')),
        podPhase: String(pod?.status?.phase ?? 'Unknown'),
        podIP: String(pod?.status?.podIP ?? ''),
        joined: Boolean(joinedNode),
        roles: String(joinedNode?.['node.role'] ?? ''),
        master: joinedNode?.master === '*',
        metricsObserved: Boolean(timestamps.length),
        timestamps,
        labels: this.labels(timestamps),
        heap: this.align(timestamps, heap),
        cpu: this.align(timestamps, cpu),
        diskAvailable: this.align(timestamps, diskAvailable),
      };
    });
  }

  private timestamps(...sets: MetricPoint[][]): number[] {
    return [...new Set(sets.flatMap((set) => set.map(([time]) => time)))].sort((a, b) => a - b);
  }

  private labels(timestamps: number[]): string[] {
    return timestamps.map((time) => new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }

  private align(timestamps: number[], source: MetricPoint[]): (number | null)[] {
    const values = new Map(source.map(([time, value]) => [time, value]));
    return timestamps.map((time) => values.get(time) ?? null);
  }

  private last(values: (number | null)[]): number {
    return [...values].reverse().find((value): value is number => value !== null) ?? 0;
  }
}
