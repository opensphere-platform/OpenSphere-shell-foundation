import { Injectable, inject, signal } from '@angular/core';
import { FoundationRegistryService } from '../registry/foundation-registry.service';

export type EngineRuntimeState =
  | 'loading'
  | 'ok'
  | 'disabled'
  | 'progressing'
  | 'degraded'
  | 'noperm'
  | 'nocrd'
  | 'error';

interface EngineAuthority {
  model: string;
  engine: string;
  observation: string;
}

const ENGINE_AUTHORITY: Record<string, EngineAuthority> = {
  keycloak: { model: 'identity', engine: 'keycloak', observation: 'keycloak_up' },
  syncope: { model: 'identity', engine: 'syncope', observation: 'syncope_up' },
  samba: { model: 'identity', engine: 'samba', observation: 'samba_up' },
  opa: { model: 'identity', engine: 'opa', observation: 'opa_up' },
  postgres: { model: 'data', engine: 'postgres', observation: 'pg_up' },
  psmdb: { model: 'data', engine: 'psmdb', observation: 'psmdb_up' },
  valkey: { model: 'data', engine: 'valkey', observation: 'valkey_up' },
  rustfs: { model: 'data', engine: 'rustfs', observation: 'rustfs_up' },
  opensearch: { model: 'data', engine: 'opensearch', observation: 'opensearch_up' },
  litellm: { model: 'ai', engine: 'litellm', observation: 'litellm_up' },
  langfuse: { model: 'ai', engine: 'langfuse', observation: 'langfuse_up' },
  stalwart: { model: 'communication', engine: 'stalwart', observation: 'stalwart_up' },
  novu: { model: 'communication', engine: 'novu', observation: 'novu_up' },
  mattermost: { model: 'communication', engine: 'mattermost', observation: 'mattermost_up' },
  otel: { model: 'observability', engine: 'otel', observation: 'collector_up' },
  tempo: { model: 'observability', engine: 'tempo', observation: 'tempo_up' },
  loki: { model: 'observability', engine: 'loki', observation: 'loki_up' },
  grafana: { model: 'observability', engine: 'grafana', observation: 'grafana_up' },
  backup: { model: 'backup', engine: 'ptm', observation: 'ptm_operator_up' },
};

// PFS 모듈 카탈로그의 런타임 상태 정본은 FoundationModel이다.
// Deployment/CRD가 남아 있다는 사실은 설치 의도나 준비 상태가 아니므로 직접 existence probe로 Live를 만들지 않는다.
@Injectable({ providedIn: 'root' })
export class EnginesService {
  private readonly reg = inject(FoundationRegistryService);
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);
  private started = false;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.busy.set(true);
    try {
      await this.reg.refreshModels();
      try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
    } finally {
      this.busy.set(false);
    }
  }

  liveState(key: string): EngineRuntimeState {
    const load = this.reg.modelsLoaded();
    if (load === 'loading') { return 'loading'; }
    if (load === 'noperm') { return 'noperm'; }
    if (load === 'error') { return 'error'; }

    const authority = ENGINE_AUTHORITY[key];
    if (!authority) { return 'nocrd'; }
    const domain = this.reg.domainState(authority.model);
    if (!domain) { return 'nocrd'; }
    if (domain.desired !== 'Installed' || domain.phase === 'Disabled') { return 'disabled'; }

    const configured = Object.keys(domain.engines);
    if (configured.length > 0 && domain.engines[authority.engine] !== 'enabled') { return 'disabled'; }
    if (['Failed', 'Blocked', 'Degraded'].includes(domain.phase)) { return 'degraded'; }
    if (domain.phase !== 'Installed') { return 'progressing'; }
    if (!domain.operatorDeployed) { return 'degraded'; }

    const observation = domain.observed.find((item) => item.id === authority.observation);
    return observation?.healthy === true ? 'ok' : 'degraded';
  }
}
