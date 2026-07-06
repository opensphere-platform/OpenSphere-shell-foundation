import { Injectable, computed, signal } from '@angular/core';
import { apiBase } from '../../api-base';
import { State } from '../../modules/postgres/cnpg.types';

const NS = 'monitoring';

export interface TargetRow { job: string; up: number; down: number }
export interface AlertRow { name: string; severity: string; state: string }

// kube-prometheus-stack 상세 — 상태 전용(설치 버튼 없음). 이미 부트스트랩 스크립트로 설치·운영 중인
// 콘솔 자신의 관측 백엔드라 여기서 재설치/전환을 시도하지 않는다(사용자 확정, 2026-07-04).
@Injectable({ providedIn: 'root' })
export class PromStackService {
  readonly promState = signal<State>('loading');
  readonly promReady = signal(0);
  readonly promTotal = signal(0);
  readonly amState = signal<State>('loading');
  readonly grafanaState = signal<State>('loading');

  readonly targets = signal<TargetRow[]>([]);
  readonly alerts = signal<AlertRow[]>([]);
  readonly seriesCount = signal<number>(0);

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
  private prom(query: string): string { return `${apiBase()}/api/prometheus/api/v1/query?query=${encodeURIComponent(query)}`; }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([
      this.loadPrometheus(), this.loadAlertmanager(), this.loadGrafana(),
      this.loadTargets(), this.loadAlerts(), this.loadSeries(),
    ]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async loadPrometheus(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${NS}/statefulsets/prometheus-kps-prometheus`));
      if (r.status === 403) { this.promState.set('noperm'); return; }
      if (!r.ok) { this.promState.set('nocrd'); return; }
      const j = await r.json();
      this.promReady.set(j.status?.readyReplicas ?? 0);
      this.promTotal.set(j.spec?.replicas ?? 0);
      this.promState.set('ok');
    } catch { this.promState.set('error'); }
  }
  private async loadAlertmanager(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${NS}/statefulsets/alertmanager-kps-alertmanager`));
      if (r.status === 403) { this.amState.set('noperm'); return; }
      if (!r.ok) { this.amState.set('nocrd'); return; }
      const j = await r.json();
      this.amState.set((j.status?.readyReplicas ?? 0) > 0 ? 'ok' : 'error');
    } catch { this.amState.set('error'); }
  }
  private async loadGrafana(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${NS}/deployments/kps-grafana`));
      if (r.status === 403) { this.grafanaState.set('noperm'); return; }
      if (!r.ok) { this.grafanaState.set('nocrd'); return; }
      const j = await r.json();
      this.grafanaState.set((j.status?.readyReplicas ?? 0) > 0 ? 'ok' : 'error');
    } catch { this.grafanaState.set('error'); }
  }

  private async loadTargets(): Promise<void> {
    try {
      const r = await fetch(`${apiBase()}/api/prometheus/api/v1/targets`);
      if (!r.ok) { return; }
      const j = await r.json();
      const active: any[] = j?.data?.activeTargets ?? [];
      const byJob = new Map<string, TargetRow>();
      for (const t of active) {
        const job = t.labels?.job || t.scrapePool || 'unknown';
        const row = byJob.get(job) ?? { job, up: 0, down: 0 };
        if (t.health === 'up') { row.up++; } else { row.down++; }
        byJob.set(job, row);
      }
      this.targets.set([...byJob.values()].sort((a, b) => (b.up + b.down) - (a.up + a.down)));
    } catch { /* noop */ }
  }

  private async loadAlerts(): Promise<void> {
    try {
      const r = await fetch(this.prom('ALERTS'));
      if (!r.ok) { this.alerts.set([]); return; }
      const j = await r.json();
      const rows: any[] = j?.data?.result ?? [];
      this.alerts.set(rows.map((row) => ({
        name: row.metric?.alertname ?? 'unknown',
        severity: row.metric?.severity ?? 'none',
        state: row.metric?.alertstate ?? 'unknown',
      })).filter((a) => a.state === 'firing'));
    } catch { this.alerts.set([]); }
  }

  private async loadSeries(): Promise<void> {
    try {
      const r = await fetch(this.prom('prometheus_tsdb_head_series'));
      if (!r.ok) { return; }
      const j = await r.json();
      const v = j?.data?.result?.[0]?.value?.[1];
      this.seriesCount.set(v ? Math.round(Number(v)) : 0);
    } catch { /* noop */ }
  }

  readonly phaseLabel = computed<string>(() => {
    if (this.promState() === 'loading') { return '확인 중'; }
    return this.promState() === 'ok' ? 'Running' : '문제 있음';
  });

  readonly targetsUp = computed<number>(() => this.targets().reduce((s, t) => s + t.up, 0));
  readonly targetsDown = computed<number>(() => this.targets().reduce((s, t) => s + t.down, 0));
}
