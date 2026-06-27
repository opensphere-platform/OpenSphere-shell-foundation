import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { OsService } from '../os.service';
import { OsNodeCard } from '../ui/os-node-card';
import { PgState } from '../../postgres/ui/pg-state';

@Component({
  selector: 'os-nodes',
  standalone: true,
  imports: [CommonModule, OsNodeCard, PgState],
  template: `
    <p class="muted">OpenSearch 노드 — 역할·heap·cpu·disk. master는 teal 강조. (현재 single-node dev)</p>
    <pg-state [state]="svc.nodeState()" hint="노드 없음" (retry)="svc.refresh()">
      <div class="topo">
        <os-node-card *ngFor="let n of svc.nodes()" [node]="n"></os-node-card>
      </div>
      <div class="sec-h">노드 상세</div>
      <table class="tbl">
        <thead><tr><th>노드</th><th>역할</th><th>master</th><th>heap%</th><th>ram%</th><th>cpu</th><th>disk%</th><th>load 1m</th><th>version</th></tr></thead>
        <tbody>
          <tr *ngFor="let n of svc.nodes()">
            <td class="mono">{{ n.name }}</td>
            <td>{{ n['node.role'] }}</td>
            <td>{{ n.master === '*' ? '★' : '' }}</td>
            <td>{{ n['heap.percent'] ?? '—' }}</td>
            <td>{{ n['ram.percent'] ?? '—' }}</td>
            <td>{{ n.cpu ?? '—' }}</td>
            <td>{{ n['disk.used_percent'] ?? '—' }}</td>
            <td>{{ n['load_1m'] ?? '—' }}</td>
            <td class="mono">{{ n.version || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </pg-state>
  `,
})
export class OsNodesTab {
  readonly svc = inject(OsService);
}
