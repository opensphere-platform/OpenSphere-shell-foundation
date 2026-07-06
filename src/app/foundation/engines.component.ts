import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { EnginesService } from './engines.service';
import { ViewRouter } from '../view-router';
import { OtelComponent } from './otel/otel.component';
import { CnpgOperatorComponent } from './cnpgoperator/cnpgoperator.component';
import { CrossplaneComponent } from './crossplane/crossplane.component';
import { PlaceholderModuleComponent } from './placeholder-module.component';
import { OpenSearchEngineComponent } from './opensearch-engine.component';

const REAL_DETAIL_TABS = new Set(['otel', 'cnpg', 'crossplane', 'opensearch']);
const PLACEHOLDER_TABS = new Set(['tempo', 'loki', 'grafana']);
const DETAIL_TABS = new Set([...REAL_DETAIL_TABS, ...PLACEHOLDER_TABS]);

type Impl = 'real' | 'phase1' | 'stub' | 'absent';
const IMPL_LABEL: Record<Impl, string> = { real: '배선됨', phase1: 'Phase 1', stub: '스텁(TODO)', absent: '비간섭(설계)' };
const IMPL_PILL: Record<Impl, string> = { real: 'label-success', phase1: 'label-info', stub: 'label-warning', absent: '' };

interface EngineCard {
  id: string; name: string; provider: string; version: string; logo: string; mono: string;
  category: string; role: string; impl: Impl; liveKey: string; wiring: string; detail?: boolean;
}

const LOGO_BASE = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos';

