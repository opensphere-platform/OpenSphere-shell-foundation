import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Phase } from '../cnpg.types';

// metric 타일 — 값+라벨+상태 도트(+선택 클릭 점프). 값은 Cluster.status 파생만(라이브 메트릭 프록시 없음).
@Component({
  selector: 'pg-metric',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="os-metric" [ngClass]="'os-'+status" [class.os-click]="clickable"
         [attr.role]="clickable ? 'button' : null" [attr.tabindex]="clickable ? 0 : null"
         (click)="clickable && go.emit()" (keydown.enter)="clickable && go.emit()">
      <div class="os-num">{{ value }}</div>
      <div class="os-lbl">{{ label }}</div>
      <div class="os-msub" *ngIf="sub">{{ sub }}</div>
    </div>
  `,
})
export class PgMetric {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() status: Phase = '';
  @Input() sub = '';
  @Input() clickable = false;
  @Output() go = new EventEmitter<void>();
}
