import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS, hostFetch } from '../../api-base';
import { Phase, State, phaseClass } from '../../shared/service-health';
import { WorkloadHealth } from './identity.services';

export interface SyncopeMetricSeries {
  labels: string[];
  availability: number[];
  p95Milliseconds: number[];
  cpuCores: number[];
  memoryMiB: number[];
  users: number[];
  groups: number[];
  resources: number[];
  auditEvents: number[];
}

const EMPTY: SyncopeMetricSeries = { labels: [], availability: [], p95Milliseconds: [], cpuCores: [], memoryMiB: [], users: [], groups: [], resources: [], auditEvents: [] };

@Injectable({ providedIn: 'root' })
export class SyncopeService extends WorkloadHealth {
  readonly name = 'foundation-identity-syncope';
  readonly endpoint = `https://${this.name}.${FND_NS}.svc:8443/syncope/rest`;
  readonly fm = signal<any>(null);
  readonly events = signal<any[]>([]);
  readonly databaseReady = signal(false);

  override async loadDeploy(): Promise<void> {
    if (!this.backoff.due('syncope-sts')) return;
    try {
      const response = await hostFetch(this.k(`apis/apps/v1/namespaces/${this.ns}/statefulsets/${this.name}`), { cache: 'no-store' });
      const state: State = response.status === 403 ? 'noperm' : response.status === 404 ? 'nocrd' : !response.ok ? 'error' : 'ok';
      this.backoff.report('syncope-sts', state);
      this.state.set(state);
      this.deploy.set(state === 'ok' ? await response.json() : null);
    } catch { this.backoff.report('syncope-sts', 'error'); this.state.set('error'); }
  }

  protected override extraLoads(): Promise<void>[] { return [this.loadFm(), this.loadEvents(), this.loadDatabase()]; }

  private async loadDatabase(): Promise<void> {
    if (!this.backoff.due('syncope-db')) return;
    try {
      const response = await hostFetch(this.k(`apis/provisioning.opensphere.io/v1beta1/namespaces/${this.ns}/postgresclaims/foundation-identity-syncope-pg`), { cache: 'no-store' });
      const body = response.ok ? await response.json() : null;
      this.databaseReady.set(body?.status?.phase === 'Ready');
      this.backoff.report('syncope-db', response.ok ? 'ok' : response.status === 404 ? 'nocrd' : 'error');
    } catch { this.databaseReady.set(false); this.backoff.report('syncope-db', 'error'); }
  }

  private async loadFm(): Promise<void> {
    if (!this.backoff.due('syncope-fm')) return;
    try {
      const response = await hostFetch(this.k('apis/foundation.opensphere.io/v1alpha1/foundationmodels/identity'), { cache: 'no-store' });
      this.backoff.report('syncope-fm', response.ok ? 'ok' : response.status === 404 ? 'nocrd' : 'error');
      this.fm.set(response.ok ? await response.json() : null);
    } catch { this.backoff.report('syncope-fm', 'error'); }
  }

  private async loadEvents(): Promise<void> {
    if (!this.backoff.due('syncope-events')) return;
    try {
      const selector = encodeURIComponent(`involvedObject.name=${this.name}`);
      const response = await hostFetch(this.k(`api/v1/namespaces/${this.ns}/events?fieldSelector=${selector}&limit=30`), { cache: 'no-store' });
      this.backoff.report('syncope-events', response.ok ? 'ok' : 'error');
      const items: any[] = response.ok ? ((await response.json()).items ?? []) : [];
      items.sort((a, b) => String(b.lastTimestamp || b.eventTime || '').localeCompare(String(a.lastTimestamp || a.eventTime || '')));
      this.events.set(items);
    } catch { this.backoff.report('syncope-events', 'error'); }
  }

  override readonly ready = computed(() => this.totalN() >= 2 && this.readyN() === this.totalN());
  override readonly readyN = computed(() => Number(this.deploy()?.status?.readyReplicas ?? 0));
  override readonly totalN = computed(() => Number(this.deploy()?.spec?.replicas ?? 0));
  override readonly phase = computed(() => this.ready() ? 'Running' : this.state() === 'loading' ? '확인 중' : this.pods()[0]?.status?.phase || '미발견');
  override readonly phaseCls = computed<Phase>(() => this.ready() ? 'ok' : phaseClass(this.phase(), false));
  readonly productionReady = computed(() => this.ready() && this.databaseReady() && this.fm()?.status?.syncopeProductionReady === true);
  readonly database = computed(() => this.fm()?.status?.syncopeDatabase || 'StackGres/pgc-foundation-identity-syncope-pg/syncope');
}

@Injectable({ providedIn: 'root' })
export class SyncopeMetricsService {
  readonly series = signal<SyncopeMetricSeries>(EMPTY);
  readonly state = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly hint = signal('Prometheus에서 Syncope 시계열을 확인하고 있습니다.');
  readonly target = signal<'checking' | 'up' | 'down' | 'missing'>('checking');
  readonly targetDetail = signal('ServiceMonitor target 확인 중');
  readonly busy = signal(false);
  readonly lastSync = signal('');
  readonly latestAvailability = computed(() => this.last(this.series().availability));
  readonly latestP95 = computed(() => this.last(this.series().p95Milliseconds));
  readonly latestCpu = computed(() => this.last(this.series().cpuCores));
  readonly latestMemory = computed(() => this.last(this.series().memoryMiB));
  readonly latestUsers = computed(() => this.last(this.series().users));
  readonly latestGroups = computed(() => this.last(this.series().groups));
  readonly latestResources = computed(() => this.last(this.series().resources));
  readonly latestAuditEvents = computed(() => this.last(this.series().auditEvents));
  private timer?: ReturnType<typeof setInterval>;
  private refs = 0;

