import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { PsmdbPluginComponent } from './modules/psmdb/psmdb-plugin.component';
import { ValkeyPluginComponent } from './modules/valkey/valkey-plugin.component';
import { RustFSPluginComponent } from './modules/rustfs/rustfs-plugin.component';
import { KeycloakComponent } from './modules/identity/keycloak.component';
import { FoundationOverviewComponent } from './foundation/overview.component';
import { FoundationEnginesComponent } from './foundation/engines.component';
import { ControlPlaneComponent } from './foundation/control-plane.component';
import { FoundationDeliveryComponent } from './foundation/delivery.component';
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
import Cube16 from '@carbon/icons/es/cube/16';
import FlowConnection16 from '@carbon/icons/es/flow--connection/16';

// 좌 내비 아이콘 키 → Carbon 16px 디스크립터(os-cicon). AI Hub/shell-template/shell-base와 동일 방식
// (@carbon/icons SVG 디스크립터 + CarbonIcon 렌더러. cds-icon 웹컴포넌트가 아니라 크래시와 무관).
const ICON: Record<string, any> = {
  overview: Home16, modules: Cube16, control: FlowConnection16,
  data: Db2Database16, db: Db2Database16, search: Search16, storage: ObjectStorage16,
  identity: UserMultiple16, users: UserMultiple16, key: Password16,
};

interface NavChild { id: string; name: string; module?: string; tab?: string }
interface NavGroup { id: string; label: string; iconKey: string; children: NavChild[] }

const CATALOG_MODULES = new Set([
  'syncope', 'opa', 'litellm', 'langfuse', 'stalwart', 'novu', 'mattermost',
  'otel', 'tempo', 'loki', 'grafana-operator', 'ptm',
]);

// AI/Comm은 아직 FOUNDATION_PLUGINS registry에 등록되지 않은 로드맵 도메인이라 정적 목록으로 노출.
// 실제 엔진이 배선되면 registry 엔트리로 승격하고 여기서 제거한다(2026-07-04).

// Identity 그룹은 Keycloak/Samba-AD(live, registry 파생)에 Syncope(로드맵)를 얹은 혼합 그룹.
// ADR-FND-002: IGA 단일권위는 Syncope. 별도 SCIM gateway는 멤버가 아니라 Syncope 내장 SCIM 2.0 또는 얇은 connector로 수렴한다.

// 로드맵 모듈 id → placeholder 페이지에 넘길 메타(이름/로고/모노그램/도메인 eyebrow).

