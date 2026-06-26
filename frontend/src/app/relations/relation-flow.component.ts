import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { FFlowModule } from '@foblex/flow';

/** P5 관계도 노드/엣지 VM. pos는 안정 참조(매 CD마다 새 객체 생성 방지). */
export interface FlowNodeVM {
  id: string;
  label: string;
  sub: string;
  side: 'consumer' | 'self' | 'consumed' | 'active';
  pos: { x: number; y: number };
  hasIn: boolean;
  hasOut: boolean;
}
export interface FlowEdgeVM { id: string; from: string; to: string; cls: string; }

/** @foblex/flow 기반 관계도(P5). 부모(AppComponent, ShadowDom)의 shadow root 안에 렌더되며,
 *  foblex 규칙(theme-all)·엣지 색상은 부모 app.component.scss(shadow 스코프)에서 적용된다.
 *  D-1은 읽기전용 토폴로지(렌더+pan/zoom)만 — drag-to-connect(shadow에서 document.elementsFromPoint 깨짐)는 미사용. */
@Component({
  selector: 'app-relation-flow',
  standalone: true,
  imports: [CommonModule, FFlowModule],
  template: `
    <f-flow class="fs-fflow">
      <f-canvas fZoom>
        <div
          fNode
          *ngFor="let n of nodes(); trackBy: trackNode"
          [fNodeId]="n.id"
          [fNodePosition]="n.pos"
          [fNodeDraggingDisabled]="true"
          class="fnode side-{{ n.side }}"
        >
          <div *ngIf="n.hasIn" fNodeInput [fInputId]="n.id + ':in'" class="fconn fconn-in"></div>
          <div class="fnode-body">
            <div class="fnode-label">{{ n.label }}</div>
            <div class="fnode-sub">{{ n.sub }}</div>
          </div>
          <div *ngIf="n.hasOut" fNodeOutput [fOutputId]="n.id + ':out'" class="fconn fconn-out"></div>
        </div>

        <f-connection
          *ngFor="let e of edges(); trackBy: trackEdge"
          [fOutputId]="e.from"
          [fInputId]="e.to"
          fBehavior="floating"
          fType="bezier"
          class="edge {{ e.cls }}"
        ></f-connection>
      </f-canvas>
    </f-flow>
  `,
})
export class RelationFlowComponent {
  readonly nodes = input<FlowNodeVM[]>([]);
  readonly edges = input<FlowEdgeVM[]>([]);
  trackNode = (_: number, n: FlowNodeVM) => n.id;
  trackEdge = (_: number, e: FlowEdgeVM) => e.id;
}
