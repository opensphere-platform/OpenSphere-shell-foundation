import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS } from '../../api-base';
import { PollBackoff } from '../../shared/poll-backoff';
import { Phase, State, phaseClass } from '../postgres/cnpg.types';

// Deployment 기반 워크로드 health 공통(Keycloak·Samba) — /api/k8s deployment+pods 도출. 폴러는 shell이 소유.
// 2026-07-06(Samba-AD 편입): 워크로드 이름을 control-plane identity 번들 정본(foundation-identity-*)으로 정합.
//   구 bootstrap 이름(opensphere-keycloak/opensphere-samba)은 폐기 — 실물은 FoundationModel(identity) CR →
//   reconciler(SSA)가 만든다. UI 폴러는 그 실물을 본다("메뉴=실재의 투영").
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
  protected backoff = new PollBackoff();

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
    this.timer = setInterval(() => { if (this.autoRefresh()) { this.refresh(); } }, 15000);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.started = false; }
  toggleAuto(): void { this.autoRefresh.update((v) => !v); }

  protected k(p: string): string { return `${apiBase()}/api/k8s/${p}`; }
  async refresh(): Promise<void> {
    this.busy.set(true);
    this.backoff.nextTick();
    await Promise.allSettled([this.loadDeploy(), this.loadPods(), ...this.extraLoads()]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }
  /** 서브클래스 추가 로드 훅(FoundationModel status·K8s events 등) — 같은 tick/backoff 리듬에 합류. */
  protected extraLoads(): Promise<void>[] { return []; }
  async loadDeploy(): Promise<void> {
    if (!this.backoff.due('deploy')) { return; }
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${this.ns}/deployments/${this.name}`));
      const s: State = r.status === 403 ? 'noperm' : !r.ok ? 'nocrd' : 'ok';
      this.backoff.report('deploy', s);
      this.state.set(s);
      if (s === 'ok') { this.deploy.set(await r.json()); }
    } catch { this.backoff.report('deploy', 'error'); this.state.set('error'); }
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
  /** 워크로드 env 값(자기기술 — Deployment spec에서 도출, 하드코딩 대신). */
  protected env(name: string): string {
    const envs = this.deploy()?.spec?.template?.spec?.containers?.[0]?.env || [];
    return envs.find((e: any) => e?.name === name)?.value || '';
  }
}

@Injectable({ providedIn: 'root' })
export class KcService extends WorkloadHealth {
  readonly name = 'foundation-identity-keycloak';
  readonly http = `foundation-identity-keycloak.${FND_NS}.svc:8080`;
  // identity 번들(D-3)은 start-dev(H2 내장) — Foundation PG 소비는 후속(정직 표기).
  readonly db = 'H2(내장, start-dev — 번들 D-3)';
  readonly admin = '미설정(번들에 admin bootstrap 없음 — Syncope 권위 D-7)';
  readonly fm = signal<any>(null);
  readonly events = signal<any[]>([]);
  protected override extraLoads(): Promise<void>[] { return [this.loadFm(), this.loadEvents()]; }
  private async loadFm(): Promise<void> {
    if (!this.backoff.due('kc-fm')) return;
    try {
      const r = await fetch(this.k('apis/foundation.opensphere.io/v1alpha1/foundationmodels/identity'));
      this.backoff.report('kc-fm', r.ok ? 'ok' : r.status === 404 ? 'nocrd' : 'error');
      this.fm.set(r.ok ? await r.json() : null);
    } catch { this.backoff.report('kc-fm', 'error'); }
  }
  private async loadEvents(): Promise<void> {
    if (!this.backoff.due('kc-events')) return;
    try {
      const fs = encodeURIComponent(`involvedObject.name=${this.name}`);
      const r = await fetch(this.k(`api/v1/namespaces/${this.ns}/events?fieldSelector=${fs}&limit=30`));
      this.backoff.report('kc-events', r.ok ? 'ok' : 'error');
      const items = r.ok ? ((await r.json()).items || []) : [];
      items.sort((a: any, b: any) => String(b.lastTimestamp || b.eventTime || '').localeCompare(String(a.lastTimestamp || a.eventTime || '')));
      this.events.set(items);
    } catch { this.backoff.report('kc-events', 'error'); }
  }
  readonly issuer = computed<string>(() => this.fm()?.status?.issuerURL || `http://${this.http}/realms/opensphere-workforce`);
  readonly jwks = computed<string>(() => this.fm()?.status?.jwksURL || `${this.issuer()}/protocol/openid-connect/certs`);
}

@Injectable({ providedIn: 'root' })
export class SambaService extends WorkloadHealth {
  readonly name = 'foundation-identity-samba';
  readonly ldap = `foundation-identity-samba.${FND_NS}.svc:389`;

  // ── 자기기술: realm/도메인은 하드코딩이 아니라 실물 Deployment env(DOMAIN)에서 도출(폴백 표기 '—') ──
  readonly realm = computed<string>(() => this.env('DOMAIN') || '—');
  readonly netbios = computed<string>(() => (this.env('DOMAIN') || '').split('.')[0] || '—');
  baseDn(): string {
    const r = this.env('DOMAIN');
    return r ? 'DC=' + r.split('.').join(',DC=') : '—';
  }

  // ── FoundationModel(identity) — 선언형 수명주기·관측의 클러스터 정본을 그대로 노출 ──
  readonly fm = signal<any>(null);
  readonly fmState = signal<State>('loading');
  // ── K8s 이벤트(운영 신호) — samba 오브젝트 연관 이벤트만 ──
  readonly events = signal<any[]>([]);

  protected override extraLoads(): Promise<void>[] { return [this.loadFm(), this.loadEvents()]; }

  private async loadFm(): Promise<void> {
    if (!this.backoff.due('fm')) { return; }
    try {
      const r = await fetch(this.k('apis/foundation.opensphere.io/v1alpha1/foundationmodels/identity'));
      const s: State = r.status === 403 ? 'noperm' : r.status === 404 ? 'nocrd' : !r.ok ? 'error' : 'ok';
      this.backoff.report('fm', s);
      this.fmState.set(s);
      this.fm.set(s === 'ok' ? await r.json() : null);
    } catch { this.backoff.report('fm', 'error'); this.fmState.set('error'); }
  }
  private async loadEvents(): Promise<void> {
    if (!this.backoff.due('events')) { return; }
    try {
      const fs = encodeURIComponent(`involvedObject.name=${this.name}`);
      const r = await fetch(this.k(`api/v1/namespaces/${this.ns}/events?fieldSelector=${fs}&limit=15`));
      this.backoff.report('events', r.ok ? 'ok' : 'error');
      const items: any[] = r.ok ? ((await r.json()).items || []) : [];
      items.sort((a, b) => String(b.lastTimestamp || b.eventTime || '').localeCompare(String(a.lastTimestamp || a.eventTime || '')));
      this.events.set(items);
    } catch { this.backoff.report('events', 'error'); }
  }

  /** FoundationModel status.observed(정직 신호 — control-plane이 기록). */
  readonly observed = computed<any[]>(() => (this.fm()?.status?.observed as any[]) ?? []);
  readonly fmPhase = computed<string>(() => this.fm()?.status?.phase || '—');
  readonly fmObservedAt = computed<string>(() => this.fm()?.status?.observedAt || '');
  readonly fmControlPlane = computed<string>(() => this.fm()?.status?.controlPlane || '—');
  readonly ldapUrl = computed<string>(() => this.fm()?.status?.ldapURL || `ldap://${this.ldap}`);
  /** engines 설치옵션(도메인 CR) — samba가 설치옵션으로 꺼졌는지 구분(미배포 원인 안내). */
  readonly engineOpt = computed<string>(() => this.fm()?.spec?.parameters?.engines?.samba || 'enabled');
}
