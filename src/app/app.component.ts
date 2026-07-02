import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { PostgresComponent } from './modules/postgres/postgres.component';
import { OpenSearchComponent } from './modules/opensearch/opensearch.component';
import { RustfsComponent } from './modules/rustfs/rustfs.component';
import { KeycloakComponent } from './modules/identity/keycloak.component';
import { SambaComponent } from './modules/identity/samba.component';
import { FoundationOverviewComponent } from './foundation/overview.component';
import { FoundationAdminComponent } from './foundation/plugins-admin.component';
import { FoundationRegistryService } from './registry/foundation-registry.service';
import { HostedPlugin } from './registry/hosted-plugin';
import { ViewRouter } from './view-router';
import { OsIcon } from './os-icon';

interface NavGroup { id: string; label: string; iconKey: string; children: HostedPlugin[] }

// Foundation subShell — plugin 호스팅 shell(§2.7). 크롬(2단 내비·breadcrumb·라우팅)은 SDK 정본
// OpenSphere-shell-template와 동일 패턴: 흰 clr-vertical-nav(.cm-nav, 12rem grid, 왼쪽 blue bar),
// 상단 회색 breadcrumb 바, 경로 세그먼트 라우팅(/p/foundation/<module> + pushState).
// **디자인 시스템 = Clarity 단일**(Carbon 미사용). 아이콘=clrVerticalNavIcon+인라인SVG, 표=clr-datagrid, 트리=clr-tree/clr-vertical-nav-group.
// 좌 내비 = capability 모듈(Data/Identity)을 clr-vertical-nav-group 트리로, 엔진은 그 자식(registry 파생·활성만).
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ClarityModule, OsIcon, PostgresComponent, OpenSearchComponent, RustfsComponent, KeycloakComponent, SambaComponent, FoundationOverviewComponent, FoundationAdminComponent],
  encapsulation: ViewEncapsulation.ShadowDom,
  styleUrls: ['./app.component.css'],
  styles: [`
    .os-shell { display: grid; grid-template-columns: 12rem minmax(0, 1fr); min-height: 100%; }

    /* 2단 표준(.cm-nav) — AI Hub / shell-template 정본. 흰 배경 + 왼쪽 blue bar active. */
    .cm-nav { min-height: 100vh; background: #fff; --clr-vertical-nav-bg-color: #ffffff; }
    .cm-nav .clr-vertical-nav, .cm-nav .nav-content { background: #fff; }
    .cm-nav .nav-group, .cm-nav .nav-group-content, .cm-nav .nav-group-children { background: transparent; }
    .cm-nav a[clrVerticalNavLink], .cm-nav .nav-link, .cm-nav .nav-trigger { color: #525252; font-size: 0.8rem; }
    .cm-nav a[clrVerticalNavLink]:hover, .cm-nav .nav-link:hover, .cm-nav .nav-trigger:hover { color: #161616; background: rgba(0,0,0,0.04); }
    .cm-nav a[clrVerticalNavLink]::before, .cm-nav .nav-link::before { display: none !important; content: none !important; }
    .cm-nav a[clrVerticalNavLink].active, .cm-nav .nav-link.active {
      color: #161616; font-weight: 600; background: rgba(76,111,255,0.10); box-shadow: inset 3px 0 0 #4c6fff;
    }
    .cm-brand { display: flex; align-items: center; gap: 0.4rem; min-height: 3.05rem; padding: 0.55rem 0.9rem; border-bottom: 1px solid #e0e0e0; }
    .cm-brand strong { font-size: 0.875rem; font-weight: 600; color: #161616; }

    .os-content { min-width: 0; min-height: 100vh; overflow: auto; padding: 1.1rem 1.4rem 2rem; background: var(--os-overview-bg, #f4f4f4); }
    .os-tree-ic { width: 16px; height: 16px; fill: currentColor; }

    /* 페이지 경로 — AI Hub 표준: 상단 회색 박스 바(좌우 풀폭). */
    .cc-crumbs {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; min-height: 2rem;
      margin: -1.1rem -1.4rem 0.9rem; padding: 0.45rem 1.4rem;
      background: #f4f4f4; border-top: 1px solid #d0d0d0; border-bottom: 1px solid #d0d0d0;
      font-size: 0.8125rem; line-height: 1rem;
    }
    .cc-crumb { color: #525252; }
    .cc-crumb-link { color: #4c6fff; text-decoration: none; cursor: pointer; }
    .cc-crumb-link:hover { text-decoration: underline; }
    .cc-crumb.is-cur { color: #525252; } .cc-crumb-sep { color: #8c8c8c; }
  `],
  template: `
    <div class="os-shell">
      <clr-vertical-nav class="cm-nav" [clrVerticalNavCollapsible]="false" aria-label="Foundation 보조 내비">
        <div class="cm-brand"><strong>Foundation</strong></div>

        <a clrVerticalNavLink [class.active]="vr.module() === 'overview'" (click)="go('overview')" (keydown.enter)="go('overview')">
          <os-icon clrVerticalNavIcon class="os-tree-ic" name="overview" [size]="16"/>Overview
        </a>
        <a clrVerticalNavLink [class.active]="vr.module() === 'plugins'" (click)="go('plugins')" (keydown.enter)="go('plugins')">
          <os-icon clrVerticalNavIcon class="os-tree-ic" name="plugins" [size]="16"/>Plugins 관리
        </a>

        <clr-vertical-nav-group *ngFor="let g of groups()"
            [clrVerticalNavGroupExpanded]="isOpen(g.id)" (clrVerticalNavGroupExpandedChange)="setOpen(g.id, $event)">
          <os-icon clrVerticalNavIcon class="os-tree-ic" [name]="g.iconKey" [size]="16"/>{{ g.label }}
          <clr-vertical-nav-group-children>
            <!-- 깊이 1(그룹 자식)은 아이콘 없이 들여쓴 텍스트 — shell-template/AI Hub 표준(아이콘=깊이 0만). -->
            <a *ngFor="let c of g.children" clrVerticalNavLink
               [class.active]="vr.module() === c.id" (click)="go(c.id)" (keydown.enter)="go(c.id)">{{ c.name }}</a>
          </clr-vertical-nav-group-children>
        </clr-vertical-nav-group>
      </clr-vertical-nav>

      <section class="os-content">
        <nav class="cc-crumbs" aria-label="페이지 경로">
          <ng-container *ngFor="let c of crumbs(); let last = last">
            <a *ngIf="c.link === 'home'" class="cc-crumb cc-crumb-link" href="/">{{ c.label }}</a>
            <a *ngIf="c.link === 'overview'" class="cc-crumb cc-crumb-link" (click)="go('overview')">{{ c.label }}</a>
            <span *ngIf="!c.link" class="cc-crumb is-cur">{{ c.label }}</span>
            <span class="cc-crumb-sep" *ngIf="!last">/</span>
          </ng-container>
        </nav>

        <app-foundation-overview *ngIf="vr.module() === 'overview'"></app-foundation-overview>
        <app-foundation-admin *ngIf="vr.module() === 'plugins'"></app-foundation-admin>
        <app-postgres *ngIf="vr.module() === 'postgres' && reg.isEnabled('postgres')"></app-postgres>
        <app-opensearch *ngIf="vr.module() === 'opensearch' && reg.isEnabled('opensearch')"></app-opensearch>
        <app-rustfs *ngIf="vr.module() === 'rustfs' && reg.isEnabled('rustfs')"></app-rustfs>
        <app-keycloak *ngIf="vr.module() === 'keycloak' && reg.isEnabled('keycloak')"></app-keycloak>
        <app-samba *ngIf="vr.module() === 'samba' && reg.isEnabled('samba')"></app-samba>
        <clr-alert *ngIf="disabledModule()" clrAlertType="warning" [clrAlertClosable]="false">
          <clr-alert-item><span class="alert-text">이 plugin은 비활성 상태입니다 — Plugins 관리에서 활성화하세요.</span></clr-alert-item>
        </clr-alert>
      </section>
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly vr = inject(ViewRouter);
  readonly reg = inject(FoundationRegistryService);

  private readonly openState = signal<Record<string, boolean>>({ data: true, identity: true });

  /** capability 모듈 트리 — 엔진(플러그인)을 capability 접두사로 그룹핑(활성만). Data/Identity 그룹. */
  readonly groups = computed<NavGroup[]>(() => {
    const en = this.reg.enabledPlugins();
    const pick = (prefix: string) => en.filter((p) => p.capability.startsWith(prefix));
    const out: NavGroup[] = [];
    const data = pick('data.');
    const identity = pick('identity.');
    if (data.length) out.push({ id: 'data', label: 'Data', iconKey: 'data', children: data });
    if (identity.length) out.push({ id: 'identity', label: 'Identity', iconKey: 'identity', children: identity });
    return out;
  });

  isOpen(id: string): boolean { return !!this.openState()[id]; }
  setOpen(id: string, v: boolean): void { this.openState.update((m) => ({ ...m, [id]: v })); }

  ngOnInit(): void { this.reg.start(); }
  ngOnDestroy(): void { this.reg.stop(); }

  go(id: string): void { this.vr.setModule(id); }

  disabledModule(): boolean {
    const m = this.vr.module();
    return ['postgres', 'opensearch', 'rustfs', 'keycloak', 'samba'].includes(m) && !this.reg.isEnabled(m);
  }

  private label(id: string): string {
    if (id === 'overview') return 'Overview';
    if (id === 'plugins') return 'Plugins 관리';
    const p = this.reg.all.find((x) => x.id === id);
    return p ? p.name : id;
  }

  /** 그룹 라벨(모듈이 어느 capability 그룹인지) — breadcrumb 3단용. */
  private groupLabel(id: string): string | null {
    for (const g of this.groups()) if (g.children.some((c) => c.id === id)) return g.label;
    return null;
  }

  /** 페이지 경로 — OpenSphere / Foundation / [Data|Identity] / <현재>. */
  readonly crumbs = computed<{ label: string; link: 'home' | 'overview' | null }[]>(() => {
    const id = this.vr.module();
    const out: { label: string; link: 'home' | 'overview' | null }[] = [{ label: 'OpenSphere', link: 'home' }];
    if (id === 'overview') { out.push({ label: 'Foundation', link: null }); return out; }
    out.push({ label: 'Foundation', link: 'overview' });
    const g = this.groupLabel(id);
    if (g) out.push({ label: g, link: null });
    out.push({ label: this.label(id), link: null });
    return out;
  });
}
