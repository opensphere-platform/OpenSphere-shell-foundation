import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { CnpgService } from '../cnpg.service';
import { PgState } from '../ui/pg-state';

@Component({
  selector: 'pg-databases',
  standalone: true,
  imports: [CommonModule, PgState],
  template: `
    <div class="sec-h">Databases (CNPG Database CR)</div>
    <pg-state [state]="svc.dbState()" hint="선언된 Database 없음" sub="Claims 탭에서 PostgresClaim으로 전용 DB를 발급하세요." (retry)="svc.refresh()">
      <table class="tbl">
        <thead><tr><th>CR 이름</th><th>DB</th><th>Owner</th><th>적용</th></tr></thead>
        <tbody>
          <tr *ngFor="let d of svc.databases()">
            <td class="mono">{{ d.metadata?.name }}</td>
            <td class="mono">{{ d.spec?.name }}</td>
            <td class="mono">{{ d.spec?.owner }}</td>
            <td><span class="pill" [class.ok]="d.status?.applied === true" [class.bad]="d.status?.applied === false">{{ appliedLabel(d) }}</span></td>
          </tr>
        </tbody>
      </table>
    </pg-state>

    <div class="sec-h">Managed Roles</div>
    <table class="tbl" *ngIf="svc.managedRoles().length; else noRoles">
      <thead><tr><th>Role</th><th>Login</th><th>ensure</th><th>passwordSecret</th></tr></thead>
      <tbody>
        <tr *ngFor="let r of svc.managedRoles()">
          <td class="mono">{{ r.name }}</td>
          <td>{{ r.login ? '✓' : '—' }}</td>
          <td>{{ r.ensure || 'present' }}</td>
          <td class="mono">{{ r.passwordSecret?.name || '—' }}</td>
        </tr>
      </tbody>
    </table>
    <ng-template #noRoles>
      <div class="empty">관리 role 없음 — PostgresClaim 발급 시 owner role이 <code>spec.managed.roles</code>에 집계됩니다.</div>
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
