import { CommonModule } from '@angular/common';
import { Component, ViewEncapsulation, signal } from '@angular/core';
import { PostgresComponent } from './modules/postgres/postgres.component';
import { OpenSearchComponent } from './modules/opensearch.component';

// Foundation subShell = 호스트(§2.7). 좌측 트리에 귀속 plugin 모듈, 본문에 선택 모듈 마운트.
// 모듈(PostgreSQL·OpenSearch)은 foundation shell에 귀속된 plugin(host.mountChild 자체 구현 = 컴포넌트 마운트).
interface Mod { id: 'postgres' | 'opensearch'; name: string; icon: string; }
const MODULES: Mod[] = [
  { id: 'postgres', name: 'PostgreSQL', icon: 'db' },
  { id: 'opensearch', name: 'OpenSearch', icon: 'search' },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, PostgresComponent, OpenSearchComponent],
  encapsulation: ViewEncapsulation.ShadowDom,
  styles: [`
    :host { display:block; height:100%; color:#1f2733;
            font-family: system-ui,-apple-system,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; }
    .fnd { display:flex; height:100%; }
    .nav { width:232px; flex:none; background:#0f2230; color:#cfe0e6; padding:1rem .7rem; overflow-y:auto; }
    .nav-h { font-size:1.15rem; font-weight:700; color:#fff; }
    .nav-d { font-size:.72rem; color:#7fa6b3; margin-bottom:1rem; }
    .nav-g { font-size:.66rem; text-transform:uppercase; letter-spacing:.08em; color:#5f8593; margin:.6rem .3rem .35rem; }
    .nav-i { display:flex; align-items:center; gap:.5rem; padding:.45rem .55rem; border-radius:7px; cursor:pointer; color:#cfe0e6; text-decoration:none; font-size:.9rem; }
    .nav-i:hover { background:#163545; }
    .nav-i.on { background:#0d6e6e; color:#fff; }
    .ni-ico, .ni-ico svg { width:18px; height:18px; display:inline-flex; }
    .nav-foot { margin-top:1.2rem; font-size:.64rem; color:#5f8593; line-height:1.45; padding:0 .3rem; }
    .body { flex:1; overflow-y:auto; padding:1.4rem 1.6rem; background:#f3f5f7; }
    /* ── 모듈 공유 스타일 (ShadowDom 전역 → 자식 컴포넌트 요소에도 적용) ── */
    .mod-h { display:flex; align-items:center; gap:.6rem; }
    .mod-h h2 { margin:0; font-size:1.4rem; font-weight:700; }
    .rbtn { margin-left:auto; border:1px solid #ccd2d8; background:#fff; border-radius:6px; padding:.3rem .7rem; cursor:pointer; font-size:.8rem; }
    .tag { font-size:.58rem; font-weight:700; padding:.08rem .4rem; border-radius:4px; text-transform:uppercase; color:#fff; }
    .tag-plugin { background:#3b5bdb; }
    .muted { color:#7a828f; font-size:.84rem; margin:.2rem 0 1rem; }
    .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:1rem; }
    .card { background:#fff; border-radius:10px; padding:1rem 1.2rem; box-shadow:0 3px 12px rgba(20,30,60,.06); }
    .card-h { font-weight:700; font-size:.95rem; margin-bottom:.6rem; }
    .kv { display:grid; grid-template-columns:100px 1fr; gap:.3rem .6rem; font-size:.86rem; margin:0; }
    .kv dt { color:#7a828f; } .kv dd { margin:0; }
    .mono { font-family:monospace; font-size:.8rem; word-break:break-all; }
    .sec-h { font-weight:700; font-size:1rem; margin:1.4rem 0 .5rem; }
    .tbl { width:100%; border-collapse:collapse; font-size:.84rem; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 3px 12px rgba(20,30,60,.05); }
    .tbl th { text-align:left; background:#eef1f4; padding:.5rem .7rem; font-size:.76rem; color:#48515d; }
    .tbl td { padding:.45rem .7rem; border-top:1px solid #eef0f3; }
    .pill { font-size:.7rem; font-weight:600; padding:.1rem .5rem; border-radius:10px; background:#e9ecef; color:#566; }
    .pill.ok, .pill.os-green { background:#d3f9d8; color:#1d8f4e; }
    .pill.os-yellow { background:#fff3bf; color:#9a7500; }
    .pill.bad, .pill.os-red { background:#ffe3e3; color:#c0392b; }
    code { background:#f1f3f6; padding:.08rem .35rem; border-radius:4px; font-size:.8rem; }
    /* ── Phase 3 Claims UI ── */
    .tabs { display:flex; gap:.3rem; border-bottom:1px solid #dde2e7; margin:.2rem 0 1rem; }
    .tab { border:none; background:none; padding:.45rem .9rem; cursor:pointer; font-size:.86rem; color:#6b7480; border-bottom:2px solid transparent; margin-bottom:-1px; }
    .tab.on { color:#0d6e6e; border-bottom-color:#0d6e6e; font-weight:600; }
    .claims-bar { display:flex; align-items:center; gap:.6rem; margin-bottom:.5rem; }
    .claims-bar .rbtn { margin-left:auto; }
    .claim-deny { background:#fff8e6; border:1px solid #ffe08a; border-radius:8px; padding:.7rem .9rem; font-size:.84rem; color:#6a5400; line-height:1.5; }
    .claim-deny .muted { color:#8a7a3a; }
    .yaml-prev { background:#0f2230; color:#cfe0e6; border-radius:8px; padding:.8rem 1rem; font-size:.78rem; overflow-x:auto; margin-top:.6rem; white-space:pre; }
    .nc { background:#fff; border-radius:10px; padding:1rem 1.2rem; box-shadow:0 3px 12px rgba(20,30,60,.06); margin-bottom:.8rem; }
    .nc-row { display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:.7rem; }
    .nc-row label { display:flex; flex-direction:column; font-size:.74rem; color:#6b7480; gap:.25rem; flex:1; min-width:180px; }
    .nc-row input { border:1px solid #ccd2d8; border-radius:6px; padding:.4rem .55rem; font-size:.86rem; font-family:monospace; }
    .nc-act { display:flex; align-items:center; gap:.6rem; }
    .rbtn.primary { background:#0d6e6e; color:#fff; border-color:#0d6e6e; }
    .rbtn:disabled { opacity:.55; cursor:default; }
    /* ── PG 콘솔: metric 타일 (status 파생, 라이브 메트릭 프록시 불요) ── */
    .metric-row{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:.8rem; margin:.2rem 0 1.2rem; }
    .metric{ background:#fff; border-radius:10px; padding:.8rem 1rem; box-shadow:0 3px 12px rgba(20,30,60,.06); border-left:3px solid #ccd2d8; }
    .metric.ok{ border-left-color:#1d8f4e; } .metric.warn{ border-left-color:#9a7500; } .metric.bad{ border-left-color:#c0392b; }
    .metric .m-val{ font-size:1.5rem; font-weight:700; line-height:1.1; color:#1f2733; word-break:break-all; }
    .metric .m-lab{ font-size:.62rem; text-transform:uppercase; letter-spacing:.07em; color:#7a828f; margin-top:.25rem; }
    .metric .m-sub{ display:flex; align-items:center; gap:.35rem; font-size:.74rem; color:#566a76; margin-top:.25rem; }
    .metric.click{ cursor:pointer; } .metric.click:hover{ box-shadow:0 5px 16px rgba(20,30,60,.1); }
    .dot{ width:8px; height:8px; border-radius:50%; background:#adb5bd; flex:none; }
    .dot.ok{ background:#1d8f4e; } .dot.warn{ background:#e0a800; } .dot.bad{ background:#c0392b; }
    /* ── 토폴로지 ── */
    .topo{ display:flex; gap:1rem; flex-wrap:wrap; margin:.4rem 0 1rem; }
    .topo-card{ background:#fff; border-radius:10px; padding:.8rem 1rem; min-width:210px; box-shadow:0 3px 12px rgba(20,30,60,.06); border-top:3px solid #4263eb; }
    .topo-card.primary{ border-top-color:#0d6e6e; }
    .topo-role{ font-size:.6rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#4263eb; }
    .topo-card.primary .topo-role{ color:#0d6e6e; }
    .topo-name{ font-family:monospace; font-size:.86rem; font-weight:600; margin:.15rem 0 .45rem; word-break:break-all; }
    .topo-kv{ font-size:.74rem; color:#566a76; display:grid; grid-template-columns:auto 1fr; gap:.15rem .5rem; align-items:center; }
    /* ── config dense 키-값 ── */
    .cfg{ width:100%; border-collapse:collapse; font-size:.8rem; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 3px 12px rgba(20,30,60,.05); }
    .cfg td{ padding:.35rem .7rem; border-top:1px solid #f0f2f5; font-family:monospace; }
    .cfg td.k{ color:#48515d; width:42%; } .cfg td.v{ color:#1f2733; word-break:break-all; }
    .cfg-filter{ border:1px solid #ccd2d8; border-radius:6px; padding:.35rem .6rem; font-size:.82rem; margin-bottom:.5rem; width:260px; max-width:100%; }
    /* ── 상태 타임라인 ── */
    .tl{ list-style:none; margin:.4rem 0; padding:0; border-left:2px solid #e3e7ec; }
    .tl li{ position:relative; padding:.35rem 0 .55rem 1.1rem; font-size:.82rem; }
    .tl li::before{ content:''; position:absolute; left:-5px; top:.55rem; width:8px; height:8px; border-radius:50%; background:#adb5bd; }
    .tl li.ok::before{ background:#1d8f4e; } .tl li.warn::before{ background:#e0a800; } .tl li.bad::before{ background:#c0392b; }
    .tl li.bad{ border-left:2px solid #ffc9c9; margin-left:-2px; padding-left:1.2rem; }
    .tl .t-title{ font-weight:600; color:#1f2733; } .tl .t-when{ color:#9aa1ab; font-size:.72rem; margin-left:.4rem; } .tl .t-msg{ color:#48515d; margin-top:.1rem; }
    /* ── 빈/로딩/에러 (6-state) ── */
    .empty{ background:#fff; border:1px dashed #d3d9df; border-radius:10px; padding:1.6rem 1.2rem; text-align:center; color:#7a828f; font-size:.86rem; }
    .empty .e-hint{ font-size:.78rem; margin-top:.3rem; color:#9aa1ab; }
    .spinner{ width:16px; height:16px; border:2px solid #d3d9df; border-top-color:#0d6e6e; border-radius:50%; display:inline-block; animation:spin .7s linear infinite; vertical-align:-3px; margin-right:.4rem; }
    @keyframes spin{ to{ transform:rotate(360deg); } }
    .claim-deny.err{ background:#fff0f0; border-color:#ffc9c9; color:#a02020; }
    .auto-tog{ font-size:.72rem; color:#7a828f; display:inline-flex; align-items:center; gap:.3rem; }
    .badge-mod{ font-size:.58rem; font-weight:700; color:#9a7500; background:#fff3bf; padding:.05rem .35rem; border-radius:4px; margin-left:.4rem; }
    @media (max-width:760px){ .nav{ width:160px; } .cards{ grid-template-columns:1fr; } .metric-row{ grid-template-columns:1fr 1fr; } .topo{ flex-direction:column; } }
  `],
  template: `
    <div class="fnd">
      <aside class="nav">
        <div class="nav-h">Foundation</div>
        <div class="nav-d">플랫폼 백킹서비스</div>
        <div class="nav-g">모듈 · Plugins</div>
        <a class="nav-i" *ngFor="let m of modules" [class.on]="sel() === m.id"
           role="button" tabindex="0" (click)="sel.set(m.id)" (keydown.enter)="sel.set(m.id)">
          <span class="ni-ico">
            <svg *ngIf="m.icon === 'db'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>
            <svg *ngIf="m.icon === 'search'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          </span>{{ m.name }}
        </a>
        <div class="nav-foot">§2.7 — 각 모듈은 foundation shell에 귀속된 plugin (hostRef=foundation)</div>
      </aside>
      <main class="body">
        <app-postgres *ngIf="sel() === 'postgres'"></app-postgres>
        <app-opensearch *ngIf="sel() === 'opensearch'"></app-opensearch>
      </main>
    </div>
  `,
})
export class AppComponent {
  readonly modules = MODULES;
  readonly sel = signal<'postgres' | 'opensearch'>('postgres');
}
