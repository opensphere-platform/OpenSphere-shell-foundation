import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { PostgresComponent } from './modules/postgres/postgres.component';
import { RustfsComponent } from './modules/rustfs/rustfs.component';
import { KeycloakComponent } from './modules/identity/keycloak.component';
import { FoundationOverviewComponent } from './foundation/overview.component';
import { FoundationConnectivityComponent } from './foundation/connectivity.component';
import { FoundationEnginesComponent } from './foundation/engines.component';
import { PlaceholderModuleComponent } from './foundation/placeholder-module.component';
import { PluginOutletComponent } from './foundation/plugin-outlet.component';
import { FoundationRegistryService } from './registry/foundation-registry.service';
import { ViewRouter } from './view-router';
import { CarbonIcon } from './carbon-icon';
import { HostedPlugin } from './registry/hosted-plugin';
import Home16 from '@carbon/icons/es/home/16';
import Db2Database16 from '@carbon/icons/es/db2--database/16';
import UserMultiple16 from '@carbon/icons/es/user--multiple/16';
import Search16 from '@carbon/icons/es/search/16';
import ObjectStorage16 from '@carbon/icons/es/object-storage/16';
import Password16 from '@carbon/icons/es/password/16';
import Network416 from '@carbon/icons/es/network--4/16';
import Cube16 from '@carbon/icons/es/cube/16';
import MachineLearningModel16 from '@carbon/icons/es/machine-learning-model/16';
import Chat16 from '@carbon/icons/es/chat/16';

// 좌 내비 아이콘 키 → Carbon 16px 디스크립터(os-cicon). AI Hub/shell-template/shell-base와 동일 방식
// (@carbon/icons SVG 디스크립터 + CarbonIcon 렌더러. cds-icon 웹컴포넌트가 아니라 크래시와 무관).
const ICON: Record<string, any> = {
  overview: Home16, bss: Network416, engines: Cube16,
  data: Db2Database16, db: Db2Database16, search: Search16, storage: ObjectStorage16,
  identity: UserMultiple16, users: UserMultiple16, key: Password16,
  ai: MachineLearningModel16, comm: Chat16,
};

interface NavChild { id: string; name: string; planned?: boolean }
interface NavGroup { id: string; label: string; iconKey: string; children: NavChild[]; planned?: boolean }

// AI/Comm은 아직 FOUNDATION_PLUGINS registry에 등록되지 않은 로드맵 도메인이라 정적 목록으로 노출.
// 실제 엔진이 배선되면 registry 엔트리로 승격하고 여기서 제거한다(2026-07-04).
const ROADMAP_GROUPS: NavGroup[] = [
  { id: 'ai', label: 'AI', iconKey: 'ai', planned: true, children: [
    { id: 'litellm', name: 'LiteLLM' }, { id: 'langfuse', name: 'Langfuse' },
  ] },
  { id: 'comm', label: 'Comm', iconKey: 'comm', planned: true, children: [
    { id: 'stalwart', name: 'Stalwart (JMAP)' }, { id: 'novu', name: 'Novu' }, { id: 'mattermost', name: 'Mattermost' },
  ] },
];

// Identity 그룹은 Keycloak/Samba-AD(live, registry 파생)에 Syncope(로드맵)를 얹은 혼합 그룹.
// ADR-FND-002: IGA 단일권위는 Syncope. 별도 SCIM gateway는 멤버가 아니라 Syncope 내장 SCIM 2.0 또는 얇은 connector로 수렴한다.
const IDENTITY_ROADMAP: NavChild[] = [{ id: 'syncope', name: 'Syncope (IGA)', planned: true }];

// 로드맵 모듈 id → placeholder 페이지에 넘길 메타(이름/로고/모노그램/도메인 eyebrow).
const ROADMAP_META: Record<string, { name: string; logo: string; mono: string; domain: string }> = {
  litellm: { name: 'LiteLLM', logo: 'litellm', mono: 'L', domain: 'AI' },
  langfuse: { name: 'Langfuse', logo: 'langfuse', mono: 'LF', domain: 'AI' },
  stalwart: { name: 'Stalwart (JMAP)', logo: 'stalwart', mono: 'S', domain: 'Comm' },
  novu: { name: 'Novu', logo: 'novu', mono: 'N', domain: 'Comm' },
  mattermost: { name: 'Mattermost', logo: 'mattermost', mono: 'M', domain: 'Comm' },
  syncope: { name: 'Apache Syncope', logo: 'apache-2', mono: 'SY', domain: 'Identity(IGA + SCIM)' },
};

