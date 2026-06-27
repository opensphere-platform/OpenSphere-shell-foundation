import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { apiBase } from '../api-base';
import { PROV_GROUP, PROV_VER, ClaimRow, phaseFromStatus, age } from './claims.types';

// 재사용 Claims 목록 — provisioning.opensphere.io claim을 클러스터 전역으로 나열(read-only).
// graceful degrade: 404=CRD 미설치, 403=read 권한 없음, ok=목록(빈 목록 포함).
@Component({
  selector: 'app-claims-list',
  standalone: true,
  imports: [CommonModule, ClarityModule],
  template: `
    <div class="os-title-row">
      <span class="os-mono os-sub">{{ plural }}.{{ PROV_GROUP }}/{{ PROV_VER }}</span>
      <button class="btn btn-sm os-ml-auto" (click)="load()">새로고침</button>
    </div>
    <table class="table" *ngIf="state() === 'ok'">
      <thead><tr><th>이름</th><th>네임스페이스</th><th>{{ primaryLabel }}</th><th>상태</th><th>{{ detailLabel }}</th><th>Age</th></tr></thead>
      <tbody>
        <tr *ngFor="let r of rows()">
          <td class="os-mono">{{ r.name }}</td>
          <td class="os-mono">{{ r.namespace }}</td>
          <td class="os-mono">{{ r.primary }}</td>
          <td><span class="label" [ngClass]="r.ready ? 'label-success' : 'label-warning'">{{ r.phase }}</span></td>
          <td class="os-mono">{{ r.detail }}</td>
          <td>{{ r.age }}</td>
        </tr>
        <tr *ngIf="!rows().length"><td colspan="6" class="os-muted">claim 없음 — 위 폼으로 선언하세요.</td></tr>
      </tbody>
    </table>
    <clr-alert *ngIf="state() === 'nocrd'" clrAlertType="info" [clrAlertClosable]="false" [clrAlertLightweight]="true">
      <clr-alert-item><span class="alert-text"><span class="os-mono">{{ plural }}.{{ PROV_GROUP }}</span> CRD 미설치 — Phase 3 컨트롤러·CRD 배포 후 표시됩니다.</span></clr-alert-item>
    </clr-alert>
    <clr-alert *ngIf="state() === 'noperm'" clrAlertType="warning" [clrAlertClosable]="false">
      <clr-alert-item><span class="alert-text">조회 권한 없음 — <span class="os-mono">rbac-foundation-read.yaml</span>(provisioning.opensphere.io read) 적용 필요.</span></clr-alert-item>
    </clr-alert>
    <div class="os-dim" *ngIf="state() === 'loading'"><span class="spinner spinner-sm"></span> 불러오는 중…</div>
  `,
})
export class ClaimsListComponent implements OnInit {
  @Input() plural = 'postgresclaims';
  @Input() primaryLabel = 'DB / owner';
  @Input() detailLabel = '연결 Secret';
  @Input() kind: 'pg' | 'os' = 'pg';
  readonly PROV_GROUP = PROV_GROUP;
  readonly PROV_VER = PROV_VER;
  readonly rows = signal<ClaimRow[]>([]);
  readonly state = signal<'loading' | 'ok' | 'nocrd' | 'noperm'>('loading');

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const r = await fetch(`${apiBase()}/api/k8s/apis/${PROV_GROUP}/${PROV_VER}/${this.plural}`);
      if (r.status === 403) { this.state.set('noperm'); return; }
      if (r.status === 404 || !r.ok) { this.state.set('nocrd'); return; }
      const items = (await r.json()).items || [];
      this.rows.set(items.map((c: any) => {
        const ps = phaseFromStatus(c.status);
        const sp = c.spec || {};
        return {
          name: c.metadata?.name,
          namespace: c.metadata?.namespace,
          primary: this.kind === 'pg' ? `${sp.database} / ${sp.owner}` : (sp.indexName || (sp.indexPrefix ? sp.indexPrefix + '*' : '—')),
          phase: ps.phase,
          ready: ps.ready,
          detail: c.status?.connectionSecretRef?.name || c.status?.host || '—',
          age: age(c.metadata?.creationTimestamp),
        } as ClaimRow;
      }));
      this.state.set('ok');
    } catch { this.state.set('nocrd'); }
  }
}
