import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface PluginPageHeaderModel {
  name: string;
  logo: string;
  monogram?: string;
  capability: string;
  description: string;
  lifecycle: string;
  lifecycleClass?: string;
  versionLabel?: string;
  version: string;
  profile: string;
  namespace: string;
}

export interface PluginPageTab {
  id: string;
  label: string;
  disabled?: boolean;
  badge?: string | number;
}

/** PostgreSQL plugin이 확립한 PFS 상세 화면의 정본 11탭 계약. */
export type PfsPluginTabId =
  | 'overview' | 'operator' | 'cluster' | 'topology' | 'config'
  | 'domain' | 'backups' | 'events' | 'claims' | 'upgrade' | 'documentation';

export function pfsPluginTabs(domainLabel: string): PluginPageTab[] {
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'operator', label: 'Operator' },
    { id: 'cluster', label: 'Cluster plan' },
    { id: 'topology', label: 'Topology' },
    { id: 'config', label: 'Configuration' },
    { id: 'domain', label: domainLabel },
    { id: 'backups', label: 'Backups' },
    { id: 'events', label: 'Events' },
    { id: 'claims', label: 'Claims' },
    { id: 'upgrade', label: 'Upgrade' },
    { id: 'documentation', label: 'Documentation' },
  ];
}

/**
 * PostgreSQL이 확립한 PFS plugin 페이지 머리/메타 계약의 단일 구현.
 * 엔진별 차이는 model 값으로만 표현하고 레이아웃은 분기하지 않는다.
 */
@Component({
  selector: 'osp-plugin-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="pfs-plugin-head" [attr.aria-labelledby]="headingId">
      <div class="pfs-plugin-brand">
        <div class="pfs-plugin-logo"><img *ngIf="model.logo" [src]="model.logo" [alt]="model.name" /><span *ngIf="!model.logo" class="pfs-plugin-monogram">{{ model.monogram || model.name.slice(0, 2) }}</span></div>
        <div>
          <span class="vl-eyebrow">PFS · {{ model.capability }}</span>
          <h1 [id]="headingId">{{ model.name }}</h1>
          <p>{{ model.description }}</p>
        </div>
      </div>
      <dl class="pfs-plugin-release">
        <div><dt>Lifecycle</dt><dd><span class="label" [ngClass]="model.lifecycleClass || 'label-warning'">{{ model.lifecycle }}</span></dd></div>
        <div><dt>{{ model.versionLabel || 'Version' }}</dt><dd>{{ model.version }}</dd></div>
        <div><dt>Profile</dt><dd>{{ model.profile }}</dd></div>
        <div><dt>Namespace</dt><dd class="os-mono">{{ model.namespace }}</dd></div>
      </dl>
    </section>
  `,
})
export class PluginPageHeaderComponent {
  @Input({ required: true }) model!: PluginPageHeaderModel;
  @Input() headingId = 'pfs-plugin-page-title';
}

@Component({
  selector: 'osp-plugin-tabs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <nav class="pfs-plugin-tabs" [attr.aria-label]="ariaLabel">
      <button *ngFor="let tab of tabs" type="button" class="pfs-plugin-tab"
        [class.active]="active === tab.id" [disabled]="tab.disabled" (click)="selected.emit(tab.id)">
        {{ tab.label }}<span *ngIf="tab.badge !== undefined && tab.badge !== '' && tab.badge !== 0" class="label">{{ tab.badge }}</span>
      </button>
    </nav>
  `,
})
export class PluginTabsComponent {
  @Input({ required: true }) tabs: PluginPageTab[] = [];
  @Input({ required: true }) active = 'overview';
  @Input() ariaLabel = 'Plugin 메뉴';
  @Output() readonly selected = new EventEmitter<string>();
}
