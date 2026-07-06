import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CrossplaneService } from './crossplane.service';
import { ViewRouter } from '../../view-router';
import { CarbonIcon } from '../../carbon-icon';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

const LOGO = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos/crossplane-non-typo.svg';

// Crossplane 상세 — 메타 페이지(이미 설치됨, 설치 버튼 없음). 다른 6개 모듈이 이 provider-helm을 통해 설치된다.
@Component({
  selector: 'app-crossplane',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> FSS 멤버
    </a>

    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">Foundation · 전달</span>
        <h1>Crossplane</h1>
        <p>내부·외부를 막론하고 선언형 API로 인프라를 합성하는 통일 control-plane. Velero·OTel Collector·CloudNativePG 모두 이 provider-helm을 통해 설치된다.</p>
        <div class="vl-hero__meta">
          <span class="label" [ngClass]="svc.phaseLabel() === 'Running' ? 'label-success' : 'label-warning'">{{ svc.phaseLabel() }}</span>
          <span class="vl-dim">crossplane.io · CNCF · Apache-2.0</span>
          <button class="btn btn-sm btn-link vl-refresh" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
        </div>
      </div>
      <div class="vl-hero__art" aria-hidden="true"><img [src]="LOGO" alt="Crossplane" /></div>
    </section>

    <section class="vl-section">
      <h2>코어 구성 요소</h2>
      <div class="vl-tile-grid">
        <div class="vl-tile"><h3>crossplane <span class="label" [ngClass]="svc.coreState()==='ok' ? 'label-success':'label-danger'">{{ svc.coreState()==='ok' ? 'Running' : '문제' }}</span></h3></div>
        <div class="vl-tile"><h3>rbac-manager <span class="label" [ngClass]="svc.rbacState()==='ok' ? 'label-success':'label-danger'">{{ svc.rbacState()==='ok' ? 'Running' : '문제' }}</span></h3></div>
      </div>
    </section>

    <section class="vl-section">
      <h2>Provider <span class="vl-dim">— {{ svc.healthyProviderCount() }}/{{ svc.providers().length }} healthy</span></h2>
      <div class="vl-tile vl-tile--wide">
        <table class="table">
          <thead><tr><th>이름</th><th>패키지</th><th>설치</th><th>Healthy</th></tr></thead>
          <tbody>
            <tr *ngFor="let p of svc.providers()">
              <td>{{ p.name }}</td>
              <td class="os-mono">{{ p.package }}</td>
              <td><span class="label" [ngClass]="p.installed ? 'label-success':'label-danger'">{{ p.installed ? '설치됨' : '미설치' }}</span></td>
              <td><span class="label" [ngClass]="p.healthy ? 'label-success':'label-warning'">{{ p.healthy ? 'Healthy' : '점검 필요' }}</span></td>
            </tr>
            <tr *ngIf="!svc.providers().length"><td colspan="4" class="vl-nocap">등록된 Provider 없음</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="vl-section">
      <h2>관리 중인 Release <span class="vl-dim">— {{ svc.readyReleaseCount() }}/{{ svc.releases().length }} ready</span></h2>
      <div class="vl-tile vl-tile--wide">
        <table class="table">
          <thead><tr><th>Release</th><th>차트</th><th>네임스페이스</th><th>Synced</th><th>Ready</th></tr></thead>
          <tbody>
            <tr *ngFor="let r of svc.releases()">
              <td>{{ r.name }}</td>
              <td>{{ r.chart }}</td>
              <td class="os-mono">{{ r.namespace }}</td>
              <td><span class="label" [ngClass]="r.synced ? 'label-success':'label-warning'">{{ r.synced ? 'Synced' : '동기화 중' }}</span></td>
              <td><span class="label" [ngClass]="r.ready ? 'label-success':'label-warning'">{{ r.ready ? 'Ready' : '대기' }}</span></td>
            </tr>
            <tr *ngIf="!svc.releases().length"><td colspan="5" class="vl-nocap">관리 중인 Release 없음</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</p>
  `,
})
export class CrossplaneComponent {
  readonly svc = inject(CrossplaneService);
  private vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly iBack = ArrowLeft16;

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  back(): void { this.vr.setTab('overview'); }
}
