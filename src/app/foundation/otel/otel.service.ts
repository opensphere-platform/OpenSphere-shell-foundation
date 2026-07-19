import { Injectable, computed, signal } from '@angular/core';
import { apiBase, hostFetch, writeHeaders } from '../../api-base';
import { State } from '../../modules/postgres/cnpg.types';

export interface OtelVersion { chart: string; app: string; note?: string }

// 실측(helm search open-telemetry/opentelemetry-collector, 2026-07-04). 최신순.
export const OTEL_VERSIONS: OtelVersion[] = [
  { chart: '0.162.0', app: '0.154.0', note: '최신' },
  { chart: '0.159.0', app: '0.154.0' },
  { chart: '0.111.0', app: '0.111.0', note: '기존 배선 이미지와 동일 태그' },
];

// PFS member operands share one ownership and policy boundary. The Helm operator
// itself remains external, but the Collector workload belongs here.
const NS = 'opensphere-foundation';

export interface InstallPlan { chart: string; app: string; namespace: string; image: string; imageOrigin: string }

// OpenTelemetry Collector(중앙 게이트웨이) 상세 — 각 모듈 사이드카 수집기(otel-collector-contrib:0.111.0, 이미 배선됨)와
// 별개로, 여러 모듈의 지표·로그·추적을 한곳에서 받아 Basic Prometheus로 넘기는 중앙 수집기. Velero와 동일하게
// Crossplane provider-helm Release로 실제 설치(INV-1 준수).
@Injectable({ providedIn: 'root' })
export class OtelService {
  readonly deploy = signal<any>(null);
  readonly deployState = signal<State>('loading');
  readonly pods = signal<any[]>([]);

