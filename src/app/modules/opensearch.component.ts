import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { apiBase, FND_NS } from '../api-base';
import { ClaimsListComponent } from './claims-list.component';

// Foundation 호스팅 plugin 모듈 — OpenSearch 관리 표면(§2.7: foundation shell에 귀속).
// 데이터=server.js /api/opensearch 읽기 프록시(_cluster/health·_cat/indices·_cat/nodes).
@Component({
  selector: 'app-opensearch',
  standalone: true,
  imports: [CommonModule, ClaimsListComponent],
  template: `
    <div class="mod-h">
      <h2>OpenSearch <span class="tag tag-plugin">plugin</span></h2>
      <button class="rbtn" (click)="load()" *ngIf="view() === 'overview'">새로고침</button>
    </div>
    <div class="tabs">
      <button class="tab" [class.on]="view() === 'overview'" (click)="view.set('overview')">Overview</button>
      <button class="tab" [class.on]="view() === 'claims'" (click)="view.set('claims')">Claims</button>
    </div>

    <ng-container *ngIf="view() === 'overview'">
    <p class="muted">공용 검색/인덱스 capability · single-node (dev) · ns {{ ns }}</p>

    <div class="cards">
      <div class="card">
        <div class="card-h">클러스터 health</div>
        <dl class="kv">
          <dt>상태</dt><dd><span class="pill" [ngClass]="statusClass()">{{ health()?.status || (loaded() ? '도달 불가' : '확인 중') }}</span></dd>
          <dt>노드</dt><dd>{{ health()?.number_of_nodes ?? '—' }}</dd>
          <dt>활성 샤드</dt><dd>{{ health()?.active_shards ?? '—' }} ({{ health()?.active_shards_percent_as_number ?? '—' }}%)</dd>
          <dt>미할당</dt><dd>{{ health()?.unassigned_shards ?? '—' }}</dd>
        </dl>
      </div>
      <div class="card">
        <div class="card-h">연결 — 상위 서비스 소비점</div>
        <dl class="kv">
          <dt>엔드포인트</dt><dd class="mono">opensphere-search.{{ ns }}.svc:9200</dd>
          <dt>인덱스 수</dt><dd>{{ indices().length }}</dd>
          <dt>문서 합</dt><dd>{{ totalDocs() }}</dd>
        </dl>
      </div>
    </div>

    <div class="sec-h">인덱스</div>
    <table class="tbl">
      <thead><tr><th>인덱스</th><th>health</th><th>문서</th><th>크기</th><th>샤드(p/r)</th></tr></thead>
      <tbody>
        <tr *ngFor="let i of indices()">
          <td class="mono">{{ i.index }}</td>
          <td><span class="pill" [ngClass]="'os-' + i.health">{{ i.health }}</span></td>
          <td>{{ i['docs.count'] }}</td>
          <td>{{ i['store.size'] }}</td>
          <td>{{ i.pri }}/{{ i.rep }}</td>
        </tr>
        <tr *ngIf="!indices().length"><td colspan="5" class="muted">{{ loaded() ? '인덱스 없음 / 도달 불가' : '불러오는 중…' }}</td></tr>
      </tbody>
    </table>

    <div class="sec-h">노드</div>
    <table class="tbl">
      <thead><tr><th>노드</th><th>역할</th><th>heap%</th><th>cpu</th></tr></thead>
      <tbody>
        <tr *ngFor="let n of nodes()">
          <td class="mono">{{ n.name }}</td>
          <td>{{ n['node.role'] }}</td>
          <td>{{ n['heap.percent'] }}</td>
          <td>{{ n.cpu }}</td>
        </tr>
        <tr *ngIf="!nodes().length"><td colspan="4" class="muted">{{ loaded() ? '—' : '…' }}</td></tr>
      </tbody>
    </table>
    <p class="muted">앱별 인덱스는 <code>OpenSearchIndexClaim</code> 선언으로 발급 예정 (Phase 3). Help Center 종합검색의 백본.</p>
    </ng-container>

    <ng-container *ngIf="view() === 'claims'">
      <div class="claim-deny">ⓘ OpenSearch write-path는 <b>operator 승격 후 활성</b>됩니다. 현 plain single-node엔 선언형 인덱스 CRD가 없어(ADR-005), MVP는 CRD·목록·Accept-stub만. 인덱스는 앱이 클라이언트로 lazy-create(auto-create-index ON).</div>
      <div class="sec-h">OpenSearchIndexClaims</div>
      <app-claims-list kind="os" plural="opensearchindexclaims" primaryLabel="인덱스" detailLabel="endpoint"></app-claims-list>
    </ng-container>
  `,
})
export class OpenSearchComponent implements OnInit {
  readonly ns = FND_NS;
  readonly view = signal<'overview' | 'claims'>('overview');
  readonly health = signal<any>(null);
  readonly indices = signal<any[]>([]);
  readonly nodes = signal<any[]>([]);
  readonly loaded = signal(false);

  ngOnInit(): void { this.load(); }

  private async get(path: string): Promise<any> {
    try { const r = await fetch(`${apiBase()}/api/opensearch${path}`); return r.ok ? await r.json() : null; } catch { return null; }
  }

  async load(): Promise<void> {
    this.loaded.set(false);
    this.health.set(await this.get('/_cluster/health'));
    this.indices.set((await this.get('/_cat/indices?format=json&bytes=mb&s=index')) || []);
    this.nodes.set((await this.get('/_cat/nodes?format=json&h=name,heap.percent,cpu,node.role')) || []);
    this.loaded.set(true);
  }

  statusClass(): string {
    const s = this.health()?.status;
    return s === 'green' ? 'os-green' : s === 'yellow' ? 'os-yellow' : s === 'red' ? 'os-red' : 'bad';
  }
  totalDocs(): number {
    return this.indices().reduce((a, i) => a + (parseInt(i['docs.count'], 10) || 0), 0);
  }
}
