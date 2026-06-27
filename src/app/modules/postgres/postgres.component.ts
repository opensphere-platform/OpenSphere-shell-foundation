import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { CnpgService } from './cnpg.service';
import { PILL } from './cnpg.types';
import { ViewRouter } from '../../view-router';
import { PgOverviewTab } from './tabs/pg-overview.tab';
import { PgTopologyTab } from './tabs/pg-topology.tab';
import { PgConfigTab } from './tabs/pg-config.tab';
import { PgDatabasesTab } from './tabs/pg-databases.tab';
import { PgBackupsTab } from './tabs/pg-backups.tab';
import { PgEventsTab } from './tabs/pg-events.tab';
import { PgClaimsTab } from './tabs/pg-claims.tab';

type Tab = 'overview' | 'topology' | 'config' | 'databases' | 'backups' | 'events' | 'claims';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'topology', label: 'Topology' },
  { id: 'config', label: 'Configuration' },
  { id: 'databases', label: 'Databases & Roles' },
  { id: 'backups', label: 'Backups' },
  { id: 'events', label: 'Events' },
  { id: 'claims', label: 'Claims' },
];

// PostgreSQL 콘솔 컨테이너 — 상태 없는 탭 셸. 데이터·폴링은 전부 CnpgService(단일 폴러).
@Component({
  selector: 'app-postgres',
  standalone: true,
  imports: [CommonModule, PgOverviewTab, PgTopologyTab, PgConfigTab, PgDatabasesTab, PgBackupsTab, PgEventsTab, PgClaimsTab],
  template: `
    <div class="mod-h">
      <h2>PostgreSQL <span class="tag tag-plugin">plugin</span></h2>
      <span class="pill" [ngClass]="pillCls()">{{ svc.phase() }}</span>
      <label class="auto-tog" style="margin-left:auto">
        <input type="checkbox" [checked]="svc.autoRefresh()" (change)="svc.toggleAuto()"> auto 15s
      </label>
      <button class="rbtn" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
    </div>
    <p class="muted">공용 관계형 DB capability · CloudNativePG · {{ svc.name }} · ns {{ svc.ns }}<span *ngIf="svc.lastSync()"> · {{ svc.lastSync() }}</span></p>

    <div class="tabs" role="tablist">
      <button class="tab" *ngFor="let t of tabs" [class.on]="tab() === t.id" (click)="vr.setTab(t.id)"
              role="tab" [attr.aria-selected]="tab() === t.id">
        {{ t.label }}<span class="badge-mod" *ngIf="badge(t.id)">{{ badge(t.id) }}</span>
      </button>
    </div>

    <pg-overview *ngIf="tab() === 'overview'" (jump)="vr.setTab($event)"></pg-overview>
    <pg-topology *ngIf="tab() === 'topology'"></pg-topology>
    <pg-config *ngIf="tab() === 'config'"></pg-config>
    <pg-databases *ngIf="tab() === 'databases'"></pg-databases>
    <pg-backups *ngIf="tab() === 'backups'"></pg-backups>
    <pg-events *ngIf="tab() === 'events'"></pg-events>
    <pg-claims *ngIf="tab() === 'claims'"></pg-claims>
  `,
})
export class PostgresComponent implements OnInit, OnDestroy {
  readonly svc = inject(CnpgService);
  readonly vr = inject(ViewRouter);
  readonly tabs = TABS;
  readonly tab = computed<Tab>(() => {
    const t = this.vr.tab();
    return this.tabs.some((x) => x.id === t) ? (t as Tab) : 'overview';
  });

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }

  pillCls(): string { return PILL[this.svc.phaseCls()]; }

  badge(id: Tab): string {
    if (id === 'databases') { const n = this.svc.databases().length + this.svc.managedRoles().length; return n ? String(n) : ''; }
    if (id === 'backups') { return this.svc.backups().length ? String(this.svc.backups().length) : ''; }
    if (id === 'events') { const w = this.svc.events().filter((e: any) => e.type === 'Warning').length; return w ? String(w) : ''; }
    return '';
  }
}
