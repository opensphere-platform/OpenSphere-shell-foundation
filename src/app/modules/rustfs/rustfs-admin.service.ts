import { Injectable, computed, inject, signal } from '@angular/core';
import { apiBase, hostFetch, writeHeaders } from '../../api-base';
import { DataEngineRuntimeService } from '../data-engine/data-engine-runtime.service';

export interface RustFSBucket { name: string; createdAt: string }
export interface RustFSSummary {
  authority: string;
  observedAt: string;
  version: string;
  endpoint: string;
  bucketCount: number;
  buckets: RustFSBucket[];
  desired: Record<string, any>;
  secretRef: { namespace: string; name: string; keys: string[] };
}
export interface RustFSOneTimeCredential { accessKey: string; secretKey: string }
export interface RustFSCredentialState { present: boolean; validKeys: boolean; name: string }

@Injectable({ providedIn: 'root' })
export class RustFSAdminService {
  readonly runtime = inject(DataEngineRuntimeService);
  readonly summary = signal<RustFSSummary | null>(null);
  readonly summaryState = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  readonly summaryError = signal('');
  readonly operationError = signal('');
  readonly oneTimeCredential = signal<RustFSOneTimeCredential | null>(null);
  readonly credentialState = signal<RustFSCredentialState | null>(null);
  readonly lastSync = signal('');
  readonly busy = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private refs = 0;

  readonly rt = computed(() => this.runtime.runtime('rustfs'));
  readonly exists = computed(() => this.rt().state === 'ok' && !!this.rt().resource);
  readonly ready = computed(() => this.runtime.ready('rustfs'));
  readonly readyN = computed(() => this.runtime.readyN('rustfs'));
  readonly totalN = computed(() => this.runtime.totalN('rustfs'));
  readonly availability = computed(() => this.totalN() ? Math.round(this.readyN() / this.totalN() * 100) : 0);
  readonly image = computed(() => this.runtime.image('rustfs'));
  readonly capacity = computed(() => this.rt().pvcs[0]?.status?.capacity?.storage || this.rt().pvcs[0]?.spec?.resources?.requests?.storage || '—');
  readonly storageClass = computed(() => this.rt().pvcs[0]?.spec?.storageClassName || '—');

  start(): void {
    this.refs++;
    this.runtime.start();
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 15000);
  }
  stop(): void {
    this.refs = Math.max(0, this.refs - 1);
    this.runtime.stop();
    if (this.refs || !this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.runtime.refresh('rustfs');
    await Promise.allSettled([this.loadSummary(), this.loadCredentialState()]);
    this.lastSync.set(new Date().toLocaleTimeString());
    this.busy.set(false);
  }

  async loadSummary(): Promise<void> {
    if (!this.exists()) {
      this.summary.set(null);
      this.summaryState.set('empty');
      this.summaryError.set('RustFS StatefulSet이 생성되면 S3 관리 API를 연결합니다.');
      return;
    }
    try {
      const response = await hostFetch(this.api('summary'), { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      this.summary.set(body as RustFSSummary);
      this.summaryState.set('ok');
      this.summaryError.set('');
    } catch (error) {
      this.summaryState.set('error');
      this.summaryError.set(`RustFS 관리 API 조회 실패: ${String((error as Error)?.message ?? error)}`);
    }
  }

  async createCredential(reason: string): Promise<void> {
    const body = await this.post('credential', { name: 'rustfs-credentials', reason });
    this.oneTimeCredential.set({ accessKey: String(body.accessKey || ''), secretKey: String(body.secretKey || '') });
    await this.loadCredentialState();
  }

  private async loadCredentialState(): Promise<void> {
    try {
      const response = await hostFetch(this.api('credential'), { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      this.credentialState.set(body as RustFSCredentialState);
    } catch {
      this.credentialState.set(null);
    }
  }
  async mutateBucket(action: 'create' | 'delete', name: string, reason: string): Promise<void> {
    await this.post('bucket', { action, name, reason });
    await this.loadSummary();
  }

  private api(path: string): string { return `${apiBase()}/api/foundation/rustfs/${path}`; }
  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    this.operationError.set('');
    try {
      const response = await hostFetch(this.api(path), { method: 'POST', headers: writeHeaders(), body: JSON.stringify(body), cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      this.operationError.set(message);
      throw error;
    }
  }
}
