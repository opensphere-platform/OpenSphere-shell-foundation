import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS } from '../../api-base';
import { Phase, State, phaseClass } from '../postgres/cnpg.types';

// Deployment 기반 워크로드 health 공통(Keycloak·Samba) — /api/k8s deployment+pods 도출. 폴러는 shell이 소유.
abstract class WorkloadHealth {
  abstract readonly name: string;
  readonly ns = FND_NS;
  readonly deploy = signal<any>(null);
  readonly pods = signal<any[]>([]);
  readonly state = signal<State>('loading');
  readonly autoRefresh = signal(true);
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);
  private timer: any = null;
  private started = false;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
    this.timer = setInterval(() => { if (this.autoRefresh()) { this.refresh(); } }, 15000);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.started = false; }
  toggleAuto(): void { this.autoRefresh.update((v) => !v); }

  private k(p: string): string { return `${apiBase()}/api/k8s/${p}`; }
  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([this.loadDeploy(), this.loadPods()]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }
  async loadDeploy(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${this.ns}/deployments/${this.name}`));
      if (r.status === 403) { this.state.set('noperm'); return; }
      if (!r.ok) { this.state.set('nocrd'); return; }
      this.deploy.set(await r.json());
      this.state.set('ok');
    } catch { this.state.set('error'); }
  }
  async loadPods(): Promise<void> {
    try {
      const sel = encodeURIComponent(`app=${this.name}`);
      const r = await fetch(this.k(`api/v1/namespaces/${this.ns}/pods?labelSelector=${sel}`));
      this.pods.set(r.ok ? ((await r.json()).items || []) : []);
    } catch { this.pods.set([]); }
  }

  readonly ready = computed<boolean>(() => {
    const p = this.pods()[0];
    return !!p && (p.status?.conditions || []).some((c: any) => c.type === 'Ready' && c.status === 'True');
  });
  readonly readyN = computed<number>(() => this.deploy()?.status?.readyReplicas ?? (this.ready() ? 1 : 0));
  readonly totalN = computed<number>(() => this.deploy()?.spec?.replicas ?? this.pods().length);
  readonly phase = computed<string>(() => {
    if (this.ready()) { return 'Running'; }
    if (this.state() === 'loading') { return '확인 중'; }
    if (this.pods().length) { return this.pods()[0]?.status?.phase || 'Pending'; }
    return '미발견';
  });
  readonly phaseCls = computed<Phase>(() => (this.ready() ? 'ok' : phaseClass(this.phase(), false)));
  readonly image = computed<string>(() => this.deploy()?.spec?.template?.spec?.containers?.[0]?.image || '');
  readonly node = computed<string>(() => this.pods()[0]?.spec?.nodeName || '—');
  readonly restarts = computed<number>(() => (this.pods()[0]?.status?.containerStatuses || []).reduce((a: number, c: any) => a + (c.restartCount || 0), 0));
}

@Injectable({ providedIn: 'root' })
export class KcService extends WorkloadHealth {
  readonly name = 'opensphere-keycloak';
  readonly http = `opensphere-keycloak.${FND_NS}.svc:8080`;
  readonly db = 'keycloak @ opensphere-pg (Foundation PG)';
  readonly admin = 'admin / admin (dev)';
}

@Injectable({ providedIn: 'root' })
export class SambaService extends WorkloadHealth {
  readonly name = 'opensphere-samba';
  readonly ldap = `opensphere-samba.${FND_NS}.svc:389`;
  readonly realm = 'OPENSPHERE.LOCAL';
  readonly domain = 'OPENSPHERE';
  baseDn(): string { return 'DC=' + this.realm.split('.').join(',DC='); }
}
