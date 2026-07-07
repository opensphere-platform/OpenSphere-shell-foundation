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
type EngineState = 'Installed' | 'Disabled';
interface DomainCRView { desired: string; engines: Record<string, string> }

// Foundation(host)의 plugin 거버넌스 — 등록(registry)·상태(health 어댑트)·수명주기(enable/disable)·모니터링 소유.
// ⚠️ health는 fetch하지 않는다. healthRef가 가리키는 기존 폴러(CnpgService/OsService)의 computed를 소비만 한다.
// 폴러 라이프사이클을 이 서비스(=shell)가 소유 → overview/admin/콘솔 어디서나 health가 라이브(콘솔이 stop하지 않음).
//
// 감사 시정 S4 → 2026-07-06 의미론 정정: FoundationModel CR은 **도메인(모델) 단위**(name==model — reconciler
// 계약: bundles[spec.model] 디스패치 + name=owner 라벨 회수)다. 엔진(내부 plugin) 단위 수명주기는
// **spec.parameters.engines.<engineId>: enabled|disabled**(설치옵션 — identity 번들이 실제 게이트).
//   · 표시: 도메인 CR에서 hydrate(15s 폴링). 도메인 CR 부재 = 소속 엔진 전부 '미등록'(비활성·비노출).
//   · 전이: 도메인 CR에 merge-PATCH(engines.<id>); 도메인 CR 없으면 POST 생성(선언 API — ADR-FND-001).
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

  // 도메인 CR hydrate 상태 — null=아직 미로드(첫 응답 전 플리커 방지를 위해 낙관 Enabled 표시), 이후 CR 기준.
  private readonly domains = signal<Record<string, DomainCRView> | null>(null);
  readonly modelsLoaded = signal<'loading' | 'ok' | 'noperm' | 'error'>('loading');
  readonly lastError = signal<string>('');
  private fmTimer: ReturnType<typeof setInterval> | undefined;

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }
  /** plugin의 소속 도메인 — capability 접두(HostedPlugin 자기기술)에서 도출. */
  private domainOf(id: string): string {
    const p = this.all.find((x) => x.id === id);
    return p?.capability.startsWith('identity.') ? 'identity' : 'data';
  }

  async refreshModels(): Promise<void> {
    try {
      const res = await fetch(this.k(FM_PATH), { cache: 'no-store' });
      if (res.status === 403) { this.modelsLoaded.set('noperm'); return; } // 마지막 값 유지(fail-open 읽기)
      if (!res.ok) { this.modelsLoaded.set('error'); return; }
      const body = await res.json();
      const map: Record<string, DomainCRView> = {};
      for (const item of body?.items ?? []) {
        const n = item?.metadata?.name;
        if (typeof n !== 'string') { continue; }
        map[n] = {
          desired: String(item?.spec?.desiredState ?? ''),
          engines: (item?.spec?.parameters?.['engines'] as Record<string, string>) ?? {},
        };
      }
      this.domains.set(map);
      this.modelsLoaded.set('ok');
    } catch { this.modelsLoaded.set('error'); }
  }

  /** 엔진 실태 — 'Installed' | 'Disabled' | '미등록'(도메인 CR 없음) | null(아직 미로드). */
  modelOf(id: string): EngineState | '미등록' | null {
    const m = this.domains();
    if (m === null) { return null; }
    const d = m[this.domainOf(id)];
    if (!d) { return '미등록'; }
    if (d.desired !== 'Installed') { return 'Disabled'; } // 도메인 자체 Disabled → 소속 엔진 전부
    return d.engines[id] === 'enabled' ? 'Installed' : 'Disabled';
  }

  isEnabled(id: string): boolean {
    const m = this.domains();
    if (m === null) { return false; }
    return this.modelOf(id) === 'Installed';
  }

  /** 엔진 수명주기 전이 — 도메인 CR의 parameters.engines.<id>를 merge-PATCH(404 시 도메인 CR 생성). */
  async setEnabled(id: string, on: boolean): Promise<void> {
    this.lastError.set('');
    const domain = this.domainOf(id);
    const value = on ? 'enabled' : 'disabled';
    try {
      const res = await fetch(this.k(`${FM_PATH}/${domain}`), {
        method: 'PATCH',
        headers: { ...writeHeaders(), 'content-type': 'application/merge-patch+json' },
        body: JSON.stringify({ spec: { parameters: { engines: { [id]: value } } } }),
      });
      if (res.status === 404) {
        const create = await fetch(this.k(FM_PATH), {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({
            apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'FoundationModel',
            metadata: { name: domain },
            spec: { model: domain, desiredState: 'Installed', parameters: { engines: { [id]: value } } },
          }),
        });
        if (!create.ok) { throw new Error(`도메인 CR(${domain}) 생성 실패 HTTP ${create.status}`); }
      } else if (!res.ok) {
        throw new Error(`engines.${id} 전이 실패 HTTP ${res.status}${res.status === 401 ? ' (로그인 토큰 만료?)' : res.status === 403 ? ' (권한 없음 — foundation-models-manage RBAC)' : ''}`);
      }
      await this.refreshModels();
    } catch (e) {
      this.lastError.set(String((e as Error)?.message ?? e));
    }
  }

  // 좌 nav·본문 마운트가 소비하는 '실재의 투영' — 도메인 CR(engines 설치옵션)의 파생. CR 0건이면 0개(클러스터 진실).
  readonly enabledPlugins = computed<HostedPlugin[]>(() => {
    this.domains(); // 반응성 트리거
    return this.all.filter((p) => this.isEnabled(p.id));
  });

  // health 어댑터 — 두 이질 서비스를 PluginHealth로 통일. registry가 가리킨 곳에서 읽어 답한다.
  health(p: HostedPlugin): PluginHealth {
    switch (p.healthRef) {
      case 'cnpg': return this.pgHealth();
      case 'os': return this.osHealth();
      case 'rustfs': return this.rsHealth();
      case 'keycloak': return this.wlHealth(this.kc, [{ val: 'PG', lab: 'Database' }, { val: ':8080', lab: 'HTTP' }]);
      default: return this.wlHealth(this.samba, [{ val: this.samba.realm(), lab: 'Realm' }, { val: ':389', lab: 'LDAP' }]);
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
