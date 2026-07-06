import { Injectable, computed, signal } from '@angular/core';
import { apiBase, writeHeaders, tokenExpired, isAuthFail } from '../../api-base';
import { State } from '../../modules/postgres/cnpg.types';

// Velero 설치·상태 단일 데이터 진입점. Host 연결 카탈로그의 Velero 카드 클릭 시 열리는 전용 페이지가 소비.
// 원칙: "코드/설치 여부"와 "지금 클러스터 실재"를 분리해 정직하게 표시. 실 설치는 선언형 write-path(INV-1) —
// 이 페이지는 설치 계획(plan)을 준비하며, 실제 프로비저닝 배선은 후속(FoundationModel/Crossplane 경로 결정).

export interface VeleroVersion { chart: string; app: string; note?: string }

// 실측(helm search vmware-tanzu/velero, 2026-07-04). 최신순.
export const VELERO_VERSIONS: VeleroVersion[] = [
  { chart: '12.1.0', app: '1.18.1', note: '최신' },
  { chart: '12.0.3', app: '1.18.1' },
  { chart: '12.0.0', app: '1.18.0' },
  { chart: '11.4.0', app: '1.17.1' },
  { chart: '11.3.2', app: '1.17.1', note: 'LTS 후보' },
];

// 백업 대상은 외부 S3 호환 서비스(사용자 구성) — 클러스터 내부 저장소에 의존하지 않는다(2026-07-06, 사용자 방향).
// 공용 기본 대상은 이 페이지에서 구성하고, plugin은 필요 시 자기 전용 대상으로 override한다.
const VELERO_NS = 'velero';

export interface DepCheck {
  id: string;
  label: string;
  required: boolean;   // true=미충족 시 설치 차단(blocking), false=경고(정보)
  state: State;        // ok=충족
  detail: string;      // 충족/미충족 사유
  fixHint: string;     // 미충족 시 안내
}

// 설치 계획 = 설치 자체에 필요한 사실만. 백업 대상/방식 등 "이 모듈을 어떻게 쓸지"는
// 상위 소비 모듈(opensphere-backup)의 결정이라 여기 포함하지 않는다.
export interface InstallPlan {
  chart: string;
  app: string;
  namespace: string;
  image: string;          // GHCR 미러
  imageOrigin: string;
}

export interface VeleroMetrics {
  backupTotal: number; backupSuccess: number; backupFailure: number; backupPartial: number;
  restoreTotal: number; restoreSuccess: number; restoreFailure: number; restorePartial: number;
}

// 외부 S3 호환 백업 대상(사용자 구성). 저장 시 Velero Release CR values를 선언형 PATCH →
// provider-helm이 cloud-credentials Secret + BackupStorageLocation + node-agent DaemonSet을 한 번에 적용.
export interface BackupTarget {
  endpoint: string;   // s3Url — 외부 S3 엔드포인트(예: https://s3.ap-northeast-2.amazonaws.com)
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}
export interface BslView {
  name: string; phase: string; bucket: string; endpoint: string; region: string; isDefault: boolean; message?: string;
}

@Injectable({ providedIn: 'root' })
export class VeleroService {
  // 설치 상태
  readonly crdState = signal<State>('loading');       // backups.velero.io CRD
  readonly deploy = signal<any>(null);
  readonly deployState = signal<State>('loading');
  readonly pods = signal<any[]>([]);

  // 의존성 raw state
  readonly csiState = signal<State>('loading');

  // 백업 대상(외부 S3) — BackupStorageLocation + node-agent 실측. 저장 상태.
  readonly bsls = signal<BslView[]>([]);
  readonly bslState = signal<State>('loading');
  readonly nodeAgent = signal<{ desired: number; ready: number } | null>(null);
  readonly saveBusy = signal(false);
  readonly saveMsg = signal<string>('');
  readonly saveErr = signal<string>('');
  readonly sessionExpired = signal(false);   // 콘솔 15분 토큰 만료 — 새로고침(SSO 재발급) 유도

  // Prometheus(kube-prometheus-stack) 연계 — 백업/복원 이력 지표. 설치 후에만 의미 있음(스크레이프 대상 존재).
  readonly metricsState = signal<State>('loading');
  readonly metrics = signal<VeleroMetrics | null>(null);

  readonly selectedChart = signal<string>(VELERO_VERSIONS[0].chart);
  readonly lastSync = signal<string>('');
  readonly busy = signal(false);
  private started = false;

