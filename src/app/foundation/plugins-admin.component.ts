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
    <div class="mod-h"><h2>Plugins 관리 <span class="tag tag-shell">host control</span></h2></div>
    <p class="muted">Foundation(host)에 귀속된 plugin을 등록·상태·수명주기로 통치. 제어 범위는 mainShell이 위임한 자기 도메인으로 한정.</p>

    <div class="sec-h">구성도 Topology</div>
    <div class="ftree">
      <div class="ftn ftn0">
        <span class="ftt tt-shell">subShell</span>
        <strong>foundation</strong>
        <span class="ftm">host · ns opensphere-foundation</span>
        <span class="ftc">{{ reg.all.length }} plugin</span>
      </div>
      <div class="ftn ftn1" *ngFor="let p of reg.all">
        <span class="ftt tt-plugin">plugin</span>
        <span class="ftl">{{ p.name }}</span>
        <span class="pill" [ngClass]="h(p).pill">{{ h(p).label }}</span>
        <span class="pill" [class.ok]="reg.isEnabled(p.id)">{{ reg.isEnabled(p.id) ? 'Enabled' : 'Disabled' }}</span>
        <span class="ftcap"><code>{{ p.capability }}</code></span>
        <span class="ftm">hostRef={{ p.hostRef }}</span>
      </div>
    </div>

    <div class="sec-h">Plugin Registry</div>
    <table class="tbl">
      <thead><tr><th>Plugin</th><th>Kind</th><th>Capability</th><th>Health (runtime)</th><th>Lifecycle</th><th>소비점</th><th>Actions</th></tr></thead>
      <tbody>
        <tr *ngFor="let p of reg.all">
          <td><span class="tag tag-plugin">plugin</span> {{ p.name }}</td>
          <td>{{ p.kind }} <span class="mono muted">·{{ p.hostRef }}</span></td>
          <td><code>{{ p.capability }}</code></td>
          <td><span class="pill" [ngClass]="h(p).pill">{{ h(p).label }}</span></td>
          <td><span class="pill" [class.ok]="reg.isEnabled(p.id)">{{ reg.isEnabled(p.id) ? 'Enabled' : 'Disabled' }}</span></td>
          <td class="mono">{{ p.consumePoint }}</td>
          <td class="pc-act">
            <button class="rbtn" (click)="reg.setEnabled(p.id, false)" *ngIf="reg.isEnabled(p.id)">Disable</button>
            <button class="rbtn primary" (click)="reg.setEnabled(p.id, true)" *ngIf="!reg.isEnabled(p.id)">Enable</button>
            <button class="rbtn" (click)="open(p)" [disabled]="!reg.isEnabled(p.id)">열기</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="muted" style="margin-top:.6rem">⚠️ MVP: Lifecycle = 콘솔 노출 soft toggle(localStorage, 즉시 nav·마운트 반영).
       후속: controller registry(<code>hostRef=foundation</code>)에서 phase hydrate + 실제 install/uninstall.</p>
  `,
  styles: [`
    .ftree{ font-size:.84rem; margin:.2rem 0 1rem; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 3px 12px rgba(20,30,60,.05); }
    .ftn{ display:flex; align-items:center; gap:.55rem; padding:.5rem .7rem; border-top:1px solid #eef0f3; }
    .ftn0{ background:#eef4f4; border-top:0; }
    .ftn1{ padding-left:2.2rem; }
    .ftt{ font-size:.55rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:.08rem .42rem; border-radius:3px; color:#fff; }
    .tt-shell{ background:#0d6e6e; } .tt-plugin{ background:#3b5bdb; }
    .ftl{ font-weight:600; }
    .ftcap code{ font-size:.72rem; }
    .ftm{ margin-left:auto; font-family:monospace; font-size:.66rem; color:#7a828f; }
    .ftc{ font-size:.66rem; color:#7a828f; }
    .pc-act{ display:flex; gap:.4rem; flex-wrap:wrap; }
  `],
})
export class FoundationAdminComponent {
  readonly reg = inject(FoundationRegistryService);
  private vr = inject(ViewRouter);
  h(p: HostedPlugin) { return this.reg.health(p); }
  open(p: HostedPlugin): void { this.vr.setModule(p.view.module); }
}
