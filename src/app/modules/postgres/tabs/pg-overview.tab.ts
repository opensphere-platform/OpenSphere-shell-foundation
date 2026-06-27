import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject } from '@angular/core';
import { CnpgService } from '../cnpg.service';
import { TlItem } from '../cnpg.types';
import { PgMetric } from '../ui/pg-metric';
import { PgTimeline } from '../ui/pg-timeline';
import { PgState } from '../ui/pg-state';

@Component({
  selector: 'pg-overview',
  standalone: true,
  imports: [CommonModule, PgMetric, PgTimeline, PgState],
  template: `
    <div class="os-metrics">
      <pg-metric label="상태" [value]="svc.phase()" [status]="svc.phaseCls()" [sub]="svc.lastSync() ? '동기화 ' + svc.lastSync() : ''"></pg-metric>
      <pg-metric label="인스턴스" [value]="svc.readyN() + ' / ' + svc.totalN()" [status]="svc.allReady() ? 'ok' : 'warn'" sub="ready" [clickable]="true" (go)="jump.emit('topology')"></pg-metric>
      <pg-metric label="Primary" [value]="primaryShort()" [status]="svc.primary() ? 'ok' : ''" [sub]="svc.primary() ? 'rw 라우팅' : '미상'" [clickable]="true" (go)="jump.emit('topology')"></pg-metric>
      <pg-metric label="PostgreSQL" [value]="'v' + svc.pgMajor()" [sub]="imageShort()"></pg-metric>
      <pg-metric label="Storage" [value]="svc.storage()" [sub]="svc.storageClass()" [clickable]="true" (go)="jump.emit('config')"></pg-metric>
    </div>

    <div class="os-cardgrid">
      <div class="card">
        <div class="card-header">클러스터 · {{ svc.name }}</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>네임스페이스</dt><dd class="os-mono">{{ svc.ns }}</dd>
            <dt>이미지</dt><dd class="os-mono">{{ svc.image() || '—' }}</dd>
            <dt>프로파일</dt><dd>{{ svc.instanceProfile() }} (cpu/mem)</dd>
            <dt>관리 role</dt><dd>{{ svc.managedRoles().length }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">연결 — 상위 서비스 소비점</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>쓰기(RW)</dt><dd class="os-mono">{{ svc.name }}-rw.{{ svc.ns }}.svc:5432</dd>
            <dt>읽기(RO)</dt><dd class="os-mono">{{ svc.name }}-ro.{{ svc.ns }}.svc:5432</dd>
            <dt>자격 Secret</dt><dd class="os-mono">{{ svc.name }}-app · pgc-&lt;claim&gt;-conn</dd>
          </dl>
          <p class="os-sub">키: host·port·dbname·user·password·uri. 값은 정책상 비노출 — <code>kubectl get secret</code>.</p>
        </div>
      </div>
    </div>

    <div class="os-sech">상태 조건 (conditions)</div>
    <pg-state [state]="condState()" hint="조건 보고 없음" sub="클러스터가 막 생성되었거나 status를 아직 보고하지 않습니다." (retry)="svc.refresh()">
      <pg-timeline [items]="condItems()"></pg-timeline>
    </pg-state>
  `,
})
export class PgOverviewTab {
  readonly svc = inject(CnpgService);
  @Output() jump = new EventEmitter<string>();

  primaryShort(): string { const p = this.svc.primary(); return p ? p.replace(this.svc.name + '-', '#') : '—'; }
  imageShort(): string { const i = this.svc.image(); return i ? (i.split('/').pop() || i) : '—'; }

  readonly condState = computed(() => {
    if (this.svc.conditions().length) { return 'ok' as const; }
    return this.svc.clusterState() === 'ok' ? ('empty' as const) : this.svc.clusterState();
  });
  readonly condItems = computed<TlItem[]>(() => this.svc.conditions().map((c: any) => ({
    cls: c.status === 'True' ? 'ok' : (c.type === 'Ready' ? 'bad' : 'warn'),
    title: c.type + (c.reason ? ' · ' + c.reason : ''),
    msg: c.message,
    when: c.lastTransitionTime ? new Date(c.lastTransitionTime).toLocaleString() : '',
  })));
}
