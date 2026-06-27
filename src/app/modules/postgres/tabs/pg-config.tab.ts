import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { CnpgService } from '../cnpg.service';
import { PgKv } from '../ui/pg-kv';
import { PgState } from '../ui/pg-state';

@Component({
  selector: 'pg-config',
  standalone: true,
  imports: [CommonModule, PgKv, PgState],
  template: `
    <div class="os-cardgrid">
      <div class="card">
        <div class="card-header">리소스</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>CPU</dt><dd>{{ res()?.requests?.cpu || '—' }} req / {{ res()?.limits?.cpu || '—' }} lim</dd>
            <dt>Memory</dt><dd>{{ res()?.requests?.memory || '—' }} req / {{ res()?.limits?.memory || '—' }} lim</dd>
            <dt>Storage</dt><dd>{{ svc.storage() }} · {{ svc.storageClass() }}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-header">PostgreSQL</div>
        <div class="card-block">
          <dl class="os-kv">
            <dt>버전</dt><dd>v{{ svc.pgMajor() }}</dd>
            <dt>이미지</dt><dd class="os-mono">{{ svc.image() || '—' }}</dd>
            <dt>파라미터</dt><dd>{{ paramCount() }} 개</dd>
          </dl>
        </div>
      </div>
    </div>

    <div class="os-sech">postgresql.conf 파라미터</div>
    <pg-state [state]="state()" hint="명시 파라미터 없음" sub="CNPG 기본 튜닝을 사용합니다." (retry)="svc.refresh()">
      <pg-kv [params]="svc.params()"></pg-kv>
    </pg-state>
  `,
})
export class PgConfigTab {
  readonly svc = inject(CnpgService);
  readonly res = computed(() => this.svc.resources());
  readonly paramCount = computed(() => Object.keys(this.svc.params()).length);
  readonly state = computed(() => (this.paramCount() ? 'ok' : (this.svc.clusterState() === 'ok' ? 'empty' : this.svc.clusterState())));
}
