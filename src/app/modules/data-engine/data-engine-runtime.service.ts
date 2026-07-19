import { Injectable, signal } from '@angular/core';
import { apiBase, hostFetch } from '../../api-base';
import { State } from '../postgres/cnpg.types';
import { DATA_ENGINE_SPECS, DataEngineId } from './data-engine.spec';

export interface DataEngineRuntime {
  state: State;
  resource: any;
  pods: any[];
  pvcs: any[];
  services: any[];
  events: any[];
  operator: any;
  lastSync: string;
}

const EMPTY = (): DataEngineRuntime => ({ state: 'loading', resource: null, pods: [], pvcs: [], services: [], events: [], operator: null, lastSync: '' });

@Injectable({ providedIn: 'root' })
export class DataEngineRuntimeService {
  readonly runtimes = signal<Record<DataEngineId, DataEngineRuntime>>({
    psmdb: EMPTY(), valkey: EMPTY(), rustfs: EMPTY(), opensearch: EMPTY(),
  });
  readonly busy = signal<Record<DataEngineId, boolean>>({ psmdb: false, valkey: false, rustfs: false, opensearch: false });
  private timer: ReturnType<typeof setInterval> | undefined;
  private refs = 0;

  start(): void {
    this.refs++;
    if (this.timer) return;
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), 15000);
  }

  stop(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs || !this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  runtime(id: DataEngineId): DataEngineRuntime { return this.runtimes()[id]; }
  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  async refreshAll(): Promise<void> { await Promise.allSettled((Object.keys(DATA_ENGINE_SPECS) as DataEngineId[]).map((id) => this.refresh(id))); }

  async refresh(id: DataEngineId): Promise<void> {
    const spec = DATA_ENGINE_SPECS[id];
    this.busy.update((m) => ({ ...m, [id]: true }));
    const selector = encodeURIComponent(`foundation.opensphere.io/engine=${id}`);
    const podPath = id === 'psmdb'
      ? `api/v1/namespaces/${spec.namespace}/pods`
      : `api/v1/namespaces/${spec.namespace}/pods?labelSelector=${selector}`;
    const workloadPath = spec.workloadKind === 'psmdb'
      ? `apis/psmdb.percona.com/v1/namespaces/${spec.namespace}/perconaservermongodbs/${spec.workloadName}`
      : `apis/apps/v1/namespaces/${spec.namespace}/statefulsets/${spec.workloadName}`;
    const requests: Promise<Response>[] = [
      hostFetch(this.k(workloadPath), { cache: 'no-store' }),
      hostFetch(this.k(podPath), { cache: 'no-store' }),
      hostFetch(this.k(`api/v1/namespaces/${spec.namespace}/persistentvolumeclaims`), { cache: 'no-store' }),
      hostFetch(this.k(`api/v1/namespaces/${spec.namespace}/services?labelSelector=${selector}`), { cache: 'no-store' }),
      hostFetch(this.k(`api/v1/namespaces/${spec.namespace}/events?limit=100`), { cache: 'no-store' }),
    ];
    if (spec.operator) {
      requests.push(hostFetch(this.k(`apis/apps/v1/namespaces/${spec.operator.namespace}/deployments/${spec.operator.deployment}`), { cache: 'no-store' }));
    }
    try {
      const [workload, pods, pvcs, services, events, operator] = await Promise.all(requests);
      const status: State = workload.status === 403 ? 'noperm' : workload.status === 404 ? 'nocrd' : workload.ok ? 'ok' : 'error';
      const resource = workload.ok ? await workload.json() : null;
      const podRows = pods.ok ? ((await pods.json()).items ?? []).filter((p: any) => id !== 'psmdb' || String(p.metadata?.name ?? '').startsWith(spec.workloadName)) : [];
      const pvcRows = pvcs.ok ? ((await pvcs.json()).items ?? []).filter((x: any) =>
        x.metadata?.labels?.['foundation.opensphere.io/engine'] === id || String(x.metadata?.name ?? '').includes(spec.workloadName)) : [];
      const serviceRows = services.ok ? ((await services.json()).items ?? []) : [];
      const eventRows = events.ok ? ((await events.json()).items ?? []).filter((x: any) => {
        const n = String(x.involvedObject?.name ?? '');
        return n.includes(spec.workloadName) || podRows.some((p: any) => p.metadata?.name === n);
      }).sort((a: any, b: any) => String(b.lastTimestamp ?? b.eventTime ?? '').localeCompare(String(a.lastTimestamp ?? a.eventTime ?? ''))) : [];
      this.runtimes.update((m) => ({ ...m, [id]: {
        state: status, resource, pods: podRows, pvcs: pvcRows, services: serviceRows, events: eventRows,
        operator: operator?.ok ? undefined : null,
        lastSync: new Date().toLocaleTimeString(),
      }}));
      if (operator?.ok) {
        const body = await operator.json();
        this.runtimes.update((m) => ({ ...m, [id]: { ...m[id], operator: body } }));
      }
    } catch {
      this.runtimes.update((m) => ({ ...m, [id]: { ...m[id], state: 'error', lastSync: new Date().toLocaleTimeString() } }));
    } finally {
      this.busy.update((m) => ({ ...m, [id]: false }));
    }
  }

  readyN(id: DataEngineId): number {
    const r = this.runtime(id);
    if (DATA_ENGINE_SPECS[id].workloadKind === 'statefulset') return Number(r.resource?.status?.readyReplicas ?? 0);
    return r.pods.filter((p) => (p.status?.conditions ?? []).some((c: any) => c.type === 'Ready' && c.status === 'True')).length;
  }
  totalN(id: DataEngineId): number {
    const r = this.runtime(id);
    if (DATA_ENGINE_SPECS[id].workloadKind === 'statefulset') return Number(r.resource?.spec?.replicas ?? r.pods.length ?? 0);
    return Number(r.resource?.spec?.replsets?.[0]?.size ?? r.pods.length ?? 0);
  }
  ready(id: DataEngineId): boolean { return this.totalN(id) > 0 && this.readyN(id) >= this.totalN(id); }
  operatorReady(id: DataEngineId): boolean {
    const op = this.runtime(id).operator;
    return !DATA_ENGINE_SPECS[id].operator || Number(op?.status?.readyReplicas ?? 0) > 0;
  }
  phase(id: DataEngineId): string {
    const r = this.runtime(id);
    if (r.state === 'loading') return '확인 중';
    if (r.state === 'noperm') return '권한 없음';
    if (r.state === 'nocrd') return '미생성';
    if (r.state === 'error') return '조회 실패';
    return this.ready(id) ? 'Ready' : String(r.resource?.status?.state ?? r.resource?.status?.phase ?? 'Progressing');
  }
  image(id: DataEngineId): string {
    const r = this.runtime(id).resource;
    if (id === 'psmdb') return String(r?.spec?.image ?? '');
    return String(r?.spec?.template?.spec?.containers?.[0]?.image ?? '');
  }
  storage(id: DataEngineId): string {
    const rows = this.runtime(id).pvcs;
    return rows.map((x) => `${x.metadata?.name}: ${x.status?.capacity?.storage ?? x.spec?.resources?.requests?.storage ?? '—'}`).join(' · ') || '—';
  }
}
