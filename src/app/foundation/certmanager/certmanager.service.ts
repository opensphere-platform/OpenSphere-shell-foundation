import { Injectable, computed, signal } from '@angular/core';
import { apiBase } from '../../api-base';
import { State } from '../../modules/postgres/cnpg.types';

const NS = 'cert-manager';

export interface CertRow { name: string; namespace: string; ready: boolean; notAfter: string; daysLeft: number }

// cert-manager 상세 — 상태 전용(설치 버튼 없음, 사용자 확정 2026-07-04). 콘솔 자신의 TLS 발급이 이 위에
// 얹혀 있어 여기서 재설치를 시도하지 않는다. 실제 Certificate CR의 만료일을 그대로 보여준다(가공 없음).
@Injectable({ providedIn: 'root' })
export class CertManagerService {
  readonly controllerState = signal<State>('loading');
  readonly cainjectorState = signal<State>('loading');
  readonly webhookState = signal<State>('loading');

  readonly certs = signal<CertRow[]>([]);

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
    await Promise.allSettled([
      this.loadDeploy('cert-manager', this.controllerState),
      this.loadDeploy('cert-manager-cainjector', this.cainjectorState),
      this.loadDeploy('cert-manager-webhook', this.webhookState),
      this.loadCerts(),
    ]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async loadDeploy(name: string, dest: ReturnType<typeof signal>): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${NS}/deployments/${name}`));
      if (r.status === 403) { dest.set('noperm'); return; }
      if (!r.ok) { dest.set('nocrd'); return; }
      const j = await r.json();
      dest.set((j.status?.readyReplicas ?? 0) > 0 ? 'ok' : 'error');
    } catch { dest.set('error'); }
  }

  private async loadCerts(): Promise<void> {
    try {
      const r = await fetch(this.k('apis/cert-manager.io/v1/certificates'));
      if (!r.ok) { this.certs.set([]); return; }
      const items: any[] = (await r.json()).items ?? [];
      const now = Date.now();
      this.certs.set(items.map((it) => {
        const notAfter = it.status?.notAfter ?? '';
        const days = notAfter ? Math.round((new Date(notAfter).getTime() - now) / 86400000) : -1;
        const readyCond = (it.status?.conditions ?? []).find((c: any) => c.type === 'Ready');
        return {
          name: it.metadata?.name ?? '', namespace: it.metadata?.namespace ?? '',
          ready: readyCond?.status === 'True', notAfter, daysLeft: days,
        };
      }).sort((a, b) => a.daysLeft - b.daysLeft));
    } catch { this.certs.set([]); }
  }

  readonly phaseLabel = computed<string>(() => {
    if (this.controllerState() === 'loading') { return '확인 중'; }
    return this.controllerState() === 'ok' ? 'Running' : '문제 있음';
  });
  readonly expiringSoon = computed<number>(() => this.certs().filter((c) => c.daysLeft >= 0 && c.daysLeft < 14).length);
}
