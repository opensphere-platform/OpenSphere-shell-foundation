import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS } from '../../api-base';
import { PollBackoff } from '../../shared/poll-backoff';
import { Instance, Phase, State, age, phaseClass } from './cnpg.types';

const NAME = 'opensphere-pg';

// 단일 데이터 진입점 — 모든 fetch·15s 단일 폴러·파생 signals·6-state graceful.
// 컴포넌트는 구독만(자체 폴링 금지). Cluster CR 미열람 시 Pods에서 phase/primary/ready 도출(부분 동작).
@Injectable({ providedIn: 'root' })
export class CnpgService {
  readonly ns = FND_NS;
  readonly name = NAME;

  // raw
  readonly cluster = signal<any>(null);
  readonly pods = signal<any[]>([]);
  readonly backups = signal<any[]>([]);
  readonly scheduled = signal<any[]>([]);
  readonly databases = signal<any[]>([]);
  readonly events = signal<any[]>([]);
  readonly services = signal<any[]>([]);

  // per-resource state
  readonly clusterState = signal<State>('loading');
  readonly backupState = signal<State>('loading');
  readonly dbState = signal<State>('loading');
  readonly eventState = signal<State>('loading');

  readonly autoRefresh = signal(true);
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);

  private timer: any = null;
  private started = false;
  private backoff = new PollBackoff();

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
    this.timer = setInterval(() => { if (this.autoRefresh()) { this.refresh(); } }, 15000);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.started = false; }
  toggleAuto(): void { this.autoRefresh.update((v) => !v); }

  async refresh(): Promise<void> {
    this.busy.set(true);
    this.backoff.nextTick();
    await Promise.allSettled([
      this.loadCluster(), this.loadPods(), this.loadBackups(),
      this.loadScheduled(), this.loadDatabases(), this.loadEvents(), this.loadServices(),
    ]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  // key로 백오프 판단 — nocrd/noperm 확정 후엔 지수 백오프로 재조회 빈도만 낮춘다(state는 그대로 유지).
  private async getList(key: string, path: string, set: (v: any[]) => void, state?: (s: State) => void): Promise<void> {
    if (!this.backoff.due(key)) { return; }
    try {
      const r = await fetch(this.k(path));
      const s: State = r.status === 403 ? 'noperm' : r.status === 404 ? 'nocrd' : !r.ok ? 'error' : 'ok';
      this.backoff.report(key, s);
      if (s === 'noperm' || s === 'nocrd' || s === 'error') { state?.(s); return; }
      const items = (await r.json()).items || [];
      set(items);
      state?.(items.length ? 'ok' : 'empty');
    } catch { this.backoff.report(key, 'error'); state?.('error'); }
  }

  async loadCluster(): Promise<void> {
    if (!this.backoff.due('cluster')) { return; }
    try {
      const r = await fetch(this.k(`apis/postgresql.cnpg.io/v1/namespaces/${this.ns}/clusters/${this.name}`));
      const s: State = r.status === 403 ? 'noperm' : !r.ok ? 'nocrd' : 'ok';
      this.backoff.report('cluster', s);
      this.clusterState.set(s);
      if (s === 'ok') { this.cluster.set(await r.json()); }
    } catch { this.backoff.report('cluster', 'error'); this.clusterState.set('error'); }
  }
  async loadPods(): Promise<void> {
    if (!this.backoff.due('pods')) { return; }
    try {
      const sel = encodeURIComponent(`cnpg.io/cluster=${this.name}`);
      const r = await fetch(this.k(`api/v1/namespaces/${this.ns}/pods?labelSelector=${sel}`));
      this.backoff.report('pods', r.ok ? 'ok' : r.status === 404 ? 'nocrd' : 'error');
      this.pods.set(r.ok ? ((await r.json()).items || []) : []);
    } catch { this.backoff.report('pods', 'error'); this.pods.set([]); }
  }
  loadBackups() { return this.getList('backups', `apis/postgresql.cnpg.io/v1/namespaces/${this.ns}/backups`, (v) => this.backups.set(v), (s) => this.backupState.set(s)); }
  loadScheduled() { return this.getList('scheduled', `apis/postgresql.cnpg.io/v1/namespaces/${this.ns}/scheduledbackups`, (v) => this.scheduled.set(v)); }
  loadDatabases() { return this.getList('databases', `apis/postgresql.cnpg.io/v1/namespaces/${this.ns}/databases`, (v) => this.databases.set(v), (s) => this.dbState.set(s)); }
  loadEvents() {
    const sel = encodeURIComponent(`involvedObject.name=${this.name}`);
    return this.getList('events', `api/v1/namespaces/${this.ns}/events?fieldSelector=${sel}`, (v) => this.events.set(v), (s) => this.eventState.set(s));
  }
  loadServices() {
    const sel = encodeURIComponent(`cnpg.io/cluster=${this.name}`);
    return this.getList('services', `api/v1/namespaces/${this.ns}/services?labelSelector=${sel}`, (v) => this.services.set(v));
  }

  // ── computed (파생) ──
  readonly instances = computed<Instance[]>(() => {
    const primary = this.cluster()?.status?.currentPrimary;
    return this.pods()
      .map((p) => {
        const ready = (p.status?.conditions || []).some((c: any) => c.type === 'Ready' && c.status === 'True');
        const role = p.metadata?.labels?.['cnpg.io/instanceRole'] || p.metadata?.labels?.['role'] || (p.metadata?.name === primary ? 'primary' : 'replica');
        const restarts = (p.status?.containerStatuses || []).reduce((a: number, c: any) => a + (c.restartCount || 0), 0);
        return {
          name: p.metadata?.name, role, ready,
          status: ready ? 'Ready' : (p.status?.phase || '?'),
          node: p.spec?.nodeName || '—', restarts, age: age(p.metadata?.creationTimestamp), ip: p.status?.podIP,
        } as Instance;
      })
      .sort((a, b) => (a.role === 'primary' ? -1 : b.role === 'primary' ? 1 : a.name.localeCompare(b.name)));
  });
  readonly allReady = computed(() => { const i = this.instances(); return i.length > 0 && i.every((x) => x.ready); });
  readonly primary = computed(() => this.cluster()?.status?.currentPrimary || this.instances().find((i) => i.role === 'primary')?.name || '');
  readonly readyN = computed<number>(() => this.cluster()?.status?.readyInstances ?? this.instances().filter((i) => i.ready).length);
  readonly totalN = computed<number>(() => this.cluster()?.spec?.instances ?? this.instances().length);
  readonly phase = computed<string>(() => {
    const ph = this.cluster()?.status?.phase;
    if (ph) { return ph; }
    const ins = this.instances();
    if (!ins.length) { return this.clusterState() === 'loading' ? '확인 중' : '미발견'; }
    return ins.every((i) => i.ready) ? 'Cluster in healthy state' : 'Degraded';
  });
  readonly phaseCls = computed<Phase>(() => phaseClass(this.phase(), this.allReady()));
  readonly image = computed<string>(() => this.cluster()?.status?.image || this.cluster()?.spec?.imageName || '');
  readonly pgMajor = computed<string>(() => {
    const m = (this.image() || '').match(/postgresql:(\d+)/i) || (this.cluster()?.spec?.postgresql?.version ? [null, String(this.cluster().spec.postgresql.version)] : null);
    return m ? m[1]! : (this.cluster()?.spec?.imageCatalogRef?.major ? String(this.cluster().spec.imageCatalogRef.major) : '—');
  });
  readonly storage = computed<string>(() => this.cluster()?.spec?.storage?.size || '—');
  readonly storageClass = computed<string>(() => this.cluster()?.spec?.storage?.storageClass || 'default');
  readonly params = computed<Record<string, string>>(() => this.cluster()?.spec?.postgresql?.parameters || {});
  readonly resources = computed<any>(() => this.cluster()?.spec?.resources || {});
  readonly managedRoles = computed<any[]>(() => this.cluster()?.spec?.managed?.roles || []);
  readonly conditions = computed<any[]>(() => this.cluster()?.status?.conditions || []);
  readonly backupConfigured = computed<boolean>(() => !!this.cluster()?.spec?.backup);
  readonly instanceProfile = computed<string>(() => {
    const r = this.resources();
    const cpu = r?.requests?.cpu || r?.limits?.cpu || '—';
    const mem = r?.requests?.memory || r?.limits?.memory || '—';
    return `${cpu} / ${mem}`;
  });
}
