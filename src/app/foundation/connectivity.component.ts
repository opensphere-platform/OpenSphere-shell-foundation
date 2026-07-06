import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { ConnectivityService } from './connectivity.service';
import { ViewRouter } from '../view-router';
import { PromStackComponent } from './promstack/promstack.component';
import { IngressNginxComponent } from './ingressnginx/ingressnginx.component';
import { CertManagerComponent } from './certmanager/certmanager.component';
import { StorageClassComponent } from './storageclass/storageclass.component';
import { VeleroComponent } from './velero/velero.component';
import { PgMetric } from '../modules/postgres/ui/pg-metric';

const DETAIL_TABS = new Set(['prometheus', 'ingress', 'certmanager', 'storage', 'velero', 'm-wiring', 'm-missing', 'm-models']);

// 구현 상태(코드에 정의됐는가) — 라이브 존재 여부와 별개. [[basic-foundation-connector-gap]] 정본.
type Impl = 'real' | 'phase1' | 'stub' | 'absent';
const IMPL_LABEL: Record<Impl, string> = { real: '배선됨', phase1: 'Phase 1', stub: '스텁(TODO)', absent: '비간섭(설계)' };
const IMPL_PILL: Record<Impl, string> = { real: 'label-success', phase1: 'label-info', stub: 'label-warning', absent: '' };

interface DepCard {
  id: string;
  name: string;
  provider: string;
  version: string;
  logo: string;
  mono: string;
  category: string;
  role: string;
  impl: Impl;
  liveKey: string;
  wiring: string;
  detail?: boolean;
}

const LOGO_BASE = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos';

