import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FoundationRegistryService } from '../registry/foundation-registry.service';
import { EnginesService } from './engines.service';
import { ConnectivityService } from './connectivity.service';
import { ViewRouter } from '../view-router';
import { CarbonIcon } from '../carbon-icon';
import Db2Database20 from '@carbon/icons/es/db2--database/20';
import UserMultiple20 from '@carbon/icons/es/user--multiple/20';
import MachineLearningModel20 from '@carbon/icons/es/machine-learning-model/20';
import Chat20 from '@carbon/icons/es/chat/20';
import ChartLine20 from '@carbon/icons/es/chart--line/20';
import Renew20 from '@carbon/icons/es/renew/20';
import Apps24 from '@carbon/icons/es/apps/24';
import Home24 from '@carbon/icons/es/home/24';

// capability 도메인/시작하기 카드 아이콘(20·24px) — Carbon(@carbon/icons), shell-template/ai/base와 동일 관례.
const DOMAIN_ICON: Record<string, any> = {
  data: Db2Database20, identity: UserMultiple20, ai: MachineLearningModel20,
  comm: Chat20, observability: ChartLine20, backup: Renew20,
};

interface DomainCard {
  id: string; label: string; icon: any; desc: string; live: boolean;
  count: number; healthy: number; degraded: boolean; modules: string; firstModule: string;
  opNote?: string;    // 로드맵 도메인 중 실제 설치 진행이 있는 엔진의 실시간 상태(BSS/FSS 카탈로그 실측)
  linkTab?: string;   // opNote가 있으면 클릭 시 이동할 탭(예: 'velero')
  linkModule?: 'bss' | 'engines'; // linkTab이 속한 모듈 — Velero=bss, OTel=engines(2026-07-04 재확정)
  plannedNote?: string; // live 도메인 안에도 아직 미구현인 엔진이 있을 때(예: Identity의 Syncope) 표시
}

// FS 구축계획서(§3.2 모듈 카탈로그, 정본: _DOCS_/Foundation/FS-구축계획서-2026-07-02.md) 기준 계획 제품명.
// 아직 capability 서비스(FOUNDATION_PLUGINS)로 등록되지 않은 4개 도메인도 정확한 제품명을 명시한다.
// liveKey가 있으면 실제 카탈로그(BSS host 연결 또는 FS 구현 엔진)의 실측 상태를 그대로 반영한다(하드코딩 금지).
// FS 정본 멤버는 제품명이 아니라 identity/data/ai/comm/observability/backup capability 모듈이다.
const PLANNED: Record<string, { modules: string; liveKey?: string; liveLabel?: string; linkTab?: string; linkModule?: 'bss' | 'engines' }> = {
  ai: { modules: 'LiteLLM · Langfuse · Embed' },
  comm: { modules: 'Stalwart(JMAP) · Novu · Mattermost' },
  observability: { modules: 'OpenTelemetry Collector · Prometheus(Basic 위임) · Tempo · Loki · Grafana', liveKey: 'otel', liveLabel: 'OpenTelemetry Collector', linkTab: 'otel', linkModule: 'engines' },
  backup: { modules: 'Velero', liveKey: 'velero', liveLabel: 'Velero', linkTab: 'velero', linkModule: 'bss' },
};

