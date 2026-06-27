import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { OsService } from './os.service';
import { PILL } from './os.types';
import { ViewRouter } from '../../view-router';
import { OsOverviewTab } from './tabs/os-overview.tab';
import { OsNodesTab } from './tabs/os-nodes.tab';
import { OsIndicesTab } from './tabs/os-indices.tab';
import { OsShardsTab } from './tabs/os-shards.tab';
import { OsTemplatesTab } from './tabs/os-templates.tab';
import { OsTasksTab } from './tabs/os-tasks.tab';
import { OsClaimsTab } from './tabs/os-claims.tab';

type Tab = 'overview' | 'nodes' | 'indices' | 'shards' | 'templates' | 'tasks' | 'claims';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'indices', label: 'Indices' },
  { id: 'shards', label: 'Shards' },
  { id: 'templates', label: 'Templates & Aliases' },
  { id: 'tasks', label: 'Tasks & Settings' },
  { id: 'claims', label: 'Claims' },
];

// OpenSearch 콘솔 컨테이너 — 상태없는 탭 셸(PG 콘솔과 동급 구조). 데이터·폴링은 OsService.
@Component({
  selector: 'app-opensearch',
  standalone: true,
  imports: [CommonModule, OsOverviewTab, OsNodesTab, OsIndicesTab, OsShardsTab, OsTemplatesTab, OsTasksTab, OsClaimsTab],
  template: `
    <div class="os-title-row">
      <h2 class="os-h2">OpenSearch <span class="label label-info">plugin</span></h2>
      <span class="label" [ngClass]="pillCls()">{{ svc.status() || '확인 중' }}</span>
      <label class="clr-control-label os-ml-auto">
        <input type="checkbox" class="clr-checkbox" [checked]="svc.autoRefresh()" (change)="svc.toggleAuto()"> auto 15s
      </label>
      <button class="btn btn-sm" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
    </div>
    <p class="os-sub">공용 검색/인덱스 capability · OpenSearch (single-node dev) · {{ svc.endpoint }}<span *ngIf="svc.lastSync()"> · {{ svc.lastSync() }}</span></p>

    <ul class="nav" role="tablist">
      <li class="nav-item" *ngFor="let t of tabs">
        <button class="btn btn-link nav-link" [class.active]="tab() === t.id" (click)="vr.setTab(t.id)" type="button"
                role="tab" [attr.aria-selected]="tab() === t.id">
          {{ t.label }}<span class="label" *ngIf="badge(t.id)">{{ badge(t.id) }}</span>
        </button>
      </li>
    </ul>

    <os-overview *ngIf="tab() === 'overview'" (jump)="vr.setTab($event)"></os-overview>
    <os-nodes *ngIf="tab() === 'nodes'"></os-nodes>
    <os-indices *ngIf="tab() === 'indices'"></os-indices>
    <os-shards *ngIf="tab() === 'shards'"></os-shards>
    <os-templates *ngIf="tab() === 'templates'"></os-templates>
    <os-tasks *ngIf="tab() === 'tasks'"></os-tasks>
    <os-claims *ngIf="tab() === 'claims'"></os-claims>
  `,
})
export class OpenSearchComponent {
  readonly svc = inject(OsService);
  readonly vr = inject(ViewRouter);
  readonly tabs = TABS;
  readonly tab = computed<Tab>(() => {
    const t = this.vr.tab();
    return this.tabs.some((x) => x.id === t) ? (t as Tab) : 'overview';
  });

  // 폴러 라이프사이클은 shell(FoundationRegistryService)이 소유 — 콘솔은 구독만.
  pillCls(): string { return PILL[this.svc.statusPhase()]; }

  badge(id: Tab): string {
    if (id === 'nodes') { return this.svc.nodeCount() ? String(this.svc.nodeCount()) : ''; }
    if (id === 'indices') { return this.svc.indexCount() ? String(this.svc.indexCount()) : ''; }
    if (id === 'shards') { const u = this.svc.unassigned(); return u ? String(u) : ''; }
    if (id === 'tasks') { return this.svc.pendingTasks() ? String(this.svc.pendingTasks()) : ''; }
    return '';
  }
}
