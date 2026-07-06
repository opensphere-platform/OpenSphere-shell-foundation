import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { FoundationRegistryService } from '../registry/foundation-registry.service';
import { HostedPlugin } from '../registry/hosted-plugin';
import { ViewRouter } from '../view-router';

// Foundation 관리자 — host에 귀속된 plugin을 등록·상태·수명주기로 통치.
// 디자인 시스템 = Clarity 단일: 구성도=clr-tree, 레지스트리=clr-datagrid, 상태=clr label, 액션=clr btn.
@Component({
  selector: 'app-foundation-admin',
  standalone: true,
  imports: [CommonModule, ClarityModule],
  template: `
    <div class="os-title-row"><h2 class="os-h2">Plugins 관리 <span class="label label-info">host control</span></h2></div>
    <p class="os-sub">Foundation(host)에 귀속된 plugin을 등록·상태·수명주기로 통치. 제어 범위는 mainShell이 위임한 자기 도메인으로 한정.
      수명주기 정본 = <code class="os-mono">FoundationModel</code> CR(desiredState) — 표시는 CR에서 hydrate, 전이는 CR PATCH.</p>

    <clr-alert *ngIf="reg.lastError()" clrAlertType="danger" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text">수명주기 전이 실패: {{ reg.lastError() }}</span></clr-alert-item>
    </clr-alert>
    <clr-alert *ngIf="reg.modelsLoaded() === 'noperm' || reg.modelsLoaded() === 'error'" clrAlertType="warning" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text">FoundationModel CR 조회 {{ reg.modelsLoaded() === 'noperm' ? '권한 없음' : '실패' }} — 표시는 마지막 성공값 기준입니다.</span></clr-alert-item>
    </clr-alert>

    <div class="os-sech">구성도 Topology</div>
    <clr-tree>
      <clr-tree-node [clrExpanded]="true">
        <span class="label label-info">subShell</span> <strong>foundation</strong>
        <span class="os-mono os-muted">host · ns opensphere-foundation · {{ reg.all.length }} plugin</span>
        <clr-tree-node *ngFor="let p of reg.all">
          <span class="label label-info">plugin</span> {{ p.name }}
          <span class="label" [ngClass]="h(p).pill">{{ h(p).label }}</span>
          <span class="label" [ngClass]="reg.isEnabled(p.id) ? 'label-success' : (reg.modelOf(p.id) === '미등록' ? 'label-warning' : '')">{{ lifecycleLabel(p.id) }}</span>
          <code class="os-mono">{{ p.capability }}</code>
        </clr-tree-node>
      </clr-tree-node>
    </clr-tree>

    <div class="os-sech">Plugin Registry</div>
    <clr-datagrid>
      <clr-dg-column>Plugin</clr-dg-column>
      <clr-dg-column>Kind</clr-dg-column>
      <clr-dg-column>Capability</clr-dg-column>
      <clr-dg-column>Health (runtime)</clr-dg-column>
      <clr-dg-column>Lifecycle</clr-dg-column>
      <clr-dg-column>소비점</clr-dg-column>
      <clr-dg-column>Actions</clr-dg-column>
      <clr-dg-row *ngFor="let p of reg.all">
        <clr-dg-cell><span class="label label-info">plugin</span> {{ p.name }}</clr-dg-cell>
        <clr-dg-cell>{{ p.kind }} <span class="os-mono os-muted">·{{ p.hostRef }}</span></clr-dg-cell>
        <clr-dg-cell><code class="os-mono">{{ p.capability }}</code></clr-dg-cell>
        <clr-dg-cell><span class="label" [ngClass]="h(p).pill">{{ h(p).label }}</span></clr-dg-cell>
        <clr-dg-cell><span class="label" [ngClass]="reg.isEnabled(p.id) ? 'label-success' : (reg.modelOf(p.id) === '미등록' ? 'label-warning' : '')">{{ lifecycleLabel(p.id) }}</span></clr-dg-cell>
        <clr-dg-cell class="os-mono">{{ p.consumePoint }}</clr-dg-cell>
        <clr-dg-cell class="os-actions">
          <button class="btn btn-sm" (click)="reg.setEnabled(p.id, false)" *ngIf="reg.isEnabled(p.id)">Disable</button>
          <button class="btn btn-sm btn-primary" (click)="reg.setEnabled(p.id, true)" *ngIf="!reg.isEnabled(p.id)">Enable</button>
          <button class="btn btn-sm" (click)="open(p)" [disabled]="!reg.isEnabled(p.id)">열기</button>
        </clr-dg-cell>
      </clr-dg-row>
      <clr-dg-footer>{{ reg.all.length }} plugin · Enable=선언형 설치·배포(control-plane SSA) · Disable=실회수(워크로드 제거, PVC 데이터 보존) · 정본=FoundationModel &lt;domain&gt; parameters.engines — 등록/해지는 deploy/foundationmodels.yaml 선언.</clr-dg-footer>
    </clr-datagrid>
  `,
})
export class FoundationAdminComponent {
  readonly reg = inject(FoundationRegistryService);
  private vr = inject(ViewRouter);
  h(p: HostedPlugin) { return this.reg.health(p); }
  open(p: HostedPlugin): void { this.vr.setModule(p.view.module); }
  /** CR 실태 라벨 — Installed=Enabled, Disabled, CR 부재='미등록', 로드 전=Enabled(낙관). */
  lifecycleLabel(id: string): string {
    const m = this.reg.modelOf(id);
    if (m === 'Installed' || m === null) { return 'Enabled'; }
    return m === 'Disabled' ? 'Disabled' : '미등록';
  }
}
