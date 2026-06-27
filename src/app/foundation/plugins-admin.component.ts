import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FoundationRegistryService } from '../registry/foundation-registry.service';
import { HostedPlugin } from '../registry/hosted-plugin';
import { ViewRouter } from '../view-router';

// Foundation 관리자 — host에 귀속된 plugin을 등록·상태·수명주기로 통치. Console Extensions의 Foundation 레벨 직역.
@Component({
  selector: 'app-foundation-admin',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="os-title-row"><h2 class="os-h2">Plugins 관리 <span class="label label-info">host control</span></h2></div>
    <p class="os-sub">Foundation(host)에 귀속된 plugin을 등록·상태·수명주기로 통치. 제어 범위는 mainShell이 위임한 자기 도메인으로 한정.</p>

    <div class="os-sech">구성도 Topology</div>
    <div class="os-topo">
      <div class="os-topo-row os-topo-host">
        <span class="label label-info">subShell</span>
        <strong>foundation</strong>
        <span class="os-topo-meta">host · ns opensphere-foundation</span>
        <span class="os-topo-meta os-ml-auto">{{ reg.all.length }} plugin</span>
      </div>
      <div class="os-topo-row os-topo-child" *ngFor="let p of reg.all">
        <span class="label label-info">plugin</span>
        <span>{{ p.name }}</span>
        <span class="label" [ngClass]="h(p).pill">{{ h(p).label }}</span>
        <span class="label" [ngClass]="reg.isEnabled(p.id) ? 'label-success' : ''">{{ reg.isEnabled(p.id) ? 'Enabled' : 'Disabled' }}</span>
        <code class="os-mono">{{ p.capability }}</code>
        <span class="os-topo-meta os-ml-auto">hostRef={{ p.hostRef }}</span>
      </div>
    </div>

    <div class="os-sech">Plugin Registry</div>
    <table class="table">
      <thead><tr><th>Plugin</th><th>Kind</th><th>Capability</th><th>Health (runtime)</th><th>Lifecycle</th><th>소비점</th><th>Actions</th></tr></thead>
      <tbody>
        <tr *ngFor="let p of reg.all">
          <td><span class="label label-info">plugin</span> {{ p.name }}</td>
          <td>{{ p.kind }} <span class="os-mono os-muted">·{{ p.hostRef }}</span></td>
          <td><code class="os-mono">{{ p.capability }}</code></td>
          <td><span class="label" [ngClass]="h(p).pill">{{ h(p).label }}</span></td>
          <td><span class="label" [ngClass]="reg.isEnabled(p.id) ? 'label-success' : ''">{{ reg.isEnabled(p.id) ? 'Enabled' : 'Disabled' }}</span></td>
          <td class="os-mono">{{ p.consumePoint }}</td>
          <td class="os-actions">
            <button class="btn btn-sm" (click)="reg.setEnabled(p.id, false)" *ngIf="reg.isEnabled(p.id)">Disable</button>
            <button class="btn btn-sm btn-primary" (click)="reg.setEnabled(p.id, true)" *ngIf="!reg.isEnabled(p.id)">Enable</button>
            <button class="btn btn-sm" (click)="open(p)" [disabled]="!reg.isEnabled(p.id)">열기</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="os-sub">⚠️ MVP: Lifecycle = 콘솔 노출 soft toggle(localStorage, 즉시 nav·마운트 반영).
       후속: controller registry(<code class="os-mono">hostRef=foundation</code>)에서 phase hydrate + 실제 install/uninstall.</p>
  `,
})
export class FoundationAdminComponent {
  readonly reg = inject(FoundationRegistryService);
  private vr = inject(ViewRouter);
  h(p: HostedPlugin) { return this.reg.health(p); }
  open(p: HostedPlugin): void { this.vr.setModule(p.view.module); }
}
