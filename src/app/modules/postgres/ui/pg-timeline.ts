import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PILL, TlItem } from '../cnpg.types';

// conditions·events 공용 — cls(ok/warn/bad/'')로 상태 라벨 색.
@Component({
  selector: 'pg-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <table class="table">
      <tbody>
        <tr *ngFor="let it of items">
          <td><span class="label" [ngClass]="pill(it.cls)">{{ it.title }}</span></td>
          <td>
            <div *ngIf="it.msg" class="os-muted">{{ it.msg }}</div>
          </td>
          <td class="os-dim os-ml-auto" *ngIf="it.when">{{ it.when }}</td>
          <td *ngIf="!it.when"></td>
        </tr>
      </tbody>
    </table>
  `,
})
export class PgTimeline {
  @Input() items: TlItem[] = [];
  pill(cls: TlItem['cls']): string { return PILL[cls]; }
}
