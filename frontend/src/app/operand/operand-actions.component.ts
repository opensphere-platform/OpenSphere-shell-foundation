import { CommonModule } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { OperandAction, REALM_FACTS } from '../core/operands';

/** operand-actions — 읽기 전용 액션. reveal은 인라인 *ngIf(Clarity 오버레이 포털 미사용 — shadow DOM 안전). */
@Component({
  selector: 'app-operand-actions',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="op-actions">
      <button class="btn btn-sm btn-outline" *ngFor="let a of actions()" [disabled]="a.liveOnly && !live()" (click)="onAction(a)">
        {{ a.label }}<span class="fs-muted" *ngIf="a.liveOnly && !live()"> (배포 후)</span>
      </button>
    </div>
    <pre class="op-reveal" *ngIf="revealed()">{{ revealed() }}</pre>
    <span class="op-copied" *ngIf="copied()">복사됨: {{ copied() }}</span>
  `,
})
export class OperandActionsComponent {
  readonly actions = input<OperandAction[]>([]);
  readonly fm = input<any>(null);
  readonly live = input<boolean>(false);
  readonly revealed = signal<string>('');
  readonly copied = signal<string>('');

  onAction(a: OperandAction) {
    if (a.kind === 'reveal') { this.revealed.set(this.revealed() ? '' : this.dataFor(a)); return; }
    if (a.kind === 'copy') { const v = this.valFor(a); try { (navigator as any).clipboard?.writeText(v); } catch { /* noop */ } this.copied.set(v || '(없음)'); setTimeout(() => this.copied.set(''), 2500); return; }
    // link/external: 내부 svc DNS는 브라우저 직접 도달 불가 → 안내만(읽기전용 콘솔)
    this.revealed.set(this.revealed() ? '' : '대상: ' + (a.target || '') + ' — 클러스터 내부 엔드포인트(브라우저 직접 접근 아님).');
  }
  private dataFor(a: OperandAction): string {
    const t = a.target || '';
    if (t === 'realm') return JSON.stringify(REALM_FACTS, null, 2);
    const scrape = this.fm()?.status?.scrape;
    if (t === 'discovery' || t === 'jwks' || t === 'config') {
      return scrape ? JSON.stringify(scrape, null, 2) : '측정 대기(scrape) — control-plane 스크레이프(P3) 적용 후 실데이터 표시. 현재는 status.issuerURL/jwksURL·observed만 라이브.';
    }
    const sp = this.fm()?.status?.[t];
    return sp != null ? String(sp) : '(없음)';
  }
  private valFor(a: OperandAction): string { const sp = this.fm()?.status?.[a.target || '']; return sp != null ? String(sp) : ''; }
}
