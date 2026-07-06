import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CarbonIcon } from '../carbon-icon';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

const LOGO_BASE = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos';

// 로드맵 모듈(아직 착수 전) 전용 최소 페이지 — 로고/제목만 있는 빈 페이지(2026-07-04, 사용자 지시).
// 실제 엔진 착수 시 otel.component.ts류 전용 컴포넌트로 교체한다. backLabel을 주면 카탈로그
// (FSS 멤버의 엔진 후보 등) 내부 탭으로도 재사용 가능(그 경우 (back) 이벤트로 상위가 탭 전환을 처리).
@Component({
  selector: 'app-placeholder-module',
  standalone: true,
  imports: [CommonModule, CarbonIcon],
  template: `
    <a class="vl-back" *ngIf="backLabel" (click)="back.emit()" (keydown.enter)="back.emit()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> {{ backLabel }}
    </a>
    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">{{ eyebrow }}</span>
        <h1>{{ name }}</h1>
        <p class="vl-dim">아직 착수 전인 로드맵 모듈입니다. 설치·상태 관리 기능은 준비 중입니다.</p>
      </div>
      <div class="vl-hero__art" aria-hidden="true">
        <img *ngIf="logo && !failed()" [src]="logoUrl()" [alt]="name" loading="lazy" (error)="failed.set(true)" />
        <span *ngIf="!logo || failed()" class="ph-mono">{{ mono }}</span>
      </div>
    </section>
  `,
  styles: [`
    .ph-mono { display: flex; align-items: center; justify-content: center; width: 120px; height: 120px;
      border-radius: 50%; background: #eef1ff; color: var(--os-brand-500); font-size: 2rem; font-weight: 700; }
  `],
})
export class PlaceholderModuleComponent {
  @Input() name = '';
  @Input() logo = '';
  @Input() mono = '?';
  @Input() eyebrow = 'Foundation · 로드맵';
  @Input() backLabel = '';
  @Output() back = new EventEmitter<void>();
  readonly failed = signal(false);
  readonly iBack = ArrowLeft16;
  logoUrl(): string { return `${LOGO_BASE}/${this.logo}.svg`; }
}
