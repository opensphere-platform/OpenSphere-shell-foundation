import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import ListBoxes16 from '@carbon/icons/es/list--boxes/16';
import Catalog16 from '@carbon/icons/es/catalog/16';
import DataAdd16 from '@carbon/icons/es/data--add/16';
import Settings16 from '@carbon/icons/es/settings/16';
import Renew16 from '@carbon/icons/es/renew/16';
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
  stackSeparator?: '/' | '·';
  managementActions?: boolean;
  fleetActionLabel?: string;
  catalogActionLabel?: string;
  provisioningActionLabel?: string;
  operatorActionLabel?: string;
}

export interface PluginPageTab {
  id: string;
  label: string;
  disabled?: boolean;
  badge?: string | number;
}

export interface PluginHeaderOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export type PluginManagementActionId = 'cluster' | 'config' | 'claims' | 'operator';

/**
 * PostgreSQL이 확립한 PFSS 머리글의 운영 컨텍스트 계약.
 * Namespace, 선택 리소스, 추가/갱신 및 상위 관리 작업을 이 컴포넌트가
 * 직접 렌더링하여 모듈별 DOM/CSS 복제를 금지한다.
 */
export interface PluginHeaderContextModel {
  namespace: string;
  namespaces?: PluginHeaderOption[];
  resourceLabel?: string;
  resource?: string;
  resources?: PluginHeaderOption[];
  routeBase?: string;
  activeManagement?: PfsPluginTabId | '';
  allowNamespaceAdd?: boolean;
  refreshDisabled?: boolean;
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

/** PostgreSQL plugin이 확립한 PFSS 상세 화면 계약. 관리 작업은 header action으로 분리한다. */
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
 * PostgreSQL이 확립한 PFSS plugin 페이지 머리/메타 계약의 단일 구현.
 * 엔진별 차이는 model 값으로만 표현하고 레이아웃은 분기하지 않는다.
 */
@Component({
  selector: 'osp-plugin-page-header',
  standalone: true,
  imports: [CommonModule, FormsModule, ClarityModule, CarbonIcon],
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
          <span class="vl-eyebrow">{{ model.stack || 'PFSS' }} {{ model.stackSeparator || '/' }} {{ model.capability }}</span>
          <h1 [id]="headingId">{{ model.name }}</h1>
          <p>{{ model.description }}</p>
        </div>
      </div>
      <dl class="pfs-plugin-release">
        <div><dt>Lifecycle</dt><dd><span class="label" [ngClass]="model.lifecycleClass || 'label-warning'">{{ model.lifecycle }}</span></dd></div>
        <div><dt>{{ model.versionLabel || 'Version' }}</dt><dd>{{ model.version }}</dd></div>
        <div><dt>Profile</dt><dd>{{ model.profile }}</dd></div>
        <div class="pgp-header-tools">
          <nav *ngIf="model.managementActions !== false" class="pgp-management-actions pgp-management-actions--header" aria-label="플랫폼 관리 작업">
            <button *ngIf="model.managedFleet" type="button" class="pgp-management-action" [title]="model.fleetActionLabel || '전체 서비스'" [attr.aria-label]="model.fleetActionLabel || '전체 서비스'" [attr.aria-current]="context?.activeManagement === 'cluster' ? 'page' : null" [class.active]="context?.activeManagement === 'cluster'" (click)="selectManagement('cluster')"><os-cicon [icon]="iFleet" [size]="16" /><span>{{ model.fleetActionLabel || '전체 서비스' }}</span></button>
            <button type="button" class="pgp-management-action" [title]="model.catalogActionLabel || '설정 카탈로그'" [attr.aria-label]="model.catalogActionLabel || '설정 카탈로그'" [attr.aria-current]="context?.activeManagement === 'config' ? 'page' : null" [class.active]="context?.activeManagement === 'config'" (click)="selectManagement('config')"><os-cicon [icon]="iCatalog" [size]="16" /><span>{{ model.catalogActionLabel || '설정 카탈로그' }}</span></button>
            <button type="button" class="pgp-management-action pgp-management-action--primary" [title]="model.provisioningActionLabel || '서비스 생성'" [attr.aria-label]="model.provisioningActionLabel || '서비스 생성'" [attr.aria-current]="context?.activeManagement === 'claims' ? 'page' : null" [class.active]="context?.activeManagement === 'claims'" (click)="selectManagement('claims')"><os-cicon [icon]="iProvisioning" [size]="16" /><span>{{ model.provisioningActionLabel || '서비스 생성' }}</span></button>
            <button type="button" class="pgp-management-action" [title]="model.operatorActionLabel || '엔진 관리'" [attr.aria-label]="model.operatorActionLabel || '엔진 관리'" [attr.aria-current]="context?.activeManagement === 'operator' ? 'page' : null" [class.active]="context?.activeManagement === 'operator'" (click)="selectManagement('operator')"><os-cicon [icon]="iOperator" [size]="16" /><span>{{ model.operatorActionLabel || '엔진 관리' }}</span></button>
          </nav>
          <div class="pgp-header-context" aria-label="PFSS 운영 컨텍스트">
            <div class="pgp-header-context-unit">
              <clr-select-container class="pgp-header-context-field">
                <label>Namespace</label>
                <select clrSelect name="pfssHeaderNamespace" aria-label="Namespace 선택" [ngModel]="selectedNamespace()" (ngModelChange)="namespaceSelected.emit($event)">
                  <option *ngFor="let option of namespaceOptions()" [ngValue]="option.value" [disabled]="option.disabled">{{ option.label }}</option>
                </select>
              </clr-select-container>
              <button *ngIf="context?.allowNamespaceAdd !== false" class="btn btn-sm btn-link pgp-header-context-action" type="button" aria-label="Namespace 추가" title="Namespace 추가" (click)="addNamespace()">추가</button>
            </div>
            <div class="pgp-header-context-unit">
              <clr-select-container class="pgp-header-context-field" *ngIf="resourceOptions().length">
                <label>{{ context?.resourceLabel || '서비스' }}</label>
                <select clrSelect name="pfssHeaderResource" [attr.aria-label]="(context?.resourceLabel || '서비스') + ' 선택'" [ngModel]="context?.resource || ''" (ngModelChange)="resourceSelected.emit($event)">
                  <option *ngFor="let option of resourceOptions()" [ngValue]="option.value" [disabled]="option.disabled">{{ option.label }}</option>
                </select>
              </clr-select-container>
              <button class="btn btn-sm btn-link pgp-header-context-refresh" type="button" aria-label="운영 컨텍스트 새로고침" title="새로고침" [disabled]="context?.refreshDisabled" (click)="refreshRequested.emit()"><os-cicon [icon]="iRenew" [size]="16" /></button>
            </div>
          </div>
        </div>
      </dl>
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
  `],
})
export class PluginPageHeaderComponent {
  readonly iFleet = ListBoxes16;
  readonly iCatalog = Catalog16;
  readonly iProvisioning = DataAdd16;
  readonly iOperator = Settings16;
  readonly iRenew = Renew16;
  @Input({ required: true }) model!: PluginPageHeaderModel;
  @Input() context?: PluginHeaderContextModel;
  @Input() headingId = 'pfs-plugin-page-title';
  @Output() readonly managementSelected = new EventEmitter<PluginManagementActionId>();
  @Output() readonly namespaceSelected = new EventEmitter<string>();
  @Output() readonly resourceSelected = new EventEmitter<string>();
  @Output() readonly namespaceAdd = new EventEmitter<void>();
  @Output() readonly refreshRequested = new EventEmitter<void>();

  selectedNamespace(): string { return this.context?.namespace || this.model.namespace || 'opensphere-foundation'; }
  namespaceOptions(): PluginHeaderOption[] {
    return this.context?.namespaces?.length
      ? this.context.namespaces
      : [{ value: this.selectedNamespace(), label: this.selectedNamespace() }];
  }
  resourceOptions(): PluginHeaderOption[] { return this.context?.resources || []; }
  selectManagement(tab: PluginManagementActionId): void { this.managementSelected.emit(tab); }
  addNamespace(): void { this.namespaceAdd.emit(); this.managementSelected.emit('claims'); }
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
