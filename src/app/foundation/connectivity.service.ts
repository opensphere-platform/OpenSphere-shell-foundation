import { Injectable, signal } from '@angular/core';
import { apiBase, FND_NS } from '../api-base';
import { State } from '../modules/postgres/cnpg.types';

// Basic Service Stack(BSS) ↔ Foundation 연결의 실측 상태.
// 정본(_DOCS_/Foundation/FS-구축계획서-2026-07-02.md §1.1): BSS = k8s에서 범용 제공하는 클러스터 공유 인프라.
// 현 클러스터 정본 실체는 kube-prometheus-stack(ns monitoring), storage(local-path), ingress다.
// cert-manager/Velero는 여기서 함께 관측하는 host 연결 운영 의존성이다.
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
      // otel/cnpg/crossplane은 FS 모듈 구현 엔진이므로 engines.service.ts에서 관측한다.
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
