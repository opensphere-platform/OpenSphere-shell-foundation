import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { IngressNginxService } from './ingressnginx.service';
import { ViewRouter } from '../../view-router';
import { BarChart, BarDatum } from '../../shared/bar-chart';
import { CarbonIcon } from '../../carbon-icon';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

const LOGO = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos/nginx.svg';

// ingress-nginx 상세 — 상태 전용(설치 버튼 없음). 콘솔 자신의 외부 노출 진입점이라 여기서 건드리지 않는다.
@Component({
  selector: 'app-ingressnginx',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, BarChart],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> BSS
    </a>

    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">Basic Service Stack · 외부노출</span>
        <h1>ingress-nginx</h1>
        <p>클러스터 밖으로 서비스를 노출하는 진입점 — 콘솔 자신의 라우팅도 이 위에 얹혀 있어 이 페이지는 <strong>상태 조회만</strong> 한다.</p>
        <div class="vl-hero__meta">
          <span class="label" [ngClass]="svc.phaseLabel() === 'Running' ? 'label-success' : 'label-warning'">{{ svc.phaseLabel() }}</span>
          <span class="vl-dim">kubernetes.io · Apache-2.0 · ns ingress-nginx</span>
          <button class="btn btn-sm btn-link vl-refresh" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
        </div>
      </div>
      <div class="vl-hero__art" aria-hidden="true"><img [src]="LOGO" alt="nginx" /></div>
    </section>

    <section class="vl-section">
      <h2>컨트롤러 상태</h2>
      <div class="vl-tile vl-tile--wide">
        <dl class="os-kv">
          <dt>상태</dt><dd><span class="label" [ngClass]="svc.ready()>0 ? 'label-success':'label-danger'">{{ svc.ready()>0 ? 'Running' : '문제' }}</span>
            <span class="vl-dim"> 레플리카 {{ svc.ready() }}/{{ svc.total() }}</span></dd>
          <dt>image</dt><dd class="os-mono">{{ svc.image() }}</dd>
          <dt>Ingress 총 개수</dt><dd>{{ svc.ingresses().length }}개 (TLS 적용 {{ svc.tlsCount() }}개)</dd>
        </dl>
      </div>
    </section>

    <section class="vl-section" *ngIf="svc.byNamespace().length">
      <h2>네임스페이스별 Ingress 분포</h2>
      <div class="vl-tile vl-tile--wide">
        <os-bar-chart [data]="nsBars()"></os-bar-chart>
      </div>
    </section>

    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</p>
  `,
})
export class IngressNginxComponent {
  readonly svc = inject(IngressNginxService);
  private vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly iBack = ArrowLeft16;

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  back(): void { this.vr.setTab('overview'); }

  nsBars(): BarDatum[] {
    return this.svc.byNamespace().map((n) => ({ label: n.ns, value: n.count, kind: 'default' as const }));
  }
}
