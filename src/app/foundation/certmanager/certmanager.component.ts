import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CertManagerService } from './certmanager.service';
import { ViewRouter } from '../../view-router';
import { BarChart, BarDatum } from '../../shared/bar-chart';
import { CarbonIcon } from '../../carbon-icon';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

const LOGO = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos/cert-manager.svg';

// cert-manager 상세 — 상태 전용(설치 버튼 없음). 콘솔 자신의 TLS 인증서 발급이 이 위에 얹혀 있어 건드리지 않는다.
@Component({
  selector: 'app-certmanager',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, BarChart],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> BSS
    </a>

    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">Basic Service Stack · 외부노출</span>
        <h1>cert-manager</h1>
        <p>TLS 인증서를 자동 발급·갱신하는 컴포넌트 — 콘솔 자신의 인증서도 여기서 나온다. 이 페이지는 <strong>상태 조회만</strong> 한다.</p>
        <div class="vl-hero__meta">
          <span class="label" [ngClass]="svc.phaseLabel() === 'Running' ? 'label-success' : 'label-warning'">{{ svc.phaseLabel() }}</span>
          <span class="vl-dim">cert-manager.io · Apache-2.0 · ns cert-manager</span>
          <button class="btn btn-sm btn-link vl-refresh" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
        </div>
      </div>
      <div class="vl-hero__art" aria-hidden="true"><img [src]="LOGO" alt="cert-manager" /></div>
    </section>

    <section class="vl-section">
      <h2>구성 요소</h2>
      <div class="vl-tile-grid">
        <div class="vl-tile"><h3>controller <span class="label" [ngClass]="svc.controllerState()==='ok' ? 'label-success':'label-danger'">{{ svc.controllerState()==='ok' ? 'Running' : '문제' }}</span></h3></div>
        <div class="vl-tile"><h3>cainjector <span class="label" [ngClass]="svc.cainjectorState()==='ok' ? 'label-success':'label-danger'">{{ svc.cainjectorState()==='ok' ? 'Running' : '문제' }}</span></h3></div>
        <div class="vl-tile"><h3>webhook <span class="label" [ngClass]="svc.webhookState()==='ok' ? 'label-success':'label-danger'">{{ svc.webhookState()==='ok' ? 'Running' : '문제' }}</span></h3></div>
      </div>
    </section>

    <section class="vl-section">
      <h2>인증서 만료 현황 <span class="vl-dim">— 남은 일수(적을수록 위)</span></h2>
      <div class="vl-tile vl-tile--wide">
        <div class="vl-stat-grid vl-stat-grid--gap">
          <div class="vl-stat"><span class="vl-stat-n">{{ svc.certs().length }}</span><span class="vl-stat-l">총 인증서</span></div>
          <div class="vl-stat"><span class="vl-stat-n" [ngClass]="svc.expiringSoon() ? 'vl-warn-n':''">{{ svc.expiringSoon() }}</span><span class="vl-stat-l">14일 내 만료</span></div>
        </div>
        <os-bar-chart [data]="certBars()"></os-bar-chart>
      </div>
    </section>

    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</p>
  `,
})
export class CertManagerComponent {
  readonly svc = inject(CertManagerService);
  private vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly iBack = ArrowLeft16;

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  back(): void { this.vr.setTab('overview'); }

  certBars(): BarDatum[] {
    return this.svc.certs().map((c) => ({
      label: `${c.namespace}/${c.name}`, value: Math.max(0, c.daysLeft),
      kind: c.daysLeft < 7 ? 'bad' : c.daysLeft < 30 ? 'warn' : 'ok', hint: '일',
    }));
  }
}
