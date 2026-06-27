import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TlItem } from '../cnpg.types';

// 도트+라인 타임라인 — conditions·events 공용. cls(ok/warn/bad/'')로 도트 색.
@Component({
  selector: 'pg-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ul class="tl">
      <li *ngFor="let it of items" [ngClass]="it.cls">
        <span class="t-title">{{ it.title }}</span>
        <span class="t-when" *ngIf="it.when">{{ it.when }}</span>
        <div class="t-msg" *ngIf="it.msg">{{ it.msg }}</div>
      </li>
    </ul>
  `,
})
export class PgTimeline {
  @Input() items: TlItem[] = [];
}
