import { Injectable, computed, signal } from '@angular/core';
import { apiBase, hostFetch, writeHeaders } from '../../api-base';

export interface PostgresFleetCluster {
  id: string; provider: 'stackgres'; namespace: string; name: string;
  displayName: string; mode: 'Dedicated'; phase: string; ready: boolean;
  instances: number; readyInstances: number; postgresVersion: string; storage: string;
  plan: string; bindingSecret: string; uid: string; createdAt: string | null;
}

export interface PostgresClaimDraft {
  name: string; namespace: string; database: string; owner: string; plan: string;
  storageSize?: string; storageClass?: string;
}

@Injectable({ providedIn: 'root' })
export class PostgresFleetService {
  readonly clusters = signal<PostgresFleetCluster[]>([]);
  readonly plans = signal<any[]>([]);
  readonly claims = signal<any[]>([]);
  readonly namespaces = signal<string[]>(['opensphere-foundation']);
  readonly selectedId = signal('');
  readonly state = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly selected = computed(() => this.clusters().find((cluster) => cluster.id === this.selectedId()) || this.clusters()[0] || null);

  private api(path: string): string { return `${apiBase()}${path}`; }

  async refresh(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try {
      const [fleet, plans, claims, namespaces] = await Promise.all([
        hostFetch(this.api('/api/foundation/postgres/clusters'), { cache: 'no-store' }),
        hostFetch(this.api('/api/k8s/apis/catalog.opensphere.io/v1alpha1/addonplans'), { cache: 'no-store' }),
        hostFetch(this.api('/api/k8s/apis/provisioning.opensphere.io/v1beta1/postgresclaims'), { cache: 'no-store' }),
        hostFetch(this.api('/api/foundation/postgres/namespaces'), { cache: 'no-store' }),
      ]);
      const fleetBody = await fleet.json().catch(() => ({}));
      if (!fleet.ok) throw new Error(fleetBody.error || `PostgreSQL fleet HTTP ${fleet.status}`);
      const clusterRows = (fleetBody.clusters || []) as PostgresFleetCluster[];
      this.clusters.set(clusterRows);
      if (!clusterRows.some((cluster) => cluster.id === this.selectedId()) && clusterRows[0]) {
        this.selectedId.set(clusterRows[0].id);
      }
      this.plans.set(plans.ok ? ((await plans.json()).items || []).filter((item: any) => item.spec?.capabilityRef === 'postgresql') : []);
      this.claims.set(claims.ok ? ((await claims.json()).items || []) : []);
      if (namespaces.ok) {
        const rows: string[] = ((await namespaces.json()).namespaces || [])
          .map((item: any): string => String(item.name || ''))
          .filter((name: string) => Boolean(name));
        const available = rows.length ? rows : ['opensphere-foundation'];
        this.namespaces.set([...new Set<string>(available)]);
      }
      this.state.set(clusterRows.length ? 'ok' : 'empty');
    } catch (error: any) {
      this.error.set(error?.message || String(error)); this.state.set('error');
    } finally { this.busy.set(false); }
  }

  select(id: string): void { this.selectedId.set(id); }

  async createNamespace(name: string, reason: string): Promise<void> {
    const response = await hostFetch(this.api('/api/foundation/postgres/namespaces'), {
      method: 'POST', headers: writeHeaders(), body: JSON.stringify({ name, reason }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || `Namespace HTTP ${response.status}`);
    if (!this.namespaces().includes(name)) this.namespaces.update((rows) => [...rows, name].sort());
  }

  async createClaim(draft: PostgresClaimDraft): Promise<void> {
    const spec: any = {
      planRef: { name: draft.plan }, isolation: 'Dedicated', database: draft.database, owner: draft.owner,
      deletionPolicy: 'Retain',
    };
    if (draft.storageSize || draft.storageClass) spec.storage = { size: draft.storageSize || undefined, storageClass: draft.storageClass || undefined };
    const response = await hostFetch(this.api(`/api/k8s/apis/provisioning.opensphere.io/v1beta1/namespaces/${encodeURIComponent(draft.namespace)}/postgresclaims`), {
      method: 'POST', headers: writeHeaders(), body: JSON.stringify({
        apiVersion: 'provisioning.opensphere.io/v1beta1', kind: 'PostgresClaim',
        metadata: { name: draft.name, namespace: draft.namespace }, spec,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || `PostgresClaim HTTP ${response.status}`);
    await this.refresh();
  }
}