// Foundation Overview — subShell home(개요). 정체성(10 Perspective의 기둥) + capability 6-도메인 현황
// (Data/Identity 가동 · AI/Comm/Observability/Backup 로드맵) + at-a-glance KPI + 시작하기.
// ※ 소비 엔드포인트·plugin별 상세는 각 모듈 자신의 페이지에 있다(중복이라 별도 Services 메뉴는 폐기, 2026-07-04). 여기는 '한눈에'만.
@Component({
  selector: 'app-foundation-overview',
  standalone: true,
  imports: [CommonModule, CarbonIcon],
  template: `
    <!-- Hero: 정체성 + at-a-glance -->
    <section class="ov-hero">
      <div class="ov-hero-copy">
        <span class="ov-eyebrow">Foundation Service Stack</span>
        <h1 class="ov-h1">플랫폼 운영의 기둥</h1>
        <p class="ov-lead">
          사원·고객 신원과 모든 시스템 운영을 관장하는 Foundation. OpenSphere 10개 Perspective를 지탱하는
          <strong>capability 모듈</strong>을 설치·운영하고, 다른 subShell이 소비할 백킹서비스를 호스팅합니다.
        </p>
        <div class="ov-hero-actions">
          <button class="btn btn-primary" (click)="go('engines')">FSS 엔진 설치</button>
        </div>
      </div>
      <div class="ov-hero-stat">
        <div class="ov-stat-big">{{ liveDomains() }}<span>/6</span></div>
        <div class="ov-stat-cap">capability 도메인 가동</div>
        <ul class="ov-stat-list">
          <li><span>설치 모듈</span><b>{{ s().hosted }}</b></li>
          <li><span>런타임 정상</span><b [class.ov-warn]="s().degraded">{{ s().healthy }}<i>/{{ s().hosted }}</i></b></li>
          <li><span>제공 capability</span><b>{{ s().capabilities }}</b></li>
        </ul>
      </div>
    </section>

    <!-- BSS/FSS 개념 정의: _DOCS_/Foundation/FS-구축계획서-2026-07-02.md §1.1, §3.1 기준 -->
    <div class="os-sech">BSS / FSS 정의 <span class="os-dim">— FS 구축계획서 §1.1 · §3.1 정본</span></div>
    <section class="stack-defs">
      <article class="stack-def stack-def--bss" (click)="go('bss')" role="button" tabindex="0" (keydown.enter)="go('bss')">
        <div class="stack-def-h">
          <span class="label label-info">BSS</span>
          <h3>Basic Service Stack</h3>
        </div>
        <p>
          k8s에서 범용 제공하는 클러스터 공유 인프라입니다. 소비자는 클러스터 전체이며,
          Foundation은 이 자원을 소유하지 않고 필요한 요구만 선언해 소비합니다.
        </p>
        <div class="stack-members">
          <span *ngFor="let m of bssMembers" class="stack-chip">{{ m }}</span>
        </div>
      </article>

      <article class="stack-def stack-def--fss" (click)="go('engines')" role="button" tabindex="0" (keydown.enter)="go('engines')">
        <div class="stack-def-h">
          <span class="label label-success">FSS</span>
          <h3>Foundation Service Stack</h3>
        </div>
        <p>
          사용자(사원·고객) 관리와 이를 위한 모든 시스템 운영 관리 서비스입니다.
          10 Perspective를 지탱하는 기둥이며, capability 모듈이 FS의 정본 멤버입니다.
        </p>
        <div class="stack-members">
          <span *ngFor="let m of fssMembers" class="stack-chip">{{ m }}</span>
        </div>
      </article>
    </section>

    <!-- Capability 6-도메인 현황 -->
    <div class="os-sech">Capability 도메인</div>
    <div class="ov-domains">
      <div class="ov-domain" *ngFor="let d of domains()" [class.ov-domain--planned]="!d.live"
           [class.ov-domain--clickable]="d.live || d.linkTab" (click)="goDomain(d)">
        <div class="ov-domain-h">
          <os-cicon [icon]="d.icon" [size]="20"/>
          <span class="ov-domain-name">{{ d.label }}</span>
          <span class="label os-ml-auto"
                [ngClass]="d.live ? (d.degraded ? 'label-danger' : 'label-success') : (d.opNote?.includes('설치·운영중') ? 'label-info' : '')">
            {{ d.live ? (d.degraded ? 'Degraded' : 'Live') : (d.opNote?.includes('설치·운영중') ? '일부 가동' : '로드맵') }}
          </span>
        </div>
        <p class="ov-domain-desc">{{ d.desc }}</p>
        <div class="ov-domain-foot" *ngIf="d.live">
          <span class="ov-domain-count">{{ d.healthy }}/{{ d.count }} 모듈 정상</span>
          <span class="ov-domain-mods">{{ d.modules }}</span>
          <span class="ov-domain-opnote" *ngIf="d.plannedNote">{{ d.plannedNote }}</span>
        </div>
        <div class="ov-domain-foot ov-domain-foot--planned" *ngIf="!d.live">
          <span class="ov-domain-mods">{{ d.modules }}</span>
          <span class="ov-domain-opnote" *ngIf="d.opNote">{{ d.opNote }}</span>
        </div>
      </div>
    </div>

    <!-- 시작하기 -->
    <div class="os-sech">시작하기</div>
    <div class="ov-jump">
      <div class="ov-jump-card" (click)="go('engines')">
        <os-cicon [icon]="iApps" [size]="24"/>
        <h3>FSS 엔진 설치</h3>
        <p>Foundation Service Stack 엔진을 설치 선언하고 상태를 확인합니다.</p>
      </div>
      <div class="ov-jump-card ov-jump-card--muted">
        <os-cicon [icon]="iHome" [size]="24"/>
        <h3>capability 소비</h3>
        <p>다른 subShell이 BackboneClaim/서비스 DNS로 이 백킹서비스를 소비하는 방법.</p>
      </div>
    </div>
  `,
})
export class FoundationOverviewComponent {
  readonly reg = inject(FoundationRegistryService);
  readonly engines = inject(EnginesService);
  readonly conn = inject(ConnectivityService);
  private vr = inject(ViewRouter);
  readonly s = this.reg.summary;
  readonly iApps = Apps24;
  readonly iHome = Home24;
  readonly bssMembers = ['kube-prometheus-stack', 'storage(local-path)', 'ingress'];
  readonly fssMembers = ['identity', 'data', 'ai', 'comm', 'observability', 'backup'];

