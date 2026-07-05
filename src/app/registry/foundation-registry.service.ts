import { Injectable, computed, inject, signal } from '@angular/core';
import { FOUNDATION_PLUGINS } from './plugins.registry';
import { HostedPlugin, PluginHealth } from './hosted-plugin';
import { CnpgService } from '../modules/postgres/cnpg.service';
import { OsService } from '../modules/opensearch/os.service';
import { RsService } from '../modules/rustfs/rs.service';
import { KcService, SambaService } from '../modules/identity/identity.services';
import { PILL, Phase } from '../modules/postgres/cnpg.types';
import { apiBase, writeHeaders } from '../api-base';

// FoundationModel CR(foundation.opensphere.io/v1alpha1, Cluster-scope) — 수명주기의 클러스터 정본.
const FM_PATH = 'apis/foundation.opensphere.io/v1alpha1/foundationmodels';
type FmState = 'Installed' | 'Disabled';

// Foundation(host)의 plugin 거버넌스 — 등록(registry)·상태(health 어댑트)·수명주기(enable/disable)·모니터링 소유.
// ⚠️ health는 fetch하지 않는다. healthRef가 가리키는 기존 폴러(CnpgService/OsService)의 computed를 소비만 한다.
// 폴러 라이프사이클을 이 서비스(=shell)가 소유 → overview/admin/콘솔 어디서나 health가 라이브(콘솔이 stop하지 않음).
//
// 감사 시정 S4(2026-07-06): 수명주기(enable/disable)의 정본을 localStorage('fnd.disabled') 소프트 토글에서
// FoundationModel CR(desiredState: Installed|Disabled)로 이관 — "메뉴=실재의 투영"(§3.3)을 클러스터 진실로 회복.
//   · 표시: CR에서 hydrate(15s 폴링). CR 부재 = 미등록(비활성·비노출).
//   · 전이: PATCH(merge-patch) desiredState; CR 없으면 POST 생성(선언 API 경유 — ADR-FND-001 write-path 준수).
//   · 쓰기 인증: x-os-id-token → server.js가 사용자/그룹 임퍼소네이션(foundation-models-manage RBAC,
//     deploy/foundationmodels.yaml). 실패는 lastError로 노출(침묵 금지).
@Injectable({ providedIn: 'root' })
export class FoundationRegistryService {
  private cnpg = inject(CnpgService);
  private os = inject(OsService);
  private rs = inject(RsService);
  private kc = inject(KcService);
  private samba = inject(SambaService);

  readonly all: HostedPlugin[] = FOUNDATION_PLUGINS;

  // CR hydrate 상태 — null=아직 미로드(첫 응답 전 플리커 방지를 위해 낙관 Enabled 표시), 이후 CR 기준.
  private readonly models = signal<Record<string, FmState> | null>(null);
  readonly modelsLoaded = signal<'loading' | 'ok' | 'noperm' | 'error'>('loading');
  readonly lastError = signal<string>('');
  private fmTimer: ReturnType<typeof setInterval> | undefined;

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  async refreshModels(): Promise<void> {
    try {
      const res = await fetch(this.k(FM_PATH), { cache: 'no-store' });
      if (res.status === 403) { this.modelsLoaded.set('noperm'); return; } // 마지막 값 유지(fail-open 읽기)
      if (!res.ok) { this.modelsLoaded.set('error'); return; }
      const body = await res.json();
      const map: Record<string, FmState> = {};
      for (const item of body?.items ?? []) {
        const n = item?.metadata?.name;
        const d = item?.spec?.desiredState;
        if (typeof n === 'string' && (d === 'Installed' || d === 'Disabled')) { map[n] = d; }
      }
      this.models.set(map);
      this.modelsLoaded.set('ok');
    } catch { this.modelsLoaded.set('error'); }
  }

  /** CR 실태 — 'Installed' | 'Disabled' | '미등록'(CR 없음) | null(아직 미로드). */
  modelOf(id: string): FmState | '미등록' | null {
    const m = this.models();
    if (m === null) { return null; }
    return m[id] ?? '미등록';
  }

  isEnabled(id: string): boolean {
    const m = this.models();
    if (m === null) { return true; } // 첫 hydrate 전 낙관 표시(플리커 방지). 로드 후엔 CR이 유일 진실.
    return m[id] === 'Installed';
  }

  /** desiredState 전이 — PATCH, CR 부재(404) 시 POST 생성. 성공 후 재-hydrate. */
  async setEnabled(id: string, on: boolean): Promise<void> {
    this.lastError.set('');
    const desired: FmState = on ? 'Installed' : 'Disabled';
    try {
      const res = await fetch(this.k(`${FM_PATH}/${id}`), {
        method: 'PATCH',
        headers: { ...writeHeaders(), 'content-type': 'application/merge-patch+json' },
        body: JSON.stringify({ spec: { desiredState: desired } }),
      });
      if (res.status === 404) {
        const p = this.all.find((x) => x.id === id);
        const model = p?.capability.startsWith('identity.') ? 'identity' : 'data';
        const create = await fetch(this.k(FM_PATH), {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({
            apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'FoundationModel',
            metadata: { name: id, labels: { 'opensphere.io/foundation-plugin': id } },
            spec: { model, desiredState: desired },
          }),
        });
        if (!create.ok) { throw new Error(`CR 생성 실패 HTTP ${create.status}`); }
      } else if (!res.ok) {
        throw new Error(`desiredState 전이 실패 HTTP ${res.status}${res.status === 401 ? ' (로그인 토큰 만료?)' : res.status === 403 ? ' (권한 없음 — foundation-models-manage RBAC)' : ''}`);
      }
      await this.refreshModels();
    } catch (e) {
      this.lastError.set(String((e as Error)?.message ?? e));
    }
  }

