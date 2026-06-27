import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { KcService } from './identity.services';
import { PILL } from '../postgres/cnpg.types';
import { PgMetric } from '../postgres/ui/pg-metric';

// Keycloak(workspace IAM) 콘솔 — 상태·DB·소비점(Clarity). 폴러는 shell 소유. Kanidm 콘솔과 무관.
@Component({
  selector: 'app-keycloak',
  standalone: true,
  imports: [CommonModule, ClarityModule, PgMetric],
  template: `
    <div class="os-title-row">
      <h2 class="os-h2">Keycloak <span class="label label-info">plugin</span></h2>
      <span class="label" [ngClass]="pillCls()">{{ svc.phase() }}</span>
      <label class="clr-control-label os-ml-auto"><input type="checkbox" class="clr-checkbox" [checked]="svc.autoRefresh()" (change)="svc.toggleAuto()"> auto 15s</label>
      <button class="btn btn-sm" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
    </div>
    <p class="os-sub">workspace/사원 IAM·SSO · Keycloak 26 · Foundation PostgreSQL 소비 · ns {{ svc.ns }}<span *ngIf="svc.lastSync()"> · {{ svc.lastSync() }}</span></p>

    <div class="os-metrics">
      <pg-metric label="상태" [value]="svc.phase()" [status]="svc.phaseCls()"></pg-metric>
      <pg-metric label="Replicas" [value]="svc.readyN() + ' / ' + svc.totalN()" [status]="svc.ready() ? 'ok' : 'warn'" sub="ready"></pg-metric>
      <pg-metric label="DB" value="PG" sub="keycloak @ opensphere-pg"></pg-metric>
      <pg-metric label="HTTP" value=":8080" sub="admin console"></pg-metric>
    </div>

    <div class="os-cardgrid">
      <div class="card">
        <div class="card-header">IAM · {{ svc.name }}</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>이미지</dt><dd class="os-mono">{{ svc.image() || '—' }}</dd>
            <dt>Node</dt><dd class="os-mono">{{ svc.node() }}</dd>
            <dt>재시작</dt><dd>{{ svc.restarts() }}</dd>
            <dt>DB</dt><dd>{{ svc.db }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">연결 — 상위 서비스 소비점</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>HTTP</dt><dd class="os-mono">{{ svc.http }}</dd>
            <dt>관리자</dt><dd class="os-mono">{{ svc.admin }}</dd>
            <dt>OIDC issuer</dt><dd class="os-mono">http://{{ svc.http }}/realms/&lt;realm&gt;</dd>
          </dl>
          <p class="os-sub">realm·user federation은 Keycloak Admin UI(:8080). 사원 신원은 Samba-AD LDAP federation.</p>
        </div>
      </div>
    </div>

    <div class="os-sech">연동</div>
    <clr-alert clrAlertType="info" [clrAlertClosable]="false" [clrAlertLightweight]="true">
      <clr-alert-item><span class="alert-text">사원 디렉터리는 <b>Samba-AD(LDAP 389)</b> User Federation으로 연결(Admin → User Federation → ldap). Kanidm 콘솔 인증과 <b>무관</b>(별개 영역).</span></clr-alert-item>
    </clr-alert>
  `,
})
export class KeycloakComponent {
  readonly svc = inject(KcService);
  pillCls(): string { return PILL[this.svc.phaseCls()]; }
}
