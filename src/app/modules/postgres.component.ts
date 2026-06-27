import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { apiBase, FND_NS } from '../api-base';

// Foundation 호스팅 plugin 모듈 — PostgreSQL(CloudNativePG) 관리 표면(§2.7: foundation shell에 귀속).
// 데이터=server.js /api/k8s 프록시(CNPG Cluster CR + pods). 읽기 전용 운영 표면(쓰기·DB생성은 PostgresClaim, Phase 3).
@Component({
  selector: 'app-postgres',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mod-h">
      <h2>PostgreSQL <span class="tag tag-plugin">plugin</span></h2>
      <button class="rbtn" (click)="load()">새로고침</button>
    </div>
    <p class="muted">공용 관계형 DB capability · CloudNativePG · ns {{ ns }}</p>

    <div class="cards">
      <div class="card">
        <div class="card-h">클러스터 · opensphere-pg</div>
        <dl class="kv">
          <dt>상태</dt><dd><span class="pill" [class.ok]="ready()" [class.bad]="loaded() && !ready()">{{ phase() }}</span></dd>
          <dt>인스턴스</dt><dd>{{ readyN() }} / {{ totalN() }} ready</dd>
          <dt>Primary</dt><dd class="mono">{{ primary() || '—' }}</dd>
          <dt>이미지</dt><dd class="mono">{{ image() || '—' }}</dd>
        </dl>
      </div>
      <div class="card">
        <div class="card-h">연결 — 상위 서비스 소비점</div>
        <dl class="kv">
          <dt>쓰기(RW)</dt><dd class="mono">opensphere-pg-rw.{{ ns }}.svc:5432</dd>
          <dt>읽기(RO)</dt><dd class="mono">opensphere-pg-ro.{{ ns }}.svc:5432</dd>
          <dt>Secret</dt><dd class="mono">opensphere-pg-app</dd>
          <dt>DB / User</dt><dd class="mono">appdb / appuser</dd>
        </dl>
      </div>
    </div>

    <div class="sec-h">Pods</div>
    <table class="tbl">
      <thead><tr><th>Pod</th><th>상태</th><th>역할</th><th>Node</th></tr></thead>
      <tbody>
        <tr *ngFor="let p of pods()">
          <td class="mono">{{ p.name }}</td>
          <td><span class="pill" [class.ok]="p.ready">{{ p.ready ? 'Ready' : p.phase }}</span></td>
          <td>{{ p.role }}</td>
          <td class="mono">{{ p.node }}</td>
        </tr>
        <tr *ngIf="!pods().length"><td colspan="4" class="muted">{{ loaded() ? 'Pod 없음 / 권한 없음' : '불러오는 중…' }}</td></tr>
      </tbody>
    </table>
    <p class="muted" *ngIf="loaded() && !cluster()">ⓘ 상태·Primary는 Pod에서 도출. CNPG Cluster CR 상세(image·backup·storage)는 SA에 <code>postgresql.cnpg.io</code> read 부여 시 표시 (rbac-foundation-read.yaml).</p>
    <p class="muted">앱별 DB는 <code>PostgresClaim</code> 선언으로 발급됩니다 (Phase 3 — 선언형 write-path, execInPod 금지).</p>
  `,
})
export class PostgresComponent implements OnInit {
  readonly ns = FND_NS;
  readonly cluster = signal<any>(null);
  readonly pods = signal<any[]>([]);
  readonly loaded = signal(false);

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.loaded.set(false);
    const base = apiBase();
    try {
      const cr = await fetch(`${base}/api/k8s/apis/postgresql.cnpg.io/v1/namespaces/${this.ns}/clusters/opensphere-pg`);
      this.cluster.set(cr.ok ? await cr.json() : null);
    } catch { this.cluster.set(null); }
    try {
      const sel = encodeURIComponent('cnpg.io/cluster=opensphere-pg');
      const pr = await fetch(`${base}/api/k8s/api/v1/namespaces/${this.ns}/pods?labelSelector=${sel}`);
      const items = pr.ok ? ((await pr.json()).items || []) : [];
      this.pods.set(items.map((p: any) => ({
        name: p.metadata?.name,
        phase: p.status?.phase,
        ready: (p.status?.conditions || []).some((c: any) => c.type === 'Ready' && c.status === 'True'),
        role: p.metadata?.labels?.['cnpg.io/instanceRole'] || p.metadata?.labels?.['role'] || '—',
        node: p.spec?.nodeName || '—',
      })));
    } catch { this.pods.set([]); }
    this.loaded.set(true);
  }

  // CNPG Cluster CR을 못 읽어도(SA RBAC) Pod에서 상태·Primary를 도출 — graceful degrade.
  phase(): string {
    if (this.cluster()?.status?.phase) return this.cluster().status.phase;
    if (!this.loaded()) return '확인 중';
    const ps = this.pods();
    if (!ps.length) return '미발견';
    if (ps.every((p) => p.ready)) return 'Running';
    return ps.some((p) => p.ready) ? 'Degraded' : 'Down';
  }
  ready(): boolean {
    if (/healthy/i.test(this.cluster()?.status?.phase || '')) return true;
    const ps = this.pods();
    return ps.length > 0 && ps.every((p) => p.ready);
  }
  readyN(): number { return this.cluster()?.status?.readyInstances ?? this.pods().filter((p) => p.ready).length; }
  totalN(): number { return this.cluster()?.spec?.instances ?? this.pods().length; }
  primary(): string { return this.cluster()?.status?.currentPrimary || this.pods().find((p) => /primary/i.test(p.role))?.name || ''; }
  image(): string { return this.cluster()?.status?.image || this.cluster()?.spec?.imageName || ''; }
}
