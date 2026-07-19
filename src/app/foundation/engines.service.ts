import { Injectable, signal } from '@angular/core';
import { apiBase } from '../api-base';
import { State } from '../modules/postgres/cnpg.types';

// PFS 모듈 카탈로그의 라이브 상태.
// 정본(CONSTITUTION-0004 §2.0.4): PFS core는 identity/data/ai-substrate/comm/observability/backup.
// 이 service는 정본 멤버 자체가 아니라 그 모듈을 구현·조달하는 엔진 후보의 live 상태를 조회한다.
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
      // OTel Collector는 자체 CRD가 없어 실제 Deployment 존재로 직접 확인.
      this.probe('otel', 'apis/apps/v1/namespaces/opensphere-foundation/deployments/otel-collector-opentelemetry-collector'),
      this.probe('cnpg', 'apis/apiextensions.k8s.io/v1/customresourcedefinitions/clusters.postgresql.cnpg.io'),
      this.probe('argocd', 'apis/apps/v1/namespaces/argocd/deployments/argocd-server'),
      this.probe('crossplane', 'apis/apiextensions.k8s.io/v1/customresourcedefinitions/compositions.apiextensions.crossplane.io'),
      this.probe('opensearch', 'apis/apps/v1/namespaces/opensphere-foundation/statefulsets/opensphere-search'),
    ]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async probe(key: string, path: string): Promise<void> {
    this.setLive(key, await this.existsState(path));
  }

  liveState(key: string): State { return this.live()[key] ?? 'loading'; }
}
