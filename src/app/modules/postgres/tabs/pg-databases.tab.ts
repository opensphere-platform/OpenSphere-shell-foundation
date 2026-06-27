import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { CnpgService } from '../cnpg.service';
import { PgState } from '../ui/pg-state';

@Component({
  selector: 'pg-databases',
  standalone: true,
  imports: [CommonModule, ClarityModule, PgState],
  template: `
    <div class="os-sech">Databases (CNPG Database CR)</div>
    <pg-state [state]="svc.dbState()" hint="선언된 Database 없음" sub="Claims 탭에서 PostgresClaim으로 전용 DB를 발급하세요." (retry)="svc.refresh()">
      <table class="table">
        <thead><tr><th>CR 이름</th><th>DB</th><th>Owner</th><th>적용</th></tr></thead>
        <tbody>
          <tr *ngFor="let d of svc.databases()">
            <td class="os-mono">{{ d.metadata?.name }}</td>
            <td class="os-mono">{{ d.spec?.name }}</td>
            <td class="os-mono">{{ d.spec?.owner }}</td>
            <td><span class="label" [ngClass]="d.status?.applied === true ? 'label-success' : (d.status?.applied === false ? 'label-danger' : 'label')">{{ appliedLabel(d) }}</span></td>
          </tr>
        </tbody>
      </table>
    </pg-state>

    <div class="os-sech">Managed Roles</div>
    <table class="table" *ngIf="svc.managedRoles().length; else noRoles">
      <thead><tr><th>Role</th><th>Login</th><th>ensure</th><th>passwordSecret</th></tr></thead>
      <tbody>
        <tr *ngFor="let r of svc.managedRoles()">
          <td class="os-mono">{{ r.name }}</td>
          <td>{{ r.login ? '✓' : '—' }}</td>
          <td>{{ r.ensure || 'present' }}</td>
          <td class="os-mono">{{ r.passwordSecret?.name || '—' }}</td>
        </tr>
      </tbody>
    </table>
    <ng-template #noRoles>
      <clr-alert clrAlertType="info" [clrAlertClosable]="false" [clrAlertLightweight]="true">
        <clr-alert-item><span class="alert-text">관리 role 없음 — PostgresClaim 발급 시 owner role이 <code>spec.managed.roles</code>에 집계됩니다.</span></clr-alert-item>
      </clr-alert>
    </ng-template>
  `,
})
export class PgDatabasesTab {
  readonly svc = inject(CnpgService);
  appliedLabel(d: any): string {
    if (d.status?.applied === true) { return 'applied'; }
    if (d.status?.applied === false) { return 'failed'; }
    return 'pending';
  }
}
