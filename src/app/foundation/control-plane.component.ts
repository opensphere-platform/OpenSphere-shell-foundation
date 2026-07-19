import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CarbonIcon } from '../carbon-icon';
import { ControlPlaneService, CpState } from './control-plane.service';
import Renew16 from '@carbon/icons/es/renew/16';
import Rule16 from '@carbon/icons/es/rule/16';
import FlowConnection16 from '@carbon/icons/es/flow--connection/16';
import CloudServiceManagement16 from '@carbon/icons/es/cloud--service-management/16';
import WarningAlt16 from '@carbon/icons/es/warning--alt/16';
import { PluginPageHeaderComponent, PluginPageHeaderModel } from '../shared/plugin-page-shell.component';

@Component({
  selector: 'app-control-plane',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, PluginPageHeaderComponent],
  styles: [`
    .cp-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
    .cp-title { display:flex; align-items:center; gap:.45rem; }
    .cp-title h2 { margin:0; font-size:1.35rem; font-weight:500; color:#161616; }
    .cp-sub { margin:.25rem 0 0; color:#5f6b85; font-size:.82rem; line-height:1.45; }
    .cp-actions { display:flex; align-items:center; gap:.5rem; }
    .cp-strip { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:.75rem; margin-bottom:1rem; }
    .cp-stat { background:#fff; border:1px solid #d0d7de; border-radius:4px; padding:.8rem .9rem; min-height:4.8rem; }
    .cp-stat span { display:block; color:#5f6b85; font-size:.72rem; text-transform:uppercase; letter-spacing:.02em; }
    .cp-stat strong { display:block; margin-top:.45rem; font-size:1.35rem; font-weight:600; color:#161616; }
    .cp-stat small { display:block; margin-top:.2rem; color:#69758c; font-size:.72rem; }
    .cp-alert { border:1px solid #e5534b; border-left:4px solid #e5534b; background:#fff7f6; padding:.8rem .9rem; margin-bottom:1rem; }
    .cp-alert h3 { margin:.05rem 0 .35rem; font-size:.9rem; }
    .cp-alert p { margin:.2rem 0; font-size:.78rem; line-height:1.45; color:#3b3b3b; }
    .cp-admin { display:grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap:.75rem; margin:0 0 1rem; }
    .cp-admin-card { background:#fff; border:1px solid #d0d7de; border-radius:4px; padding:.85rem .95rem; }
    .cp-admin-card h3 { margin:.05rem 0 .45rem; font-size:.95rem; font-weight:600; color:#26374f; }
    .cp-admin-card p { margin:.25rem 0; color:#4f5b70; font-size:.78rem; line-height:1.45; }
    .cp-admin-actions { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-top:.65rem; }
    .cp-admin-list { margin:.45rem 0 0; padding-left:1rem; color:#3b3b3b; font-size:.78rem; line-height:1.55; }
    .cp-admin-list li { margin:.2rem 0; }
    .cp-no { color:#c92100; font-weight:600; }
    .cp-yes { color:#2e8540; font-weight:600; }
    .cp-section { margin-top:1rem; }
    .cp-section h3 { margin:0 0 .5rem; font-size:.95rem; font-weight:600; color:#26374f; }
    .cp-grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:.75rem; }
    .cp-card { background:#fff; border:1px solid #d0d7de; border-radius:4px; padding:.75rem; min-height:6.8rem; }
    .cp-card-h { display:flex; align-items:center; justify-content:space-between; gap:.5rem; margin-bottom:.55rem; }
    .cp-card h4 { margin:0; font-size:.86rem; font-weight:600; color:#161616; }
    .cp-card p { margin:.25rem 0; color:#4f5b70; font-size:.76rem; line-height:1.4; }
    .cp-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:.7rem; color:#4f5b70; word-break:break-all; }
    .cp-table { width:100%; background:#fff; border:1px solid #d0d7de; border-collapse:collapse; }
    .cp-table th, .cp-table td { border-bottom:1px solid #e6e8eb; padding:.45rem .55rem; text-align:left; vertical-align:top; font-size:.75rem; }
    .cp-table th { background:#f4f6f8; color:#26374f; font-weight:600; }
    .cp-state { display:inline-flex; align-items:center; gap:.25rem; white-space:nowrap; }
    .cp-dot { width:.45rem; height:.45rem; border-radius:50%; background:#8a8f98; }
    .cp-dot.pass { background:#2e8540; }
    .cp-dot.warn { background:#f0ad00; }
    .cp-dot.fail { background:#c92100; }
    .cp-dot.loading { background:#8a8f98; }
    @media (max-width: 980px) { .cp-strip, .cp-grid, .cp-admin { grid-template-columns:1fr; } .cp-head { flex-direction:column; } }
  `],
  template: `
    <osp-plugin-page-header [model]="headerModel()" headingId="foundation-control-plane-title" />
    <div class="cp-head">
      <div class="cp-actions">
        <button class="btn btn-sm" type="button" [disabled]="svc.busy()" (click)="svc.refresh()">
          <span class="spinner spinner-inline" *ngIf="svc.busy()"></span>
          <os-cicon [icon]="iRenew" [size]="16"></os-cicon> Refresh
        </button>
        <span class="os-dim" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</span>
      </div>
    </div>

    <section class="cp-strip">
      <div class="cp-stat">
        <span>Checks</span>
        <strong>{{ svc.summary().pass }}/{{ svc.summary().total }}</strong>
        <small>pass / total</small>
      </div>
      <div class="cp-stat">
        <span>Blockers</span>
        <strong>{{ svc.blockers().length }}</strong>
        <small>required fail</small>
      </div>
      <div class="cp-stat">
        <span>Contracts</span>
        <strong>{{ contractPass() }}/{{ svc.contracts().length }}</strong>
        <small>CRD contracts</small>
      </div>
      <div class="cp-stat">
        <span>Write path</span>
        <strong>{{ writePathPass() }}/{{ svc.writePaths().length }}</strong>
        <small>Crossplane / GitOps</small>
      </div>
    </section>

    <div class="cp-alert" *ngIf="identityBlocked()">
      <h3><os-cicon [icon]="iWarn" [size]="16"></os-cicon> Samba-AD 설치 BLOCK 원인</h3>
      <p>
        Crossplane core/provider는 준비되어 있어도, typed identity directory 계약인
        <b>IdentityDirectoryClaim</b> / <b>IdentityDirectoryBinding</b> CRD가 없으면
        Samba-AD consumer에게 LDAP endpointRef, secretRef, policyRef를 안전하게 발급할 수 없다.
      </p>
      <p>
        따라서 다음 작업은 Crossplane 재설치가 아니라 Foundation control-plane에 typed IdentityDirectory 계약과 reconciler를 추가하는 것이다.
      </p>
    </div>

    <section class="cp-admin" *ngIf="identityBlocked()">
      <article class="cp-admin-card">
        <h3>OpenSphere가 복구해야 할 일</h3>
        <p>
          이것은 사용자 설정 문제가 아니라 Foundation control-plane의 계약 패키지 누락이다.
          admin은 CRD YAML을 직접 작성하지 않고, OpenSphere가 제공하는
          <b>Identity Directory Contract Pack</b> 복구/업데이트를 승인한다.
        </p>
        <ol class="cp-admin-list">
          <li>OpenSphere가 <b>IdentityDirectoryClaim</b>, <b>IdentityDirectoryBinding</b> CRD를 설치/업데이트한다.</li>
          <li>Foundation control-plane이 typed 계약 reconciler로 Binding을 발급한다.</li>
          <li>이 화면에서 Contracts와 Reconcilers가 Ready로 바뀌는지 확인한다.</li>
          <li>Ready가 되면 Samba-AD Preflight로 돌아가 설치를 진행한다.</li>
        </ol>
        <div class="cp-admin-actions">
          <button class="btn btn-primary" type="button" [disabled]="svc.repairBusy()" (click)="svc.repairIdentityDirectoryContracts()">
            <span class="spinner spinner-inline" *ngIf="svc.repairBusy()"></span>
            Repair Contract Pack
          </button>
          <span class="os-dim" *ngIf="svc.repairMessage()">{{ svc.repairMessage() }}</span>
        </div>
      </article>
      <article class="cp-admin-card">
        <h3>하지 말아야 할 일</h3>
        <p><span class="cp-no">Crossplane 재설치 아님</span> — Crossplane은 실행/전달 엔진이며, typed identity 계약의 소유자가 아니다.</p>
        <p><span class="cp-no">Samba-AD 강제 설치 아님</span> — 소비 계약이 없으면 Keycloak 같은 consumer에게 연결권을 안전하게 발급할 수 없다.</p>
        <p><span class="cp-yes">제품 복구 대상</span> — 이 문제의 책임 경계는 OpenSphere Foundation control-plane이다.</p>
      </article>
    </section>

    <clr-alert *ngIf="svc.error()" clrAlertType="danger" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text">{{ svc.error() }}</span></clr-alert-item>
    </clr-alert>

    <section class="cp-section">
      <h3><os-cicon [icon]="iRule" [size]="16"></os-cicon> Contracts</h3>
      <table class="cp-table">
        <thead><tr><th>Contract</th><th>Scope</th><th>State</th><th>CRD</th><th>Message</th></tr></thead>
        <tbody>
          <tr *ngFor="let c of svc.contracts()">
            <td><b>{{ c.name }}</b><br><span class="label" [ngClass]="c.required ? 'label-info' : ''">{{ c.required ? 'required' : 'optional' }}</span></td>
            <td>{{ c.scope }}</td>
            <td><span class="cp-state"><span class="cp-dot" [ngClass]="c.state"></span>{{ stateLabel(c.state) }}</span></td>
            <td class="cp-mono">{{ c.kind }}</td>
            <td>{{ c.message }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="cp-section">
      <h3><os-cicon [icon]="iCloud" [size]="16"></os-cicon> Reconcilers</h3>
      <div class="cp-grid">
        <article class="cp-card" *ngFor="let w of svc.workloads()">
          <div class="cp-card-h">
            <h4>{{ w.name }}</h4>
            <span class="cp-state"><span class="cp-dot" [ngClass]="w.state"></span>{{ stateLabel(w.state) }}</span>
          </div>
          <p>{{ w.role }}</p>
          <p><b>ns</b> {{ w.namespace }} · <b>ready</b> {{ w.ready }}</p>
          <p class="cp-mono">{{ w.image }}</p>
        </article>
      </div>
    </section>

    <section class="cp-section">
      <h3><os-cicon [icon]="iFlow" [size]="16"></os-cicon> Write Path</h3>
      <div class="cp-grid">
        <article class="cp-card" *ngFor="let p of svc.writePaths()">
          <div class="cp-card-h">
            <h4>{{ p.name }}</h4>
            <span class="cp-state"><span class="cp-dot" [ngClass]="p.state"></span>{{ stateLabel(p.state) }}</span>
          </div>
          <p>{{ p.message }}</p>
        </article>
      </div>
    </section>
  `,
})
export class ControlPlaneComponent {
  readonly svc = inject(ControlPlaneService);
  readonly iRenew = Renew16;
  readonly iRule = Rule16;
  readonly iFlow = FlowConnection16;
  readonly iCloud = CloudServiceManagement16;
  readonly iWarn = WarningAlt16;

  ngOnInit(): void { this.svc.start(); }

  headerModel(): PluginPageHeaderModel {
    const blocked = this.svc.blockers().length;
    return {
      name: 'Control Plane', logo: '', monogram: 'CP', capability: 'platform.authority',
      description: 'PFS 모듈 사이의 Claim, Binding, reconciler와 GitOps/Crossplane write-path 상태를 관리합니다.',
      lifecycle: blocked ? 'Blocked' : 'Ready', lifecycleClass: blocked ? 'label-danger' : 'label-success',
      version: 'contract v1', profile: 'authoritative', namespace: 'opensphere-system',
    };
  }

  stateLabel(s: CpState): string {
    return { pass: 'Ready', warn: 'Warning', fail: 'Blocked', loading: 'Loading' }[s];
  }

  contractPass(): number { return this.svc.contracts().filter((x) => x.state === 'pass').length; }
  writePathPass(): number { return this.svc.writePaths().filter((x) => x.state === 'pass').length; }

  identityBlocked(): boolean {
    return this.svc.contracts().some((x) => x.id.startsWith('identity-directory') && x.state === 'fail');
  }
}
