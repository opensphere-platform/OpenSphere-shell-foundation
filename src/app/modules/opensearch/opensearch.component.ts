import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { OsService } from './os.service';
import { PILL } from './os.types';
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
    <div class="mod-h">
      <h2>OpenSearch <span class="tag tag-plugin">plugin</span></h2>
      <span class="pill" [ngClass]="pillCls()">{{ svc.status() || '확인 중' }}</span>
      <label class="auto-tog" style="margin-left:auto">
        <input type="checkbox" [checked]="svc.autoRefresh()" (change)="svc.toggleAuto()"> auto 15s
      </label>
      <button class="rbtn" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
    </div>
    <p class="muted">공용 검색/인덱스 capability · OpenSearch (single-node dev) · {{ svc.endpoint }}<span *ngIf="svc.lastSync()"> · {{ svc.lastSync() }}</span></p>

    <div class="tabs" role="tablist">
      <button class="tab" *ngFor="let t of tabs" [class.on]="tab() === t.id" (click)="tab.set(t.id)"
              role="tab" [attr.aria-selected]="tab() === t.id">
        {{ t.label }}<span class="badge-mod" *ngIf="badge(t.id)">{{ badge(t.id) }}</span>
      </button>
    </div>

    <os-overview *ngIf="tab() === 'overview'" (jump)="tab.set($any($event))"></os-overview>
    <os-nodes *ngIf="tab() === 'nodes'"></os-nodes>
    <os-indices *ngIf="tab() === 'indices'"></os-indices>
    <os-shards *ngIf="tab() === 'shards'"></os-shards>
    <os-templates *ngIf="tab() === 'templates'"></os-templates>
    <os-tasks *ngIf="tab() === 'tasks'"></os-tasks>
    <os-claims *ngIf="tab() === 'claims'"></os-claims>
  `,
})
export class OpenSearchComponent implements OnInit, OnDestroy {
  readonly svc = inject(OsService);
  readonly tabs = TABS;
  readonly tab = signal<Tab>('overview');

  ngOnInit(): void { this.svc.start(); }
  ngOnDestroy(): void { this.svc.stop(); }

  pillCls(): string { return PILL[this.svc.statusPhase()]; }

  badge(id: Tab): string {
    if (id === 'nodes') { return this.svc.nodeCount() ? String(this.svc.nodeCount()) : ''; }
    if (id === 'indices') { return this.svc.indexCount() ? String(this.svc.indexCount()) : ''; }
    if (id === 'shards') { const u = this.svc.unassigned(); return u ? String(u) : ''; }
    if (id === 'tasks') { return this.svc.pendingTasks() ? String(this.svc.pendingTasks()) : ''; }
    return '';
  }
}