  start(): void { this.refs++; if (this.timer) return; void this.refresh(); this.timer = setInterval(() => void this.refresh(), 15000); }
  stop(): void { this.refs = Math.max(0, this.refs - 1); if (this.refs || !this.timer) return; clearInterval(this.timer); this.timer = undefined; }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await Promise.all([this.loadTarget(), this.loadSeries()]); this.lastSync.set(new Date().toLocaleTimeString()); }
    finally { this.busy.set(false); }
  }

  private prom(path: string): string { return `${apiBase()}/api/prometheus/${path}`; }

  private async loadTarget(): Promise<void> {
    try {
      const response = await hostFetch(this.prom('api/v1/targets?state=active'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const targets = ((await response.json()).data?.activeTargets ?? []).filter((item: any) => {
        const labels = item.labels ?? item.discoveredLabels ?? {};
        return labels.namespace === FND_NS && (labels.service === 'foundation-identity-syncope' || String(labels.job ?? '').includes('foundation-identity-syncope'));
      });
      if (!targets.length) { this.target.set('missing'); this.targetDetail.set('Syncope ServiceMonitor target 없음'); return; }
      const down = targets.filter((item: any) => item.health !== 'up');
      this.target.set(down.length ? 'down' : 'up');
      this.targetDetail.set(down.length ? `${down.length}/${targets.length} target down` : `${targets.length}/${targets.length} target up · 15s scrape`);
    } catch (error) { this.target.set('missing'); this.targetDetail.set(`Targets 조회 실패: ${String((error as Error)?.message ?? error)}`); }
  }

  private async loadSeries(): Promise<void> {
    const end = Math.floor(Date.now() / 1000); const start = end - 3600;
    const monitor = 'namespace="opensphere-foundation",service="foundation-identity-syncope"';
    const workload = 'namespace="opensphere-foundation",pod=~"foundation-identity-syncope-.*",container="syncope"';
    this.state.set('loading');
    try {
      const [availability, p95, cpu, memory, users, groups, resources, auditEvents] = await Promise.all([
        this.range(`100 * avg(opensphere_syncope_up{${monitor}})`, start, end),
        this.range(`1000 * histogram_quantile(0.95, sum by (le) (rate(opensphere_syncope_probe_duration_seconds_bucket{${monitor}}[5m])))`, start, end),
        this.range(`sum(rate(container_cpu_usage_seconds_total{${workload}}[5m]))`, start, end),
        this.range(`sum(container_memory_working_set_bytes{${workload}}) / 1048576`, start, end),
        this.range(`max(opensphere_syncope_users{${monitor}})`, start, end),
        this.range(`max(opensphere_syncope_groups{${monitor}})`, start, end),
        this.range(`max(opensphere_syncope_external_resources{${monitor}})`, start, end),
        this.range(`max(opensphere_syncope_audit_events_total{${monitor}})`, start, end),
      ]);
      const base = availability.length ? availability : memory.length ? memory : users;
      if (!base.length) { this.series.set(EMPTY); this.state.set('empty'); this.hint.set('Syncope ServiceMonitor는 선언됐지만 시계열이 없습니다. target과 monitor sidecar를 확인하세요.'); return; }
      this.series.set({
        labels: base.map(([time]) => new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        availability: this.align(base, availability), p95Milliseconds: this.align(base, p95), cpuCores: this.align(base, cpu), memoryMiB: this.align(base, memory),
        users: this.align(base, users), groups: this.align(base, groups), resources: this.align(base, resources), auditEvents: this.align(base, auditEvents),
      });
      this.state.set('ok'); this.hint.set('Syncope Prometheus · 최근 1시간 · PostgreSQL과 같은 60초 X축 간격 · 화면 15초 갱신');
    } catch (error) { this.series.set(EMPTY); this.state.set('error'); this.hint.set(`Prometheus 조회 실패: ${String((error as Error)?.message ?? error)}`); }
  }

  private async range(expression: string, start: number, end: number): Promise<[number, number][]> {
    const query = new URLSearchParams({ query: expression, start: String(start), end: String(end), step: '60' });
    const response = await hostFetch(this.prom(`api/v1/query_range?${query.toString()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.status !== 'success') throw new Error(body.error || 'Prometheus query failed');
    return (body.data?.result?.[0]?.values ?? []).map(([time, value]: [number, string]) => [Number(time), Number(value)] as [number, number]).filter(([, value]: [number, number]) => Number.isFinite(value));
  }
  private align(base: [number, number][], source: [number, number][]): number[] { const values = new Map(source.map(([time, value]) => [time, value])); return base.map(([time]) => values.get(time) ?? 0); }
  private last(values: number[]): number { return values.length ? values[values.length - 1] : 0; }
}
