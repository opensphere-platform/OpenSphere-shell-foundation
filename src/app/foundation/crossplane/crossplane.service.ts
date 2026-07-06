import { Injectable, computed, signal } from '@angular/core';
import { apiBase } from '../../api-base';
import { State } from '../../modules/postgres/cnpg.types';

const NS = 'crossplane-system';

export interface ProviderRow { name: string; installed: boolean; healthy: boolean; package: string }
export interface ReleaseRow { name: string; namespace: string; chart: string; synced: boolean; ready: boolean; state: string }

// Crossplane 상세 — 이미 설치돼 있고, 다른 6개 모듈이 이걸 통해 설치된다(메타 페이지, 설치 버튼 없음).
// "내부·외부 막론 통일 control-plane"으로 방향 전환(2026-07-03, crossplane-unification-decision).
@Injectable({ providedIn: 'root' })
export class CrossplaneService {
  readonly coreState = signal<State>('loading');
  readonly rbacState = signal<State>('loading');
  readonly providers = signal<ProviderRow[]>([]);
  readonly releases = signal<ReleaseRow[]>([]);

  readonly lastSync = signal<string>('');
  readonly busy = signal(false);
  private started = false;
  private timer: any = null;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 15000);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.started = false; }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([this.loadCore(), this.loadRbac(), this.loadProviders(), this.loadReleases()]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async loadCore(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${NS}/deployments/crossplane`));
      if (r.status === 403) { this.coreState.set('noperm'); return; }
      if (!r.ok) { this.coreState.set('nocrd'); return; }
      const j = await r.json();
      this.coreState.set((j.status?.readyReplicas ?? 0) > 0 ? 'ok' : 'error');
    } catch { this.coreState.set('error'); }
  }
  private async loadRbac(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${NS}/deployments/crossplane-rbac-manager`));
      if (r.status === 403) { this.rbacState.set('noperm'); return; }
      if (!r.ok) { this.rbacState.set('nocrd'); return; }
      const j = await r.json();
      this.rbacState.set((j.status?.readyReplicas ?? 0) > 0 ? 'ok' : 'error');
    } catch { this.rbacState.set('error'); }
  }
  private async loadProviders(): Promise<void> {
    try {
      const r = await fetch(this.k('apis/pkg.crossplane.io/v1/providers'));
      if (!r.ok) { this.providers.set([]); return; }
      const items: any[] = (await r.json()).items ?? [];
      this.providers.set(items.map((it) => {
        const conds = it.status?.conditions ?? [];
        return {
          name: it.metadata?.name ?? '',
          installed: conds.some((c: any) => c.type === 'Installed' && c.status === 'True'),
          healthy: conds.some((c: any) => c.type === 'Healthy' && c.status === 'True'),
          package: it.spec?.package ?? '',
        };
      }));
    } catch { this.providers.set([]); }
  }
  private async loadReleases(): Promise<void> {
    try {
      const r = await fetch(this.k('apis/helm.crossplane.io/v1beta1/releases'));
      if (!r.ok) { this.releases.set([]); return; }
      const items: any[] = (await r.json()).items ?? [];
      this.releases.set(items.map((it) => {
        const conds = it.status?.conditions ?? [];
        return {
          name: it.metadata?.name ?? '',
          namespace: it.spec?.forProvider?.namespace ?? '',
          chart: it.spec?.forProvider?.chart?.name ?? '',
          synced: conds.some((c: any) => c.type === 'Synced' && c.status === 'True'),
          ready: conds.some((c: any) => c.type === 'Ready' && c.status === 'True'),
          state: it.status?.atProvider?.state ?? '',
        };
      }));
    } catch { this.releases.set([]); }
  }

  readonly phaseLabel = computed<string>(() => {
    if (this.coreState() === 'loading') { return '확인 중'; }
    return this.coreState() === 'ok' ? 'Running' : '문제 있음';
  });
  readonly readyReleaseCount = computed<number>(() => this.releases().filter((r) => r.ready).length);
  readonly healthyProviderCount = computed<number>(() => this.providers().filter((p) => p.healthy).length);
}
