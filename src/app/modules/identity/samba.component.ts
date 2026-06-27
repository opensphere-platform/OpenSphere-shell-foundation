import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { SambaService } from './identity.services';
import { PILL } from '../postgres/cnpg.types';
import { PgMetric } from '../postgres/ui/pg-metric';

// Samba-AD(workspace 디렉터리) 콘솔 — 상태·realm·LDAP 소비점(Clarity). 폴러는 shell 소유.
@Component({
  selector: 'app-samba',
  standalone: true,
  imports: [CommonModule, ClarityModule, PgMetric],
  template: `
    <div class="os-title-row">
      <h2 class="os-h2">Samba-AD <span class="label label-info">plugin</span></h2>
      <span class="label" [ngClass]="pillCls()">{{ svc.phase() }}</span>
      <label class="clr-control-label os-ml-auto"><input type="checkbox" class="clr-checkbox" [checked]="svc.autoRefresh()" (change)="svc.toggleAuto()"> auto 15s</label>
      <button class="btn btn-sm" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
    </div>
    <p class="os-sub">workspace/사원 디렉터리 · Samba Active Directory DC · realm {{ svc.realm }} · ns {{ svc.ns }}<span *ngIf="svc.lastSync()"> · {{ svc.lastSync() }}</span></p>

    <div class="os-metrics">
      <pg-metric label="상태" [value]="svc.phase()" [status]="svc.phaseCls()"></pg-metric>
      <pg-metric label="Replicas" [value]="svc.readyN() + ' / ' + svc.totalN()" [status]="svc.ready() ? 'ok' : 'warn'" sub="ready"></pg-metric>
      <pg-metric label="Domain" [value]="svc.domain" sub="NetBIOS"></pg-metric>
      <pg-metric label="LDAP" value=":389" sub="endpoint"></pg-metric>
    </div>

    <div class="os-cardgrid">
      <div class="card">
        <div class="card-header">디렉터리 · {{ svc.name }}</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>이미지</dt><dd class="os-mono">{{ svc.image() || '—' }}</dd>
            <dt>Node</dt><dd class="os-mono">{{ svc.node() }}</dd>
            <dt>재시작</dt><dd>{{ svc.restarts() }}</dd>
            <dt>Realm</dt><dd class="os-mono">{{ svc.realm }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">연결 — 상위 서비스 소비점</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>LDAP</dt><dd class="os-mono">{{ svc.ldap }}</dd>
            <dt>Base DN</dt><dd class="os-mono">{{ svc.baseDn() }}</dd>
            <dt>Admin</dt><dd class="os-mono">Administrator (dev)</dd>
          </dl>
          <p class="os-sub">Keycloak User Federation의 LDAP 연결 대상. 사용자·그룹 관리는 AD 도구(RSAT)/samba-tool.</p>
        </div>
      </div>
    </div>

    <div class="os-sech">관리</div>
    <clr-alert clrAlertType="info" [clrAlertClosable]="false" [clrAlertLightweight]="true">
      <clr-alert-item><span class="alert-text">사용자·그룹 생성은 samba-tool 또는 Windows RSAT. Keycloak이 이 LDAP를 federation해 사원 로그인을 제공.</span></clr-alert-item>
    </clr-alert>
  `,
})
export class SambaComponent {
  readonly svc = inject(SambaService);
  pillCls(): string { return PILL[this.svc.phaseCls()]; }
}