// Host 연결(Basic Service Stack, BSS) 카탈로그 — 관리자 화면.
// 정본(_DOCS_/Foundation/FS-구축계획서-2026-07-02.md §1.1): BSS = k8s에서 범용 제공하는 클러스터 공유 인프라.
// 현 클러스터 정본 실체는 kube-prometheus-stack(ns monitoring), storage(local-path), ingress다.
// cert-manager/Velero는 이 화면에서 함께 다루는 host 연결 운영 의존성이다.
// Foundation은 BSS 자원을 소유하지 않고 요구만 선언(§1.2)한다. 각 카드는 (a)Foundation 쪽 배선이 코드에
// 있는지(impl), (b)지금 이 클러스터에 그 컴포넌트가 실재하는지(live)를 함께 보여준다.
@Component({
  selector: 'app-foundation-connectivity',
  standalone: true,
  imports: [
    CommonModule, ClarityModule, PgMetric, PromStackComponent, IngressNginxComponent,
    CertManagerComponent, StorageClassComponent, VeleroComponent,
  ],
  template: `
    <app-promstack *ngIf="vr.tab() === 'prometheus'"></app-promstack>
    <app-ingressnginx *ngIf="vr.tab() === 'ingress'"></app-ingressnginx>
    <app-certmanager *ngIf="vr.tab() === 'certmanager'"></app-certmanager>
    <app-storageclass *ngIf="vr.tab() === 'storage'"></app-storageclass>
    <app-velero *ngIf="vr.tab() === 'velero'"></app-velero>

    <!-- 상단 요약 지표 3개 각각의 세부 정보 페이지 -->
    <ng-container *ngIf="vr.tab() === 'm-wiring'">
      <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">← BSS</a>
      <h2 class="os-h2">Foundation 배선 상세</h2>
      <p class="os-sub">전체 {{ allCards.length }}개 카드 중 {{ implCount('real') }}개가 코드에 실제 배선(REAL)돼 있다.</p>
      <table class="table">
        <thead><tr><th>이름</th><th>배선 상태</th><th>설명</th></tr></thead>
        <tbody>
          <tr *ngFor="let c of allCards">
            <td>{{ c.name }}</td>
            <td><span class="label" [ngClass]="IMPL_PILL[c.impl]">{{ IMPL_LABEL[c.impl] }}</span></td>
            <td>{{ c.role }}</td>
          </tr>
        </tbody>
      </table>
    </ng-container>

    <ng-container *ngIf="vr.tab() === 'm-missing'">
      <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">← BSS</a>
      <h2 class="os-h2">미설치 의존성 상세</h2>
      <p class="os-sub" *ngIf="notInstalledCards().length">아직 클러스터에 설치되지 않은 {{ notInstalledCards().length }}개.</p>
      <p class="os-sub" *ngIf="!notInstalledCards().length">현재 미설치 의존성이 없다.</p>
      <table class="table" *ngIf="notInstalledCards().length">
        <thead><tr><th>이름</th><th>분류</th></tr></thead>
        <tbody>
          <tr *ngFor="let c of notInstalledCards()">
            <td>{{ c.name }}</td>
            <td>{{ c.category }}</td>
          </tr>
        </tbody>
      </table>
    </ng-container>

    <ng-container *ngIf="vr.tab() === 'm-models'">
      <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">← BSS</a>
      <h2 class="os-h2">활성 모듈 상세</h2>
      <p class="os-sub">FoundationModel {{ svc.modelCount() }}개 · FoundationModuleDescriptor {{ svc.descriptorCount() }}개.</p>
      <table class="table">
        <thead><tr><th>종류</th><th>이름</th><th>네임스페이스</th></tr></thead>
        <tbody>
          <tr *ngFor="let m of svc.models()"><td>FoundationModel</td><td>{{ m.metadata?.name }}</td><td>{{ m.metadata?.namespace }}</td></tr>
          <tr *ngFor="let d of svc.descriptors()"><td>FoundationModuleDescriptor</td><td>{{ d.metadata?.name }}</td><td>{{ d.metadata?.namespace }}</td></tr>
          <tr *ngIf="!svc.models().length && !svc.descriptors().length"><td colspan="3" class="vl-nocap">아직 등록된 CR이 없음</td></tr>
        </tbody>
      </table>
    </ng-container>

    <ng-container *ngIf="!isDetailTab()">
    <div class="os-title-row"><h2 class="os-h2">BSS <span class="label label-info">Basic Service Stack · Host 연결</span></h2></div>
    <section class="stack-inline">
      <div>
        <span class="stack-kicker">Concept</span>
        <strong>클러스터 공유 인프라</strong>
        <p>BSS는 k8s에서 범용 제공하는 클러스터 공유 인프라다. 소비자는 특정 subShell이 아니라 클러스터 전체다.</p>
      </div>
      <div class="stack-members">
        <span *ngFor="let m of bssMembers" class="stack-chip">{{ m }}</span>
      </div>
    </section>
    <p class="os-sub">
      Foundation은 Basic Service Stack의 자원을 소유하지 않고 <strong>요구만 선언</strong>한다(FS 구축계획서 §1.2).
      아래 카드는 정본 BSS 실체와 host 연결 운영 의존성을 함께 보여준다. OpenSphere capability 멤버와 구현 엔진 후보는
      <a class="vl-link" (click)="goEngines()">FSS 멤버 카탈로그</a>에서 별도로 다룬다.
    </p>

    <div class="os-metrics os-metrics--tight">
      <pg-metric label="BSS 의존성" [value]="basicLive()+'/'+count()" [status]="basicLive()===count() ? 'ok':'warn'" sub="host 제공 범용 서비스" [clickable]="false"></pg-metric>
      <pg-metric label="Foundation 배선" [value]="implCount('real')" status="ok" sub="코드에 REAL" [clickable]="true" (go)="vr.setTab('m-wiring')"></pg-metric>
      <pg-metric label="미설치 의존성" [value]="notInstalled()" [status]="notInstalled() ? 'warn':'ok'" [sub]="notInstalledNames()" [clickable]="true" (go)="vr.setTab('m-missing')"></pg-metric>
      <pg-metric label="활성 모듈" [value]="svc.modelCount()" [status]="svc.modelCount()?'ok':''" sub="FoundationModel CR" [clickable]="true" (go)="vr.setTab('m-models')"></pg-metric>
    </div>

    <div class="os-sech">Basic Service Stack / Host 연결 <span class="os-dim">— host가 제공, Foundation은 요구만 선언·소비</span></div>
    <div class="hc-grid">
      <div class="hc-card" *ngFor="let c of allCards"
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
export class FoundationConnectivityComponent {
  readonly svc = inject(ConnectivityService);
  readonly vr = inject(ViewRouter);
  readonly IMPL_LABEL = IMPL_LABEL;
  readonly IMPL_PILL = IMPL_PILL;
  readonly failed = signal<Set<string>>(new Set());
  readonly bssMembers = ['kube-prometheus-stack', 'storage(local-path)', 'ingress'];

  ngOnInit(): void { this.svc.start(); }

  open(c: DepCard): void { this.vr.setTab(c.id); }
  goEngines(): void { this.vr.setModule('engines'); }
  isDetailTab(): boolean { return DETAIL_TABS.has(this.vr.tab()); }
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

  count(): number { return this.allCards.length; }
  implCount(impl: Impl): number { return this.allCards.filter((c) => c.impl === impl).length; }
  basicLive(): number {
    return this.allCards.filter((c) => c.liveKey && this.svc.liveState(c.liveKey) === 'ok').length;
  }
  notInstalledCards(): DepCard[] {
    return this.allCards.filter((c) => c.liveKey && this.svc.liveState(c.liveKey) === 'nocrd');
  }
  notInstalled(): number { return this.notInstalledCards().length; }
  notInstalledNames(): string {
    const names = this.notInstalledCards().map((c) => c.name);
    return names.length ? names.join(' · ') : '없음';
  }

  readonly allCards: DepCard[] = [
    {
      id: 'prometheus', name: 'kube-prometheus-stack', provider: 'prometheus-community', version: 'chart 87.3.0', logo: 'prometheus', mono: 'P', detail: true,
      category: '관측', impl: 'real', liveKey: 'prometheus',
      role: 'Foundation이 수집한 지표를 저장·조회하는 관측 백엔드. 별도 Prometheus를 두지 않고 여기에 위임한다(HostDelegate).',
      wiring: '카드를 클릭하면 상태 전용 페이지(설치·전환 없음)에서 타깃·알림을 볼 수 있다.',
    },
    {
      id: 'ingress', name: 'ingress-nginx', provider: 'kubernetes', version: 'v1.11.3', logo: 'nginx', mono: 'N', detail: true,
      category: '외부노출', impl: 'absent', liveKey: 'ingress',
      role: '서비스를 클러스터 밖으로 노출하고 도메인 기반으로 라우팅하는 진입점. 이 영역은 호스트가 책임진다.',
      wiring: '카드를 클릭하면 상태 전용 페이지(설치·전환 없음)에서 Ingress 현황을 볼 수 있다.',
    },
    {
      id: 'certmanager', name: 'cert-manager', provider: 'cert-manager.io', version: 'v1.20.3', logo: 'cert-manager', mono: 'CM', detail: true,
      category: '외부노출', impl: 'absent', liveKey: 'certmanager',
      role: 'TLS 인증서를 자동으로 발급·갱신하는 컴포넌트. 인증서 관리 역시 호스트 몫이다.',
      wiring: '카드를 클릭하면 상태 전용 페이지(설치·전환 없음)에서 인증서 만료 현황을 볼 수 있다.',
    },
    {
      id: 'storage', name: 'local-path (StorageClass)', provider: 'rancher.io/local-path', version: 'v20260521', logo: 'kubernetes', mono: 'SC', detail: true,
      category: '스토리지', impl: 'real', liveKey: 'storage',
      role: '데이터를 담을 볼륨을 실제로 만들어 주는 스토리지 공급자. Foundation은 어떤 스토리지를 쓸지 이름만 요구한다.',
      wiring: '카드를 클릭하면 클러스터의 StorageClass 중 Foundation 기본값을 고르는 페이지로 이동한다(설치 아님, 선택).',
    },
    {
      id: 'velero', name: 'Velero', provider: 'velero.io (CNCF Sandbox)', version: 'v1.18.1', logo: 'velero', mono: 'V', detail: true,
      category: '백업', impl: 'real', liveKey: 'velero',
      role: '클러스터의 아무 네임스페이스나 백업·복원 대상으로 삼는 워크로드 무관 범용 DR 도구. Foundation뿐 아니라 어느 스택도 쓸 수 있다.',
      wiring: '카드를 클릭하면 Velero 전용 페이지에서 설치 상태·백업/복원 이력을 관리한다.',
    },
  ];

  back(): void { this.vr.setTab('overview'); }
}
