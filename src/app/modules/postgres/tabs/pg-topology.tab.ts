import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { CnpgService } from '../cnpg.service';
import { PgTopoCard } from '../ui/pg-topo-card';
import { PgState } from '../ui/pg-state';

@Component({
  selector: 'pg-topology',
  standalone: true,
  imports: [CommonModule, PgTopoCard, PgState],
  template: `
    <p class="muted">CNPG 인스턴스 토폴로지 — primary 1 + replica {{ replicaN() }}. rw는 primary로, ro는 replica(없으면 primary)로 라우팅.</p>
    <pg-state [state]="state()" hint="인스턴스 Pod 없음" sub="Cluster가 생성 중이거나 read 권한이 없습니다." (retry)="svc.refresh()">
      <div class="topo">
        <pg-topo-card *ngFor="let i of svc.instances()" [instance]="i"></pg-topo-card>
      </div>
      <div class="sec-h">인스턴스 상세</div>
      <table class="tbl">
        <thead><tr><th>Pod</th><th>역할</th><th>상태</th><th>재시작</th><th>Node</th><th>IP</th><th>Age</th></tr></thead>
        <tbody>
          <tr *ngFor="let i of svc.instances()">
            <td class="mono">{{ i.name }}</td>
            <td>{{ i.role }}</td>
            <td><span class="pill" [class.ok]="i.ready" [class.bad]="!i.ready">{{ i.status }}</span></td>
            <td>{{ i.restarts }}</td>
            <td class="mono">{{ i.node }}</td>
            <td class="mono">{{ i.ip || '—' }}</td>
            <td>{{ i.age }}</td>
          </tr>
        </tbody>
      </table>
    </pg-state>
  `,
})
export class PgTopologyTab {
  readonly svc = inject(CnpgService);
  readonly replicaN = computed(() => this.svc.instances().filter((i) => i.role !== 'primary').length);
  readonly state = computed(() => (this.svc.instances().length ? 'ok' : (this.svc.clusterState() === 'loading' && !this.svc.pods().length ? 'loading' : 'empty')));
}
