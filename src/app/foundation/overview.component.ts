import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FoundationRegistryService } from '../registry/foundation-registry.service';
import { HostedPlugin } from '../registry/hosted-plugin';
import { ViewRouter } from '../view-router';
import { PgMetric } from '../modules/postgres/ui/pg-metric';

// Foundation shell의 home — 정체성 + 2축 KPI(lifecycle/runtime) + 호스팅 plugin 카드(라이브 health).
@Component({
  selector: 'app-foundation-overview',
  standalone: true,
  imports: [CommonModule, PgMetric],
  template: `
    <div class="mod-h"><h2>Foundation <span class="tag tag-shell">subShell · host</span></h2></div>
    <p class="muted">
      플랫폼 공용 데이터/인프라 capability를 <strong>호스팅</strong>하는 subShell.
      아래 plugin은 <code>hostRef=foundation</code>으로 귀속되며, 이 셸이 등록·상태·수명주기를 소유한다(§2.7).
    </p>

    <div class="metric-row">
      <pg-metric label="Hosted Plugins" [value]="s().hosted" sub="hostRef=foundation"></pg-metric>
      <pg-metric label="Enabled" [value]="s().enabled" [status]="s().enabled === s().hosted ? 'ok' : 'warn'"
                 [sub]="s().disabled ? s().disabled + ' disabled' : '전부 활성'"></pg-metric>
      <pg-metric label="Healthy" [value]="s().healthy" [status]="s().degraded ? 'bad' : (s().healthy ? 'ok' : '')"
                 [sub]="s().degraded ? s().degraded + ' degraded' : '런타임 정상'"></pg-metric>
      <pg-metric label="Capabilities" [value]="s().capabilities" sub="제공 역량 종류"></pg-metric>
    </div>

    <div class="sec-h">호스팅 Plugins</div>
    <div class="cards">
      <div class="card" *ngFor="let p of reg.all" [class.dimmed]="!reg.isEnabled(p.id)">
        <div class="card-h">
          <span class="tag tag-plugin">plugin</span> {{ p.name }}
          <span class="pill" [ngClass]="h(p).pill" style="margin-left:auto">{{ h(p).label }}</span>
        </div>
        <p class="muted" style="margin:.2rem 0 .6rem">{{ p.desc }}</p>
        <div class="pc-metrics">
          <div class="pc-m" *ngFor="let m of h(p).metrics"><b>{{ m.val }}</b><span>{{ m.lab }}</span></div>
        </div>
        <dl class="kv" style="margin-top:.6rem">
          <dt>capability</dt><dd><code>{{ p.capability }}</code> · {{ p.capabilityLabel }}</dd>
          <dt>제공 주소</dt><dd class="mono">{{ p.consumePoint }}</dd>
        </dl>
        <div class="pc-act">
          <button class="rbtn primary" (click)="open(p)" [disabled]="!reg.isEnabled(p.id)">콘솔 열기 →</button>
          <span class="pill" *ngIf="!reg.isEnabled(p.id)">비활성 — Plugins 관리에서 활성화</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pc-metrics{ display:flex; gap:1.4rem; flex-wrap:wrap; margin:.4rem 0; }
    .pc-m{ display:flex; flex-direction:column; }
    .pc-m b{ font-size:1.15rem; color:#1f2733; line-height:1.1; }
    .pc-m span{ font-size:.6rem; text-transform:uppercase; letter-spacing:.05em; color:#7a828f; margin-top:.15rem; }
    .pc-act{ display:flex; align-items:center; gap:.6rem; margin-top:.8rem; flex-wrap:wrap; }
    .card.dimmed{ opacity:.62; }
  `],
})
export class FoundationOverviewComponent {
  readonly reg = inject(FoundationRegistryService);
  private vr = inject(ViewRouter);
  readonly s = this.reg.summary;
  h(p: HostedPlugin) { return this.reg.health(p); }
  open(p: HostedPlugin): void { this.vr.setModule(p.view.module); }
}
