import { Injectable, computed, inject, signal } from '@angular/core';
import { FOUNDATION_PLUGINS } from './plugins.registry';
import { HostedPlugin, PluginHealth } from './hosted-plugin';
import { CnpgService } from '../modules/postgres/cnpg.service';
import { OsService } from '../modules/opensearch/os.service';
import { RsService } from '../modules/rustfs/rs.service';
import { KcService, SambaService } from '../modules/identity/identity.services';
import { PILL, Phase } from '../modules/postgres/cnpg.types';

const DISABLED_KEY = 'fnd.disabled';

// Foundation(host)의 plugin 거버넌스 — 등록(registry)·상태(health 어댑트)·수명주기(enable/disable)·모니터링 소유.
// ⚠️ registry는 fetch하지 않는다. healthRef가 가리키는 기존 폴러(CnpgService/OsService)의 computed를 소비만 한다.
// 폴러 라이프사이클을 이 서비스(=shell)가 소유 → overview/admin/콘솔 어디서나 health가 라이브(콘솔이 stop하지 않음).
@Injectable({ providedIn: 'root' })
export class FoundationRegistryService {
  private cnpg = inject(CnpgService);
  private os = inject(OsService);
  private rs = inject(RsService);
  private kc = inject(KcService);
  private samba = inject(SambaService);

  readonly all: HostedPlugin[] = FOUNDATION_PLUGINS;

  // soft-disable (desiredState 최소 구현). disable = 콘솔에서 이 plugin 비노출 + 마운트 거부.
  readonly disabled = signal<Set<string>>(this.load());
  private load(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]')); } catch { return new Set(); }
  }
  private persist(s: Set<string>): void {
    try { localStorage.setItem(DISABLED_KEY, JSON.stringify([...s])); } catch { /* noop */ }
  }

  isEnabled(id: string): boolean { return !this.disabled().has(id); }
  setEnabled(id: string, on: boolean): void {
    const s = new Set(this.disabled());
    if (on) { s.delete(id); } else { s.add(id); }
    this.disabled.set(s);
    this.persist(s);
  }

  // 좌 nav·본문 마운트가 소비하는 '실재의 투영'. disabled면 사라진다 = soft toggle이 실제로 동작.
  readonly enabledPlugins = computed<HostedPlugin[]>(() => this.all.filter((p) => this.isEnabled(p.id)));

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
  start(): void { this.cnpg.start(); this.os.start(); this.rs.start(); this.kc.start(); this.samba.start(); }
  stop(): void { this.cnpg.stop(); this.os.stop(); this.rs.stop(); this.kc.stop(); this.samba.stop(); }
}

function shorten(s: string): string { return s ? s.replace('opensphere-pg-', '#') : '—'; }
