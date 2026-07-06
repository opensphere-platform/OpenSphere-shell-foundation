import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { StorageClassService } from './storageclass.service';
import { ViewRouter } from '../../view-router';
import { BarChart, BarDatum } from '../../shared/bar-chart';
import { CarbonIcon } from '../../carbon-icon';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';
import Misuse20 from '@carbon/icons/es/misuse/20';

const LOGO = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos/kubernetes.svg';

// StorageClass 상세 — 설치 대상이 아니라 "이미 있는 StorageClass 중 Foundation 기본값을 고르는" 선택 페이지.
@Component({
  selector: 'app-storageclass',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, BarChart],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> BSS
    </a>

    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">Basic Service Stack · 스토리지</span>
        <h1>StorageClass</h1>
        <p>
          Foundation은 스토리지를 직접 설치하지 않는다 — 클러스터에 이미 있는 StorageClass 중
          <strong>모듈 기본값으로 쓸 것을 고르는</strong> 페이지다. 설치 개념이 아니라 선택·적용이다.
        </p>
        <div class="vl-hero__meta">
          <span class="label label-info">현재 기본값: {{ svc.currentDefault() }}</span>
          <button class="btn btn-sm btn-link vl-refresh" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
        </div>
      </div>
      <div class="vl-hero__art" aria-hidden="true"><img [src]="LOGO" alt="Kubernetes" /></div>
    </section>

    <div class="vl-note vl-note--danger" *ngIf="svc.applyState() === 'error'">
      <os-cicon [icon]="iMisuse" [size]="20" />
      <div><strong>적용 실패</strong><p>{{ svc.applyError() }} <a class="vl-link" (click)="svc.dismissError()">닫기</a></p></div>
    </div>

    <section class="vl-section">
      <h2>클러스터 StorageClass 목록</h2>
      <div class="vl-tile-grid">
        <div class="vl-tile" *ngFor="let c of svc.classes()">
          <h3>{{ c.name }} <span class="label" *ngIf="c.isDefault">k8s 기본</span></h3>
          <p>provisioner: {{ c.provisioner }} · binding: {{ c.bindingMode }} · reclaim: {{ c.reclaimPolicy }}</p>
          <p>사용 중인 PVC {{ c.pvcCount }}개</p>
        </div>
      </div>
    </section>

    <section class="vl-section" *ngIf="svc.classes().length">
      <h2>StorageClass별 PVC 사용 분포</h2>
      <div class="vl-tile vl-tile--wide"><os-bar-chart [data]="pvcBars()"></os-bar-chart></div>
    </section>

    <section class="vl-section">
      <h2>Foundation 기본 StorageClass 선택</h2>
      <div class="vl-install-row">
        <label class="vl-field">
          <span class="vl-field-l">기본값</span>
          <select class="os-filter" (change)="onSelect($event)">
            <option *ngFor="let c of svc.classes()" [value]="c.name" [selected]="c.name === svc.selected()">{{ c.name }}{{ c.isDefault ? ' (k8s 기본)' : '' }}</option>
          </select>
        </label>
        <button class="btn btn-primary vl-install-btn" [disabled]="!svc.isDirty() || svc.applyState()==='applying'" (click)="svc.apply()">
          {{ svc.applyState()==='applying' ? '적용 중…' : svc.applyState()==='done' ? '적용됨 ✓' : '적용' }}
        </button>
      </div>
      <p class="vl-plan-note">
        선택을 적용하면 <code>foundation-control-plane</code>의 <code>--default-storage-class</code> 인자가 바뀌고
        컨트롤플레인이 재기동된다 — 개별 모듈은 <code>FoundationModel.spec.parameters.hostRequirements.storageClass</code>로 이 기본값을 override할 수 있다.
      </p>
    </section>

    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</p>
  `,
})
export class StorageClassComponent {
  readonly svc = inject(StorageClassService);
  private vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly iBack = ArrowLeft16;
  readonly iMisuse = Misuse20;

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }
  back(): void { this.vr.setTab('overview'); }
  onSelect(e: Event): void { this.svc.select((e.target as HTMLSelectElement).value); }

  pvcBars(): BarDatum[] {
    return this.svc.classes().map((c) => ({ label: c.name, value: c.pvcCount, kind: 'default' as const }));
  }
}
