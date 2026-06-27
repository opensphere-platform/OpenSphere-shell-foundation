import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { State } from '../cnpg.types';

// 6-state 단일 렌더 — loading/empty/noperm/nocrd/error/ok. styles 없음(ShadowDom 전역 클래스 수령).
// empty(점선 회색 중립)와 error(빨강+재시도)를 시각 분리 — '0건=정상'을 에러처럼 보이게 하지 않는다.
@Component({
  selector: 'pg-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="state === 'ok'"><ng-content></ng-content></ng-container>
    <div class="muted" *ngIf="state === 'loading'"><span class="spinner"></span>불러오는 중…</div>
    <div class="empty" *ngIf="state === 'empty'">
      <div>{{ hint || '항목이 없습니다.' }}</div>
      <div class="e-hint" *ngIf="sub">{{ sub }}</div>
    </div>
    <div class="claim-deny" *ngIf="state === 'noperm'">ⓘ 조회 권한 없음 — <code>rbac-foundation-read.yaml</code>(provisioning·CNPG read) 적용 필요.</div>
    <div class="claim-deny" *ngIf="state === 'nocrd'">ⓘ 해당 리소스 타입이 클러스터에 없습니다(CRD 미설치).</div>
    <div class="claim-deny err" *ngIf="state === 'error'">⚠️ 불러오기 실패. <button class="rbtn" (click)="retry.emit()">재시도</button></div>
  `,
})
export class PgState {
  @Input() state: State = 'loading';
  @Input() hint = '';
  @Input() sub = '';
  @Output() retry = new EventEmitter<void>();
}
