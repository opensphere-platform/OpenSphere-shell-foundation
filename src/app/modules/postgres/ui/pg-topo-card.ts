import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Instance } from '../cnpg.types';

// 토폴로지 카드 — primary/replica 인스턴스 1개. primary는 teal 강조.
@Component({
  selector: 'pg-topo-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="topo-card" [class.primary]="instance.role === 'primary'">
      <div class="topo-role">{{ instance.role }}</div>
      <div class="topo-name">{{ instance.name }}</div>
      <div class="topo-kv">
        <span>상태</span><span><span class="pill" [class.ok]="instance.ready" [class.bad]="!instance.ready">{{ instance.status }}</span></span>
        <span>Node</span><span class="mono">{{ instance.node }}</span>
        <span>재시작</span><span>{{ instance.restarts }}</span>
        <span>Age</span><span>{{ instance.age }}</span>
      </div>
    </div>
  `,
})
export class PgTopoCard {
  @Input() instance!: Instance;
}
