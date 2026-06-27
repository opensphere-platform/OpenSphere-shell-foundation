import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS } from '../../api-base';
import { Phase, State, osHealthPhase } from './os.types';

// OpenSearch 콘솔 단일 데이터 진입점 — /api/opensearch 프록시(읽기 전용 화이트리스트) + 15s 단일 폴러 + 6-state.
@Injectable({ providedIn: 'root' })
export class OsService {
  readonly ns = FND_NS;
  readonly endpoint = `opensphere-search.${FND_NS}.svc:9200`;

  // raw
  readonly health = signal<any>(null);
  readonly stats = signal<any>(null);
  readonly nodes = signal<any[]>([]);
  readonly indices = signal<any[]>([]);
  readonly shards = signal<any[]>([]);
  readonly templates = signal<any[]>([]);
  readonly aliases = signal<any[]>([]);
  readonly settings = signal<any>(null);
  readonly pending = signal<any[]>([]);
  readonly threadPool = signal<any[]>([]);

  // per-resource state
  readonly healthState = signal<State>('loading');
  readonly indexState = signal<State>('loading');
  readonly nodeState = signal<State>('loading');
  readonly shardState = signal<State>('loading');
  readonly tmplState = signal<State>('loading');
  readonly taskState = signal<State>('loading');

  readonly autoRefresh = signal(true);
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);

  private timer: any = null;
  private started = false;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
    this.timer = setInterval(() => { if (this.autoRefresh()) { this.refresh(); } }, 15000);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.started = false; }
  toggleAuto(): void { this.autoRefresh.update((v) => !v); }

  private url(path: string): string { return `${apiBase()}/api/opensearch${path}`; }
  private async getJson(path: string): Promise<{ ok: boolean; status: number; data: any }> {
    try { const r = await fetch(this.url(path)); return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null }; }
    catch { return { ok: false, status: 0, data: null }; }
  }
  private mapState(r: { ok: boolean; status: number }, len: number): State {
    if (r.status === 403) { return 'noperm'; }
    if (!r.ok) { return 'error'; }
    return len ? 'ok' : 'empty';
  }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([
      this.loadHealth(), this.loadStats(), this.loadNodes(), this.loadIndices(),
      this.loadShards(), this.loadTemplates(), this.loadAliases(), this.loadSettings(),
      this.loadPending(), this.loadThreadPool(),
    ]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  async loadHealth() { const r = await this.getJson('/_cluster/health'); if (r.ok) { this.health.set(r.data); this.healthState.set('ok'); } else { this.healthState.set(r.status === 403 ? 'noperm' : 'error'); } }
  async loadStats() { const r = await this.getJson('/_cluster/stats'); if (r.ok) { this.stats.set(r.data); } }
  async loadNodes() { const r = await this.getJson('/_cat/nodes?format=json&h=name,node.role,master,heap.percent,ram.percent,cpu,disk.used_percent,version,load_1m'); this.nodes.set(r.data || []); this.nodeState.set(this.mapState(r, (r.data || []).length)); }
  async loadIndices() { const r = await this.getJson('/_cat/indices?format=json&bytes=b&s=index&h=index,health,status,docs.count,docs.deleted,pri,rep,store.size'); this.indices.set(r.data || []); this.indexState.set(this.mapState(r, (r.data || []).length)); }
  async loadShards() { const r = await this.getJson('/_cat/shards?format=json&bytes=b&h=index,shard,prirep,state,docs,store,node'); this.shards.set(r.data || []); this.shardState.set(this.mapState(r, (r.data || []).length)); }
  async loadTemplates() { const r = await this.getJson('/_cat/templates?format=json&h=name,index_patterns,order,version'); this.templates.set(r.data || []); this.tmplState.set(this.mapState(r, (r.data || []).length)); }
  async loadAliases() { const r = await this.getJson('/_cat/aliases?format=json&h=alias,index,is_write_index'); this.aliases.set(r.data || []); }
  async loadSettings() { const r = await this.getJson('/_cluster/settings?flat_settings=true'); if (r.ok) { this.settings.set(r.data); } }
  async loadPending() { const r = await this.getJson('/_cluster/pending_tasks'); this.pending.set(r.data?.tasks || []); this.taskState.set(this.mapState(r, (r.data?.tasks || []).length)); }
  async loadThreadPool() { const r = await this.getJson('/_cat/thread_pool?format=json&h=node_name,name,active,queue,rejected'); this.threadPool.set((r.data || []).filter((t: any) => +t.active || +t.queue || +t.rejected)); }

  // ── computed ──
  readonly status = computed<string>(() => this.health()?.status || (this.healthState() === 'loading' ? '' : 'unknown'));
  readonly statusPhase = computed<Phase>(() => osHealthPhase(this.status()));
  readonly clusterName = computed<string>(() => this.health()?.cluster_name || this.stats()?.cluster_name || 'opensphere-search');
  readonly nodeCount = computed<number>(() => this.health()?.number_of_nodes ?? this.nodes().length);
  readonly dataNodes = computed<number | string>(() => this.health()?.number_of_data_nodes ?? '—');
  readonly activeShards = computed<number>(() => this.health()?.active_shards ?? this.shards().filter((s) => s.state === 'STARTED').length);
  readonly relocating = computed<number>(() => this.health()?.relocating_shards ?? 0);
  readonly initializing = computed<number>(() => this.health()?.initializing_shards ?? 0);
  readonly unassigned = computed<number>(() => this.health()?.unassigned_shards ?? 0);
  readonly shardPct = computed<number>(() => Math.round((this.health()?.active_shards_percent_as_number ?? 100) * 10) / 10);
  readonly indexCount = computed<number>(() => this.indices().length || this.stats()?.indices?.count || 0);
  readonly docCount = computed<number>(() => this.stats()?.indices?.docs?.count ?? this.indices().reduce((a, i) => a + (+i['docs.count'] || 0), 0));
  readonly storeBytes = computed<number>(() => this.stats()?.indices?.store?.size_in_bytes ?? this.indices().reduce((a, i) => a + (+i['store.size'] || 0), 0));
  readonly version = computed<string>(() => (this.stats()?.nodes?.versions || [])[0] || this.nodes()[0]?.version || '—');
  readonly pendingTasks = computed<number>(() => this.health()?.number_of_pending_tasks ?? this.pending().length);
}
