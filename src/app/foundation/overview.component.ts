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
    <div class="os-title-row"><h2 class="os-h2">Foundation <span class="label label-info">subShell · host</span></h2></div>
    <p class="os-sub">
      플랫폼 공용 데이터/인프라 capability를 <strong>호스팅</strong>하는 subShell.
      아래 plugin은 <code class="os-mono">hostRef=foundation</code>으로 귀속되며, 이 셸이 등록·상태·수명주기를 소유한다(§2.7).
    </p>

    <div class="os-metrics">
      <pg-metric label="Hosted Plugins" [value]="s().hosted" sub="hostRef=foundation"></pg-metric>
      <pg-metric label="Enabled" [value]="s().enabled" [status]="s().enabled === s().hosted ? 'ok' : 'warn'"
                 [sub]="s().disabled ? s().disabled + ' disabled' : '전부 활성'"></pg-metric>
      <pg-metric label="Healthy" [value]="s().healthy" [status]="s().degraded ? 'bad' : (s().healthy ? 'ok' : '')"
                 [sub]="s().degraded ? s().degraded + ' degraded' : '런타임 정상'"></pg-metric>
      <pg-metric label="Capabilities" [value]="s().capabilities" sub="제공 역량 종류"></pg-metric>
    </div>

    <div class="os-sech">호스팅 Plugins</div>
    <div class="os-cardgrid">
      <div class="card" *ngFor="let p of reg.all" [class.os-dim]="!reg.isEnabled(p.id)">
        <div class="card-header">
          <span class="label label-info">plugin</span> {{ p.name }}
          <span class="label os-ml-auto" [ngClass]="h(p).pill">{{ h(p).label }}</span>
        </div>
        <div class="card-block">
          <p class="os-sub">{{ p.desc }}</p>
          <div class="os-pcm">
            <div *ngFor="let m of h(p).metrics"><b>{{ m.val }}</b><span>{{ m.lab }}</span></div>
          </div>
          <dl class="os-kv">
            <dt>capability</dt><dd><code class="os-mono">{{ p.capability }}</code> · {{ p.capabilityLabel }}</dd>
            <dt>제공 주소</dt><dd class="os-mono">{{ p.consumePoint }}</dd>
          </dl>
          <div class="os-actions">
            <button class="btn btn-sm btn-primary" (click)="open(p)" [disabled]="!reg.isEnabled(p.id)">콘솔 열기 →</button>
            <span class="label" *ngIf="!reg.isEnabled(p.id)">비활성 — Plugins 관리에서 활성화</span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class FoundationOverviewComponent {
  readonly reg = inject(FoundationRegistryService);
  private vr = inject(ViewRouter);
  readonly s = this.reg.summary;
  h(p: HostedPlugin) { return this.reg.health(p); }
  open(p: HostedPlugin): void { this.vr.setModule(p.view.module); }
}
