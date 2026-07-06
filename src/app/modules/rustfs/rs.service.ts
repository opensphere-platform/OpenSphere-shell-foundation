import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS } from '../../api-base';
import { PollBackoff } from '../../shared/poll-backoff';
import { Phase, State, phaseClass } from '../postgres/cnpg.types';

const NAME = 'opensphere-rustfs';

// RustFS(S3 object storage) 데이터 서비스 — /api/k8s로 StatefulSet·pod·PVC 도출(health = pod ready).
// S3 API는 서명 필요라 v1은 k8s 상태 기반. 버킷·사용량은 후속(S3 프록시/서명) 또는 RustFS 자체 콘솔(:9001).
@Injectable({ providedIn: 'root' })
export class RsService {
  readonly ns = FND_NS;
  readonly name = NAME;
  readonly s3 = `${NAME}.${FND_NS}.svc:9000`;
  readonly consoleEp = `${NAME}.${FND_NS}.svc:9001`;
  readonly credSecret = 'rustfs-credentials';

  readonly sts = signal<any>(null);
  readonly pods = signal<any[]>([]);
  readonly pvc = signal<any>(null);
  readonly state = signal<State>('loading');
  readonly autoRefresh = signal(true);
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);

  private timer: any = null;
  private started = false;
  private backoff = new PollBackoff();

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
    this.backoff.nextTick();
    await Promise.allSettled([this.loadSts(), this.loadPods(), this.loadPvc()]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }
  async loadSts(): Promise<void> {
    if (!this.backoff.due('sts')) { return; }
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${this.ns}/statefulsets/${this.name}`));
      const s: State = r.status === 403 ? 'noperm' : !r.ok ? 'nocrd' : 'ok';
      this.backoff.report('sts', s);
      this.state.set(s);
      if (s === 'ok') { this.sts.set(await r.json()); }
    } catch { this.backoff.report('sts', 'error'); this.state.set('error'); }
  }
  async loadPods(): Promise<void> {
    if (!this.backoff.due('pods')) { return; }
    try {
      const sel = encodeURIComponent(`app=${this.name}`);
      const r = await fetch(this.k(`api/v1/namespaces/${this.ns}/pods?labelSelector=${sel}`));
      this.backoff.report('pods', r.ok ? 'ok' : r.status === 404 ? 'nocrd' : 'error');
      this.pods.set(r.ok ? ((await r.json()).items || []) : []);
    } catch { this.backoff.report('pods', 'error'); this.pods.set([]); }
  }
  async loadPvc(): Promise<void> {
    if (!this.backoff.due('pvc')) { return; }
    try {
      const r = await fetch(this.k(`api/v1/namespaces/${this.ns}/persistentvolumeclaims/data-${this.name}-0`));
      this.backoff.report('pvc', r.ok ? 'ok' : r.status === 404 ? 'nocrd' : 'error');
      this.pvc.set(r.ok ? await r.json() : null);
    } catch { this.backoff.report('pvc', 'error'); this.pvc.set(null); }
  }

  readonly ready = computed<boolean>(() => {
    const p = this.pods()[0];
    return !!p && (p.status?.conditions || []).some((c: any) => c.type === 'Ready' && c.status === 'True');
  });
  readonly readyN = computed<number>(() => this.sts()?.status?.readyReplicas ?? (this.ready() ? 1 : 0));
  readonly totalN = computed<number>(() => this.sts()?.spec?.replicas ?? this.pods().length);
  readonly phase = computed<string>(() => {
    if (this.ready()) { return 'Running'; }
    if (this.state() === 'loading') { return '확인 중'; }
    if (this.pods().length) { return this.pods()[0]?.status?.phase || 'Pending'; }
    return '미발견';
  });
  readonly phaseCls = computed<Phase>(() => (this.ready() ? 'ok' : phaseClass(this.phase(), false)));
  readonly capacity = computed<string>(() => this.pvc()?.status?.capacity?.storage || this.pvc()?.spec?.resources?.requests?.storage || '—');
  readonly node = computed<string>(() => this.pods()[0]?.spec?.nodeName || '—');
  readonly image = computed<string>(() => this.sts()?.spec?.template?.spec?.containers?.[0]?.image || '');
  readonly restarts = computed<number>(() => (this.pods()[0]?.status?.containerStatuses || []).reduce((a: number, c: any) => a + (c.restartCount || 0), 0));
}
