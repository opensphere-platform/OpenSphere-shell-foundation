import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { apiBase } from '../api-base';
import { PROV_GROUP, PROV_VER } from './claims.types';

// 선언형 claim 생성 폼 — /api/k8s create 시도. 403(권한)·404(CRD 미설치) 시 YAML 미리보기로 graceful 폴백(GitOps PR 우회).
@Component({
  selector: 'app-new-claim-form',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="nc">
      <div class="nc-row">
        <label>네임스페이스<input [value]="ns()" (input)="ns.set(val($event))" placeholder="소비 서비스 ns"></label>
        <label>claim 이름<input [value]="name()" (input)="name.set(val($event))" placeholder="예: helpcenter"></label>
      </div>
      <div class="nc-row">
        <label>{{ kind === 'pg' ? 'Database' : 'Index 이름' }}<input [value]="f1()" (input)="f1.set(val($event))" [placeholder]="kind === 'pg' ? 'logical db' : 'index'"></label>
        <label>Owner (service id)<input [value]="f2()" (input)="f2.set(val($event))" placeholder="svc_xxx"></label>
      </div>
      <div class="nc-act">
        <button class="rbtn primary" (click)="submit()">선언 생성</button>
        <button class="rbtn" (click)="yaml.set(toYaml(build()))">YAML 보기</button>
        <span class="muted">{{ msg() }}</span>
      </div>
      <pre class="yaml-prev" *ngIf="yaml()">{{ yaml() }}</pre>
    </div>
  `,
})
export class NewClaimFormComponent {
  @Input() kind: 'pg' | 'os' = 'pg';
  @Output() created = new EventEmitter<void>();
  readonly ns = signal('default');
  readonly name = signal('');
  readonly f1 = signal('');
  readonly f2 = signal('');
  readonly msg = signal('');
  readonly yaml = signal('');

  val(e: Event): string { return (e.target as HTMLInputElement).value; }

  build(): any {
    const k = this.kind === 'pg' ? 'PostgresClaim' : 'OpenSearchIndexClaim';
    const spec = this.kind === 'pg'
      ? { database: this.f1(), owner: this.f2(), privileges: 'owner' }
      : { indexName: this.f1(), owner: this.f2(), access: 'write' };
    return { apiVersion: `${PROV_GROUP}/${PROV_VER}`, kind: k, metadata: { name: this.name(), namespace: this.ns() }, spec };
  }

  toYaml(o: any): string {
    const spec = Object.entries(o.spec).map(([k, v]) => `  ${k}: ${v}`).join('\n');
    return `apiVersion: ${o.apiVersion}\nkind: ${o.kind}\nmetadata:\n  name: ${o.metadata.name}\n  namespace: ${o.metadata.namespace}\nspec:\n${spec}`;
  }

  async submit(): Promise<void> {
    if (!this.name() || !this.f1() || !this.f2()) { this.msg.set('이름·필드를 모두 채우세요.'); return; }
    const obj = this.build();
    const plural = this.kind === 'pg' ? 'postgresclaims' : 'opensearchindexclaims';
    try {
      const r = await fetch(`${apiBase()}/api/k8s/apis/${PROV_GROUP}/${PROV_VER}/namespaces/${this.ns()}/${plural}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj),
      });
      if (r.ok) { this.msg.set('✓ 생성됨 — 컨트롤러가 프로비저닝합니다.'); this.yaml.set(''); this.created.emit(); }
      else if (r.status === 403) { this.msg.set('권한 없음 — 아래 YAML을 GitOps PR로 제출하세요.'); this.yaml.set(this.toYaml(obj)); }
      else if (r.status === 404) { this.msg.set('CRD 미설치 — 컨트롤러·CRD 배포 후 가능. YAML 보관:'); this.yaml.set(this.toYaml(obj)); }
      else { this.msg.set('실패 ' + r.status); this.yaml.set(this.toYaml(obj)); }
    } catch { this.msg.set('네트워크 오류 — YAML 보관:'); this.yaml.set(this.toYaml(obj)); }
  }
}
