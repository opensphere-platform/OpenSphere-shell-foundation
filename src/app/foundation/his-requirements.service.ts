import { Injectable, signal } from '@angular/core';
import { apiBase, hostFetch } from '../api-base';

export type HisState = 'Ready' | 'Blocked' | 'Degraded';
export type HisMode = 'DetectOnly' | 'HelmManaged';

export interface HisRequirementItem {
  id: string;
  displayName: string;
  description: string;
  mode: HisMode;
  required: boolean;
  profileSelected?: boolean;
  effectiveRequired?: boolean;
  ownership: 'ClusterManager' | 'External' | 'Unmanaged' | 'Unknown';
  check: {
    state: HisState;
    reason: string;
    message: string;
    observedVersion: string;
    lastCheckedAt: string;
  };
}

export interface HisStatus {
  stack: 'HIS';
  state: HisState;
  checkedAt: string;
  items: HisRequirementItem[];
  summary: {
    coreReady: number;
    coreTotal: number;
    selectedProfilesReady: number;
    selectedProfilesTotal: number;
  };
}

// Foundation은 HIS를 소유하거나 Kubernetes를 다시 진단하지 않는다.
// Cluster Manager의 단일 HIS read model을 소비해 PFS 선행 요구조건만 투영한다.
@Injectable({ providedIn: 'root' })
export class HisRequirementsService {
  readonly status = signal<HisStatus | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly lastSync = signal('');
  private started = false;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await hostFetch(this.statusUrl(), { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Cluster Manager HIS status HTTP ${response.status}`);
      }
      const body = await response.json() as HisStatus;
      if (body?.stack !== 'HIS' || !Array.isArray(body?.items)) {
        throw new Error('Cluster Manager가 유효한 HIS status 계약을 반환하지 않았습니다.');
      }
      this.status.set(body);
      this.lastSync.set(body.checkedAt || new Date().toISOString());
    } catch (e: any) {
      this.status.set(null);
      this.error.set(e?.message || 'HIS 상태를 확인하지 못했습니다.');
    } finally {
      this.busy.set(false);
    }
  }

  private statusUrl(): string {
    return `${apiBase()}/api/foundation/his-status`;
  }
}
