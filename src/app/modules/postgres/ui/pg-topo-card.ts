import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Instance } from '../cnpg.types';

// 토폴로지 카드 — primary/replica 인스턴스 1개. primary는 teal 강조.
@Component({
  selector: 'pg-topo-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <div class="card-header">
        {{ instance.role }}
        <span class="label" [ngClass]="instance.role === 'primary' ? 'label-info' : ''">{{ instance.name }}</span>
      </div>
      <div class="card-block">
        <dl class="os-kv">
          <dt>상태</dt><dd><span class="label" [ngClass]="instance.ready ? 'label-success' : 'label-danger'">{{ instance.status }}</span></dd>
          <dt>Node</dt><dd class="os-mono">{{ instance.node }}</dd>
          <dt>재시작</dt><dd>{{ instance.restarts }}</dd>
          <dt>Age</dt><dd>{{ instance.age }}</dd>
        </dl>
      </div>
    </div>
  `,
})
export class PgTopoCard {
  @Input() instance!: Instance;
}