  // 좌 nav·본문 마운트가 소비하는 '실재의 투영' — CR desiredState의 파생. CR 0건이면 0개(클러스터 진실).
  readonly enabledPlugins = computed<HostedPlugin[]>(() => {
    this.models(); // 반응성 트리거
    return this.all.filter((p) => this.isEnabled(p.id));
  });

  // health 어댑터 — 두 이질 서비스를 PluginHealth로 통일. registry가 가리킨 곳에서 읽어 답한다.
  health(p: HostedPlugin): PluginHealth {
    switch (p.healthRef) {
      case 'cnpg': return this.pgHealth();
      case 'os': return this.osHealth();
      case 'rustfs': return this.rsHealth();
      case 'keycloak': return this.wlHealth(this.kc, [{ val: 'PG', lab: 'Database' }, { val: ':8080', lab: 'HTTP' }]);
      default: return this.wlHealth(this.samba, [{ val: this.samba.domain, lab: 'Realm' }, { val: ':389', lab: 'LDAP' }]);
    }
  }

  // Deployment 워크로드(Keycloak·Samba) 공통 health — WorkloadHealth signal 소비.
  private wlHealth(svc: KcService | SambaService, extra: { val: string | number; lab: string }[]): PluginHealth {
    const ph = svc.phaseCls();
    const st = svc.state();
    return {
      phase: ph, pill: PILL[ph], state: st, ready: svc.ready(), label: this.healthLabel(ph, st),
      metrics: [{ val: `${svc.readyN()}/${svc.totalN()}`, lab: 'Replicas Ready' }, ...extra, { val: svc.restarts(), lab: 'Restarts' }],
    };
  }

  private pgHealth(): PluginHealth {
    const ph = this.cnpg.phaseCls();
    const st = this.cnpg.clusterState();
    return {
      phase: ph, pill: PILL[ph], state: st, ready: this.cnpg.allReady(),
      label: this.healthLabel(ph, st),
      metrics: [
        { val: `${this.cnpg.readyN()}/${this.cnpg.totalN()}`, lab: 'Instances Ready' },
        { val: shorten(this.cnpg.primary()), lab: 'Primary' },
        { val: 'PG ' + this.cnpg.pgMajor(), lab: 'Engine' },
        { val: this.cnpg.storage(), lab: 'Storage' },
      ],
    };
  }
  private osHealth(): PluginHealth {
    const ph = this.os.statusPhase();
    const st = this.os.healthState();
    return {
      phase: ph, pill: PILL[ph], state: st, ready: ph === 'ok',
      label: this.healthLabel(ph, st),
      metrics: [
        { val: this.os.nodeCount(), lab: 'Nodes' },
        { val: this.os.shardPct() + '%', lab: 'Active Shards' },
        { val: this.os.indexCount(), lab: 'Indices' },
        { val: this.os.docCount(), lab: 'Docs' },
      ],
    };
  }
  private rsHealth(): PluginHealth {
    const ph = this.rs.phaseCls();
    const st = this.rs.state();
    return {
      phase: ph, pill: PILL[ph], state: st, ready: this.rs.ready(),
      label: this.healthLabel(ph, st),
      metrics: [
        { val: `${this.rs.readyN()}/${this.rs.totalN()}`, lab: 'Replicas Ready' },
        { val: this.rs.capacity(), lab: 'Capacity' },
        { val: 'S3', lab: 'API :9000' },
        { val: ':9001', lab: 'Console' },
      ],
    };
  }
  private healthLabel(ph: Phase, st: string): string {
    if (st === 'noperm') { return '권한 없음'; }
    if (st === 'nocrd') { return '미배포'; }
    if (ph === 'ok') { return 'Healthy'; }
    if (ph === 'bad') { return 'Degraded'; }
    if (ph === 'warn') { return 'Progressing'; }
    return '미발견';
  }

  // overview 헤더 — lifecycle(enabled) vs runtime(health) 2축 분리 집계.
  readonly summary = computed(() => {
    const en = this.enabledPlugins();
    const h = this.all.map((p) => this.health(p));
    return {
      hosted: this.all.length,
      enabled: en.length,
      disabled: this.all.length - en.length,
      healthy: h.filter((x) => x.phase === 'ok').length,
      degraded: h.filter((x) => x.phase === 'bad').length,
      capabilities: new Set(this.all.map((p) => p.capability)).size,
    };
  });

  // 폴러 라이프사이클 = shell 소유. foundation subShell 마운트/언마운트에 묶임(app.component).
  // S4: FoundationModel CR hydrate 폴러(15s)도 여기에 귀속 — health 폴러와 동일 수명.
  start(): void {
    this.cnpg.start(); this.os.start(); this.rs.start(); this.kc.start(); this.samba.start();
    void this.refreshModels();
    if (!this.fmTimer) { this.fmTimer = setInterval(() => void this.refreshModels(), 15000); }
  }
  stop(): void {
    this.cnpg.stop(); this.os.stop(); this.rs.stop(); this.kc.stop(); this.samba.stop();
    if (this.fmTimer) { clearInterval(this.fmTimer); this.fmTimer = undefined; }
  }
}

function shorten(s: string): string { return s ? s.replace('opensphere-pg-', '#') : '—'; }