// Foundation subShell — plugin 호스팅 shell(§2.7). 크롬(2단 내비·breadcrumb·라우팅)은 SDK 정본
// OpenSphere-shell-template와 동일 패턴: 흰 clr-vertical-nav(.cm-nav, 12rem grid, 왼쪽 blue bar),
// 상단 회색 breadcrumb 바, 경로 세그먼트 라우팅(/pfss/<module> + pushState).
// 구조·컴포넌트 = Clarity(clr-vertical-nav·clr-tree·clr-datagrid). 아이콘 = Carbon(@carbon/icons·os-cicon) —
// shell-template/shell-ai/shell-base와 동일 관례(Clarity는 아이콘 세트를 자체 제공하지 않고, Clarity Core의
// cds-icon 웹컴포넌트는 이 ShadowDom Angular-Element 셸에서 부트스트랩 크래시 → Carbon SVG 디스크립터로 대체).
// 좌 내비 = capability 모듈(Data/Identity)을 clr-vertical-nav-group 트리로, 엔진은 그 자식(registry 파생·활성만).
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ClarityModule, CarbonIcon, PsmdbPluginComponent, ValkeyPluginComponent, RustFSPluginComponent, KeycloakComponent, FoundationOverviewComponent, FoundationEnginesComponent, ControlPlaneComponent, FoundationDeliveryComponent, PluginOutletComponent],
  encapsulation: ViewEncapsulation.ShadowDom,
  styleUrls: ['./app.component.css'],
  styles: [`
    .os-shell { display: grid; grid-template-columns: 12rem minmax(0, 1fr); min-height: 100%; }

    /* 2단 표준(.cm-nav) — AI Hub / shell-template 정본. 흰 배경 + 왼쪽 blue bar active. */
    .cm-nav { min-height: 100%; background: #fff; --clr-vertical-nav-bg-color: #ffffff; }
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

    /* Main Shell의 content-area가 유일한 page scroll owner다. Guest가 viewport 높이와
       overflow를 다시 소유하면 문서/guest 이중 스크롤이 생긴다. */
    .os-content { min-width: 0; min-height: 0; overflow: visible; padding: 1.1rem 1.4rem 2rem; background: var(--os-overview-bg, #f4f4f4); }
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

    .pfs-module-management { padding: 1.25rem; border: 1px solid #d9d9d9; background: #fff; }
    .pfs-module-management__heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #d9d9d9; }
    .pfs-module-management__heading h1 { margin: .2rem 0; font-size: 1.6rem; }
    .pfs-module-management__heading p { margin: 0; color: #565656; }
    .pfs-module-management__eyebrow { color: #0f62fe; font-size: .72rem; font-weight: 700; letter-spacing: .08em; }
    .pfs-module-management__facts { display: grid; grid-template-columns: 9rem minmax(0, 1fr); margin: 1rem 0; border-top: 1px solid #d9d9d9; }
    .pfs-module-management__facts dt, .pfs-module-management__facts dd { margin: 0; padding: .65rem; border-bottom: 1px solid #d9d9d9; overflow-wrap: anywhere; }
    .pfs-module-management__facts dt { font-weight: 600; background: #f4f4f4; }

    @media (max-width: 760px) {
      .os-shell { grid-template-columns: minmax(0, 1fr); }
      .cm-nav { display: none; }
      .os-content { padding: 0.85rem 0.8rem 1.5rem; }
      .cc-crumbs { margin: -0.85rem -0.8rem 0.75rem; padding: 0.4rem 0.8rem; }
    }
  `],
  template: `
    <div class="os-shell">
      <clr-vertical-nav class="cm-nav" [clrVerticalNavCollapsible]="false" aria-label="Foundation 보조 내비">
        <div class="cm-brand"><strong>Foundation</strong></div>

        <a clrVerticalNavLink [class.active]="vr.module() === 'overview'" (click)="go('overview')" (keydown.enter)="go('overview')">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON['overview']" [size]="16" />Overview
        </a>
        <a clrVerticalNavLink [class.active]="vr.module() === 'modules'" (click)="go('modules')" (keydown.enter)="go('modules')">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON['modules']" [size]="16" />PFSS 모듈
        </a>

        <a clrVerticalNavLink [class.active]="vr.module() === 'control-plane'" (click)="go('control-plane')" (keydown.enter)="go('control-plane')">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON['control']" [size]="16" />Control Plane
        </a>

        <clr-vertical-nav-group [clrVerticalNavGroupExpanded]="vr.module()==='delivery' || isOpen('delivery')" (clrVerticalNavGroupExpandedChange)="setOpen('delivery', $event)">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON['control']" [size]="16" />Platform Delivery
          <clr-vertical-nav-group-children>
            <a *ngFor="let c of deliveryNav" clrVerticalNavLink [class.active]="childActive(c)" (click)="goChild(c)" (keydown.enter)="goChild(c)">{{c.name}}</a>
          </clr-vertical-nav-group-children>
        </clr-vertical-nav-group>

        <clr-vertical-nav-group *ngFor="let g of groups()"
            [clrVerticalNavGroupExpanded]="isOpen(g.id)" (clrVerticalNavGroupExpandedChange)="setOpen(g.id, $event)">
          <os-cicon clrVerticalNavIcon class="os-tree-ic" [icon]="ICON[g.iconKey]" [size]="16" />{{ g.label }}
          <clr-vertical-nav-group-children>
            <!-- 깊이 1(그룹 자식)은 아이콘 없이 들여쓴 텍스트 — shell-template/AI Hub 표준(아이콘=깊이 0만). -->
            <a *ngFor="let c of g.children" clrVerticalNavLink
               [class.active]="childActive(c)" (click)="goChild(c)" (keydown.enter)="goChild(c)">{{ c.name }}</a>
          </clr-vertical-nav-group-children>
        </clr-vertical-nav-group>
      </clr-vertical-nav>

      <section class="os-content">
        <nav class="cc-crumbs" aria-label="페이지 경로">
          <ng-container *ngFor="let c of crumbs(); let last = last">
            <a *ngIf="c.link === 'home'" class="cc-crumb cc-crumb-link" href="/">{{ c.label }}</a>
            <a *ngIf="c.link === 'overview'" class="cc-crumb cc-crumb-link" (click)="go('overview')">{{ c.label }}</a>
            <a *ngIf="c.link === 'delivery'" class="cc-crumb cc-crumb-link" (click)="goDeliveryOverview()">{{ c.label }}</a>
            <span *ngIf="!c.link" class="cc-crumb is-cur">{{ c.label }}</span>
            <span class="cc-crumb-sep" *ngIf="!last">/</span>
          </ng-container>
        </nav>

        <app-foundation-overview *ngIf="vr.module() === 'overview'"></app-foundation-overview>
        <app-foundation-engines *ngIf="((vr.module() === 'modules' && vr.tab() === 'overview') || catalogModule()) && !activePlugin()"></app-foundation-engines>
        <app-control-plane *ngIf="vr.module() === 'control-plane'"></app-control-plane>
        <app-foundation-delivery *ngIf="vr.module() === 'delivery' && !activePlugin()"></app-foundation-delivery>
        <app-plugin-outlet *ngIf="activePlugin() as p" [plugin]="p"></app-plugin-outlet>
        <app-psmdb-plugin *ngIf="vr.module() === 'psmdb' && !activePlugin()"></app-psmdb-plugin>
        <app-valkey-plugin *ngIf="vr.module() === 'valkey' && !activePlugin()"></app-valkey-plugin>
        <app-rustfs-plugin *ngIf="vr.module() === 'rustfs' && !activePlugin()"></app-rustfs-plugin>
        <app-keycloak *ngIf="vr.module() === 'keycloak' && !activePlugin()"></app-keycloak>
        <section *ngIf="inactivePlugin() as p" class="pfs-module-management" aria-labelledby="pfs-module-management-title">
          <div class="pfs-module-management__heading">
            <div>
              <div class="pfs-module-management__eyebrow">PFSS MODULE MANAGEMENT</div>
              <h1 id="pfs-module-management-title">{{ p.name }}</h1>
              <p>실행 UI가 아직 활성화되지 않았습니다. 관리 경로는 유지되며 준비 상태를 확인할 수 있습니다.</p>
            </div>
            <a class="btn btn-primary" href="/manage/extensions">Extensions 관리</a>
          </div>
          <dl class="pfs-module-management__facts">
            <dt>정본 경로</dt><dd class="os-mono">/pfss/{{ routeId(p.id) }}</dd>
            <dt>설치 선언</dt><dd>{{ reg.modelOf(p.id) ?? '확인 중' }}</dd>
            <dt>Runtime</dt><dd>{{ reg.health(p).label }}</dd>
            <dt>UI 상태</dt><dd>Activation 대기</dd>
          </dl>
          <clr-alert clrAlertType="warning" [clrAlertClosable]="false">
            <clr-alert-item><span class="alert-text">서명·의존성·플랫폼 준비도 검증이 끝날 때까지 변경 작업은 차단됩니다.</span></clr-alert-item>
          </clr-alert>
        </section>
        <clr-alert *ngIf="disabledModule()" clrAlertType="warning" [clrAlertClosable]="false">
          <clr-alert-item><span class="alert-text">이 plugin은 비활성 상태입니다. PFSS 모듈 화면에서 설치 상태를 확인하세요.</span></clr-alert-item>
        </clr-alert>
        <clr-alert *ngIf="unknownModule()" clrAlertType="warning" [clrAlertClosable]="false">
          <clr-alert-item>
            <span class="alert-text">존재하지 않는 Foundation 경로입니다. 폐기된 BSS 경로는 더 이상 제공하지 않습니다.</span>
            <div class="alert-actions"><button class="btn alert-action" type="button" (click)="go('overview')">Overview로 이동</button></div>
          </clr-alert-item>
        </clr-alert>
      </section>
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly vr = inject(ViewRouter);
  readonly reg = inject(FoundationRegistryService);
  readonly ICON = ICON;
  readonly deliveryNav: NavChild[] = [
    {id:'delivery-overview',name:'개요',module:'delivery',tab:'overview'},
    {id:'argocd',name:'Argo CD',module:'delivery',tab:'argocd'},
    {id:'crossplane',name:'Crossplane',module:'delivery',tab:'crossplane'},
  ];

  private readonly openState = signal<Record<string, boolean>>({ data: true, identity: true });

  /** 설치 전 관리도 lifecycle의 일부다. 모든 PFS 섹터를 상시 노출하고 각 Operator 표면으로 진입시킨다. */
  readonly groups = computed<NavGroup[]>(() => {
    const pick = (prefix: string): NavChild[] => this.reg.all
      .filter((p) => p.capability.startsWith(prefix))
      .map((p) => ({ id:this.routeId(p.id), name:p.name }));
    const catalog = (id:string,name:string):NavChild => ({id,name});
    return [
      { id:'identity', label:'Identity', iconKey:'identity', children:pick('identity.') },
      { id:'data', label:'Data', iconKey:'data', children:pick('data.') },
      { id:'ai', label:'AI / Retrieval', iconKey:'search', children:[catalog('litellm','LiteLLM'),catalog('langfuse','Langfuse')] },
      { id:'comm', label:'Communication', iconKey:'users', children:[catalog('stalwart','Stalwart'),catalog('novu','Novu'),catalog('mattermost','Mattermost')] },
      { id:'observability', label:'Observability', iconKey:'control', children:[catalog('otel','OpenTelemetry Collector'),catalog('tempo','Grafana Tempo'),catalog('loki','Grafana Loki'),catalog('grafana-operator','Grafana Operator')] },
      { id:'backup', label:'Backup / Restore', iconKey:'storage', children:[catalog('ptm','.ptm')] },
    ];
  });

  isOpen(id: string): boolean {
    if (this.openState()[id]) { return true; }
    const group = this.groups().find((g) => g.id === id);
    return !!group?.children.some((child) => this.childActive(child));
  }
  setOpen(id: string, v: boolean): void { this.openState.update((m) => ({ ...m, [id]: v })); }

  ngOnInit(): void {
    this.reg.start();
    if (this.vr.module() === 'plugins') {
      this.vr.setModule('modules');
    }
  }
  ngOnDestroy(): void { this.reg.stop(); }

  go(id: string): void {
    this.vr.setModule(id);
  }

  goChild(child: NavChild): void {
    this.vr.setModule(child.module ?? child.id);
    if (child.tab) { this.vr.setTab(child.tab); }
  }

  goDeliveryOverview(): void {
    this.vr.setModule('delivery');
    this.vr.setTab('overview');
  }

  childActive(child: NavChild): boolean {
    return this.vr.module() === (child.module ?? child.id) && (!child.tab || this.vr.tab() === child.tab);
  }

  activePlugin(): HostedPlugin | undefined {
    const route = this.vr.module();
    const id = this.pluginId(route === 'delivery' ? this.vr.tab() : route);
    const p = this.reg.all.find((x) => x.id === id && !!x.activation);
    if (!p) { return undefined; }
    return p.activation?.element && customElements.get(p.activation.element) ? p : undefined;
  }

  inactivePlugin(): HostedPlugin | undefined {
    const route = this.vr.module();
    const id = this.pluginId(route === 'delivery' ? this.vr.tab() : route);
    if (!['samba', 'postgres'].includes(id)) return undefined;
    const plugin = this.reg.all.find((item) => item.id === id && !!item.activation);
    if (!plugin?.activation?.element || customElements.get(plugin.activation.element)) return undefined;
    return plugin;
  }

  disabledModule(): boolean {
    return false;
  }

  unknownModule(): boolean {
    const m = this.vr.module();
    // /modules is the catalog root only. The retired /modules/<plugin> address
    // must not keep behaving as a second, hidden plugin URL namespace.
    if (m === 'modules') { return this.vr.tab() !== 'overview'; }
    if (['overview', 'control-plane', 'delivery'].includes(m)) { return false; }
    if (CATALOG_MODULES.has(m)) { return false; }
    return !this.reg.all.some((p) => this.routeId(p.id) === m);
  }

  catalogModule(): boolean { return CATALOG_MODULES.has(this.vr.module()); }

  /** 로드맵 모듈(AI/Comm) 페이지에 넘길 메타 — 해당 모듈이 아니면 undefined(placeholder 미표시). */
  private label(id: string): string {
    if (id === 'overview') return 'Overview';
    if (id === 'modules') return 'PFSS 모듈';
    if (id === 'control-plane') return 'Control Plane';
    if (id === 'delivery') return 'Platform Delivery';
    const p = this.reg.all.find((x) => x.id === this.pluginId(id));
    return p ? p.name : id;
  }

  /** Foundation engine identity는 samba로 유지하되 사용자 주소 공간은 공급자 중립적인 directory를 사용한다. */
  routeId(pluginId: string): string { return pluginId === 'samba' ? 'directory' : pluginId; }
  private pluginId(routeId: string): string { return routeId === 'directory' ? 'samba' : routeId; }

  /** 그룹 라벨(모듈이 어느 capability 그룹인지) — breadcrumb 3단용. */
  private groupLabel(id: string): string | null {
    for (const g of this.groups()) if (g.children.some((c) => c.id === id)) return g.label;
    return null;
  }

  /** 페이지 경로 — OpenSphere / Foundation / [Data|Identity] / <현재>. */
  readonly crumbs = computed<{ label: string; link: 'home' | 'overview' | 'delivery' | null }[]>(() => {
    const id = this.vr.module();
    const out: { label: string; link: 'home' | 'overview' | 'delivery' | null }[] = [{ label: 'OpenSphere', link: 'home' }];
    if (id === 'overview') { out.push({ label: 'Foundation', link: null }); return out; }
    out.push({ label: 'Foundation', link: 'overview' });
    if (id === 'delivery') {
      out.push({ label: 'Platform Delivery', link: this.vr.tab() === 'overview' ? null : 'delivery' });
      if (this.vr.tab() === 'argocd') out.push({ label: 'Argo CD', link: null });
      if (this.vr.tab() === 'crossplane') out.push({ label: 'Crossplane', link: null });
      return out;
    }
    const g = this.groupLabel(id);
    if (g) out.push({ label: g, link: null });
    out.push({ label: this.label(id), link: null });
    return out;
  });
}
