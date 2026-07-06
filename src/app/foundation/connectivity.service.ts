import { Injectable, signal } from '@angular/core';
import { apiBase, FND_NS } from '../api-base';
import { State } from '../modules/postgres/cnpg.types';

// Basic Service Stack(BSS) ↔ Foundation 연결의 실측 상태. §1.1(3-스택 소비 계약) 기준.
// BSS = 클러스터 어디서든 쓰는 범용 k8s 서비스(kube-prometheus-stack·ingress-nginx·cert-manager·StorageClass·Velero).
// Velero는 클러스터의 아무 네임스페이스나 백업 대상으로 삼는 워크로드 무관 범용 DR 도구라 BSS(2026-07-04 재확정, 사용자).
// OTel Collector/CloudNativePG/Crossplane은 Foundation 자신의 구성에 특정 배선된 FSS 엔진이라 여기 없다 — engines.service.ts 참조.
// "코드에 구현됐는가"(정적, file:line 근거)와 "지금 이 클러스터에 대응 인프라가 실재하는가"(라이브 k8s 조회)를
// 분리해 각각 정직하게 보여준다 — 둘을 섞어 "설치된 것처럼" 오인시키지 않는다(§9.3 사고 재발 방지).
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly modelCount = signal<number>(0);
  readonly descriptorCount = signal<number>(0);
  readonly models = signal<any[]>([]);
  readonly descriptors = signal<any[]>([]);

  // Basic Service Stack 컴포넌트 라이브 존재 여부(카드별 liveKey로 참조).
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

  /** 리소스 GET → 6-state(404=미설치, 403=권한없음). 존재 확인 전용. */
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
      this.loadModules(),
      // Basic host 컴포넌트
      this.probe('prometheus', 'api/v1/namespaces/monitoring/services/kps-prometheus'),
      this.probe('ingress', 'apis/networking.k8s.io/v1/ingressclasses/nginx'),
      this.probe('certmanager', 'apis/apiextensions.k8s.io/v1/customresourcedefinitions/clusterissuers.cert-manager.io'),
      this.probe('storage', 'apis/storage.k8s.io/v1/storageclasses/standard'),
      this.probe('velero', 'apis/apiextensions.k8s.io/v1/customresourcedefinitions/backups.velero.io'),
      // otel/cnpg/crossplane은 FSS 엔진 카탈로그(engines.service.ts)로 이관됨(2026-07-04) —
      // "범용 k8s 서비스=BSS, OpenSphere 구성 전용=FSS" 기준, 이 3개는 BSS가 아니다.
    ]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async probe(key: string, path: string): Promise<void> {
    this.setLive(key, await this.existsState(path));
  }

  private async loadModules(): Promise<void> {
    try {
      const [fm, fmd] = await Promise.all([
        fetch(this.k('apis/foundation.opensphere.io/v1alpha1/foundationmodels')),
        fetch(this.k('apis/foundation.opensphere.io/v1alpha1/foundationmoduledescriptors')),
      ]);
      if (!fm.ok || !fmd.ok) { return; }
      const models = (await fm.json()).items ?? [];
      const descriptors = (await fmd.json()).items ?? [];
      this.models.set(models);
      this.descriptors.set(descriptors);
      this.modelCount.set(models.length);
      this.descriptorCount.set(descriptors.length);
    } catch { /* noop */ }
  }

  liveState(key: string): State { return this.live()[key] ?? 'loading'; }

  readonly ns = FND_NS;
}
