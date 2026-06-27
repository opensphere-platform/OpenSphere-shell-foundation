import { CommonModule } from '@angular/common';
import { Component, Input, computed, signal } from '@angular/core';

// dense 키-값 표(postgresql 파라미터) + 라이브 필터. @Input params → 내부 signal(완전 반응형).
@Component({
  selector: 'pg-kv',
  standalone: true,
  imports: [CommonModule],
  template: `
    <input class="clr-input os-filter" [value]="filter()" (input)="filter.set(val($event))" placeholder="파라미터 필터…" aria-label="파라미터 필터">
    <table class="table os-cfg">
      <tbody>
        <tr *ngFor="let k of keys()">
          <td class="os-k">{{ k }}</td>
          <td class="os-v">{{ data()[k] }}</td>
        </tr>
        <tr *ngIf="!keys().length"><td colspan="2" class="os-muted">{{ rawCount() ? '일치하는 파라미터 없음' : '설정된 파라미터 없음(CNPG 기본값 사용)' }}</td></tr>
      </tbody>
    </table>
  `,
})
export class PgKv {
  readonly data = signal<Record<string, string>>({});
  @Input() set params(v: Record<string, string>) { this.data.set(v || {}); }
  readonly filter = signal('');
  readonly rawCount = computed(() => Object.keys(this.data()).length);
  readonly keys = computed(() => {
    const p = this.data();
    const f = this.filter().toLowerCase();
    return Object.keys(p)
      .filter((k) => !f || k.toLowerCase().includes(f) || String(p[k]).toLowerCase().includes(f))
      .sort();
  });
  val(e: Event): string { return (e.target as HTMLInputElement).value; }
}