  ngOnInit(): void { this.engines.start(); this.conn.start(); }

  readonly domains = computed<DomainCard[]>(() => {
    const roll = (prefix: string): Omit<DomainCard, 'id' | 'label' | 'icon' | 'desc' | 'live'> => {
      const list = this.reg.all.filter((p) => p.capability.startsWith(prefix));
      const hs = list.map((p) => this.reg.health(p));
      return {
        count: list.length,
        healthy: hs.filter((h) => h.phase === 'ok').length,
        degraded: hs.some((h) => h.phase === 'bad'),
        modules: list.map((p) => p.name).join(' · '),
        firstModule: list[0]?.view.module ?? 'overview',
      };
    };
    const planned = (id: string): Omit<DomainCard, 'id' | 'label' | 'icon' | 'desc' | 'live'> => {
      const p = PLANNED[id];
      const base = { count: 0, healthy: 0, degraded: false, modules: p.modules, firstModule: 'overview' };
      if (!p.liveKey) { return base; }
      const svc = p.linkModule === 'bss' ? this.conn : this.engines;
      const state = svc.liveState(p.liveKey);
      if (state === 'loading') { return base; } // 확인 중엔 아무 것도 단정하지 않음(플리커 방지)
      const catalogLabel = p.linkModule === 'bss' ? 'BSS' : 'FSS 엔진';
      const opNote = state === 'ok' ? `${p.liveLabel} 설치·운영중 — ${catalogLabel}에서 상태 확인` : `${p.liveLabel} 미설치 — ${catalogLabel}에서 설치 가능`;
      return { ...base, opNote, linkTab: p.linkTab, linkModule: p.linkModule };
    };
    return [
      { id: 'data', label: 'Data', icon: DOMAIN_ICON['data'], desc: '관계형 DB · 검색 · 오브젝트 스토리지', live: true, ...roll('data.') },
      { id: 'identity', label: 'Identity', icon: DOMAIN_ICON['identity'], desc: '사원·고객 신원 · SSO · 디렉터리', live: true, plannedNote: '+ Syncope(IGA) 예정', ...roll('identity.') },
      { id: 'ai', label: 'AI', icon: DOMAIN_ICON['ai'], desc: '모델 서빙 · 추론 · 벡터 메모리', live: false, ...planned('ai') },
      { id: 'comm', label: 'Comm', icon: DOMAIN_ICON['comm'], desc: '메시징 · 알림 · 협업', live: false, ...planned('comm') },
      { id: 'observability', label: 'Observability', icon: DOMAIN_ICON['observability'], desc: '메트릭 · 로그 · 트레이스', live: false, ...planned('observability') },
      { id: 'backup', label: 'Backup', icon: DOMAIN_ICON['backup'], desc: '백업 · 복구 · 보존', live: false, ...planned('backup') },
    ];
  });

  readonly liveDomains = computed(() => this.domains().filter((d) => d.live).length);

  go(id: string): void { this.vr.setModule(id); }
  goDomain(d: DomainCard): void {
    if (d.live) { this.go(d.firstModule); return; }
    if (d.linkTab) { this.vr.setModule(d.linkModule ?? 'engines'); this.vr.setTab(d.linkTab); }
  }
}