// FSS 엔진 카탈로그 — Basic Service Stack(BSS, connectivity.component.ts)과 분리(2026-07-04, 사용자 확정).
// 판정 기준: "범용 k8s 서비스면 BSS, OpenSphere 구성 전용 서비스면 FSS". 이 엔진들은 클러스터 아무
// 워크로드나 쓰는 범용 도구가 아니라 OpenSphere 자신의 capability 모듈(data/observability)과 설치
// 파이프라인을 구성하기 위해서만 존재 — 그래서 BSS 멤버가 될 수 없고(양립 불가) FSS 소속이다.
// ※ Velero는 워크로드 무관 범용 DR 도구라 BSS로 재확정(2026-07-04) — connectivity.component.ts에 있다.
// ※ tempo/loki/grafana는 착수 전 로드맵 카드 — PlaceholderModuleComponent로 로고/제목만 표시(2026-07-04).
@Component({
  selector: 'app-foundation-engines',
  standalone: true,
  imports: [CommonModule, ClarityModule, OtelComponent, CnpgOperatorComponent, CrossplaneComponent, OpenSearchEngineComponent, PlaceholderModuleComponent],
  template: `
    <app-otel *ngIf="vr.tab() === 'otel'"></app-otel>
    <app-cnpgoperator *ngIf="vr.tab() === 'cnpg'"></app-cnpgoperator>
    <app-crossplane *ngIf="vr.tab() === 'crossplane'"></app-crossplane>
    <app-opensearch-engine *ngIf="vr.tab() === 'opensearch'"></app-opensearch-engine>
    <app-placeholder-module *ngIf="placeholderCard() as pc" [name]="pc.name" [logo]="pc.logo" [mono]="pc.mono"
      eyebrow="Foundation · 관측" backLabel="FSS 엔진" (back)="vr.setTab('overview')"></app-placeholder-module>

    <ng-container *ngIf="!isDetailTab()">
    <div class="os-title-row"><h2 class="os-h2">FSS 엔진 <span class="label label-info">Foundation Service Stack(FSS)</span></h2></div>
    <section class="stack-inline">
      <div>
        <span class="stack-kicker">Concept</span>
        <strong>OpenSphere 구성 전용 엔진</strong>
        <p>FSS는 Foundation capability와 설치 파이프라인을 만들기 위한 전용 엔진이다. 범용 host 서비스인 BSS와 멤버를 공유하지 않는다.</p>
      </div>
      <div class="stack-members">
        <span *ngFor="let m of fssMembers" class="stack-chip">{{ m }}</span>
      </div>
    </section>
    <p class="os-sub">
      OpenSphere <strong>구성 전용</strong> 엔진 카탈로그 — 범용 k8s 서비스(Basic Service Stack, <a class="vl-link" (click)="goBss()">BSS</a>)와
      달리, 이 엔진들은 Foundation의 capability 모듈(data·observability)과 설치 파이프라인을 만드는 데만 쓰인다.
      BSS 멤버는 될 수 없다.
    </p>

    <div class="hc-grid">
      <div class="hc-card" *ngFor="let c of cards"
           [class.hc-clickable]="c.detail" (click)="c.detail && open(c)"
           [attr.role]="c.detail ? 'button' : null" [attr.tabindex]="c.detail ? 0 : null"
           (keydown.enter)="c.detail && open(c)">
        <div class="hc-head">
          <div class="hc-logo">
            <img *ngIf="c.logo && !failed().has(c.id)" [src]="logoUrl(c.logo)" [alt]="c.name" loading="lazy" (error)="markFailed(c.id)" />
            <span *ngIf="!c.logo || failed().has(c.id)" class="hc-mono">{{ c.mono }}</span>
          </div>
          <div class="hc-idblock">
            <div class="hc-name">{{ c.name }}<span *ngIf="c.detail" class="hc-open">관리 →</span></div>
            <div class="hc-provider">{{ c.provider }}<span *ngIf="c.version"> · {{ c.version }}</span></div>
          </div>
        </div>

        <p class="hc-role">{{ c.role }}</p>
        <div class="hc-wiring"><span class="hc-wiring-k">연결</span><span>{{ c.wiring }}</span></div>

        <div class="hc-foot">
          <span class="hc-cat"><span class="hc-cat-dot"></span>{{ c.category }}</span>
          <span class="hc-badges">
            <span class="label" [ngClass]="IMPL_PILL[c.impl]">{{ IMPL_LABEL[c.impl] }}</span>
            <span *ngIf="c.liveKey" class="label" [ngClass]="livePill(c.liveKey)">{{ liveLabel(c.liveKey) }}</span>
          </span>
        </div>
      </div>
    </div>

    <div class="os-actions hc-refresh">
      <button class="btn btn-sm" (click)="svc.refresh()" [disabled]="svc.busy()">
        <span class="spinner spinner-inline" *ngIf="svc.busy()"></span> 새로고침
      </button>
      <span class="os-dim" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</span>
    </div>
    </ng-container>
  `,
})
export class FoundationEnginesComponent {
  readonly svc = inject(EnginesService);
  readonly vr = inject(ViewRouter);
  readonly IMPL_LABEL = IMPL_LABEL;
  readonly IMPL_PILL = IMPL_PILL;
  readonly failed = signal<Set<string>>(new Set());
  readonly fssMembers = ['OpenTelemetry Collector', 'CloudNativePG', 'OpenSearch', 'Crossplane', 'Grafana Tempo', 'Grafana Loki', 'Grafana'];

  ngOnInit(): void { this.svc.start(); }

  open(c: EngineCard): void { this.vr.setTab(c.id); }
  goBss(): void { this.vr.setModule('bss'); }
  isDetailTab(): boolean { return DETAIL_TABS.has(this.vr.tab()); }
  /** 착수 전 3개(tempo/loki/grafana) 전용 — placeholder 페이지에 넘길 카드(없으면 undefined). */
  placeholderCard(): EngineCard | undefined {
    return PLACEHOLDER_TABS.has(this.vr.tab()) ? this.cards.find((c) => c.id === this.vr.tab()) : undefined;
  }
  logoUrl(name: string): string { return `${LOGO_BASE}/${name}.svg`; }
  markFailed(id: string): void { this.failed.update((s) => new Set(s).add(id)); }

