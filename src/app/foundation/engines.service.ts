import { Injectable, signal } from '@angular/core';
import { apiBase } from '../api-base';
import { State } from '../shared/service-health';

// PFS 모듈 카탈로그의 라이브 상태.
// 정본(CONSTITUTION-0004 §2.0.4): PFS core는 identity/data/ai-substrate/comm/observability/backup.
// 이 service는 정본 멤버 자체가 아니라 그 모듈을 구현하는 Operator/operand의 live 상태를 조회한다.
@Injectable({ providedIn: 'root' })
export class EnginesService {
  readonly live = signal<Record<string, State>>({});
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);
  private started = false;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
  }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  private async existsState(path: string): Promise<State> {
    try {
      const r = await fetch(this.k(path));
      if (r.status === 403) { return 'noperm'; }
      if (r.status === 404) { return 'nocrd'; }
      if (!r.ok) { return 'error'; }
      return 'ok';
    } catch { return 'error'; }
  }

  private setLive(key: string, s: State): void {
    this.live.update((m) => ({ ...m, [key]: s }));
  }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([
      this.probe('keycloak', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-identity-keycloak'),
      this.probe('syncope', 'apis/apps/v1/namespaces/opensphere-foundation/statefulsets/foundation-identity-syncope'),
      this.probe('samba', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-identity-samba'),
      this.probe('opa', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-identity-opa'),
      this.probe('postgres', 'apis/apiextensions.k8s.io/v1/customresourcedefinitions/sgclusters.stackgres.io'),
      this.probe('psmdb', 'apis/psmdb.percona.com/v1/namespaces/opensphere-foundation/perconaservermongodbs/foundation-data-mongodb'),
      this.probe('valkey', 'apis/apps/v1/namespaces/opensphere-foundation/statefulsets/foundation-data-valkey'),
      this.probe('rustfs', 'apis/apps/v1/namespaces/opensphere-foundation/statefulsets/opensphere-rustfs'),
      this.probe('opensearch', 'apis/opensearch.opster.io/v1/namespaces/opensphere-foundation/opensearchclusters/opensphere-search'),
      this.probe('litellm', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-ai-litellm'),
      this.probe('langfuse', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-ai-langfuse'),
      this.probe('stalwart', 'apis/apps/v1/namespaces/opensphere-foundation/statefulsets/foundation-communication-stalwart'),
      this.probe('novu', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-communication-novu-api'),
      this.probe('mattermost', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-communication-mattermost'),
      this.probe('otel', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/foundation-observability-collector'),
      this.probe('tempo', 'apis/apps/v1/namespaces/opensphere-foundation/statefulsets/foundation-observability-tempo'),
      this.probe('loki', 'apis/apps/v1/namespaces/opensphere-foundation/statefulsets/foundation-observability-loki'),
      this.probe('grafana', 'apis/grafana.integreatly.org/v1beta1/namespaces/opensphere-foundation/grafanas/foundation-observability-grafana'),
      this.probe('backup', 'apis/apps/v1/namespaces/opensphere-backup/deployments/opensphere-backup'),
      this.probe('argocd', 'apis/apps/v1/namespaces/argocd/deployments/argocd-server'),
      this.probe('crossplane', 'apis/apiextensions.k8s.io/v1/customresourcedefinitions/compositions.apiextensions.crossplane.io'),
    ]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async probe(key: string, path: string): Promise<void> {
    this.setLive(key, await this.existsState(path));
  }

  liveState(key: string): State { return this.live()[key] ?? 'loading'; }
}
