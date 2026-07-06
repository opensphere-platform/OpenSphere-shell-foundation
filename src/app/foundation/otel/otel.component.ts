import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { OtelService } from './otel.service';
import { ViewRouter } from '../../view-router';
import { CarbonIcon } from '../../carbon-icon';
import Misuse20 from '@carbon/icons/es/misuse/20';
import Download16 from '@carbon/icons/es/download/16';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

const LOGO = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos/opentelemetry-non-typo.svg';

// OpenTelemetry Collector(중앙 게이트웨이) 전용 페이지 — Velero 페이지와 동일한 설치·상태 패턴.
@Component({
  selector: 'app-otel',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> FSS 멤버
    </a>

    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">Foundation · 관측</span>
        <h1>OpenTelemetry Collector</h1>
        <p>각 모듈 사이드카 수집기와 별개로, 여러 모듈의 지표·로그·추적을 한곳에서 받아 Basic Prometheus로 넘기는 중앙 게이트웨이.</p>
        <div class="vl-hero__meta">
          <span class="label" [ngClass]="phasePill()">{{ svc.phaseLabel() }}</span>
          <span class="vl-dim">opentelemetry.io · CNCF · Apache-2.0</span>
          <button class="btn btn-sm btn-link vl-refresh" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
        </div>
      </div>
      <div class="vl-hero__art" aria-hidden="true"><img [src]="LOGO" alt="OpenTelemetry" /></div>
    </section>

    <section class="vl-section" *ngIf="svc.installed()">
      <h2>설치 상태</h2>
      <div class="vl-tile vl-tile--wide">
        <dl class="os-kv">
          <dt>상태</dt>
          <dd>
            <span class="label" [ngClass]="svc.ready() ? 'label-success' : 'label-warning'">{{ svc.ready() ? 'Running' : '기동 중' }}</span>
            <span class="vl-dim"> 레플리카 {{ svc.readyN() }}/{{ svc.totalN() }}</span>
          </dd>
          <dt>image</dt><dd class="os-mono">{{ svc.installedImage() }}</dd>
          <dt>네임스페이스</dt><dd class="os-mono">opensphere-otel-collector</dd>
        </dl>
      </div>
    </section>

    <section class="vl-section" *ngIf="!svc.installed()">
      <h2>설치</h2>

      <div class="vl-note vl-note--danger" *ngIf="svc.installState() === 'error'">
        <os-cicon [icon]="iMisuse" [size]="20" />
        <div><strong>설치 실패</strong><p>{{ svc.installError() }} <a class="vl-link" (click)="svc.dismissError()">다시 시도</a></p></div>
      </div>

      <div class="vl-progress-wrap" *ngIf="svc.installState() === 'installing'">
        <div class="vl-progress-head">
          <span>설치 진행 중… chart {{ svc.plan().chart }}</span>
          <span class="vl-progress-pct">{{ svc.progress() }}%</span>
        </div>
        <div class="vl-progress-track"><div class="vl-progress-bar" [style.width.%]="svc.progress()"></div></div>
        <div class="vl-log">
          <div class="vl-log-line" *ngFor="let l of svc.logs()">{{ l }}</div>
          <div class="vl-log-empty" *ngIf="!svc.logs().length">로그 대기 중…</div>
        </div>
      </div>

      <div class="vl-install" *ngIf="svc.installState() === 'idle'">
        <div class="vl-install-row">
          <label class="vl-field">
            <span class="vl-field-l">버전</span>
            <select class="os-filter" (change)="onSelect($event)">
              <option *ngFor="let v of svc.versions" [value]="v.chart" [selected]="v.chart === svc.selectedChart()">chart {{ v.chart }} · app {{ v.app }}{{ v.note ? ' (' + v.note + ')' : '' }}</option>
            </select>
          </label>
          <button class="btn btn-primary vl-install-btn" [disabled]="!svc.canInstall()" (click)="svc.install()">
            <os-cicon [icon]="iDownload" [size]="16" /> 설치
          </button>
        </div>
        <div class="vl-tile vl-tile--wide vl-plan">
          <h3>설치 계획</h3>
          <dl class="os-kv">
            <dt>차트 / app</dt><dd>{{ svc.plan().chart }} / {{ svc.plan().app }}</dd>
            <dt>네임스페이스</dt><dd class="os-mono">{{ svc.plan().namespace }}</dd>
            <dt>image</dt><dd class="os-mono">{{ svc.plan().image }} <span class="vl-dim">← {{ svc.plan().imageOrigin }}</span></dd>
            <dt>설치 방식</dt><dd>Crossplane provider-helm · Release CR (선언형)</dd>
          </dl>
          <p class="vl-plan-note">파이프라인 구성(receiver/exporter)은 차트 기본값(OTLP·Prometheus 수신 → debug 출력)을 그대로 쓴다 — 실제 내보내기 대상 설정은 상위 소비 모듈 몫.</p>
        </div>
      </div>
    </section>

    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</p>
  `,
})
export class OtelComponent {
  readonly svc = inject(OtelService);
  private vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly iBack = ArrowLeft16;
  readonly iMisuse = Misuse20;
  readonly iDownload = Download16;

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  back(): void { this.vr.setTab('overview'); }
  onSelect(e: Event): void { this.svc.selectChart((e.target as HTMLSelectElement).value); }

  phasePill(): string {
    if (this.svc.installed()) { return this.svc.ready() ? 'label-success' : 'label-warning'; }
    return this.svc.phaseLabel() === '확인 중' ? '' : 'label-warning';
  }
}
