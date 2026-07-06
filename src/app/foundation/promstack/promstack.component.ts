import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { PromStackService } from './promstack.service';
import { ViewRouter } from '../../view-router';
import { BarChart, BarDatum } from '../../shared/bar-chart';
import { CarbonIcon } from '../../carbon-icon';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

const LOGO = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos/prometheus.svg';

// kube-prometheus-stack 상세 — 상태 전용(설치 버튼 없음, 사용자 확정 2026-07-04). 콘솔 자신의 TLS·라우팅이
// 이 위에 얹혀 있지 않지만, 관측 백엔드 자체가 이미 부트스트랩 스크립트로 운영 중이라 여기서 재설치를 시도하지 않는다.
@Component({
  selector: 'app-promstack',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, BarChart],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> BSS
    </a>

    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">Basic Service Stack · 관측</span>
        <h1>kube-prometheus-stack</h1>
        <p>Foundation을 포함한 모든 모듈이 위임하는 관측 백엔드. 이미 host가 설치·운영 중이라 이 페이지는 <strong>상태 조회만</strong> 한다.</p>
        <div class="vl-hero__meta">
          <span class="label" [ngClass]="svc.phaseLabel() === 'Running' ? 'label-success' : 'label-warning'">{{ svc.phaseLabel() }}</span>
          <span class="vl-dim">prometheus.io · Apache-2.0 · ns monitoring</span>
          <button class="btn btn-sm btn-link vl-refresh" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
        </div>
      </div>
      <div class="vl-hero__art" aria-hidden="true"><img [src]="LOGO" alt="Prometheus" /></div>
    </section>

    <section class="vl-section">
      <h2>구성 요소</h2>
      <div class="vl-tile-grid">
        <div class="vl-tile">
          <h3>Prometheus <span class="label" [ngClass]="svc.promState()==='ok' ? 'label-success':'label-danger'">{{ svc.promState()==='ok' ? 'Running' : '문제' }}</span></h3>
          <p>레플리카 {{ svc.promReady() }}/{{ svc.promTotal() }} · 시계열 {{ svc.seriesCount() | number }}개</p>
        </div>
        <div class="vl-tile">
          <h3>Alertmanager <span class="label" [ngClass]="svc.amState()==='ok' ? 'label-success':'label-danger'">{{ svc.amState()==='ok' ? 'Running' : '문제' }}</span></h3>
          <p>활성 알림 {{ svc.alerts().length }}건</p>
        </div>
        <div class="vl-tile">
          <h3>Grafana <span class="label" [ngClass]="svc.grafanaState()==='ok' ? 'label-success':'label-danger'">{{ svc.grafanaState()==='ok' ? 'Running' : '문제' }}</span></h3>
          <p>대시보드 사이드카가 grafana_dashboard=1 ConfigMap을 자동 임포트</p>
        </div>
      </div>
    </section>

    <section class="vl-section">
      <h2>스크레이프 대상 <span class="vl-dim">— job별 up/down</span></h2>
      <div class="vl-tile vl-tile--wide">
        <div class="vl-stat-grid vl-stat-grid--gap">
          <div class="vl-stat"><span class="vl-stat-n vl-ok-n">{{ svc.targetsUp() }}</span><span class="vl-stat-l">up</span></div>
          <div class="vl-stat"><span class="vl-stat-n" [ngClass]="svc.targetsDown() ? 'vl-bad-n':''">{{ svc.targetsDown() }}</span><span class="vl-stat-l">down</span></div>
        </div>
        <os-bar-chart [data]="targetBars()"></os-bar-chart>
      </div>
    </section>

    <section class="vl-section" *ngIf="svc.alerts().length">
      <h2>활성 알림</h2>
      <div class="vl-tile vl-tile--wide">
        <os-bar-chart [data]="alertBars()"></os-bar-chart>
      </div>
    </section>

    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</p>
  `,
})
export class PromStackComponent {
  readonly svc = inject(PromStackService);
  private vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly iBack = ArrowLeft16;

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  back(): void { this.vr.setTab('overview'); }

  targetBars(): BarDatum[] {
    return this.svc.targets().map((t) => ({ label: t.job, value: t.up, kind: t.down ? 'warn' : 'ok', hint: t.down ? `(${t.down} down)` : '' }));
  }
  alertBars(): BarDatum[] {
    const counts = new Map<string, number>();
    for (const a of this.svc.alerts()) { counts.set(a.severity, (counts.get(a.severity) ?? 0) + 1); }
    return [...counts.entries()].map(([label, value]) => ({ label, value, kind: label === 'critical' ? 'bad' : 'warn' }));
  }
}
