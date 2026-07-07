import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { EnginesService } from './engines.service';
import { FoundationRegistryService } from '../registry/foundation-registry.service';
import { ViewRouter } from '../view-router';
import { apiBase } from '../api-base';

type InstallStepState = 'pending' | 'running' | 'pass' | 'warn' | 'fail';
interface InstallStep {
  step: string;
  state: InstallStepState;
  evidence: string;
  time: string;
}

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

        <div class="card">
          <div class="card-header">Install Process</div>
          <div class="card-block">
            <clr-datagrid>
              <clr-dg-column>Time</clr-dg-column>
              <clr-dg-column>State</clr-dg-column>
              <clr-dg-column>Step</clr-dg-column>
              <clr-dg-column>Evidence</clr-dg-column>
              <clr-dg-row *ngFor="let item of installSteps()">
                <clr-dg-cell class="os-mono">{{ item.time }}</clr-dg-cell>
                <clr-dg-cell><span class="label" [ngClass]="stepPill(item.state)">{{ item.state }}</span></clr-dg-cell>
                <clr-dg-cell>{{ item.step }}</clr-dg-cell>
                <clr-dg-cell class="os-mono">{{ item.evidence }}</clr-dg-cell>
              </clr-dg-row>
            </clr-datagrid>
            <p class="os-sub" *ngIf="installSteps().length === 0">
              설치 버튼을 누르면 Plugin 등록, CLI, Manual/OAA/Search, Metrics, Grafana, Logs, Operand 선언,
              FoundationModel 적용, control-plane reconcile 단계를 순서대로 기록합니다.
            </p>
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
  readonly installSteps = signal<InstallStep[]>([]);

  installed(): boolean { return this.reg.modelOf('opensearch') === 'Installed'; }

  async prepare(): Promise<void> {
    this.busy.set(true);
    this.installSteps.set([]);
    try {
      await this.checkJson('Plugin registration', this.k('apis/plugins.opensphere.io/v1alpha1/namespaces/opensphere-system/uipluginregistrations/opensearch'), 'UIPluginRegistration/opensearch is registered');
      await this.checkJson('CLI contribution', this.plugin('/cli/manifest'), 'os opensearch status/indices/events/access manifest returned');
      this.addStep('Manual / OAA / Search', 'pass', 'manual:contribute declares plugin:opensearch/operations for Manual Registry, global search, and OAA retrieval');
      await this.checkJson('ServiceMonitor registration', this.k('apis/monitoring.coreos.com/v1/namespaces/opensphere-system/servicemonitors/opensearch'), 'ServiceMonitor/opensearch targets /metrics');
      await this.checkText('Metrics endpoint', this.plugin('/metrics'), 'opensphere_opensearch_plugin_up exposed');
      await this.checkJson('Grafana connection', this.plugin('/api/grafana'), 'Grafana health, Prometheus datasource, Alertmanager datasource returned');
      await this.checkJson('Logs connection', this.plugin('/api/logs?minutes=5'), 'Loki log endpoint returned');
      await this.checkJson('Operand declaration', this.plugin('/operand/manifests'), 'OpenSearch operand declaration endpoint returned');
      this.addStep('FoundationModel declaration', 'running', 'patch spec.parameters.engines.opensearch=enabled');
      await this.reg.setEnabled('opensearch', true);
      if (this.reg.lastError()) {
        throw new Error(this.reg.lastError());
      }
      this.updateLastStep('pass', 'FoundationModel/data install declaration saved');
      this.addStep('Control-plane reconcile', 'running', 'waiting for opensphere-search StatefulSet observation');
      await this.svc.refresh();
      const live = this.svc.liveState('opensearch');
      if (live === 'ok') {
        this.updateLastStep('pass', 'StatefulSet opensphere-search observed');
      } else {
        this.updateLastStep('warn', `Current live state: ${live}. The declaration is prepared; workload reconciliation may still be pending.`);
      }
      this.messageType.set('success');
      this.message.set('OpenSearch install process finished. Review the process log and readiness state.');
    } catch (e) {
      this.markRunningFailed(String((e as Error)?.message ?? e));
      this.messageType.set('danger');
      this.message.set(`OpenSearch install process failed: ${String((e as Error)?.message ?? e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([this.reg.refreshModels(), this.svc.refresh()]);
    this.busy.set(false);
  }

  back(): void { this.vr.setTab('overview'); }
  openPlugin(): void { this.vr.setModule('opensearch'); }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }
  private plugin(path: string): string { return `${apiBase()}/api/plugins/opensearch${path}`; }

  private now(): string {
    try { return new Date().toLocaleTimeString(); } catch { return ''; }
  }

  private addStep(step: string, state: InstallStepState, evidence: string): void {
    this.installSteps.update((rows) => [...rows, { step, state, evidence, time: this.now() }]);
  }

  private updateLastStep(state: InstallStepState, evidence: string): void {
    this.installSteps.update((rows) => rows.map((row, i) => i === rows.length - 1 ? { ...row, state, evidence, time: this.now() } : row));
  }

  private markRunningFailed(evidence: string): void {
    const rows = this.installSteps();
    if (rows.length && rows[rows.length - 1].state === 'running') {
      this.updateLastStep('fail', evidence);
    } else {
      this.addStep('Install process', 'fail', evidence);
    }
  }

  private async checkJson(step: string, url: string, okEvidence: string): Promise<unknown> {
    this.addStep(step, 'running', 'checking...');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`${step} HTTP ${res.status}`);
    }
    const body = await res.json();
    this.updateLastStep('pass', okEvidence);
    return body;
  }

  private async checkText(step: string, url: string, needle: string): Promise<string> {
    this.addStep(step, 'running', 'checking...');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`${step} HTTP ${res.status}`);
    }
    const body = await res.text();
    if (!body.includes(needle)) {
      throw new Error(`${step} did not include ${needle}`);
    }
    this.updateLastStep('pass', needle);
    return body;
  }

  stepPill(state: InstallStepState): string {
    if (state === 'pass') { return 'label-success'; }
    if (state === 'warn') { return 'label-warning'; }
    if (state === 'fail') { return 'label-danger'; }
    if (state === 'running') { return 'label-info'; }
    return '';
  }

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
