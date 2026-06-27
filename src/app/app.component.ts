import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { PostgresComponent } from './modules/postgres/postgres.component';
import { OpenSearchComponent } from './modules/opensearch/opensearch.component';
import { FoundationOverviewComponent } from './foundation/overview.component';
import { FoundationAdminComponent } from './foundation/plugins-admin.component';
import { FoundationRegistryService } from './registry/foundation-registry.service';
import { ViewRouter } from './view-router';

// Foundation subShell = plugin 호스팅 shell(§2.7). ShadowDom + Clarity(clr-ui shadow root 주입, app.component.css).
// 좌 nav = clr-vertical-nav(SHELL: Overview·Plugins관리 / HOSTING PLUGIN: registry 파생). 폴러 라이프사이클 = 이 shell 소유.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ClarityModule, PostgresComponent, OpenSearchComponent, FoundationOverviewComponent, FoundationAdminComponent],
  encapsulation: ViewEncapsulation.ShadowDom,
  styleUrls: ['./app.component.css'],
  template: `
    <div class="os-shell">
      <clr-vertical-nav class="os-sidebar-nav" [clrVerticalNavCollapsible]="false">
        <div class="os-brand">Foundation<span class="os-brand-sub">플랫폼 백킹서비스 shell</span></div>

        <span class="os-band-label">Shell</span>
        <a clrVerticalNavLink [class.active]="vr.module() === 'overview'" (click)="vr.setModule('overview')" (keydown.enter)="vr.setModule('overview')">
          <svg viewBox="0 0 24 24" class="os-tree-ic" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" clrVerticalNavIcon><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>
          Overview
        </a>
        <a clrVerticalNavLink [class.active]="vr.module() === 'plugins'" (click)="vr.setModule('plugins')" (keydown.enter)="vr.setModule('plugins')">
          <svg viewBox="0 0 24 24" class="os-tree-ic" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" clrVerticalNavIcon><path d="M4 6h9"/><circle cx="17" cy="6" r="2.3"/><path d="M4 12h4"/><circle cx="12" cy="12" r="2.3"/><path d="M16 12h4"/><path d="M4 18h9"/><circle cx="17" cy="18" r="2.3"/></svg>
          Plugins 관리
        </a>

        <span class="os-band-label">Hosting Plugin</span>
        <a clrVerticalNavLink *ngFor="let p of reg.enabledPlugins()" [class.active]="vr.module() === p.id"
           (click)="vr.setModule(p.id)" (keydown.enter)="vr.setModule(p.id)">
          <svg *ngIf="p.icon === 'db'" viewBox="0 0 24 24" class="os-tree-ic" fill="none" stroke="currentColor" stroke-width="1.6" clrVerticalNavIcon><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>
          <svg *ngIf="p.icon === 'search'" viewBox="0 0 24 24" class="os-tree-ic" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" clrVerticalNavIcon><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          {{ p.name }}
        </a>

        <div class="os-nav-foot">§2.7 — plugin은 foundation shell에 귀속 (hostRef=foundation). 위 목록은 레지스트리의 파생(활성 plugin만).</div>
      </clr-vertical-nav>

      <section class="os-content">
        <app-foundation-overview *ngIf="vr.module() === 'overview'"></app-foundation-overview>
        <app-foundation-admin *ngIf="vr.module() === 'plugins'"></app-foundation-admin>
        <app-postgres *ngIf="vr.module() === 'postgres' && reg.isEnabled('postgres')"></app-postgres>
        <app-opensearch *ngIf="vr.module() === 'opensearch' && reg.isEnabled('opensearch')"></app-opensearch>
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

  ngOnInit(): void { this.reg.start(); }
  ngOnDestroy(): void { this.reg.stop(); }

  disabledModule(): boolean {
    const m = this.vr.module();
    return (m === 'postgres' || m === 'opensearch') && !this.reg.isEnabled(m);
  }
}
