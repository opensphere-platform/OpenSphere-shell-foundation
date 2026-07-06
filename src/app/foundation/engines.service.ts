import { Injectable, signal } from '@angular/core';
import { apiBase } from '../api-base';
import { State } from '../modules/postgres/cnpg.types';

// FSS 엔진 카탈로그의 라이브 상태. BSS(connectivity.service.ts)와 분리된 이유(2026-07-04, 사용자 확정):
// "범용 k8s 서비스면 BSS, OpenSphere 구성 전용이면 FSS" — OTel Collector(Foundation 모듈 전용 게이트웨이)·
// CloudNativePG(Foundation data 전용 operator)·Crossplane(OpenSphere 자체 설치 엔진)은 클러스터의 아무 워크로드나
// 범용으로 쓰는 게 아니라 OpenSphere 자신의 구성을 위해서만 존재한다. 따라서 BSS 멤버가 될 수 없고(양립 불가),
// FSS 소속 엔진 카탈로그로 분리한다. ※ Velero는 워크로드 무관 범용 DR 도구라 BSS로 재확정(2026-07-04)
// → connectivity.service.ts로 이동, 여기 없음.
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
      this.probe('otel', 'apis/apps/v1/namespaces/opensphere-otel-collector/deployments/otel-collector-opentelemetry-collector'),
      this.probe('cnpg', 'apis/apiextensions.k8s.io/v1/customresourcedefinitions/clusters.postgresql.cnpg.io'),
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
