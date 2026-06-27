import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { State } from '../cnpg.types';

// 6-state 단일 렌더 — loading/empty/noperm/nocrd/error/ok. styles 없음(ShadowDom 전역 클래스 수령).
// empty(info 중립)와 error(danger+재시도)를 시각 분리 — '0건=정상'을 에러처럼 보이게 하지 않는다.
@Component({
  selector: 'pg-state',
  standalone: true,
  imports: [CommonModule, ClarityModule],
  template: `
    <ng-container *ngIf="state === 'ok'"><ng-content></ng-content></ng-container>
    <div class="os-dim" *ngIf="state === 'loading'"><span class="spinner spinner-sm"></span> 불러오는 중…</div>
    <clr-alert *ngIf="state === 'empty'" clrAlertType="info" [clrAlertClosable]="false" [clrAlertLightweight]="true">
      <clr-alert-item><span class="alert-text">{{ hint || '항목이 없습니다.' }}<ng-container *ngIf="sub"> — {{ sub }}</ng-container></span></clr-alert-item>
    </clr-alert>
    <clr-alert *ngIf="state === 'noperm'" clrAlertType="warning" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text">조회 권한 없음 — rbac-foundation-read.yaml(provisioning·CNPG read) 적용 필요.</span></clr-alert-item>
    </clr-alert>
    <clr-alert *ngIf="state === 'nocrd'" clrAlertType="warning" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text">해당 리소스 타입이 클러스터에 없습니다(CRD 미설치).</span></clr-alert-item>
    </clr-alert>
    <clr-alert *ngIf="state === 'error'" clrAlertType="danger" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text">불러오기 실패.</span><div class="alert-actions"><button class="btn alert-action" (click)="retry.emit()">재시도</button></div></clr-alert-item>
    </clr-alert>
  `,
})
export class PgState {
  @Input() state: State = 'loading';
  @Input() hint = '';
  @Input() sub = '';
  @Output() retry = new EventEmitter<void>();
}
