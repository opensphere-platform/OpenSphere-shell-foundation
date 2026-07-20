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
    <nav class="pfs-plugin-tabs" [attr.aria-label]="ariaLabel" role="tablist" aria-orientation="horizontal">
      <button *ngFor="let tab of tabs" type="button" class="pfs-plugin-tab"
        role="tab" [attr.aria-selected]="active === tab.id" [attr.tabindex]="active === tab.id ? 0 : -1"
        [attr.aria-label]="tab.disabled ? tab.label + ' — 선행 설치 단계 완료 후 사용 가능' : tab.label"
        [attr.title]="tab.disabled ? '선행 설치 단계 완료 후 사용 가능' : null"
        [class.active]="active === tab.id" [disabled]="tab.disabled"
        (click)="selected.emit(tab.id)" (keydown)="onKeydown($event, tab.id)">
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

  onKeydown(event: KeyboardEvent, currentId: string): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const enabled = this.tabs.filter((tab) => !tab.disabled);
    const current = enabled.findIndex((tab) => tab.id === currentId);
    if (current < 0 || !enabled.length) return;
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % enabled.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = enabled.length - 1;
    event.preventDefault();
    const targetId = enabled[next].id;
    const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)');
    buttons?.[next]?.focus();
    this.selected.emit(targetId);
  }
}