  readonly selectedChart = signal<string>(OTEL_VERSIONS[0].chart);
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);
  private started = false;
  readonly versions = OTEL_VERSIONS;

  readonly installState = signal<'idle' | 'installing' | 'error'>('idle');
  readonly progress = signal<number>(0);
  readonly logs = signal<string[]>([]);
  readonly installError = signal<string>('');
  private watchTimer: any = null;
  private milestones = new Set<string>();
  private seenEvents = new Set<string>();
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
    await Promise.allSettled([this.loadDeploy(), this.loadPods()]);
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  private async loadDeploy(): Promise<void> {
    try {
      const r = await hostFetch(this.k(`apis/apps/v1/namespaces/${NS}/deployments/otel-collector-opentelemetry-collector`));
      if (r.status === 403) { this.deployState.set('noperm'); return; }
      if (!r.ok) { this.deployState.set('nocrd'); this.deploy.set(null); return; }
      this.deploy.set(await r.json());
      this.deployState.set('ok');
    } catch { this.deployState.set('error'); }
  }
  private async loadPods(): Promise<void> {
    try {
      const r = await hostFetch(this.k(`api/v1/namespaces/${NS}/pods`));
      this.pods.set(r.ok ? ((await r.json()).items ?? []) : []);
    } catch { this.pods.set([]); }
  }

  readonly installed = computed<boolean>(() => this.deployState() === 'ok');
  readonly readyN = computed<number>(() => this.deploy()?.status?.readyReplicas ?? 0);
  readonly totalN = computed<number>(() => this.deploy()?.spec?.replicas ?? this.pods().length ?? 0);
  readonly ready = computed<boolean>(() => this.readyN() > 0);
  readonly installedImage = computed<string>(() => this.deploy()?.spec?.template?.spec?.containers?.[0]?.image ?? '');
  readonly phaseLabel = computed<string>(() => {
    if (this.deployState() === 'loading') { return '확인 중'; }
    if (!this.installed()) { return '미설치'; }
    return this.ready() ? 'Running' : '기동 중';
  });

  readonly canInstall = computed<boolean>(() => !this.installed());

  readonly plan = computed<InstallPlan>(() => {
    const v = this.versions.find((x) => x.chart === this.selectedChart()) ?? this.versions[0];
    return {
      chart: v.chart, app: v.app, namespace: NS,
      image: `ghcr.io/opensphere-platform/mirror/opentelemetry-collector-contrib:${v.app}`,
      imageOrigin: `otel/opentelemetry-collector-contrib:${v.app} (OpenSphere curated GHCR mirror)`,
    };
  });

  selectChart(chart: string): void { this.selectedChart.set(chart); }

  private log(m: string): void {
    let t = ''; try { t = new Date().toLocaleTimeString(); } catch { /* noop */ }
    this.logs.update((l) => [...l, `[${t}] ${m}`]);
  }
  private milestone(key: string, m: string): void {
    if (this.milestones.has(key)) { return; }
    this.milestones.add(key);
    this.log(m);
  }

  /** Crossplane provider-helm Release CR을 선언형(POST)으로 생성 — helm 직접 실행 없음(INV-1). */
  async install(): Promise<void> {
    if (!this.canInstall() || this.installState() === 'installing') { return; }
    const v = this.versions.find((x) => x.chart === this.selectedChart()) ?? this.versions[0];
    this.installState.set('installing');
    this.progress.set(5);
    this.logs.set([]);
    this.installError.set('');
    this.milestones.clear();
    this.seenEvents.clear();
    this.log(`OpenTelemetry Collector chart ${v.chart} 설치 시작 — Crossplane provider-helm 경유`);

    const rel = {
      apiVersion: 'helm.crossplane.io/v1beta1', kind: 'Release',
      metadata: { name: 'otel-collector' },
      spec: {
        forProvider: {
          namespace: NS,
          chart: { name: 'opentelemetry-collector', repository: 'https://open-telemetry.github.io/opentelemetry-helm-charts', version: v.chart },
          values: {
            mode: 'deployment',
            command: { name: 'otelcol-contrib' },
            image: { repository: 'ghcr.io/opensphere-platform/mirror/opentelemetry-collector-contrib', tag: v.app },
            imagePullSecrets: [{ name: 'ghcr-pull' }],
          },
        },
        providerConfigRef: { name: 'default' },
      },
    };
    try {
      const r = await hostFetch(this.k('apis/helm.crossplane.io/v1beta1/releases'), {
        method: 'POST', headers: writeHeaders(), body: JSON.stringify(rel),
      });
      if (r.status === 403) {
        this.installState.set('error');
        this.installError.set('설치 권한 없음 — 콘솔 사용자에게 Release 생성 권한이 필요합니다.');
        this.log('✕ 403 권한 없음'); return;
      }
      if (r.status === 409) { this.log('Release가 이미 존재 — 상태 감시로 전환'); }
      else if (!r.ok) { this.installState.set('error'); this.installError.set(`설치 요청 실패 (HTTP ${r.status})`); this.log(`✕ 실패 ${r.status}`); return; }
      else { this.progress.set(15); this.log('Release/otel-collector 생성됨 — provider-helm이 차트를 적용합니다'); }
      this.startWatch();
    } catch { this.installState.set('error'); this.installError.set('네트워크 오류'); this.log('✕ 네트워크 오류'); }
  }

  private startWatch(): void {
    this.stopWatch();
    this.watchTimer = setInterval(() => this.pollInstall(), 3000);
    this.pollInstall();
  }
  private stopWatch(): void { if (this.watchTimer) { clearInterval(this.watchTimer); this.watchTimer = null; } }

  private async pollInstall(): Promise<void> {
    let synced = false;
    try {
      const r = await hostFetch(this.k('apis/helm.crossplane.io/v1beta1/releases/otel-collector'));
      if (r.ok) {
        const rel = await r.json();
        synced = (rel.status?.conditions ?? []).some((c: any) => c.type === 'Synced' && c.status === 'True');
      }
    } catch { /* noop */ }
    await Promise.allSettled([this.loadDeploy(), this.loadPods()]);
    const deploy = this.deployState() === 'ok';
    const ready = this.ready();

    try {
      const r = await hostFetch(this.k(`api/v1/namespaces/${NS}/events?limit=25`));
      if (r.ok) {
        const items = (await r.json()).items ?? [];
        items.sort((a: any, b: any) => (a.lastTimestamp || '').localeCompare(b.lastTimestamp || ''))
          .forEach((e: any) => {
            const key = e.metadata?.uid || `${e.reason}:${e.message}`;
            if (this.seenEvents.has(key)) { return; }
            this.seenEvents.add(key);
            const obj = e.involvedObject?.kind ? `${e.involvedObject.kind}/${e.involvedObject.name}` : '';
            this.log(`${obj} ${e.reason}: ${e.message}`.trim());
          });
      }
    } catch { /* noop */ }

    if (synced) { this.milestone('synced', 'provider-helm: 차트 적용 완료 (Synced)'); }
    if (deploy) { this.milestone('deploy', 'Deployment 생성됨'); }

    let p = 15;
    if (synced) { p = Math.max(p, 45); }
    if (deploy) { p = Math.max(p, 75); }
    if (ready) { p = 100; }
    this.progress.set(p);

    if (ready && this.installed()) {
      this.milestone('done', '✓ 파드 Running — 설치 완료');
      this.installState.set('idle');
      this.stopWatch();
    }
  }

  dismissError(): void { this.installState.set('idle'); this.installError.set(''); this.progress.set(0); }
}