// Foundation subShell — plugin 호스팅 shell(§2.7). 크롬(2단 내비·breadcrumb·라우팅)은 SDK 정본
// OpenSphere-shell-template와 동일 패턴: 흰 clr-vertical-nav(.cm-nav, 12rem grid, 왼쪽 blue bar),
// 상단 회색 breadcrumb 바, 경로 세그먼트 라우팅(/p/foundation/<module> + pushState).
// 구조·컴포넌트 = Clarity(clr-vertical-nav·clr-tree·clr-datagrid). 아이콘 = Carbon(@carbon/icons·os-cicon) —
// shell-template/shell-ai/shell-base와 동일 관례(Clarity는 아이콘 세트를 자체 제공하지 않고, Clarity Core의
// cds-icon 웹컴포넌트는 이 ShadowDom Angular-Element 셸에서 부트스트랩 크래시 → Carbon SVG 디스크립터로 대체).
// 좌 내비 = capability 모듈(Data/Identity)을 clr-vertical-nav-group 트리로, 엔진은 그 자식(registry 파생·활성만).
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, PostgresComponent, RustfsComponent, KeycloakComponent, FoundationOverviewComponent, FoundationConnectivityComponent, FoundationEnginesComponent, PlaceholderModuleComponent, PluginOutletComponent],
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
    .cm-roadmap-tag { font-size: 0.68rem; color: #8c8c8c; font-weight: 400; margin-left: 4px; }

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
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON['overview']" [size]="16" />Overview
        </a>
        <a clrVerticalNavLink [class.active]="vr.module() === 'bss'" (click)="go('bss')" (keydown.enter)="go('bss')">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON['bss']" [size]="16" />BSS (Host 연결)
        </a>
        <a clrVerticalNavLink [class.active]="vr.module() === 'engines'" (click)="go('engines')" (keydown.enter)="go('engines')">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON['engines']" [size]="16" />FSS 엔진
        </a>

        <clr-vertical-nav-group *ngFor="let g of groups()"
            [clrVerticalNavGroupExpanded]="isOpen(g.id)" (clrVerticalNavGroupExpandedChange)="setOpen(g.id, $event)">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON[g.iconKey]" [size]="16" />{{ g.label }}<span class="cm-roadmap-tag" *ngIf="g.planned"> 예정</span>
          <clr-vertical-nav-group-children>
            <!-- 깊이 1(그룹 자식)은 아이콘 없이 들여쓴 텍스트 — shell-template/AI Hub 표준(아이콘=깊이 0만). -->
            <a *ngFor="let c of g.children" clrVerticalNavLink
               [class.active]="vr.module() === c.id" (click)="go(c.id)" (keydown.enter)="go(c.id)">{{ c.name }}<span class="cm-roadmap-tag" *ngIf="c.planned"> 예정</span></a>
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
        <app-foundation-connectivity *ngIf="vr.module() === 'bss'"></app-foundation-connectivity>
        <app-foundation-engines *ngIf="vr.module() === 'engines'"></app-foundation-engines>
        <app-plugin-outlet *ngIf="activePlugin() as p" [plugin]="p"></app-plugin-outlet>
        <app-postgres *ngIf="vr.module() === 'postgres' && reg.isEnabled('postgres')"></app-postgres>
        <app-rustfs *ngIf="vr.module() === 'rustfs' && reg.isEnabled('rustfs')"></app-rustfs>
        <app-keycloak *ngIf="vr.module() === 'keycloak' && reg.isEnabled('keycloak')"></app-keycloak>
        <app-placeholder-module *ngIf="roadmapMeta() as rm" [name]="rm.name" [logo]="rm.logo" [mono]="rm.mono"
          [eyebrow]="'Foundation · ' + rm.domain"></app-placeholder-module>
        <clr-alert *ngIf="disabledModule()" clrAlertType="warning" [clrAlertClosable]="false">
          <clr-alert-item><span class="alert-text">이 plugin은 비활성 상태입니다. FSS 엔진 카탈로그에서 설치 상태를 확인하세요.</span></clr-alert-item>
        </clr-alert>
      </section>
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly vr = inject(ViewRouter);
  readonly reg = inject(FoundationRegistryService);
  readonly ICON = ICON;

  private readonly openState = signal<Record<string, boolean>>({ data: true, identity: true });

  /** capability 모듈 트리 — 엔진(플러그인)을 capability 접두사로 그룹핑(활성만). Data/Identity 그룹. */
  readonly groups = computed<NavGroup[]>(() => {
    const en = this.reg.enabledPlugins();
    const pick = (prefix: string) => en.filter((p) => p.capability.startsWith(prefix));
    const out: NavGroup[] = [];
    const data = pick('data.');
    const identity = pick('identity.');
    if (data.length) out.push({ id: 'data', label: 'Data', iconKey: 'data', children: data });
    out.push({ id: 'identity', label: 'Identity', iconKey: 'identity', children: [...identity, ...IDENTITY_ROADMAP] });
    out.push(...ROADMAP_GROUPS);
    return out;
  });

  isOpen(id: string): boolean { return !!this.openState()[id]; }
  setOpen(id: string, v: boolean): void { this.openState.update((m) => ({ ...m, [id]: v })); }

  ngOnInit(): void {
    this.reg.start();
    if (this.vr.module() === 'plugins') {
      this.vr.setModule('engines');
    }
  }
  ngOnDestroy(): void { this.reg.stop(); }

  go(id: string): void {
    if (id === 'opensearch' && this.reg.modelOf('opensearch') !== 'Installed') {
      this.openOpenSearchInstaller();
      return;
    }
    this.vr.setModule(id);
  }

  activePlugin(): HostedPlugin | undefined {
    const id = this.vr.module();
    const p = this.reg.all.find((x) => x.id === id && !!x.activation);
    return p && this.reg.isEnabled(p.id) ? p : undefined;
  }

  private openOpenSearchInstaller(): void {
    this.vr.setModule('engines');
    this.vr.setTab('opensearch');
  }

  disabledModule(): boolean {
    const m = this.vr.module();
    return ['postgres', 'opensearch', 'rustfs', 'keycloak', 'samba'].includes(m) && !this.reg.isEnabled(m);
  }

  /** 로드맵 모듈(AI/Comm) 페이지에 넘길 메타 — 해당 모듈이 아니면 undefined(placeholder 미표시). */
  roadmapMeta(): { name: string; logo: string; mono: string; domain: string } | undefined {
    return ROADMAP_META[this.vr.module()];
  }

  private label(id: string): string {
    if (id === 'overview') return 'Overview';
    if (id === 'bss') return 'BSS (Host 연결)';
    if (id === 'engines') return 'FSS 엔진';
    const rm = ROADMAP_META[id];
    if (rm) return rm.name;
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