  livePill(key: string): string {
    const s = this.svc.liveState(key);
    if (s === 'ok') { return 'label-success'; }
    if (s === 'loading') { return ''; }
    if (s === 'nocrd') { return 'label-warning'; }
    return 'label-danger';
  }
  liveLabel(key: string): string {
    const s = this.svc.liveState(key);
    return { loading: '확인 중…', ok: 'Live', empty: 'Live', nocrd: '미설치', noperm: '권한 없음', error: '조회 실패' }[s];
  }

  readonly cards: EngineCard[] = [
    {
      id: 'otel', name: 'OpenTelemetry Collector', provider: 'opentelemetry.io (CNCF)', version: 'v0.111.0', logo: 'opentelemetry-non-typo', mono: 'O', detail: true,
      category: '관측', impl: 'real', liveKey: 'otel',
      role: '각 FSS 모듈이 보내는 지표·로그·추적을 한곳에서 받아 BSS Prometheus 쪽으로 넘기는 중앙 게이트웨이 수집기. Foundation 전용.',
      wiring: '카드를 클릭하면 전용 페이지에서 버전 선택·설치·상태를 관리한다.',
    },
    {
      id: 'cnpg', name: 'CloudNativePG', provider: 'cloudnative-pg', version: 'PG 17', logo: 'postgresql', mono: 'PG', detail: true,
      category: 'data', impl: 'real', liveKey: 'cnpg',
      role: 'PostgreSQL 데이터베이스를 운영·관리하는 operator. FSS data 모듈이 이 위에서 PostgreSQL capability를 제공한다.',
      wiring: '카드를 클릭하면 전용 페이지에서 버전 선택·설치·상태·관리 Cluster 목록을 볼 수 있다.',
    },
    {
      id: 'opensearch', name: 'OpenSearch', provider: 'opensearch.org', version: '2.17.0', logo: 'opensearch', mono: 'OS', detail: true,
      category: 'data', impl: 'phase1', liveKey: 'opensearch',
      role: 'Shared search and index engine for manuals, OAA retrieval, catalog search, logs, and future vector/search workloads.',
      wiring: 'Open this card first to declare FoundationModel/data parameters.engines.opensearch, then reconcile the shared endpoint.',
    },
    {
      id: 'crossplane', name: 'Crossplane', provider: 'crossplane.io (CNCF)', version: 'v2.3.3', logo: 'crossplane-non-typo', mono: 'X', detail: true,
      category: '전달', impl: 'real', liveKey: 'crossplane',
      role: 'FSS 엔진들을 선언형 API로 설치·관리하는 OpenSphere 자체 delivery 엔진(방향 전환, 2026-07-03).',
      wiring: '카드를 클릭하면 provider·관리 중인 Release 목록을 볼 수 있다.',
    },
    {
      id: 'tempo', name: 'Grafana Tempo', provider: 'grafana.com (CNCF)', version: '', logo: 'tempo', mono: 'T', detail: true,
      category: '관측', impl: 'stub', liveKey: '',
      role: '분산 트레이스 저장·조회 백엔드. OTel Collector가 수집한 추적을 여기로 넘길 계획(착수 전).',
      wiring: '아직 착수 전 — 카드를 클릭하면 로드맵 placeholder 페이지가 열린다.',
    },
    {
      id: 'loki', name: 'Grafana Loki', provider: 'grafana.com (CNCF)', version: '', logo: 'loki', mono: 'L', detail: true,
      category: '관측', impl: 'stub', liveKey: '',
      role: '로그 집계·저장 백엔드. Foundation 모듈들의 로그를 인덱싱할 계획(착수 전).',
      wiring: '아직 착수 전 — 카드를 클릭하면 로드맵 placeholder 페이지가 열린다.',
    },
    {
      id: 'grafana', name: 'Grafana', provider: 'grafana.com', version: '', logo: 'grafana', mono: 'G', detail: true,
      category: '관측', impl: 'stub', liveKey: '',
      role: '메트릭·로그·트레이스 통합 대시보드. BSS Prometheus·Tempo·Loki를 한 화면에서 시각화할 계획(착수 전).',
      wiring: '아직 착수 전 — 카드를 클릭하면 로드맵 placeholder 페이지가 열린다.',
    },
  ];
}
