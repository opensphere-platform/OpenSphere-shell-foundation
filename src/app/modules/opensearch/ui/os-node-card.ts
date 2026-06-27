import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

// OpenSearch 노드 카드 — PG 토폴로지 카드와 동일 시각언어(.topo-card 재사용). master는 teal 강조.
@Component({
  selector: 'os-node-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <div class="card-header">
        {{ roles || 'node' }}<span *ngIf="isMaster" class="label label-info">master</span>
        <span class="label">{{ node.name }}</span>
      </div>
      <div class="card-block">
        <dl class="os-kv">
          <dt>heap</dt><dd>{{ node['heap.percent'] ?? '—' }}%</dd>
          <dt>cpu</dt><dd>{{ node.cpu ?? '—' }}%</dd>
          <dt>disk</dt><dd>{{ node['disk.used_percent'] ?? '—' }}%</dd>
          <dt>version</dt><dd class="os-mono">{{ node.version || '—' }}</dd>
        </dl>
      </div>
    </div>
  `,
})
export class OsNodeCard {
  @Input() node: any = {};
  get roles(): string { return (this.node['node.role'] || '').split('').join(''); }
  get isMaster(): boolean { return this.node.master === '*'; }
}
