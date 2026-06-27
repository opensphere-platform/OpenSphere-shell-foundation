import { CommonModule } from '@angular/common';
import { Component, OnInit, ViewEncapsulation, signal } from '@angular/core';

// Foundation subShell — 플랫폼 백킹서비스 관리 표면. 각 모듈(PostgreSQL·OpenSearch …)은 향후 plugin으로.
// Phase 1: 등록된 모듈을 라이브 상태와 함께 표시(server.js /api/k8s 프록시로 opensphere-foundation pod 조회).
interface Mod { id: string; name: string; role: string; endpoint: string; tech: string; prefix: string; icon: string; }
const MODULES: Mod[] = [
  { id: 'postgres', name: 'PostgreSQL', role: '공용 관계형 DB — Keycloak·Directus·GitLab·Help Center 등의 영속 저장소', endpoint: 'opensphere-pg-rw.opensphere-foundation.svc:5432', tech: 'CloudNativePG · PostgreSQL 16', prefix: 'opensphere-pg', icon: 'db' },
  { id: 'opensearch', name: 'OpenSearch', role: '공용 검색/인덱스 — 종합검색·Help Center 문서·로그·카탈로그', endpoint: 'opensphere-search.opensphere-foundation.svc:9200', tech: 'OpenSearch 2.17 · single-node (dev)', prefix: 'opensphere-search', icon: 'search' },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  encapsulation: ViewEncapsulation.ShadowDom,
  styles: [`
    :host { display:block; height:100%; overflow-y:auto; background:#f3f5f7; color:#1f2733;
            font-family: system-ui,-apple-system,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; }
    .wrap { max-width:1080px; margin:0 auto; padding:1.6rem 1.5rem 3rem; }
    .head { display:flex; align-items:flex-end; gap:.8rem; border-bottom:1px solid #e3e7ec; padding-bottom:1rem; margin-bottom:1.4rem; }
    .head h1 { margin:0; font-size:1.6rem; font-weight:700; }
    .head .badge { background:#0d6e6e; color:#fff; font-size:.7rem; font-weight:700; padding:.2rem .5rem; border-radius:5px; letter-spacing:.04em; }
    .head .sub { color:#5b6573; font-size:.9rem; margin-left:auto; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:1.2rem; }
    .card { background:#fff; border-radius:12px; padding:1.2rem 1.3rem; box-shadow:0 4px 16px rgba(20,30,60,.07); }
    .card-top { display:flex; align-items:center; gap:.7rem; margin-bottom:.7rem; }
    .ico { width:38px; height:38px; flex:none; display:inline-flex; align-items:center; justify-content:center;
           color:#0d6e6e; background:#e4f3f1; border-radius:9px; padding:7px; }
    .card-top .nm { font-size:1.1rem; font-weight:700; }
    .st { margin-left:auto; display:inline-flex; align-items:center; gap:.35rem; font-size:.8rem; font-weight:600; }
    .st .dot { width:9px; height:9px; border-radius:50%; }
    .st.ok .dot { background:#2ecc71; } .st.ok { color:#1d8f4e; }
    .st.bad .dot { background:#e74c3c; } .st.bad { color:#c0392b; }
    .st.unk .dot { background:#95a5a6; } .st.unk { color:#7a828f; }
    .role { color:#444f5c; font-size:.88rem; line-height:1.5; margin:.1rem 0 .8rem; }
    .kv { display:grid; grid-template-columns:72px 1fr; gap:.3rem .6rem; font-size:.83rem; align-items:center; }
    .kv dt { color:#7a828f; } .kv dd { margin:0; }
    .kv code { background:#f1f3f6; padding:.12rem .4rem; border-radius:4px; font-size:.8rem; word-break:break-all; }
    .manage { margin-top:.9rem; color:#0d6e6e; font-weight:600; font-size:.82rem; opacity:.55; }
    .note { margin-top:1.6rem; color:#7a828f; font-size:.84rem; }
  `],
  template: `
    <div class="wrap">
      <div class="head">
        <h1>Foundation</h1><span class="badge">PLATFORM SERVICES</span>
        <span class="sub">공용 백킹서비스 — 모든 상위 서비스의 데이터/인프라 기반</span>
      </div>

      <div class="grid">
        <div class="card" *ngFor="let m of modules">
          <div class="card-top">
            <span class="ico">
              <svg *ngIf="m.icon==='db'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>
              <svg *ngIf="m.icon==='search'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            </span>
            <span class="nm">{{ m.name }}</span>
            <span class="st" [ngClass]="stClass(m.id)">
              <span class="dot"></span>{{ stLabel(m.id) }}
            </span>
          </div>
          <div class="role">{{ m.role }}</div>
          <dl class="kv">
            <dt>엔드포인트</dt><dd><code>{{ m.endpoint }}</code></dd>
            <dt>구현</dt><dd>{{ m.tech }}</dd>
          </dl>
          <div class="manage">관리 → (Phase 2 — 모듈 플러그인 준비 중)</div>
        </div>
      </div>

      <p class="note">상위 서비스는 <code>PostgresClaim</code> / <code>OpenSearchIndexClaim</code>으로 DB·인덱스를 선언적으로 요청합니다(Phase 3). 다음 모듈(object storage 등)은 동일 패턴으로 확장됩니다.</p>
    </div>
  `,
})
export class AppComponent implements OnInit {
  readonly modules = MODULES;
  readonly status = signal<Record<string, { ready: boolean; phase: string }>>({});
  readonly loaded = signal(false);

  ngOnInit(): void { this.loadStatus(); }

  private apiBase(): string {
    try {
      const l = document.querySelector('link[data-osp-plugin="foundation"]') as HTMLLinkElement | null;
      if (l) { const m = new URL(l.href).pathname.match(/^(.*)\/app\/styles\.css$/); if (m) return m[1]; }
    } catch { /* noop */ }
    return '';
  }

  private async loadStatus(): Promise<void> {
    try {
      const r = await fetch(`${this.apiBase()}/api/k8s/api/v1/namespaces/opensphere-foundation/pods`);
      if (r.ok) {
        const pods = (await r.json()).items || [];
        const map: Record<string, { ready: boolean; phase: string }> = {};
        for (const m of MODULES) {
          const pod = pods.find((p: any) => (p.metadata?.name || '').startsWith(m.prefix));
          if (pod) {
            const ready = (pod.status?.conditions || []).some((c: any) => c.type === 'Ready' && c.status === 'True');
            map[m.id] = { ready, phase: pod.status?.phase || '?' };
          }
        }
        this.status.set(map);
      }
    } catch { /* best-effort */ }
    this.loaded.set(true);
  }

  stClass(id: string): string { const s = this.status()[id]; if (!s) return this.loaded() ? 'unk' : 'unk'; return s.ready ? 'ok' : 'bad'; }
  stLabel(id: string): string { const s = this.status()[id]; if (!s) return this.loaded() ? '미발견' : '확인 중'; return s.ready ? 'Running' : s.phase; }
}
