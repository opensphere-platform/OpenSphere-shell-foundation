import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS, hostFetch } from '../../api-base';
import { WorkloadHealth } from './identity.services';

export interface OpaMetricSeries {
  labels: string[];
  evaluations: number[];
  p95Milliseconds: number[];
  errorPercent: number[];
  heapMiB: number[];
  goroutines: number[];
	allowRate: number[];
	denyRate: number[];
}

const EMPTY: OpaMetricSeries = { labels: [], evaluations: [], p95Milliseconds: [], errorPercent: [], heapMiB: [], goroutines: [], allowRate: [], denyRate: [] };

@Injectable({ providedIn: 'root' })
export class OpaService extends WorkloadHealth {
  readonly name = 'foundation-identity-opa';
  readonly endpoint = `http://${this.name}.${FND_NS}.svc:8181`;
  readonly fm = signal<any>(null);
  readonly events = signal<any[]>([]);

  protected override extraLoads(): Promise<void>[] { return [this.loadFm(), this.loadEvents()]; }

  private async loadFm(): Promise<void> {
    if (!this.backoff.due('opa-fm')) return;
    try {
      const r = await hostFetch(this.k('apis/foundation.opensphere.io/v1alpha1/foundationmodels/identity'), { cache: 'no-store' });
      this.backoff.report('opa-fm', r.ok ? 'ok' : r.status === 404 ? 'nocrd' : 'error');
      this.fm.set(r.ok ? await r.json() : null);
    } catch { this.backoff.report('opa-fm', 'error'); }
  }

  private async loadEvents(): Promise<void> {
    if (!this.backoff.due('opa-events')) return;
    try {
      const fs = encodeURIComponent(`involvedObject.name=${this.name}`);
      const r = await hostFetch(this.k(`api/v1/namespaces/${this.ns}/events?fieldSelector=${fs}&limit=30`), { cache: 'no-store' });
      this.backoff.report('opa-events', r.ok ? 'ok' : 'error');
      const items: any[] = r.ok ? ((await r.json()).items || []) : [];
      items.sort((a, b) => String(b.lastTimestamp || b.eventTime || '').localeCompare(String(a.lastTimestamp || a.eventTime || '')));
      this.events.set(items);
    } catch { this.backoff.report('opa-events', 'error'); }
  }

  readonly policyMode = computed(() => this.fm()?.status?.opaPolicyMode || 'bootstrap-fail-closed');
  readonly modelPhase = computed(() => this.fm()?.status?.phase || '—');
}

@Injectable({ providedIn: 'root' })
export class OpaMetricsService {
  readonly series = signal<OpaMetricSeries>(EMPTY);
  readonly state = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly hint = signal('Prometheus에서 OPA 시계열을 확인하고 있습니다.');
  readonly target = signal<'checking' | 'up' | 'down' | 'missing'>('checking');
  readonly targetDetail = signal('ServiceMonitor target 확인 중');
  readonly busy = signal(false);
  readonly lastSync = signal('');
  readonly latestEvaluations = computed(() => this.last(this.series().evaluations));
  readonly latestP95 = computed(() => this.last(this.series().p95Milliseconds));
  readonly latestError = computed(() => this.last(this.series().errorPercent));
  readonly latestHeap = computed(() => this.last(this.series().heapMiB));
  readonly latestGoroutines = computed(() => this.last(this.series().goroutines));
	readonly latestAllow = computed(() => this.last(this.series().allowRate));
	readonly latestDeny = computed(() => this.last(this.series().denyRate));
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
    } finally { this.busy.set(false); }
  }

  private prom(path: string): string { return `${apiBase()}/api/prometheus/${path}`; }

  private async loadTarget(): Promise<void> {
    try {
      const response = await hostFetch(this.prom('api/v1/targets?state=active'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const all = body.data?.activeTargets ?? [];
		const targets = all.filter((item: any) => {
        const labels = item.labels ?? item.discoveredLabels ?? {};
        return labels.namespace === FND_NS && (labels.service === 'foundation-identity-opa' || String(labels.job ?? '').includes('foundation-identity-opa'));
      });
		const control = all.filter((item: any) => {
			const labels = item.labels ?? item.discoveredLabels ?? {};
			return labels.namespace === FND_NS && labels.service === 'foundation-identity-opa-control';
		});
		if (!targets.length || !control.length) { this.target.set('missing'); this.targetDetail.set('OPA 또는 decision-log ServiceMonitor target 없음'); return; }
		const down = [...targets, ...control].filter((item: any) => item.health !== 'up');
      this.target.set(down.length ? 'down' : 'up');
		this.targetDetail.set(down.length ? `${down.length}/${targets.length + control.length} target down` : `OPA ${targets.length}/${targets.length} · audit ${control.length}/${control.length} target up`);
    } catch (error) {
      this.target.set('missing');
      this.targetDetail.set(`Targets 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  private async loadSeries(): Promise<void> {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 3600;
    const match = 'namespace="opensphere-foundation",service="foundation-identity-opa"';
		const controlMatch = 'namespace="opensphere-foundation",service="foundation-identity-opa-control"';
    const decisions = `${match},handler="v1/data"`;
    this.state.set('loading');
    try {
      const [evaluations, p95, errors, heap, goroutines, allowRate, denyRate] = await Promise.all([
        this.range(`sum(rate(http_request_duration_seconds_count{${decisions}}[5m]))`, start, end),
        this.range(`1000 * histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${decisions}}[5m])))`, start, end),
        this.range(`100 * sum(rate(http_request_duration_seconds_count{${decisions},code=~"4..|5.."}[5m])) / clamp_min(sum(rate(http_request_duration_seconds_count{${decisions}}[5m])), 0.000000001)`, start, end),
        this.range(`max(go_memstats_alloc_bytes{${match}}) / 1048576`, start, end),
        this.range(`max(go_goroutines{${match}})`, start, end),
			this.range(`sum(rate(opensphere_opa_decisions_total{${controlMatch},result="allow"}[5m]))`, start, end),
			this.range(`sum(rate(opensphere_opa_decisions_total{${controlMatch},result="deny"}[5m]))`, start, end),
      ]);
      const base = heap.length ? heap : goroutines.length ? goroutines : evaluations.length ? evaluations : p95;
      if (!base.length) {
        this.series.set(EMPTY);
        this.state.set('empty');
        this.hint.set('OPA ServiceMonitor는 선언됐지만 시계열이 없습니다. Prometheus target과 diagnostic /metrics를 확인하세요.');
        return;
      }
      this.series.set({
        labels: base.map(([time]) => new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        evaluations: this.align(base, evaluations), p95Milliseconds: this.align(base, p95), errorPercent: this.align(base, errors),
        heapMiB: this.align(base, heap), goroutines: this.align(base, goroutines),
			allowRate: this.align(base, allowRate), denyRate: this.align(base, denyRate),
      });
      this.state.set('ok');
		this.hint.set('OPA + durable audit Prometheus · 최근 1시간 · 60초 간격 · 화면 15초 갱신');
    } catch (error) {
      this.series.set(EMPTY);
      this.state.set('error');
      this.hint.set(`Prometheus 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  private async range(expression: string, start: number, end: number): Promise<[number, number][]> {
    const query = new URLSearchParams({ query: expression, start: String(start), end: String(end), step: '60' });
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
  private last(values: number[]): number { return values.length ? values[values.length - 1] : 0; }
}
