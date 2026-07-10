import { Injectable, computed, signal } from '@angular/core';
import { apiBase, hostFetch, writeHeaders } from '../../api-base';

const CP_NS = 'opensphere-system';
const CP_DEPLOY = 'foundation-control-plane';
const CP_CONTAINER = 'manager';
const ARG_PREFIX = '--default-storage-class=';

export interface StorageClassRow {
  name: string; provisioner: string; isDefault: boolean;
  reclaimPolicy: string; bindingMode: string; pvcCount: number;
}

// StorageClass 상세 — 다른 6개와 달리 "설치 대상"이 아니라 "이미 있는 것 중 고르는 대상"이다(사용자 확인, 2026-07-04).
// 선택 결과는 foundation-control-plane Deployment의 --default-storage-class 인자에 반영된다
// (host_requirements.go의 cfg.defaultStorageClass 단일 선언점 — 모델별 override는 FoundationModel.spec.parameters에서 별도).
@Injectable({ providedIn: 'root' })
export class StorageClassService {
  readonly classes = signal<StorageClassRow[]>([]);
  readonly currentDefault = signal<string>('standard'); // Go 플래그 기본값과 동일
  readonly selected = signal<string>('');
  readonly cpArgs = signal<string[]>([]);

  readonly applyState = signal<'idle' | 'applying' | 'done' | 'error'>('idle');
  readonly applyError = signal<string>('');

  readonly lastSync = signal<string>('');
  readonly busy = signal(false);
  private started = false;
  private timer: any = null;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 15000);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.started = false; }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([this.loadClasses(), this.loadCurrentDefault(), this.loadPvcCounts()]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private pvcByClass = new Map<string, number>();

  private async loadClasses(): Promise<void> {
    try {
      const r = await hostFetch(this.k('apis/storage.k8s.io/v1/storageclasses'));
      if (!r.ok) { return; }
      const items: any[] = (await r.json()).items ?? [];
      this.classes.set(items.map((it) => ({
        name: it.metadata?.name ?? '',
        provisioner: it.provisioner ?? '',
        isDefault: it.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
        reclaimPolicy: it.reclaimPolicy ?? '',
        bindingMode: it.volumeBindingMode ?? '',
        pvcCount: this.pvcByClass.get(it.metadata?.name ?? '') ?? 0,
      })));
      if (!this.selected()) {
        this.selected.set(this.currentDefault() || this.classes().find((c) => c.isDefault)?.name || this.classes()[0]?.name || '');
      }
    } catch { /* noop */ }
  }

  private async loadPvcCounts(): Promise<void> {
    try {
      const r = await hostFetch(this.k('api/v1/persistentvolumeclaims'));
      if (!r.ok) { return; }
      const items: any[] = (await r.json()).items ?? [];
      const m = new Map<string, number>();
      for (const it of items) {
        const sc = it.spec?.storageClassName ?? '';
        if (!sc) { continue; }
        m.set(sc, (m.get(sc) ?? 0) + 1);
      }
      this.pvcByClass = m;
      this.classes.update((rows) => rows.map((r2) => ({ ...r2, pvcCount: m.get(r2.name) ?? 0 })));
    } catch { /* noop */ }
  }

  private async loadCurrentDefault(): Promise<void> {
    try {
      const r = await hostFetch(this.k(`apis/apps/v1/namespaces/${CP_NS}/deployments/${CP_DEPLOY}`));
      if (!r.ok) { return; }
      const j = await r.json();
      const containers: any[] = j.spec?.template?.spec?.containers ?? [];
      const c = containers.find((x) => x.name === CP_CONTAINER) ?? containers[0];
      const args: string[] = c?.args ?? [];
      this.cpArgs.set(args);
      const found = args.find((a) => a.startsWith(ARG_PREFIX));
      if (found) { this.currentDefault.set(found.slice(ARG_PREFIX.length)); }
    } catch { /* noop */ }
  }

  select(name: string): void { this.selected.set(name); }

  readonly isDirty = computed<boolean>(() => !!this.selected() && this.selected() !== this.currentDefault());

  /** 실제 적용 — foundation-control-plane Deployment의 --default-storage-class 인자를 선언형 PATCH(strategic merge)로 교체.
   *  이 인자가 host_requirements.go의 cfg.defaultStorageClass 유일 선언점이라, 컨트롤플레인 재기동이 뒤따른다. */
  async apply(): Promise<void> {
    if (!this.isDirty() || this.applyState() === 'applying') { return; }
    this.applyState.set('applying');
    this.applyError.set('');
    const next = this.cpArgs().filter((a) => !a.startsWith(ARG_PREFIX));
    next.push(`${ARG_PREFIX}${this.selected()}`);
    const body = { spec: { template: { spec: { containers: [{ name: CP_CONTAINER, args: next }] } } } };
    try {
      const r = await hostFetch(this.k(`apis/apps/v1/namespaces/${CP_NS}/deployments/${CP_DEPLOY}`), {
        method: 'PATCH', headers: { ...writeHeaders(), 'content-type': 'application/strategic-merge-patch+json' },
        body: JSON.stringify(body),
      });
      if (r.status === 403) { this.applyState.set('error'); this.applyError.set('적용 권한 없음 — 콘솔 관리자 그룹 필요.'); return; }
      if (!r.ok) { this.applyState.set('error'); this.applyError.set(`적용 실패 (HTTP ${r.status})`); return; }
      this.applyState.set('done');
      this.cpArgs.set(next);
      this.currentDefault.set(this.selected());
      setTimeout(() => this.applyState.set('idle'), 4000);
    } catch { this.applyState.set('error'); this.applyError.set('네트워크 오류'); }
  }

  dismissError(): void { this.applyState.set('idle'); this.applyError.set(''); }
}