  // 설치 실행/진행 상태 — 실제 Crossplane provider-helm Release로 설치, 클러스터를 폴링해 진행바·로그 구성.
  readonly installState = signal<'idle' | 'installing' | 'error'>('idle');
  readonly progress = signal<number>(0);
  readonly logs = signal<string[]>([]);
  readonly installError = signal<string>('');
  private watchTimer: any = null;
  private milestones = new Set<string>();
  private seenEvents = new Set<string>();

  readonly versions = VELERO_VERSIONS;

  private timer: any = null;

  start(): void {
    if (this.started) { return; }
    this.started = true;
    this.refresh();
    // 상태는 살아있는 값 — 15초 자동 갱신(다른 모듈 서비스와 동일 주기). 설치 감시(3s watch)와 별개.
    this.timer = setInterval(() => this.refresh(), 15000);
  }
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // 설치 감시(watch)는 여기서 멈추지 않음 — 설치 중 페이지를 떠나도 완료 시 스스로 종료(pollInstall).
    this.started = false;
  }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }
  private prom(query: string): string { return `${apiBase()}/api/prometheus/api/v1/query?query=${encodeURIComponent(query)}`; }
  private async existsState(path: string): Promise<State> {
    try {
      const r = await fetch(this.k(path));
      if (r.status === 403) { return 'noperm'; }
      if (r.status === 404) { return 'nocrd'; }
      if (!r.ok) { return 'error'; }
      return 'ok';
    } catch { return 'error'; }
  }

  async refresh(): Promise<void> {
    this.busy.set(true);
    await Promise.allSettled([
      this.loadCrd(), this.loadDeploy(), this.loadPods(), this.loadCsi(),
    ]);
    if (this.installed()) {
      await Promise.allSettled([this.loadMetrics(), this.loadBsl(), this.loadNodeAgent()]);
    }
    this.busy.set(false);
    try { this.lastSync.set(new Date().toLocaleTimeString()); } catch { /* noop */ }
  }

  // kube-prometheus-stack 연계 — velero_backup_*/velero_restore_* 카운터를 한 번에 조회(ServiceMonitor로 스크레이프됨).
  private async loadMetrics(): Promise<void> {
    try {
      const q = '{__name__=~"velero_(backup|restore)_(total|success_total|failure_total|partial_failure_total)"}';
      const r = await fetch(this.prom(q));
      if (!r.ok) { this.metricsState.set(r.status === 403 ? 'noperm' : 'error'); return; }
      const j = await r.json();
      const rows: any[] = j?.data?.result ?? [];
      const val = (name: string) => {
        const row = rows.find((x) => x.metric?.__name__ === name);
        return row ? Math.round(Number(row.value?.[1] ?? 0)) : 0;
      };
      this.metrics.set({
        backupTotal: val('velero_backup_total'), backupSuccess: val('velero_backup_success_total'),
        backupFailure: val('velero_backup_failure_total'), backupPartial: val('velero_backup_partial_failure_total'),
        restoreTotal: val('velero_restore_total'), restoreSuccess: val('velero_restore_success_total'),
        restoreFailure: val('velero_restore_failed_total'), restorePartial: val('velero_restore_partial_failure_total'),
      });
      this.metricsState.set('ok');
    } catch { this.metricsState.set('error'); }
  }

  private async loadCrd(): Promise<void> {
    this.crdState.set(await this.existsState('apis/apiextensions.k8s.io/v1/customresourcedefinitions/backups.velero.io'));
  }
  private async loadDeploy(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${VELERO_NS}/deployments/velero`));
      if (r.status === 403) { this.deployState.set('noperm'); return; }
      if (!r.ok) { this.deployState.set('nocrd'); this.deploy.set(null); return; }
      this.deploy.set(await r.json());
      this.deployState.set('ok');
    } catch { this.deployState.set('error'); }
  }
  private async loadPods(): Promise<void> {
    try {
      const r = await fetch(this.k(`api/v1/namespaces/${VELERO_NS}/pods`));
      this.pods.set(r.ok ? ((await r.json()).items ?? []) : []);
    } catch { this.pods.set([]); }
  }
  // 백업 대상(외부 S3) 실측 — velero.io BackupStorageLocation.
  private async loadBsl(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/velero.io/v1/namespaces/${VELERO_NS}/backupstoragelocations`));
      if (r.status === 403) { this.bslState.set('noperm'); return; }
      if (!r.ok) { this.bslState.set(r.status === 404 ? 'nocrd' : 'error'); this.bsls.set([]); return; }
      const items: any[] = (await r.json()).items ?? [];
      this.bsls.set(items.map((b) => ({
        name: b.metadata?.name ?? '?',
        phase: b.status?.phase ?? 'Unknown',
        bucket: b.spec?.objectStorage?.bucket ?? '',
        endpoint: b.spec?.config?.s3Url ?? '',
        region: b.spec?.config?.region ?? '',
        isDefault: !!b.spec?.default,
        message: b.status?.message,
      })));
      this.bslState.set('ok');
    } catch { this.bslState.set('error'); }
  }
  // fs-backup 실행 주체 — node-agent DaemonSet(전 노드). 백업 대상 저장 시 함께 활성화됨.
  private async loadNodeAgent(): Promise<void> {
    try {
      const r = await fetch(this.k(`apis/apps/v1/namespaces/${VELERO_NS}/daemonsets/node-agent`));
      if (!r.ok) { this.nodeAgent.set(null); return; }
      const d = await r.json();
      this.nodeAgent.set({ desired: d.status?.desiredNumberScheduled ?? 0, ready: d.status?.numberReady ?? 0 });
    } catch { this.nodeAgent.set(null); }
  }
  private async loadCsi(): Promise<void> {
    this.csiState.set(await this.existsState('apis/apiextensions.k8s.io/v1/customresourcedefinitions/volumesnapshotclasses.snapshot.storage.k8s.io'));
  }

  // ── 파생 ──
  readonly installed = computed<boolean>(() => this.crdState() === 'ok' && this.deployState() === 'ok');
  // 준비 판정 권위 = Deployment.status.readyReplicas(kubectl과 동일 기준). 파드 조건은 폴백.
  readonly readyN = computed<number>(() => this.deploy()?.status?.readyReplicas ?? 0);
  readonly totalN = computed<number>(() => this.deploy()?.spec?.replicas ?? this.pods().length ?? 0);
  readonly ready = computed<boolean>(() => {
    if (this.readyN() > 0) { return true; }
    const p = this.pods().find((x) => (x.metadata?.labels?.['deploy'] === 'velero') || x.metadata?.name?.startsWith('velero-'));
    return !!p && (p.status?.conditions ?? []).some((c: any) => c.type === 'Ready' && c.status === 'True');
  });
  readonly installedImage = computed<string>(() => this.deploy()?.spec?.template?.spec?.containers?.[0]?.image ?? '');
  readonly installedVersion = computed<string>(() => {
    const m = (this.installedImage() || '').match(/velero:(v[\d.]+)/i);
    return m ? m[1] : '—';
  });
  readonly phaseLabel = computed<string>(() => {
    if (this.crdState() === 'loading' || this.deployState() === 'loading') { return '확인 중'; }
    if (!this.installed()) { return '미설치'; }
    return this.ready() ? 'Running' : '기동 중';
  });

  // 공용 기본 백업 대상 = default BSL(없으면 첫 BSL).
  readonly defaultBsl = computed<BslView | null>(() => this.bsls().find((b) => b.isDefault) ?? this.bsls()[0] ?? null);
  readonly backupReady = computed<boolean>(() => (this.defaultBsl()?.phase === 'Available') && (this.nodeAgent()?.ready ?? 0) > 0);

  readonly deps = computed<DepCheck[]>(() => {
    const bsl = this.defaultBsl();
    // 외부 대상은 설치 후 사용자가 구성 — 미구성이 설치를 막지 않는다(required:false).
    const btState: State = !this.installed() ? 'loading'
      : this.bslState() === 'noperm' ? 'noperm'
      : !bsl ? 'nocrd'
      : (bsl.phase === 'Available' ? 'ok' : 'error');
    return [
      {
        id: 'backuptarget', label: '백업 대상 (외부 S3 호환)', required: false, state: btState,
        detail: !this.installed() ? '설치 후 구성'
          : !bsl ? '미구성 — 아래 "백업 대상(외부 S3)" 섹션에서 외부 서비스를 설정하세요.'
          : bsl.phase === 'Available' ? `연결됨 — ${bsl.bucket} @ ${bsl.endpoint || 'AWS S3'}`
          : `구성됨(미검증) — ${bsl.bucket} @ ${bsl.endpoint || 'AWS S3'}${bsl.message ? ' · ' + bsl.message : ' · ' + bsl.phase}`,
        fixHint: '외부 S3 엔드포인트·버킷·자격증명을 정확히 입력해야 백업이 저장됩니다.',
      },
      {
        id: 'csi', label: '볼륨 스냅샷 (CSI)', required: false, state: this.csiState(),
        detail: this.csiState() === 'ok' ? '사용 가능 — CSI 스냅샷 드라이버 존재' : '미지원 — 파일시스템 백업(node-agent)으로 대체',
        fixHint: 'CSI 드라이버가 없어도 백업 가능 — PVC는 node-agent 파일시스템 백업으로 처리된다.',
      },
    ];
  });

  // 경보는 "확정적으로 미충족"일 때만(loading=아직 확인 안 됨은 제외 → 로딩 중 플리커 방지).
  readonly blockingUnmet = computed<DepCheck[]>(() => this.deps().filter((d) => d.required && d.state !== 'ok' && d.state !== 'loading'));
  // 설치 가능 = 필수 의존성이 모두 'ok'로 확인됐을 때만(로딩 중엔 아직 알 수 없으므로 불가).
  readonly depsResolving = computed<boolean>(() => this.deps().some((d) => d.state === 'loading'));
  readonly canInstall = computed<boolean>(() => !this.installed() && this.deps().filter((d) => d.required).every((d) => d.state === 'ok'));

  readonly plan = computed<InstallPlan>(() => {
    const v = this.versions.find((x) => x.chart === this.selectedChart()) ?? this.versions[0];
    return {
      chart: v.chart,
      app: v.app,
      namespace: VELERO_NS,
      image: `ghcr.io/opensphere-platform/mirror/velero:v${v.app}`,
      imageOrigin: `velero/velero:v${v.app}`,
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

  /** 실제 설치 — Crossplane provider-helm Release CR을 선언형(POST)으로 생성(INV-1 준수, 콘솔 사용자 임퍼소네이션).
   *  이후 클러스터를 폴링해 진행바·로그를 구성. helm 직접 실행 없음. */
  async install(): Promise<void> {
    if (!this.canInstall() || this.installState() === 'installing') { return; }
    const v = this.versions.find((x) => x.chart === this.selectedChart()) ?? this.versions[0];
    this.installState.set('installing');
    this.progress.set(5);
    this.logs.set([]);
    this.installError.set('');
    this.milestones.clear();
    this.seenEvents.clear();
    this.log(`Velero ${v.app} (chart ${v.chart}) 설치 시작 — Crossplane provider-helm 경유`);

    const rel = {
      apiVersion: 'helm.crossplane.io/v1beta1', kind: 'Release',
      metadata: { name: 'velero' },
      spec: {
        forProvider: {
          namespace: VELERO_NS,
          chart: { name: 'velero', repository: 'https://vmware-tanzu.github.io/helm-charts', version: v.chart },
          values: {
            image: { repository: 'ghcr.io/opensphere-platform/mirror/velero', tag: `v${v.app}` },
            imagePullSecrets: ['ghcr-pull'],
            initContainers: [], snapshotsEnabled: false, deployNodeAgent: false,
            credentials: { useSecret: false },
            configuration: { backupStorageLocation: [], volumeSnapshotLocation: [] },
          },
        },
        providerConfigRef: { name: 'default' },
      },
    };
    try {
      const r = await fetch(this.k('apis/helm.crossplane.io/v1beta1/releases'), {
        method: 'POST', headers: writeHeaders(), body: JSON.stringify(rel),
      });
      if (r.status === 403) {
        this.installState.set('error');
        this.installError.set('설치 권한 없음 — 콘솔 사용자에게 Release 생성 권한(releases.helm.crossplane.io)이 필요합니다.');
        this.log('✕ 403 권한 없음'); return;
      }
      if (r.status === 409) { this.log('Release가 이미 존재 — 상태 감시로 전환'); }
      else if (!r.ok) { this.installState.set('error'); this.installError.set(`설치 요청 실패 (HTTP ${r.status})`); this.log(`✕ 실패 ${r.status}`); return; }
      else { this.progress.set(15); this.log('Release/velero 생성됨 — provider-helm이 차트를 적용합니다'); }
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
      const r = await fetch(this.k('apis/helm.crossplane.io/v1beta1/releases/velero'));
      if (r.ok) {
        const rel = await r.json();
        const conds = rel.status?.conditions ?? [];
        synced = conds.some((c: any) => c.type === 'Synced' && c.status === 'True');
      }
    } catch { /* noop */ }
    await Promise.allSettled([this.loadCrd(), this.loadDeploy(), this.loadPods()]);
    const crd = this.crdState() === 'ok';
    const deploy = this.deployState() === 'ok';
    const ready = this.ready();

    // velero ns 이벤트 → 로그 피드(신규만)
    try {
      const r = await fetch(this.k('api/v1/namespaces/velero/events?limit=25'));
      if (r.ok) {
        const items = (await r.json()).items ?? [];
        items
          .sort((a: any, b: any) => (a.lastTimestamp || '').localeCompare(b.lastTimestamp || ''))
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
    if (crd) { this.milestone('crd', 'Velero CRD 등록됨'); }
    if (deploy) { this.milestone('deploy', 'Velero Deployment 생성됨'); }

    let p = 15;
    if (synced) { p = Math.max(p, 35); }
    if (crd) { p = Math.max(p, 55); }
    if (deploy) { p = Math.max(p, 75); }
    if (ready) { p = 100; }
    this.progress.set(p);

    if (ready && this.installed()) {
      this.milestone('done', '✓ Velero 파드 Running — 설치 완료');
      this.installState.set('idle');
      this.stopWatch();
    }
  }

  dismissError(): void { this.installState.set('idle'); this.installError.set(''); this.progress.set(0); }

  /** 공용 기본 백업 대상(외부 S3) 구성 — Velero Release CR values를 선언형 merge-PATCH(INV-1, 사용자 임퍼소네이션).
   *  provider-helm이 cloud-credentials Secret + default BackupStorageLocation + node-agent DaemonSet을 한 번에 적용.
   *  자격증명은 values.credentials.secretContents.cloud로 전달 → 별도 Secret 쓰기 RBAC 불필요. */
  async saveBackupTarget(t: BackupTarget): Promise<void> {
    if (this.saveBusy()) { return; }
    if (tokenExpired()) { this.sessionExpired.set(true); this.saveErr.set('세션이 만료되었습니다 (콘솔 로그인 15분 · 자동 갱신 없음).'); return; }
    if (!t.endpoint || !t.bucket || !t.accessKey || !t.secretKey) {
      this.saveErr.set('엔드포인트·버킷·Access Key·Secret Key는 필수입니다.'); return;
    }
    this.saveBusy.set(true); this.saveMsg.set(''); this.saveErr.set(''); this.sessionExpired.set(false);
    const cloud = `[default]\naws_access_key_id=${t.accessKey}\naws_secret_access_key=${t.secretKey}\n`;
    const patch = {
      spec: { forProvider: { values: {
        deployNodeAgent: true,
        credentials: { useSecret: true, secretContents: { cloud } },
        configuration: {
          backupStorageLocation: [{
            name: 'default', provider: 'aws', bucket: t.bucket, default: true,
            config: { region: t.region || 'us-east-1', s3Url: t.endpoint, s3ForcePathStyle: 'true' },
          }],
        },
      } } },
    };
    try {
      const r = await fetch(this.k('apis/helm.crossplane.io/v1beta1/releases/velero'), {
        method: 'PATCH',
        headers: { ...writeHeaders(), 'content-type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      });
      if (isAuthFail(r.status)) { this.sessionExpired.set(true); this.saveErr.set('세션이 만료되었습니다 (콘솔 로그인 15분 · 자동 갱신 없음).'); return; }
      if (r.status === 403) { this.saveErr.set('권한 없음 — Release 수정 권한(releases.helm.crossplane.io)이 필요합니다.'); return; }
      if (!r.ok) { this.saveErr.set(`저장 실패 (HTTP ${r.status})`); return; }
      this.saveMsg.set('저장됨 — provider-helm이 자격증명·저장위치(BSL)·node-agent를 적용합니다(최대 1~2분). 상태는 자동 갱신됩니다.');
      // 반영이 클러스터에 나타날 시간을 두고 상태 재조회.
      setTimeout(() => { this.refresh(); }, 5000);
      setTimeout(() => { this.refresh(); }, 20000);
    } catch { this.saveErr.set('네트워크 오류'); }
    finally { this.saveBusy.set(false); }
  }
  clearSaveMsg(): void { this.saveMsg.set(''); this.saveErr.set(''); this.sessionExpired.set(false); }
}
