import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

// OpenSearch 노드 카드 — PG 토폴로지 카드와 동일 시각언어(.topo-card 재사용). master는 teal 강조.
@Component({
  selector: 'os-node-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="topo-card" [class.primary]="isMaster">
      <div class="topo-role">{{ roles || 'node' }}{{ isMaster ? ' · master' : '' }}</div>
      <div class="topo-name">{{ node.name }}</div>
      <div class="topo-kv">
        <span>heap</span><span>{{ node['heap.percent'] ?? '—' }}%</span>
        <span>cpu</span><span>{{ node.cpu ?? '—' }}%</span>
        <span>disk</span><span>{{ node['disk.used_percent'] ?? '—' }}%</span>
        <span>version</span><span class="mono">{{ node.version || '—' }}</span>
      </div>
    </div>
  `,
})
export class OsNodeCard {
  @Input() node: any = {};
  get roles(): string { return (this.node['node.role'] || '').split('').join(''); }
  get isMaster(): boolean { return this.node.master === '*'; }
}
