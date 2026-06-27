import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { RsService } from './rs.service';
import { PILL } from '../postgres/cnpg.types';
import { PgMetric } from '../postgres/ui/pg-metric';

// RustFS(S3 object storage) 콘솔 — 상태·용량·소비점(Clarity). 폴러 라이프사이클은 shell이 소유.
// 버킷 관리는 RustFS 자체 콘솔(:9001)/S3 클라이언트, 선언형 BucketClaim은 후속.
@Component({
  selector: 'app-rustfs',
  standalone: true,
  imports: [CommonModule, ClarityModule, PgMetric],
  template: `
    <div class="os-title-row">
      <h2 class="os-h2">RustFS <span class="label label-info">plugin</span></h2>
      <span class="label" [ngClass]="pillCls()">{{ svc.phase() }}</span>
      <label class="clr-control-label os-ml-auto">
        <input type="checkbox" class="clr-checkbox" [checked]="svc.autoRefresh()" (change)="svc.toggleAuto()"> auto 15s
      </label>
      <button class="btn btn-sm" (click)="svc.refresh()" [disabled]="svc.busy()">{{ svc.busy() ? '동기화…' : '새로고침' }}</button>
    </div>
    <p class="os-sub">공용 S3 호환 object storage capability · RustFS · {{ svc.name }} · ns {{ svc.ns }}<span *ngIf="svc.lastSync()"> · {{ svc.lastSync() }}</span></p>

    <div class="os-metrics">
      <pg-metric label="상태" [value]="svc.phase()" [status]="svc.phaseCls()"></pg-metric>
      <pg-metric label="Replicas" [value]="svc.readyN() + ' / ' + svc.totalN()" [status]="svc.ready() ? 'ok' : 'warn'" sub="ready"></pg-metric>
      <pg-metric label="Capacity" [value]="svc.capacity()" sub="PVC"></pg-metric>
      <pg-metric label="S3 API" value=":9000" sub="endpoint"></pg-metric>
    </div>

    <div class="os-cardgrid">
      <div class="card">
        <div class="card-header">스토리지 · {{ svc.name }}</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>이미지</dt><dd class="os-mono">{{ svc.image() || '—' }}</dd>
            <dt>Node</dt><dd class="os-mono">{{ svc.node() }}</dd>
            <dt>재시작</dt><dd>{{ svc.restarts() }}</dd>
            <dt>용량</dt><dd>{{ svc.capacity() }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">연결 — 상위 서비스 소비점</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>S3 API</dt><dd class="os-mono">{{ svc.s3 }}</dd>
            <dt>콘솔</dt><dd class="os-mono">{{ svc.consoleEp }}</dd>
            <dt>자격 Secret</dt><dd class="os-mono">{{ svc.credSecret }}</dd>
            <dt>access/secret</dt><dd class="os-mono">rustfsadmin / rustfsadmin (dev)</dd>
          </dl>
          <p class="os-sub">S3 호환 — aws-sdk·mc·boto3로 소비. 키 host/access_key/secret_key (값은 Secret).</p>
        </div>
      </div>
    </div>

    <div class="os-sech">버킷 · 관리</div>
    <clr-alert clrAlertType="info" [clrAlertClosable]="false" [clrAlertLightweight]="true">
      <clr-alert-item><span class="alert-text">버킷 생성·브라우징은 RustFS 자체 콘솔(:9001) 또는 S3 클라이언트(mc/aws-sdk). 선언형 <b>BucketClaim</b> 발급은 후속(Phase 4 provisioning — S3 서명 프록시/operator 필요).</span></clr-alert-item>
    </clr-alert>
  `,
})
export class RustfsComponent {
  readonly svc = inject(RsService);
  pillCls(): string { return PILL[this.svc.phaseCls()]; }
}
