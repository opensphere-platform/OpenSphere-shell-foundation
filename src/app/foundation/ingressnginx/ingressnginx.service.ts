import { Injectable, computed, signal } from '@angular/core';
import { apiBase } from '../../api-base';
import { State } from '../../modules/postgres/cnpg.types';

const NS = 'ingress-nginx';

export interface IngressRow { name: string; namespace: string; host: string; tls: boolean }

// ingress-nginx 상세 — 상태 전용(설치 버튼 없음, 사용자 확정 2026-07-04). 콘솔 자신의 진입점이 이 위에
// 얹혀 있어 여기서 재설치/전환을 시도하지 않는다. 메트릭 미노출(ServiceMonitor 없음) — 있는 그대로만 표시.
@Injectable({ providedIn: 'root' })
export class IngressNginxService {
  readonly deployState = signal<State>('loading');
  readonly ready = signal(0);
  readonly total = signal(0);
  readonly image = signal<string>('');

  readonly ingresses = signal<IngressRow[]>([]);

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
    await Promise.allSettled([this.loadDeploy(), this.loadIngresses()]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async loadDeploy(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${NS}/deployments/ingress-nginx-controller`));
      if (r.status === 403) { this.deployState.set('noperm'); return; }
      if (!r.ok) { this.deployState.set('nocrd'); return; }
      const j = await r.json();
      this.ready.set(j.status?.readyReplicas ?? 0);
      this.total.set(j.spec?.replicas ?? 0);
      this.image.set(j.spec?.template?.spec?.containers?.[0]?.image ?? '');
      this.deployState.set('ok');
    } catch { this.deployState.set('error'); }
  }

  private async loadIngresses(): Promise<void> {
    try {
      const r = await fetch(this.k('apis/networking.k8s.io/v1/ingresses'));
      if (!r.ok) { this.ingresses.set([]); return; }
      const items: any[] = (await r.json()).items ?? [];
      this.ingresses.set(items.map((it) => ({
        name: it.metadata?.name ?? '',
        namespace: it.metadata?.namespace ?? '',
        host: it.spec?.rules?.[0]?.host ?? '*',
        tls: (it.spec?.tls ?? []).length > 0,
      })));
    } catch { this.ingresses.set([]); }
  }

  readonly phaseLabel = computed<string>(() => {
    if (this.deployState() === 'loading') { return '확인 중'; }
    return this.deployState() === 'ok' && this.ready() > 0 ? 'Running' : '문제 있음';
  });

  readonly byNamespace = computed<{ ns: string; count: number }[]>(() => {
    const m = new Map<string, number>();
    for (const i of this.ingresses()) { m.set(i.namespace, (m.get(i.namespace) ?? 0) + 1); }
    return [...m.entries()].map(([ns, count]) => ({ ns, count })).sort((a, b) => b.count - a.count);
  });
  readonly tlsCount = computed<number>(() => this.ingresses().filter((i) => i.tls).length);
}
