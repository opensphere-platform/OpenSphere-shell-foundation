import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { EnginesService } from './engines.service';
import { FoundationRegistryService } from '../registry/foundation-registry.service';
import { ViewRouter } from '../view-router';

@Component({
  selector: 'app-opensearch-engine',
  standalone: true,
  imports: [CommonModule, ClarityModule],
  template: `
    <div class="os-title-row">
      <h2 class="os-h2">OpenSearch <span class="label label-info">FSS data engine</span></h2>
      <div class="os-actions">
        <button class="btn btn-sm" (click)="back()">Back to FSS Engines</button>
        <button class="btn btn-sm btn-primary" (click)="openPlugin()" [disabled]="!installed()">Open Plugin</button>
      </div>
    </div>

    <p class="os-sub">
      OpenSearch is installed from the FSS engine catalog. The management page becomes meaningful only after
      this engine is declared in <code>FoundationModel/data.spec.parameters.engines.opensearch</code> and the
      control-plane prepares the shared search endpoint.
    </p>

    <clr-alert *ngIf="message()" [clrAlertType]="messageType()" [clrAlertClosable]="true" (clrAlertClosedChange)="message.set('')">
      <clr-alert-item><span class="alert-text">{{ message() }}</span></clr-alert-item>
    </clr-alert>

    <div class="clr-row">
      <div class="clr-col-lg-5 clr-col-md-12">
        <div class="card">
          <div class="card-header">Install Declaration</div>
          <div class="card-block">
            <div class="clr-row os-kv-row">
              <div class="clr-col-5 os-dim">Domain</div><div class="clr-col-7 os-mono">data</div>
              <div class="clr-col-5 os-dim">Engine key</div><div class="clr-col-7 os-mono">opensearch</div>
              <div class="clr-col-5 os-dim">Target namespace</div><div class="clr-col-7 os-mono">opensphere-foundation</div>
              <div class="clr-col-5 os-dim">Endpoint</div><div class="clr-col-7 os-mono">http://opensphere-search.opensphere-foundation.svc:9200</div>
              <div class="clr-col-5 os-dim">Profile</div><div class="clr-col-7">dev single-node, security plugin disabled</div>
            </div>
            <p class="os-sub">
              This first phase intentionally prepares a small shared cluster. Operator/Crossplane managed
              OpenSearch remains the production promotion path.
            </p>
          </div>
          <div class="card-footer">
            <button class="btn btn-primary" (click)="prepare()" [disabled]="busy() || installed()">
              <span class="spinner spinner-inline" *ngIf="busy()"></span>
              Prepare OpenSearch
            </button>
            <button class="btn btn-sm" (click)="refresh()" [disabled]="busy()">Refresh</button>
          </div>
        </div>
      </div>

      <div class="clr-col-lg-7 clr-col-md-12">
        <div class="card">
          <div class="card-header">Readiness</div>
          <div class="card-block">
            <clr-datagrid>
              <clr-dg-column>Check</clr-dg-column>
              <clr-dg-column>Status</clr-dg-column>
              <clr-dg-column>Meaning</clr-dg-column>
              <clr-dg-row>
                <clr-dg-cell>FoundationModel/data</clr-dg-cell>
                <clr-dg-cell><span class="label" [ngClass]="modelPill()">{{ modelLabel() }}</span></clr-dg-cell>
                <clr-dg-cell>Admin install declaration for the data domain.</clr-dg-cell>
              </clr-dg-row>
              <clr-dg-row>
                <clr-dg-cell>OpenSearch workload</clr-dg-cell>
                <clr-dg-cell><span class="label" [ngClass]="livePill()">{{ liveLabel() }}</span></clr-dg-cell>
                <clr-dg-cell>StatefulSet <code>opensphere-search</code> observed by the FSS engine catalog.</clr-dg-cell>
              </clr-dg-row>
              <clr-dg-row>
                <clr-dg-cell>Crossplane path</clr-dg-cell>
                <clr-dg-cell><span class="label label-warning">Next</span></clr-dg-cell>
                <clr-dg-cell>Promotion target for operator-backed production installs and claim ownership.</clr-dg-cell>
              </clr-dg-row>
            </clr-datagrid>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class OpenSearchEngineComponent {
  readonly svc = inject(EnginesService);
  readonly reg = inject(FoundationRegistryService);
  readonly vr = inject(ViewRouter);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly messageType = signal<'success' | 'danger' | 'warning' | 'info'>('info');

  installed(): boolean { return this.reg.modelOf('opensearch') === 'Installed'; }

  async prepare(): Promise<void> {
    this.busy.set(true);
    await this.reg.setEnabled('opensearch', true);
    await this.svc.refresh();
    this.busy.set(false);
    if (this.reg.lastError()) {
      this.messageType.set('danger');
      this.message.set(this.reg.lastError());
      return;
    }
    this.messageType.set('success');
    this.message.set('OpenSearch install declaration is prepared. The control-plane will reconcile the workload.');
  }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([this.reg.refreshModels(), this.svc.refresh()]);
    this.busy.set(false);
  }

  back(): void { this.vr.setTab('overview'); }
  openPlugin(): void { this.vr.setModule('opensearch'); }
  modelPill(): string {
    const s = this.reg.modelOf('opensearch');
    if (s === 'Installed') { return 'label-success'; }
    if (s === 'Disabled') { return 'label-warning'; }
    if (s === null) { return ''; }
    return 'label-danger';
  }

  modelLabel(): string {
    const s = this.reg.modelOf('opensearch');
    if (s === 'Installed') { return 'Declared'; }
    if (s === 'Disabled') { return 'Disabled'; }
    if (s === null) { return 'Loading'; }
    return 'Not registered';
  }

  livePill(): string {
    const s = this.svc.liveState('opensearch');
    if (s === 'ok') { return 'label-success'; }
    if (s === 'loading') { return ''; }
    if (s === 'nocrd') { return 'label-warning'; }
    return 'label-danger';
  }

  liveLabel(): string {
    const s = this.svc.liveState('opensearch');
    return { loading: 'Checking', ok: 'Workload found', empty: 'Workload found', nocrd: 'Not prepared', noperm: 'No permission', error: 'Lookup failed' }[s];
  }
}
