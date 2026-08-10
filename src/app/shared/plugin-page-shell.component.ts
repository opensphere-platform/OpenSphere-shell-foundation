import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import ListBoxes16 from '@carbon/icons/es/list--boxes/16';
import Catalog16 from '@carbon/icons/es/catalog/16';
import DataAdd16 from '@carbon/icons/es/data--add/16';
import Settings16 from '@carbon/icons/es/settings/16';
import { CarbonIcon } from '../carbon-icon';

export interface PluginPageHeaderModel {
  name: string;
  logo: string;
  logos?: Array<{ src: string; alt: string }>;
  monogram?: string;
  stack?: string;
  capability: string;
  description: string;
  lifecycle: string;
  lifecycleClass?: string;
  versionLabel?: string;
  version: string;
  profile: string;
  namespace?: string;
  managedFleet?: boolean;
}

export interface PluginPageTab {
  id: string;
  label: string;
  disabled?: boolean;
  badge?: string | number;
}

/** Platform Delivery 엔진의 관리자 과업 중심 상세 화면 계약. */
export type DeliveryAdminTabId =
  | 'overview' | 'prerequisites' | 'install' | 'resources'
  | 'configuration' | 'security' | 'upgrade' | 'events';

export function deliveryAdminTabs(resourceLabel: string): PluginPageTab[] {
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'prerequisites', label: 'Prerequisites' },
    { id: 'install', label: 'Install & Repair' },
    { id: 'resources', label: resourceLabel },
    { id: 'configuration', label: 'Configuration' },
    { id: 'security', label: 'Security & Policy' },
    { id: 'upgrade', label: 'Upgrade & Rollback' },
    { id: 'events', label: 'Events & Audit' },
  ];
}

/** PostgreSQL plugin이 확립한 PFS 상세 화면 계약. 관리 작업은 header action으로 분리한다. */
export type PfsPluginTabId =
  | 'overview' | 'monitoring' | 'topology' | 'domain' | 'backups'
  | 'upgrade' | 'events' | 'documentation'
  | 'operator' | 'cluster' | 'config' | 'claims';

export function pfsPluginTabs(domainLabel: string): PluginPageTab[] {
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'topology', label: 'Topology' },
    { id: 'domain', label: domainLabel },
    { id: 'backups', label: 'Data Protection' },
    { id: 'upgrade', label: 'Operations' },
    { id: 'events', label: 'Events' },
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
  imports: [CommonModule, CarbonIcon],
  template: `
    <section class="pfs-plugin-head" [attr.aria-labelledby]="headingId">
      <div class="pfs-plugin-brand">
        <div class="pfs-plugin-logo" [class.pfs-plugin-logo-pair]="model.logos?.length">
          <ng-container *ngIf="model.logos?.length; else singleLogo">
            <img *ngFor="let logo of model.logos" [src]="logo.src" [alt]="logo.alt" />
          </ng-container>
          <ng-template #singleLogo>
            <img *ngIf="model.logo" [src]="model.logo" [alt]="model.name" />
            <span *ngIf="!model.logo" class="pfs-plugin-monogram">{{ model.monogram || model.name.slice(0, 2) }}</span>
          </ng-template>
        </div>
        <div>
          <span class="vl-eyebrow">{{ model.stack || 'PFS' }} · {{ model.capability }}</span>
          <h1 [id]="headingId">{{ model.name }}</h1>
          <p>{{ model.description }}</p>
        </div>
      </div>
      <dl class="pfs-plugin-release">
        <div><dt>Lifecycle</dt><dd><span class="label" [ngClass]="model.lifecycleClass || 'label-warning'">{{ model.lifecycle }}</span></dd></div>
        <div><dt>{{ model.versionLabel || 'Version' }}</dt><dd>{{ model.version }}</dd></div>
        <div><dt>Profile</dt><dd>{{ model.profile }}</dd></div>
        <div *ngIf="model.namespace"><dt>Namespace</dt><dd class="os-mono">{{ model.namespace }}</dd></div>
        <ng-content select="[pluginHeaderContext]" />
      </dl>
      <nav class="pfs-operator-actions" aria-label="플랫폼 관리 작업">
        <button *ngIf="model.managedFleet" type="button" title="Fleet" aria-label="Fleet" (click)="managementSelected.emit('cluster')"><os-cicon [icon]="iFleet" [size]="16" /></button>
        <button type="button" title="Profiles" aria-label="Profiles" (click)="managementSelected.emit('config')"><os-cicon [icon]="iCatalog" [size]="16" /></button>
        <button type="button" title="Provisioning" aria-label="Provisioning" (click)="managementSelected.emit('claims')"><os-cicon [icon]="iProvisioning" [size]="16" /></button>
        <button type="button" title="Operator" aria-label="Operator" (click)="managementSelected.emit('operator')"><os-cicon [icon]="iOperator" [size]="16" /></button>
      </nav>
    </section>
  `,
  styles: [`
    .pfs-plugin-logo-pair {
      width: auto;
      min-width: 3.4rem;
      padding: 0.28rem 0.38rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.28rem;
    }
    .pfs-plugin-logo-pair img {
      width: 1.35rem;
      height: 1.35rem;
      object-fit: contain;
      flex: 0 0 auto;
    }
    .pfs-plugin-head { position: relative; }
    .pfs-operator-actions {
      position: absolute;
      right: .8rem;
      top: .55rem;
      display: flex;
      gap: .15rem;
    }
    .pfs-operator-actions button {
      width: 2rem;
      height: 2rem;
      border: 0;
      background: transparent;
      color: #7b1fa2;
      cursor: pointer;
      font-size: 1rem;
    }
    .pfs-operator-actions button:hover,
    .pfs-operator-actions button:focus-visible { background: #f4eafa; }
    @media (max-width: 760px) {
      .pfs-plugin-brand { padding-top: 2.25rem; }
    }
  `],
})
export class PluginPageHeaderComponent {
  readonly iFleet = ListBoxes16;
  readonly iCatalog = Catalog16;
  readonly iProvisioning = DataAdd16;
  readonly iOperator = Settings16;
  @Input({ required: true }) model!: PluginPageHeaderModel;
  @Input() headingId = 'pfs-plugin-page-title';
  @Output() readonly managementSelected = new EventEmitter<PfsPluginTabId>();
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
