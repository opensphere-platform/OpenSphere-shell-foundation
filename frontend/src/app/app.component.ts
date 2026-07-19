import { CommonModule } from '@angular/common';
import { Component, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { FoundationService } from './core/foundation.service';
import { FlowEdgeVM, FlowNodeVM, RelationFlowComponent } from './relations/relation-flow.component';
import { OPERANDS, OperandMeta, OperandRelation, hasDeferralTag, isLive, operandChip, operandsOf } from './core/operands';
import { CATALOGS, catalogOf } from './core/operands-catalog';
import { OperandPanelComponent } from './operand/operand-panel.component';
import { OperandActionsComponent } from './operand/operand-actions.component';

type Route = { kind: 'index' } | { kind: 'operand'; model: string; operand: OperandMeta } | { kind: 'bootstrap' };

/** Foundation Shell — 단일 DUPA 모듈. K8s Console 동형 tree 네비:
 *  개요(별도 index 화면) + 6 모델 그룹 헤더 + operand 리프(각 operand = 다탭 페이지로 모든 정보).
 *  정직: 미배포 operand는 어떤 라이브 값/issuer/초록칩/라이브 엣지도 보이지 않는다(isLive 게이트). */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ClarityModule, RelationFlowComponent, OperandPanelComponent, OperandActionsComponent],
  encapsulation: ViewEncapsulation.ShadowDom,
  styleUrls: ['./app.component.css', './app.component.foblex.scss'],
  template: `
    <div class="fs-app">
      <!-- Clarity vertical nav: 개요 + 6 모델 그룹(clr-vertical-nav-group) + operand 리프(clrVerticalNavLink) -->
      <clr-vertical-nav class="fs-nav" [clrVerticalNavCollapsible]="false">
        <a clrVerticalNavLink class="fs-nav-index"
           [class.active]="route().kind==='index'" (click)="goIndex()">
          개요 (Foundation)
        </a>
        <clr-vertical-nav-group *ngFor="let d of descriptors(); trackBy: trackModel"
          [clrVerticalNavGroupExpanded]="isExpanded(d.spec?.model)"
          (clrVerticalNavGroupExpandedChange)="toggleExpand(d.spec?.model)">
          <span class="fs-navmodel">{{ d.spec?.model }}</span>
          <span class="fs-navphase label label-info" clrVerticalNavGroupItem>{{ d.metadata?.annotations?.['opensphere.io/os-pdnn'] }}</span>
          <ng-container ngProjectAs="clr-vertical-nav-group-children">
            <a clrVerticalNavLink *ngFor="let op of operandsOf(d.spec?.model); trackBy: trackOp"
               [class.active]="isActiveOperand(d.spec?.model, op)" (click)="openOperand(d, op)">
              <img *ngIf="op.slug && !isBroken(op.slug); else tnav" class="os-tlogo" [src]="logoUrl(op.slug)" [alt]="op.name" (error)="markBroken(op.slug!)" />
              <ng-template #tnav><span class="os-tmono" [style.background-color]="monoStyle(op.name)">{{ monoText(op.name) }}</span></ng-template>
              {{ op.name }}
            </a>
          </ng-container>
        </clr-vertical-nav-group>
      </clr-vertical-nav>

      <div class="fs-content">
        <div class="fs-head">
          <h2 class="fs-h2">Foundation <span class="label label-info">Shell · D-3</span></h2>
          <span class="fs-sub">{{ descriptors().length }} models · operand <strong>{{ liveCount() }}</strong> 배포 / {{ plannedCount() }} 계획</span>
          <button class="btn btn-sm btn-link fs-btn-ml-auto" (click)="load()">새로고침</button>
        </div>
        <div *ngIf="error()" class="alert alert-danger" role="alert">
          <div class="alert-items"><div class="alert-item static"><span class="alert-text">{{ error() }}</span></div></div>
        </div>

        <!-- ===== PG 설치 옵션 폼(공용 ng-template) — operand 페이지 + 부트스트랩 마법사에서 출력 ===== -->
        <ng-template #pgInstallForm>
          <div class="pg-install">
            <h4 class="fs-h4">{{ reconfig() ? '재구성' : '설치 옵션' }} <span class="fs-muted">(CloudNativePG 매핑 — 선언형, execInPod 0)</span>
              <button class="btn btn-sm btn-primary pg-apply" [disabled]="pgBusy()" (click)="installData()">{{ pgInstalled() ? '재구성 적용' : '설치' }}</button>
              <button *ngIf="reconfig()" class="btn btn-sm btn-link fs-btn-ml-sm" (click)="reconfig.set(false)">취소</button>
            </h4>
            <p *ngIf="reconfig()" class="fs-muted op-note fs-pg-reconfig-note">⚙ 현재 배포값을 불러왔습니다 — 네임스페이스·StorageClass는 변경 불가(불변). 인스턴스·이미지·확장·리소스·튜닝·풀러만 재구성 적용됩니다.</p>
            <div class="pg-grid">
              <div class="pg-sec">
                <div class="pg-sec-t">기본</div>
                <label>네임스페이스
                  <select class="clr-select pg-wide" [disabled]="reconfig()" [value]="pgNsSelectValue()" (change)="onPgNsSelect($any($event.target).value)">
                    <option *ngFor="let n of pgNsOptionsWithCurrent()" [value]="n">{{ n }}</option>
                    <option value="__custom__">기타(직접 입력 — 새 NS 생성)…</option>
                  </select>
                  <input *ngIf="pgNsCustom()" class="clr-input pg-wide pg-vercustom" [disabled]="reconfig()" [value]="pgOpts().namespace" (input)="setPg({namespace: $any($event.target).value})" placeholder="새 네임스페이스명(예: pg-tenant-a)" />
                  <span class="fs-muted">{{ pgNsNote() }}</span>
                </label>
                <label>인스턴스 수
                  <input type="number" min="1" max="5" class="clr-input pg-num" [value]="pgOpts().instances" (input)="setPg({instances: $any($event.target).value})" />
                  <span class="fs-muted">{{ pgOpts().instances>=2 ? 'HA 클러스터' : '단일 노드' }}</span>
                </label>
                <label>PostgreSQL 이미지 태그
                  <select class="clr-select pg-wide" [value]="pgVerSelectValue()" (change)="onPgVerSelect($any($event.target).value)">
                    <option *ngFor="let v of versionOptionsWithCurrent()" [value]="v">{{ v }}</option>
                    <option value="__custom__">기타(직접 입력)…</option>
                  </select>
                  <input *ngIf="pgVerCustom()" class="clr-input pg-wide pg-vercustom" [value]="pgOpts().imageTag" (input)="setPg({imageTag: $any($event.target).value})" placeholder="커스텀 태그(자체 빌드 이미지 등)" />
                  <span class="fs-muted">{{ pgTagsNote() }}</span>
                </label>
              </div>
              <div class="pg-sec">
                <div class="pg-sec-t">스토리지</div>
                <label>StorageClass
                  <input class="clr-input pg-num" list="pgsc" [disabled]="reconfig()" [value]="pgOpts().storageClass" (input)="setPg({storageClass: $any($event.target).value})" />
                  <datalist id="pgsc"><option *ngFor="let s of PG_SC_SUGGEST" [value]="s"></option></datalist>
                </label>
                <label>데이터 크기 <input class="clr-input pg-num" [value]="pgOpts().storageSize" (input)="setPg({storageSize: $any($event.target).value})" /></label>
                <label>WAL 전용 볼륨 <input class="clr-input pg-num" [value]="pgOpts().walStorageSize" (input)="setPg({walStorageSize: $any($event.target).value})" placeholder="비우면 없음" /></label>
              </div>
              <div class="pg-sec">
                <div class="pg-sec-t">리소스 (K8s requests/limits → spec.resources)</div>
                <label>프리셋(단축키)
                  <select class="clr-select" [value]="pgOpts().resourceProfile" (change)="onPgResProfile($any($event.target).value)">
                    <option *ngFor="let p of PG_RES_PROFILES" [value]="p">{{ p }}</option>
                  </select>
                </label>
                <ng-container *ngIf="pgOpts().resourceProfile!=='none'">
                  <label>CPU 요청 <input class="clr-input pg-num" [value]="pgOpts().cpuRequest" (input)="onPgResEdit({cpuRequest:$any($event.target).value})" /></label>
                  <label>메모리 요청 <input class="clr-input pg-num" [value]="pgOpts().memoryRequest" (input)="onPgResEdit({memoryRequest:$any($event.target).value})" /></label>
                  <label>CPU 상한 <input class="clr-input pg-num" [value]="pgOpts().cpuLimit" (input)="onPgResEdit({cpuLimit:$any($event.target).value})" /></label>
                  <label>메모리 상한 <input class="clr-input pg-num" [value]="pgOpts().memoryLimit" (input)="onPgResEdit({memoryLimit:$any($event.target).value})" /></label>
                </ng-container>
                <span class="fs-muted">프리셋은 아래 4개 값을 채우는 단축키 — 실제 기준은 이 K8s 값(편집하면 custom). none=CNPG 기본.</span>
              </div>
              <div class="pg-sec">
                <div class="pg-sec-t">PG 파라미터 튜닝</div>
                <label>max_connections <input class="clr-input pg-num" [value]="pgOpts().max_connections" (input)="setPg({max_connections:$any($event.target).value})" /></label>
                <label>shared_buffers <input class="clr-input pg-num" [value]="pgOpts().shared_buffers" (input)="setPg({shared_buffers:$any($event.target).value})" placeholder="예: 256MB" /></label>
                <label>work_mem <input class="clr-input pg-num" [value]="pgOpts().work_mem" (input)="setPg({work_mem:$any($event.target).value})" placeholder="예: 8MB" /></label>
              </div>
              <div class="pg-sec">
                <div class="pg-sec-t">커넥션 풀러 (PgBouncer)</div>
                <label class="pg-chk"><input type="checkbox" [checked]="pgOpts().poolerEnabled" (change)="setPg({poolerEnabled:$any($event.target).checked})" /> 활성화</label>
                <label>모드
                  <select class="clr-select" [disabled]="!pgOpts().poolerEnabled" [value]="pgOpts().poolerMode" (change)="setPg({poolerMode:$any($event.target).value})">
                    <option value="transaction">transaction</option><option value="session">session</option>
                  </select>
                </label>
                <label>풀러 인스턴스 <input type="number" min="1" max="5" class="clr-input pg-num" [disabled]="!pgOpts().poolerEnabled" [value]="pgOpts().poolerInstances" (input)="setPg({poolerInstances:$any($event.target).value})" /></label>
              </div>
              <div class="pg-sec">
                <div class="pg-sec-t">고급</div>
                <label class="pg-chk"><input type="checkbox" [checked]="pgOpts().enableSuperuserAccess" (change)="setPg({enableSuperuserAccess:$any($event.target).checked})" /> superuser 접근 허용</label>
                <label class="pg-chk"><input type="checkbox" [checked]="pgOpts().monitoring" (change)="setPg({monitoring:$any($event.target).checked})" /> PodMonitor(Prometheus)</label>
              </div>
              <div class="pg-sec pg-sec-wide">
                <div class="pg-sec-t">확장(extension) — 멀티 선택 <span class="fs-muted">선택 이미지가 실제 제공하는 확장 기준 · CNPG Database CR로 선언형 CREATE EXTENSION</span></div>
                <div class="pg-exts pg-exts-scroll">
                  <label class="pg-ext" *ngFor="let e of extChoices()" [title]="extInfo(e)?.comment || ''">
                    <input type="checkbox" [checked]="pgHasExt(e)" (change)="togglePgExt(e)" />{{ e }}<span class="fs-muted" *ngIf="extInfo(e)?.defaultVersion"> {{ extInfo(e)?.defaultVersion }}</span><span class="pg-ext-inst" *ngIf="extInfo(e)?.installed" title="이미 설치됨">●</span>
                  </label>
                </div>
                <div class="pg-extadd">
                  <input class="clr-input pg-num" [value]="pgExtFree()" (input)="pgExtFree.set($any($event.target).value)" (keyup.enter)="addPgExtFree()" placeholder="목록에 없는 확장 직접 추가" />
                  <button class="btn btn-sm btn-outline" (click)="addPgExtFree()">추가</button>
                  <span class="fs-muted" *ngIf="pgOpts().extensions.length">선택: {{ pgOpts().extensions.join(', ') }}</span>
                </div>
                <span class="fs-muted">{{ pgExtNote() }}</span>
              </div>
            </div>
            <p class="fs-muted op-note">이 폼은 <code>FoundationModel.spec.parameters</code>를 기록 → control-plane이 CNPG <code>Cluster</code>/<code>Pooler</code>/<code>Database</code> CR로 SSA(execInPod 0, INV-1). 인스턴스·이미지·확장 변경은 실 클러스터를 재구성합니다.</p>
          </div>
        </ng-template>

        <!-- ===== 메인 index 화면(별도 구성): 플릿/교차모델 ===== -->
        <ng-container *ngIf="route().kind==='index'">
          <div class="bs-banner" [class.bs-ok]="foundationState()==='Established'">
            <span>Foundation 설립 상태: <strong>{{ foundationState() }}</strong>
              <span class="fs-muted" *ngIf="foundationState()!=='Established'"> — 관리 페이지 접근은 설립 후 가능(현재 PostgreSQL 기준)</span>
            </span>
            <button class="btn btn-sm btn-primary" (click)="goBootstrap()">{{ foundationState()==='Established' ? '설립 마법사' : '설립 마법사 시작 →' }}</button>
          </div>
          <div class="alert alert-info" role="alert">
            <div class="alert-items"><div class="alert-item static"><span class="alert-text">
라이브 모델: <strong>{{ installedModelNames() }}</strong>. 각 모델은 reconcile 시 <strong>대표 operand 1종만</strong> 실제 배포됩니다(현재 배포: <strong>{{ liveOperandList() }}</strong>). 카탈로그 operand {{ totalOperands() }}종 중 배포 {{ liveCount() }}종, 나머지는 계획(D-2·D-4~D-7)입니다.
            </span></div></div>
          </div>

          <div class="fs-kpi">
            <div class="fs-kpi-box fs-kpi-live"><div class="fs-kpi-n">{{ liveCount() }}</div><div class="fs-kpi-l">배포됨 operand</div></div>
            <div class="fs-kpi-box fs-kpi-plan"><div class="fs-kpi-n">{{ plannedCount() }}</div><div class="fs-kpi-l">미배포(계획)</div></div>
            <div class="fs-kpi-box"><div class="fs-kpi-n">{{ installedModels() }}/6</div><div class="fs-kpi-l">설치된 모델</div></div>
          </div>

          <h4 class="fs-h4">6 모델 — 설치/배포 현황</h4>
          <table class="table">
            <thead><tr><th class="left">모듈</th><th>OS-PDNN</th><th class="left">구성 제품(operand)</th><th>모델 상태</th><th class="left">라이브 operand</th><th>설치</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let d of descriptors(); trackBy: trackModel">
                <td class="left"><strong class="fs-model">{{ d.spec?.model }}</strong></td>
                <td>{{ d.metadata?.annotations?.['opensphere.io/os-pdnn'] }}</td>
                <td class="left">
                  <span class="fs-logos fs-logos-inline">
                    <ng-container *ngFor="let o of operandsOf(d.spec?.model)">
                      <img *ngIf="o.slug && !isBroken(o.slug); else omono" class="fs-logo" [src]="logoUrl(o.slug)" [alt]="o.name" [title]="o.name" (error)="markBroken(o.slug!)" />
                      <ng-template #omono><span class="fs-mono" [style.background-color]="monoStyle(o.name)" [title]="o.name">{{ monoText(o.name) }}</span></ng-template>
                    </ng-container>
                  </span>
                </td>
                <td><span class="fs-phase" [ngClass]="phaseClass(d)">{{ phaseLabel(d) }}</span></td>
                <td class="left">{{ liveOperandName(d.spec?.model) }}</td>
                <td>
                  <label class="fs-toggle">
                    <input type="checkbox" [checked]="isInstalled(d)" [disabled]="busy()===d.spec?.model" (change)="toggle(d, $any($event.target).checked)" />
                    <span>{{ isInstalled(d) ? '설치됨' : '미설치' }}</span>
                  </label>
                </td>
                <td><button class="btn btn-sm btn-link" (click)="openPrimary(d)">열기 ▸</button></td>
              </tr>
            </tbody>
          </table>

          <h4 class="fs-h4">모델 간 관계 <span class="fs-muted">(foundation 모델 ↔ 모델 토폴로지만)</span></h4>
          <div class="fs-flowwrap">
            <app-relation-flow *ngIf="route().kind==='index'" [nodes]="globalNodes()" [edges]="globalEdges()"></app-relation-flow>
          </div>

          <h4 class="fs-h4">전체 Claim / Binding <span class="fs-muted">(읽기 전용 — 요청/해제는 operand 페이지)</span></h4>
          <table class="table table-compact">
            <thead><tr><th class="left">Claim</th><th class="left">ns</th><th>model</th><th>Claim</th><th>Binding</th><th>RTT</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of allClaimRows()">
                <td class="left">{{ row.claim }}</td><td class="left">{{ row.ns }}</td><td>{{ row.model }}</td>
                <td><span class="label" [ngClass]="phaseColor(row.claimPhase)">{{ row.claimPhase || '—' }}</span></td>
                <td><span class="label" [ngClass]="phaseColor(row.bindPhase)">{{ row.bindPhase || '—' }}</span></td>
                <td>{{ row.rtt != null ? row.rtt + 'ms' : '—' }}</td>
              </tr>
              <tr *ngIf="!allClaimRows().length"><td colspan="6" class="fs-muted">활성 Claim 없음</td></tr>
            </tbody>
          </table>
        </ng-container>

        <!-- ===== operand 페이지: 헤더 + 5 탭(모든 정보) ===== -->
        <ng-container *ngIf="opRoute() as r">
          <div class="fs-pagehead">
            <div class="fs-pagehead-l">
              <h3 class="fs-h3">
                <img *ngIf="r.operand.slug && !isBroken(r.operand.slug); else hmono" class="fs-logo-lg" [src]="logoUrl(r.operand.slug)" [alt]="r.operand.name" (error)="markBroken(r.operand.slug!)" />
                <ng-template #hmono><span class="fs-mono fs-mono-lg" [style.background-color]="monoStyle(r.operand.name)">{{ monoText(r.operand.name) }}</span></ng-template>
                <span>{{ r.operand.name }}</span>
                <span class="fs-muted">{{ r.model }} · {{ r.d?.metadata?.annotations?.['opensphere.io/os-pdnn'] }}</span>
                <span class="fs-phase" [ngClass]="phaseClass(r.d)">{{ phaseLabel(r.d) }}</span>
              </h3>
              <div class="fs-summary">{{ r.operand.description }}<span class="fs-muted" *ngIf="r.operand.role"> · 역할: {{ r.operand.role }}</span></div>
              <div *ngIf="r.live" class="fs-badge fs-badge-live">✓ 배포됨 — control plane이 이 operand를 라이브 배포<span *ngIf="r.fm?.status?.operator?.version"> (v{{ r.fm?.status?.operator?.version }})</span><span *ngIf="r.fm?.status?.observedAt"> · 갱신 {{ r.fm?.status?.observedAt }}</span></div>
              <div *ngIf="!r.live" class="fs-badge fs-badge-plan">미배포 · 계획 {{ r.operand.plannedSlice }} — 카탈로그 구성요소이며 아직 배포되지 않았습니다. 아래 모니터링·관계·계약은 모델({{ r.model }}) 수준 컨텍스트이며 이 operand의 가동을 의미하지 않습니다.<span *ngIf="!isInstalled(r.d)"> (모델 미설치 — 개요에서 설치)</span></div>
            </div>
          </div>

          <!-- 설치 폼(#pgInstallForm 공용). 운영 중이면 상태 우선 — 폼은 숨기고 '재구성' 버튼으로만 노출(설치 화면 재노출 안 함). -->
          <ng-container *ngIf="r.model==='data' && r.operand.id==='postgresql'">
            <div *ngIf="r.live && !reconfig()" class="fs-badge fs-badge-live fs-badge-row">
              <span>실행 중 — 상태·구성은 아래 탭(상세)에서 확인. 변경이 필요할 때만 재구성하세요.</span>
              <button class="btn btn-sm btn-outline fs-btn-inline" (click)="startReconfig()">⚙ 재구성</button>
            </div>
            <ng-container *ngIf="!r.live || reconfig()">
              <ng-container *ngTemplateOutlet="pgInstallForm"></ng-container>
            </ng-container>
          </ng-container>
          <clr-tabs>
            <clr-tab *ngIf="catalog() as cat">
              <button clrTabLink (click)="activeTab.set('cat')">상세 <span class="label label-info fs-tab-badge">{{ cat.panels.length }}</span></button>
              <clr-tab-content>
                <div class="fs-badge" [class.fs-badge-live]="r.live" [class.fs-badge-plan]="!r.live">
                  <ng-container *ngIf="r.live">✓ 배포됨 — <strong>라이브</strong>·<strong>배포구성</strong> 값은 실제 표시, <strong>scrape</strong> 항목은 control-plane 스크레이프(P3) 적용 후 채워집니다.</ng-container>
                  <ng-container *ngIf="!r.live">미배포 — 아래 패널은 이 operand의 <strong>제품 정보 요구사항(전체 기능 카탈로그)</strong>입니다. <strong>측정값</strong>은 위조 없이 모두 “배포 후 측정 · {{ r.operand.plannedSlice }}”로 표시되고, 이름·목적·구성 등 <strong>선언 항목</strong>만 설계 기준으로 표기됩니다.</ng-container>
                </div>
                <p class="fs-muted op-note" *ngIf="cat.note">ⓘ {{ cat.note }}</p>
                <app-operand-actions *ngIf="cat.actions?.length" [actions]="cat.actions || []" [fm]="catalogFm()" [live]="r.live"></app-operand-actions>
                <div class="op-panels">
                  <app-operand-panel *ngFor="let p of cat.panels" [panel]="p" [fm]="catalogFm()" [live]="r.live"
                                     [class.op-panel-kpi]="p.kpi" [class.op-panel-wide]="p.kind==='table'"></app-operand-panel>
                </div>
              </clr-tab-content>
            </clr-tab>

            <clr-tab>
              <button clrTabLink (click)="activeTab.set('ov')">개요</button>
              <clr-tab-content>
                <h4 class="fs-h4">역할 · capability <span class="fs-muted">(카탈로그·브랜딩 메타 — 계약 단정 아님)</span></h4>
                <div><span class="fs-muted" *ngIf="r.operand.role">{{ r.operand.role }}</span>
                  <span *ngFor="let c of r.operand.capability" class="label label-info">{{ c }}</span>
                  <span *ngIf="!r.operand.capability?.length" class="fs-muted"> (직접 capability 없음 — 교체가능 백엔드)</span>
                </div>
                <h4 class="fs-h4">배포 상태</h4>
                <div *ngIf="r.live" class="label label-success">배포됨 (LIVE)</div>
                <div *ngIf="!r.live"><span class="label label-info">미배포 · {{ r.operand.plannedSlice }} (계획)</span> <span class="fs-muted">배포 시 활성화될 기능을 정의합니다.</span></div>
                <h4 class="fs-h4">소속 모델</h4>
                <div class="fs-summary">{{ r.model }} · {{ r.d?.spec?.description?.summary }}</div>
              </clr-tab-content>
            </clr-tab>

            <clr-tab>
              <button clrTabLink (click)="activeTab.set('mon')">계약 메트릭</button>
              <clr-tab-content>
                <div *ngIf="!r.live" class="fs-badge fs-badge-plan">이 operand는 미배포입니다. 아래는 SLO 정의이며 현재값은 배포 후 control plane이 reconcile합니다.</div>
                <table class="table table-compact">
                  <thead><tr><th class="left">메트릭</th><th>SLO</th><th>현재값</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let m of operandMetrics()">
                      <td class="left">{{ m.title }} <span class="fs-muted">({{ m.id }}{{ m.unit ? ', '+m.unit : '' }})</span></td>
                      <td>{{ m.slo || '—' }}</td>
                      <td [ngSwitch]="opMetric(m).mode">
                        <ng-container *ngSwitchCase="'live'">
                          <span class="label" [ngClass]="metricClass(opMetric(m).o)" [title]="opMetric(m).o?.source || ''">{{ opMetric(m).o?.value }}{{ valUnit(opMetric(m).o, m) }}</span>
                          <span class="fs-muted" *ngIf="opMetric(m).o?.note"> · {{ opMetric(m).o?.note }}</span>
                        </ng-container>
                        <span *ngSwitchCase="'deferred'" class="label label-warning">{{ opMetric(m).note }}</span>
                        <span *ngSwitchCase="'pending'" class="fs-muted">{{ opMetric(m).note }}</span>
                        <span *ngSwitchDefault class="fs-muted">{{ opMetric(m).note }}</span>
                      </td>
                    </tr>
                    <tr *ngIf="!operandMetrics().length"><td colspan="3" class="fs-muted">메트릭 정의 없음</td></tr>
                  </tbody>
                </table>
              </clr-tab-content>
            </clr-tab>

            <clr-tab>
              <button clrTabLink (click)="activeTab.set('rel')">관계</button>
              <clr-tab-content>
                <ng-container *ngIf="catalog() as cat; else relModelOnly">
                  <div class="fs-badge" [class.fs-badge-live]="r.live" [class.fs-badge-model]="!r.live"><strong>operand({{ r.operand.name }})</strong> 수준 관계입니다. 좌측=소비(consumes), 우측=제공(provides). 색: <span class="rel-k rel-live">초록=라이브</span> · <span class="rel-k rel-decl">점선=선언</span> · <span class="rel-k rel-plan">회색=계획</span>. <span *ngIf="!r.live">미배포 operand이므로 라이브 엣지는 없습니다(정의된 관계만).</span></div>
                  <div class="fs-flowwrap">
                    <app-relation-flow *ngIf="activeTab()==='rel'" [nodes]="operandNodes()" [edges]="operandEdges()"></app-relation-flow>
                  </div>
                  <div class="rel-cols">
                    <div class="rel-col">
                      <h4 class="fs-h4">소비 (consumes) <span class="fs-muted">{{ opConsumes().length }}</span></h4>
                      <table class="table table-compact"><tbody>
                        <tr *ngFor="let c of opConsumes()">
                          <td class="left"><strong>{{ c.display || c.ref }}</strong><span class="vc-badge vc-contract" *ngIf="c.contract" title="connection 계약">계약</span></td>
                          <td class="left fs-muted">{{ c.via }}</td>
                          <td><span class="label" [ngClass]="relBadge(c).cls">{{ relBadge(c).text }}</span></td>
                        </tr>
                        <tr *ngIf="!opConsumes().length"><td class="fs-muted" colspan="3">소비 관계 없음</td></tr>
                      </tbody></table>
                    </div>
                    <div class="rel-col">
                      <h4 class="fs-h4">제공 (provides) <span class="fs-muted">{{ opProvides().length }}</span></h4>
                      <table class="table table-compact"><tbody>
                        <tr *ngFor="let p of opProvides()">
                          <td class="left"><strong>{{ p.display || p.ref }}</strong><span class="vc-badge vc-contract" *ngIf="p.contract" title="connection 계약">계약</span></td>
                          <td class="left fs-muted">{{ p.via }}</td>
                          <td><span class="label" [ngClass]="relBadge(p).cls">{{ relBadge(p).text }}</span></td>
                        </tr>
                        <tr *ngIf="!opProvides().length"><td class="fs-muted" colspan="3">제공 관계 없음</td></tr>
                      </tbody></table>
                    </div>
                  </div>
                  <h4 class="fs-h4"><button class="btn btn-sm btn-link fs-btn-no-pl" (click)="showModelTopo.set(!showModelTopo())">{{ showModelTopo() ? '▾' : '▸' }} 모델({{ r.model }}) 수준 토폴로지 보기</button></h4>
                  <div class="fs-flowwrap" *ngIf="showModelTopo()">
                    <app-relation-flow *ngIf="activeTab()==='rel' && showModelTopo()" [nodes]="flowNodes()" [edges]="flowEdges()"></app-relation-flow>
                  </div>
                </ng-container>
                <ng-template #relModelOnly>
                  <div class="fs-badge" [class.fs-badge-plan]="!r.live" [class.fs-badge-model]="r.live">관계는 <strong>모델({{ r.model }})</strong> 수준 토폴로지입니다 (operand 카탈로그 준비 중).</div>
                  <div class="fs-flowwrap">
                    <app-relation-flow *ngIf="activeTab()==='rel'" [nodes]="flowNodes()" [edges]="flowEdges()"></app-relation-flow>
                  </div>
                </ng-template>
              </clr-tab-content>
            </clr-tab>

            <clr-tab>
              <button clrTabLink (click)="activeTab.set('bind')">계약·연결담보 (모델)</button>
              <clr-tab-content>
                <div class="fs-badge fs-badge-model">Claim/Binding은 <strong>모델({{ r.model }})+capability</strong> 단위입니다 (operand별 Claim 없음).</div>
                <table class="table table-compact">
                  <tbody>
                    <tr><td class="left">claimKind(논리)</td><td class="left">{{ r.d?.spec?.bindContract?.claimKind || '—' }} <span class="fs-muted">→ FoundationClaim</span></td></tr>
                    <tr><td class="left">bindingKind(논리)</td><td class="left">{{ r.d?.spec?.bindContract?.bindingKind || '—' }} <span class="fs-muted">→ FoundationBinding</span></td></tr>
                    <tr><td class="left">Finalizer(연결담보)</td><td class="left">{{ r.d?.spec?.bindContract?.finalizer || '—' }}</td></tr>
                    <tr><td class="left">Connection SLO</td><td class="left">rtt &lt; {{ r.d?.spec?.bindContract?.connectionSLO?.rtt_ms }}ms · avail {{ r.d?.spec?.bindContract?.connectionSLO?.availability }}</td></tr>
                  </tbody>
                </table>
                <h4 class="fs-h4">라이브 Claim / Binding
                  <button class="btn btn-sm btn-outline fs-btn-ml-8" [disabled]="!(isInstalled(r.d) && r.live)" (click)="showRequest.set(!showRequest())">+ 요청</button>
                  <span class="fs-muted" *ngIf="!(isInstalled(r.d) && r.live)"> (모델 설치 + 대표 operand 배포 후 요청 가능)</span>
                </h4>
                <div class="fs-reqpanel" *ngIf="showRequest() && isInstalled(r.d) && r.live">
                  <div class="fs-reqrow">
                    <label>namespace <input class="clr-input" [value]="reqNs()" (input)="reqNs.set($any($event.target).value)" /></label>
                    <label>capability
                      <select class="clr-select" [value]="reqCap()" (change)="reqCap.set($any($event.target).value)">
                        <option *ngFor="let c of r.d?.spec?.operator?.capability" [value]="c">{{ c }}</option>
                      </select>
                    </label>
                    <button class="btn btn-sm btn-primary" [disabled]="reqBusy()" (click)="requestClaim(r.d)">요청 생성</button>
                    <button class="btn btn-sm btn-link" (click)="showRequest.set(false)">취소</button>
                  </div>
                </div>
                <table class="table table-compact">
                  <thead><tr><th class="left">Claim</th><th class="left">ns</th><th>cap</th><th>Claim</th><th>Binding</th><th>RTT</th><th>연결담보</th><th></th></tr></thead>
                  <tbody>
                    <tr *ngFor="let row of claimRows(r.d)">
                      <td class="left">{{ row.claim }}</td><td class="left">{{ row.ns }}</td><td>{{ row.capability }}</td>
                      <td><span class="label" [ngClass]="phaseColor(row.claimPhase)">{{ row.claimPhase || '—' }}</span></td>
                      <td><span class="label" [ngClass]="phaseColor(row.bindPhase)">{{ row.bindPhase || '—' }}</span></td>
                      <td [title]="'controller→svc RTT (소비자 RTT 아님)'">{{ row.rtt != null ? row.rtt + 'ms' : '—' }}</td>
                      <td>
                        <span class="label label-success" *ngIf="row.guarded && !row.terminating" title="연결담보: 소비자 release 전까지 Binding 삭제 차단">🛡 담보</span>
                        <span class="label label-warning" *ngIf="row.terminating">해제 중(담보 유지)</span>
                        <span class="fs-muted" *ngIf="!row.guarded && !row.terminating">—</span>
                      </td>
                      <td><button class="btn btn-sm btn-link" [disabled]="row.terminating" (click)="releaseClaim(row)">해제</button></td>
                    </tr>
                    <tr *ngIf="!claimRows(r.d).length"><td colspan="8" class="fs-muted">이 모델에 대한 Claim 없음</td></tr>
                  </tbody>
                </table>
              </clr-tab-content>
            </clr-tab>

            <clr-tab *ngIf="r.live && (r.fm?.status?.issuerURL)">
              <button clrTabLink (click)="activeTab.set('diag')">진단 · Issuer</button>
              <clr-tab-content>
                <h4 class="fs-h4">OIDC issuer <span class="fs-muted">(라이브)</span></h4>
                <div class="fs-summary"><code>{{ r.fm?.status?.issuerURL }}</code><br /><span class="fs-muted">JWKS: {{ r.fm?.status?.jwksURL }}</span></div>
              </clr-tab-content>
            </clr-tab>
          </clr-tabs>
        </ng-container>
      </div>

      <!-- ===== Bootstrap 마법사 — 모달(뒤 트리+콘텐츠 전체 비활성화) ===== -->
      <div class="bs-modal-backdrop" *ngIf="route().kind==='bootstrap'">
        <div class="bs-modal" role="dialog" aria-modal="true">
          <div class="bs-modal-head">
            <h3 class="fs-h3 fs-h3-no-margin">Foundation 설립 마법사 <span class="fs-muted">PostgreSQL 부트스트랩</span>
              <span class="fs-phase" [ngClass]="{'label':true,'label-info':foundationState()==='NotEstablished','label-warning':foundationState()==='Establishing','label-success':foundationState()==='Established'}">{{ foundationState() }}</span>
            </h3>
            <button class="btn btn-sm btn-link bs-modal-x" (click)="goIndex()">✕ 닫기</button>
          </div>
          <div class="bs-modal-body">
            <div class="bs-steps">
              <div class="bs-step" [class.done]="preflightOk()">① Preflight</div>
              <div class="bs-step" [class.on]="preflightOk()" [class.done]="foundationState()!=='NotEstablished'">② PostgreSQL 설치</div>
              <div class="bs-step" [class.on]="foundationState()!=='NotEstablished'" [class.done]="foundationState()==='Established'">③ 검증 · 설립</div>
            </div>

            <h4 class="fs-h4">① Preflight — 전제 조건 <button class="btn btn-sm btn-link" (click)="loadPreflight()">재검사</button></h4>
            <table class="table table-compact"><tbody>
              <tr *ngFor="let c of preflight()">
                <td class="left">{{ c.label }}</td>
                <td><span class="label" [ngClass]="c.ok?'label-success':'label-danger'">{{ c.ok ? 'OK' : '미충족' }}</span></td>
                <td class="left fs-muted">{{ c.detail }}</td>
              </tr>
              <tr *ngIf="!preflight().length"><td class="fs-muted" colspan="3">점검 중…</td></tr>
            </tbody></table>

            <div *ngIf="!preflightOk()" class="fs-badge fs-badge-plan">Preflight 미충족 — 위 전제를 먼저 해결해야 설치 단계로 진행합니다.</div>
            <ng-container *ngIf="preflightOk()">
              <h4 class="fs-h4">② PostgreSQL 설치</h4>
              <ng-container *ngTemplateOutlet="pgInstallForm"></ng-container>
            </ng-container>

            <h4 class="fs-h4">③ 검증 · 설립</h4>
            <div *ngIf="foundationState()==='NotEstablished'" class="fs-summary fs-muted">아직 PostgreSQL 미설치 — 위에서 옵션 선택 후 설치하세요.</div>
            <div *ngIf="foundationState()==='Establishing'" class="fs-badge fs-badge-plan">설치 진행 중 — PG 인스턴스 Ready 대기(phase: {{ dataPhase() }}). 10초마다 자동 갱신.</div>
            <div *ngIf="foundationState()==='Established'" class="fs-badge fs-badge-live">
              ✅ Foundation 설립 완료 — PostgreSQL 라이브: <strong>{{ liveParamSummaryLine() }}</strong>.
              <button class="btn btn-sm btn-primary fs-btn-ml-8" (click)="goIndex()">관리 콘솔 입장 →</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AppComponent {
  private svc = inject(FoundationService);
  readonly descriptors = signal<any[]>([]);
  readonly modelsByName = signal<Record<string, any>>({});
  readonly claimsList = signal<any[]>([]);
  readonly bindingsList = signal<any[]>([]);
  readonly route = signal<Route>({ kind: 'index' });
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);

  readonly activeTab = signal<'ov' | 'cat' | 'mon' | 'rel' | 'bind' | 'diag'>('ov');
  readonly showModelTopo = signal(false);
  readonly showRequest = signal(false);

  // ── PG 설치 레벨 옵션(B) — FoundationModel.spec.parameters로 기록 → control-plane이 CNPG로 매핑 ──
  // PostgreSQL 플러그인은 19 beta만 제공한다. 이전 major 버전은 설치 선택지에 노출하지 않는다.
  readonly PG_VERSION_SUGGEST = [
    '19beta2-standard-trixie',
  ];
  readonly PG_EXT_CHOICES = ['pgcrypto', 'uuid-ossp', 'pg_trgm', 'btree_gin', 'btree_gist', 'hstore', 'citext', 'ltree', 'intarray', 'unaccent', 'fuzzystrmatch', 'pg_stat_statements'];
  readonly PG_SC_SUGGEST = ['standard', 'hostpath'];
  readonly PG_RES_PROFILES = ['none', 'small', 'medium', 'large', 'custom'];
  private pgDefaults() {
    return {
      namespace: 'opensphere-foundation',
      instances: 1, imageTag: '19beta2-standard-trixie', storageClass: 'standard', storageSize: '1Gi', walStorageSize: '',
      resourceProfile: 'small', cpuRequest: '100m', memoryRequest: '256Mi', cpuLimit: '500m', memoryLimit: '512Mi',
      max_connections: '100', shared_buffers: '', work_mem: '',
      poolerEnabled: false, poolerMode: 'transaction', poolerInstances: 1,
      enableSuperuserAccess: false, monitoring: false, extensions: [] as string[],
    };
  }
  readonly pgOpts = signal<any>(this.pgDefaults());
  readonly pgExtFree = signal('');
  readonly pgBusy = signal(false);
  // 운영 중 operand는 상태 우선 — 설치 폼은 숨기고 '재구성' 버튼으로만 현재값을 불러와 노출(설치 화면 재노출 방지).
  readonly reconfig = signal(false);
  // 버전 목록 — 셸 백엔드가 ghcr 레지스트리 실시간 조회(하드코딩 PG_VERSION_SUGGEST는 조회 실패 시 폴백).
  readonly pgVersionTags = signal<string[]>([]);
  readonly pgTagsMeta = signal<{ repo?: string; totalTags?: number; count?: number; fetchedAt?: string; error?: string } | null>(null);
  private pgTagsLoading = false;
  versionOptions() {
    const only19 = this.pgVersionTags().filter((tag) => tag.startsWith('19'));
    return only19.length ? only19 : this.PG_VERSION_SUGGEST;
  }
  readonly pgVerCustom = signal(false);
  // 단일 목록(select)이 보여줄 옵션 — 현재 값이 목록에 없으면(커스텀/프리필) 맨 앞에 포함해 항상 선택 표시.
  versionOptionsWithCurrent() { const list = this.versionOptions(); const cur = this.pgOpts().imageTag; return (cur && !list.includes(cur)) ? [cur, ...list] : list; }
  pgVerSelectValue() { return this.pgVerCustom() ? '__custom__' : this.pgOpts().imageTag; }
  onPgVerSelect(v: string) { if (v === '__custom__') { this.pgVerCustom.set(true); } else { this.setPg({ imageTag: v }); this.pgVerCustom.set(false); } }
  // 네임스페이스 — 기존 목록(클러스터 조회) 선택 OR 직접 입력(새 NS 생성).
  readonly pgNsList = signal<string[]>([]);
  readonly pgNsCustom = signal(false);
  nsOptions() { const l = this.pgNsList(); return l.length ? l : ['opensphere-foundation']; }
  pgNsOptionsWithCurrent() { const list = this.nsOptions(); const cur = this.pgOpts().namespace; return (cur && !list.includes(cur)) ? [cur, ...list] : list; }
  pgNsSelectValue() { return this.pgNsCustom() ? '__custom__' : this.pgOpts().namespace; }
  onPgNsSelect(v: string) { if (v === '__custom__') { this.pgNsCustom.set(true); } else { this.setPg({ namespace: v }); this.pgNsCustom.set(false); } }
  pgNsNote() { return this.pgNsList().length ? `기존 네임스페이스 ${this.pgNsList().length}개 — 새 이름 입력 시 control-plane이 생성` : '네임스페이스 목록 조회 중…'; }
  private loadNamespaces() { this.svc.namespaces().subscribe({ next: (r: any) => this.pgNsList.set(((r.items || []).map((x: any) => x.metadata?.name)).filter(Boolean).sort()), error: () => { } }); }
  pgTagsNote() {
    const m = this.pgTagsMeta();
    if (!m) return '레지스트리 조회 중…';
    if (m.error || !this.pgVersionTags().length) return '레지스트리 조회 실패 — 하드코딩 폴백 목록 사용(자유 입력은 가능)';
    return `레지스트리 실시간: 총 ${m.totalTags}개 중 주요 ${m.count}개 (${m.repo}, ${(m.fetchedAt || '').slice(0, 16).replace('T', ' ')})`;
  }
  private loadPgTags() {
    if (this.pgTagsLoading || this.pgVersionTags().length) return;
    this.pgTagsLoading = true;
    this.svc.pgImageTags().subscribe({
      next: (r: any) => { this.pgVersionTags.set(Array.isArray(r?.tags) ? r.tags : []); this.pgTagsMeta.set(r); this.pgTagsLoading = false; },
      error: (e) => { this.pgTagsMeta.set({ error: this.errText(e) }); this.pgTagsLoading = false; },
    });
  }
  // 확장 목록 — 실행 중 PG의 pg_available_extensions(이미지가 실제 제공). 폴백=PG_EXT_CHOICES.
  readonly pgAvailExts = signal<{ name: string; defaultVersion?: string; comment?: string; installed?: boolean }[]>([]);
  readonly pgExtMeta = signal<{ available?: boolean; count?: number; reason?: string; host?: string; fetchedAt?: string } | null>(null);
  private pgExtLoading = false;
  extChoices() { const a = this.pgAvailExts(); return a.length ? a.map(e => e.name) : this.PG_EXT_CHOICES; }
  extInfo(name: string) { return this.pgAvailExts().find(e => e.name === name); }
  pgExtNote() {
    const m = this.pgExtMeta();
    if (!m) return '확장 목록 조회 중…';
    if (!m.available || !this.pgAvailExts().length) return '확장 목록 조회 불가(PG 미설치/권한) — 기본 contrib 폴백(자유 추가 가능)';
    return `실행 중 인스턴스 기준 pg_available_extensions: ${m.count}개 (${m.host || ''})`;
  }
  private loadPgExts() {
    if (this.pgExtLoading) return;
    this.pgExtLoading = true;
    this.svc.pgExtensions().subscribe({
      next: (r: any) => { this.pgAvailExts.set(Array.isArray(r?.extensions) ? r.extensions : []); this.pgExtMeta.set(r); this.pgExtLoading = false; },
      error: (e) => { this.pgExtMeta.set({ available: false, reason: this.errText(e) }); this.pgExtLoading = false; },
    });
  }
  setPg(patch: any) { this.pgOpts.update(o => ({ ...o, ...patch })); }
  // 리소스 프로파일 = 4개 실제 K8s 값(req/lim CPU·메모리)을 채우는 단축키일 뿐. 실제 기준은 그 값 자체(아래 표시·편집 가능).
  readonly PG_RES_PRESETS: Record<string, any> = {
    none: { cpuRequest: '', memoryRequest: '', cpuLimit: '', memoryLimit: '' },
    small: { cpuRequest: '100m', memoryRequest: '256Mi', cpuLimit: '500m', memoryLimit: '512Mi' },
    medium: { cpuRequest: '250m', memoryRequest: '512Mi', cpuLimit: '1', memoryLimit: '1Gi' },
    large: { cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '2Gi' },
  };
  onPgResProfile(name: string) { if (name === 'custom') { this.setPg({ resourceProfile: 'custom' }); return; } this.setPg({ resourceProfile: name, ...this.PG_RES_PRESETS[name] }); }
  onPgResEdit(patch: any) { this.setPg({ ...patch, resourceProfile: 'custom' }); }
  pgHasExt(e: string) { return this.pgOpts().extensions.includes(e); }
  togglePgExt(e: string) { this.pgOpts.update(o => { const s = new Set<string>(o.extensions); s.has(e) ? s.delete(e) : s.add(e); return { ...o, extensions: [...s] }; }); }
  addPgExtFree() { const e = this.pgExtFree().trim(); if (!e) return; this.pgOpts.update(o => o.extensions.includes(e) ? o : { ...o, extensions: [...o.extensions, e] }); this.pgExtFree.set(''); }
  pgParams() {
    const o = this.pgOpts(); const p: any = {
      namespace: (o.namespace || 'opensphere-foundation').trim(),
      instances: Number(o.instances) || 1, imageTag: o.imageTag, storageClass: o.storageClass, storageSize: o.storageSize,
      resourceProfile: o.resourceProfile, poolerEnabled: !!o.poolerEnabled, poolerMode: o.poolerMode,
      poolerInstances: Number(o.poolerInstances) || 1, enableSuperuserAccess: !!o.enableSuperuserAccess,
      monitoring: !!o.monitoring, extensions: o.extensions, max_connections: o.max_connections,
    };
    if (o.walStorageSize) p.walStorageSize = o.walStorageSize;
    if (o.shared_buffers) p.shared_buffers = o.shared_buffers;
    if (o.work_mem) p.work_mem = o.work_mem;
    if (o.resourceProfile === 'custom') { p.cpuRequest = o.cpuRequest; p.memoryRequest = o.memoryRequest; p.cpuLimit = o.cpuLimit; p.memoryLimit = o.memoryLimit; }
    return p;
  }
  liveParams() { return this.modelsByName()['data']?.spec?.parameters || {}; }
  installData() {
    this.pgBusy.set(true);
    this.svc.setDesired('data', 'Installed', this.pgParams()).subscribe({
      next: () => { this.pgBusy.set(false); this.reconfig.set(false); setTimeout(() => this.load(), 900); },
      error: e => { this.pgBusy.set(false); this.error.set('PG 설치/재구성 실패: ' + this.errText(e)); },
    });
  }
  // 재구성 진입: 현재 배포값을 폼에 불러오고(기본값 클로버 방지) 버전·확장·NS 목록 로드 후 폼 노출.
  startReconfig() {
    this.prefillPgForm();
    if (!this.pgVersionTags().length) this.loadPgTags();
    this.loadPgExts();
    this.loadNamespaces();
    this.reconfig.set(true);
  }
  readonly reqNs = signal('opensphere-foundation');
  readonly reqCap = signal('');
  readonly reqBusy = signal(false);

  // 트리 펼침 상태: 1회 초기화(설치된 모델 자동 펼침) 후 사용자 소유 — 폴링이 덮어쓰지 않는다.
  readonly expanded = signal<Set<string>>(new Set());
  private ranInit = false;

  readonly operandsOf = operandsOf;

  // ── Bootstrap(Foundation 설립) — PG 기준 상태머신 + preflight ──
  readonly PF_ORDER = ['cp', 'desc', 'sc', 'cnpg'];
  readonly preflight = signal<{ id: string; label: string; ok: boolean; detail: string }[]>([]);
  readonly bootstrapBypass = signal(false); // '그래도 둘러보기' 탈출구
  readonly foundationState = computed<'NotEstablished' | 'Establishing' | 'Established'>(() => {
    const fm = this.modelsByName()['data'];
    if (!fm || fm.spec?.desiredState !== 'Installed') return 'NotEstablished';
    const pg = operandsOf('data').find(o => o.id === 'postgresql');
    if (pg && isLive(pg, fm)) return 'Established';
    return 'Establishing';
  });
  pgInstalled() { return this.foundationState() === 'Established'; }
  dataPhase() { return this.modelsByName()['data']?.status?.phase || ''; }
  liveParamSummaryLine() { const p = this.modelsByName()['data']?.spec?.parameters || {}; const inst = p.instances || (p.topology === 'ha' ? 3 : 1); return `${p.imageTag || p.version || '?'} · ${inst >= 2 ? 'HA ' + inst + '노드' : '단일'} · ext[${(p.extensions || []).join(', ') || '없음'}]`; }
  goBootstrap() { this.route.set({ kind: 'bootstrap' }); this.loadPreflight(); if (!this.pgVersionTags().length) this.loadPgTags(); this.loadPgExts(); this.loadNamespaces(); this.prefillPgForm(); }
  upsertPf(c: { id: string; label: string; ok: boolean; detail: string }) { this.preflight.update(list => [...list.filter(x => x.id !== c.id), c].sort((a, b) => this.PF_ORDER.indexOf(a.id) - this.PF_ORDER.indexOf(b.id))); }
  preflightOk() { const l = this.preflight(); return this.PF_ORDER.every(id => l.find(c => c.id === id)?.ok); }
  loadPreflight() {
    this.upsertPf({ id: 'cp', label: 'Control plane · 계약 레지스트리', ok: this.descriptors().length > 0, detail: this.descriptors().length + ' descriptors 로드' });
    this.upsertPf({ id: 'desc', label: 'data 디스크립터(OS-2201)', ok: !!this.descriptors().find(d => d.spec?.model === 'data'), detail: 'foundation-data' });
    this.svc.storageClasses().subscribe({
      next: (r: any) => { const n = (r.items || []).length; this.upsertPf({ id: 'sc', label: 'StorageClass(CSI)', ok: n > 0, detail: n > 0 ? (r.items || []).map((x: any) => x.metadata.name).join(', ') : '없음' }); },
      error: () => this.upsertPf({ id: 'sc', label: 'StorageClass(CSI)', ok: false, detail: '확인 불가(권한)' }),
    });
    this.svc.deployment('cnpg-system', 'cnpg-controller-manager').subscribe({
      next: (d: any) => { const rr = d.status?.readyReplicas || 0; this.upsertPf({ id: 'cnpg', label: 'CloudNativePG operator(채택)', ok: rr >= 1, detail: rr + '/1 Ready' }); },
      error: () => this.upsertPf({ id: 'cnpg', label: 'CloudNativePG operator(채택)', ok: false, detail: '미설치 — 설치 필요' }),
    });
  }
  private prefillPgForm() {
    const p = this.modelsByName()['data']?.spec?.parameters || {}; const d = this.pgDefaults();
    this.pgVerCustom.set(false); this.pgNsCustom.set(false);
    this.pgOpts.set({
      ...d, namespace: p.namespace || d.namespace, instances: p.instances || (p.topology === 'ha' ? 3 : 1), imageTag: p.imageTag || p.version || d.imageTag,
      storageClass: p.storageClass || d.storageClass, storageSize: p.storageSize || d.storageSize, walStorageSize: p.walStorageSize || '',
      resourceProfile: p.resourceProfile || d.resourceProfile, cpuRequest: p.cpuRequest || d.cpuRequest, memoryRequest: p.memoryRequest || d.memoryRequest,
      cpuLimit: p.cpuLimit || d.cpuLimit, memoryLimit: p.memoryLimit || d.memoryLimit, max_connections: p.max_connections || d.max_connections,
      shared_buffers: p.shared_buffers || '', work_mem: p.work_mem || '', poolerEnabled: !!p.poolerEnabled, poolerMode: p.poolerMode || d.poolerMode,
      poolerInstances: p.poolerInstances || 1, enableSuperuserAccess: !!p.enableSuperuserAccess, monitoring: !!p.monitoring,
      extensions: Array.isArray(p.extensions) ? p.extensions : [],
    });
  }

  constructor() {
    this.load();
    effect((onCleanup) => {
      const k = this.route().kind;
      if (k !== 'operand' && k !== 'bootstrap') return; // operand·bootstrap 페이지에서 10초 폴링(설치 진행 반영)
      const id = setInterval(() => this.load(), 10000);
      onCleanup(() => clearInterval(id));
    });
    // 진단·Issuer 탭이 더 이상 렌더되지 않으면(live→planned 전환/회수) 빈 탭 방지 — 개요로 복귀.
    effect(() => {
      const r = this.opRoute();
      if (this.activeTab() === 'diag' && !(r?.live && r.fm?.status?.issuerURL)) this.activeTab.set('ov');
    });
  }

  load() {
    this.error.set(null);
    forkJoin({
      d: this.svc.descriptors().pipe(catchError(e => of({ items: [], _err: e }))),
      m: this.svc.models().pipe(catchError(() => of({ items: [] }))),
      c: this.svc.claims().pipe(catchError(() => of({ items: [] }))),
      b: this.svc.bindings().pipe(catchError(() => of({ items: [] }))),
    }).subscribe(r => {
      if ((r.d as any)._err) this.error.set('디스크립터 로드 실패: ' + this.errText((r.d as any)._err));
      const items = ((r.d as any).items || []).slice().sort((a: any, b: any) => this.pdnn(a).localeCompare(this.pdnn(b)));
      this.descriptors.set(items);
      const map: Record<string, any> = {};
      for (const fm of ((r.m as any).items || [])) map[fm.spec?.model || fm.metadata?.name] = fm;
      this.modelsByName.set(map);
      this.claimsList.set((r.c as any).items || []);
      this.bindingsList.set((r.b as any).items || []);
      if (!this.ranInit && items.length) { // 1회: 설치된 모델 자동 펼침
        const s = new Set<string>();
        for (const d of items) if (map[d.spec?.model]?.status?.phase === 'Installed') s.add(d.spec?.model);
        this.expanded.set(s); this.ranInit = true;
      }
    });
  }
  private pdnn(d: any) { return d.metadata?.annotations?.['opensphere.io/os-pdnn'] || 'OS-9999'; }

  // ── tree 네비 ──
  goIndex() { this.route.set({ kind: 'index' }); }
  isExpanded(model: string) { return this.expanded().has(model); }
  toggleExpand(model: string) { const s = new Set(this.expanded()); s.has(model) ? s.delete(model) : s.add(model); this.expanded.set(s); }
  openOperand(d: any, op: OperandMeta) {
    const m = d.spec?.model;
    if (!this.expanded().has(m)) this.toggleExpand(m);
    // 설립 게이트: Foundation 미설립이면 관리 페이지 대신 설립 마법사로(둘러보기 우회 시 통과).
    if (this.foundationState() !== 'Established' && !this.bootstrapBypass()) { this.goBootstrap(); return; }
    this.reconfig.set(false); // operand 전환 시 재구성 모드 해제(설치 폼 잔류 방지)
    this.route.set({ kind: 'operand', model: m, operand: op });
    // 카탈로그가 있으면 제품 상세를 기본 탭으로(보스: 가장 많은 기능 정보 전면 노출).
    this.activeTab.set(catalogOf(m, op.id) ? 'cat' : 'ov');
    this.showRequest.set(false); this.showModelTopo.set(false);
    if (d?.spec?.operator?.capability?.length) this.reqCap.set(d.spec.operator.capability[0]);
    if (m === 'data' && op.id === 'postgresql') { // 설치옵션 폼 프리필(현재 spec.parameters)
      this.loadPgTags(); // 버전 목록 레지스트리 실시간 조회(1회)
      this.loadPgExts(); // 확장 목록 = 실행 중 PG의 pg_available_extensions
      this.loadNamespaces(); // NS 목록
      this.pgVerCustom.set(false); this.pgNsCustom.set(false);
      const p = this.modelsByName()['data']?.spec?.parameters || {};
      const d = this.pgDefaults();
      this.pgOpts.set({
        ...d,
        namespace: p.namespace || d.namespace,
        instances: p.instances || (p.topology === 'ha' ? 3 : 1),
        imageTag: p.imageTag || p.version || d.imageTag,
        storageClass: p.storageClass || d.storageClass,
        storageSize: p.storageSize || d.storageSize,
        walStorageSize: p.walStorageSize || '',
        resourceProfile: p.resourceProfile || d.resourceProfile,
        cpuRequest: p.cpuRequest || d.cpuRequest, memoryRequest: p.memoryRequest || d.memoryRequest,
        cpuLimit: p.cpuLimit || d.cpuLimit, memoryLimit: p.memoryLimit || d.memoryLimit,
        max_connections: p.max_connections || d.max_connections, shared_buffers: p.shared_buffers || '', work_mem: p.work_mem || '',
        poolerEnabled: !!p.poolerEnabled, poolerMode: p.poolerMode || d.poolerMode, poolerInstances: p.poolerInstances || 1,
        enableSuperuserAccess: !!p.enableSuperuserAccess, monitoring: !!p.monitoring,
        extensions: Array.isArray(p.extensions) ? p.extensions : [],
      });
    }
  }
  openPrimary(d: any) { const ops = operandsOf(d.spec?.model); this.openOperand(d, ops.find(o => o.primary) || ops[0]); }
  isActiveOperand(model: string, op: OperandMeta) { const r = this.route(); return r.kind === 'operand' && r.model === model && r.operand.id === op.id; }
  opChip(model: string, op: OperandMeta) { return operandChip(op, this.modelsByName()[model]); }

  readonly opRoute = computed(() => {
    const r = this.route();
    if (r.kind !== 'operand') return null;
    const d = this.descriptors().find(x => x.spec?.model === r.model) || null;
    const fm = this.modelsByName()[r.model] || null;
    return { model: r.model, operand: r.operand, d, fm, live: isLive(r.operand, fm) };
  });

  // ── 제품-등급 카탈로그(operand별 패널/관계/액션) ──
  readonly catalog = computed(() => { const r = this.opRoute(); return r ? catalogOf(r.model, r.operand.id) || null : null; });
  catalogFm() { return this.opRoute()?.fm || null; }
  catalogLive() { return this.opRoute()?.live || false; }

  // ── operand 카운트(정직 KPI) ──
  totalOperands() { return Object.values(OPERANDS).reduce((n, a) => n + a.length, 0); }
  liveCount() { let n = 0; for (const [m, ops] of Object.entries(OPERANDS)) for (const o of ops) if (isLive(o, this.modelsByName()[m])) n++; return n; }
  plannedCount() { return this.totalOperands() - this.liveCount(); }
  installedModels() { return this.descriptors().filter(d => this.modelsByName()[d.spec?.model]?.status?.phase === 'Installed').length; }
  liveOperandName(model: string) { const ops = operandsOf(model); const live = ops.find(o => isLive(o, this.modelsByName()[model])); return live ? live.name : '—'; }
  trackModel = (_: number, d: any) => d?.spec?.model;
  trackOp = (_: number, o: OperandMeta) => o?.id;
  liveOperandList() { const names: string[] = []; for (const [m, ops] of Object.entries(OPERANDS)) for (const o of ops) if (isLive(o, this.modelsByName()[m])) names.push(o.name); return names.length ? names.join(' · ') : '없음'; }
  installedModelNames() { const ns = this.descriptors().filter(d => this.modelsByName()[d.spec?.model]?.status?.phase === 'Installed').map(d => d.spec?.model); return ns.length ? ns.join(' · ') : '없음'; }

  // ── 로고 ──
  readonly broken = signal<Set<string>>(new Set());
  logoUrl(slug: string) { return `https://cdn.simpleicons.org/${slug}`; }
  isBroken(slug: string) { return this.broken().has(slug); }
  markBroken(slug: string) { this.broken.update(s => new Set(s).add(slug)); }
  monoText(name: string) { const w = (name.match(/[A-Za-z0-9가-힣]+/g) || ['·']); return (w[w.length - 1] || w[0]).slice(0, 2).toUpperCase(); }
  monoStyle(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 42% 45%)`; }

  // ── 모델 상태/토글 ──
  model(d: any) { return this.modelsByName()[d?.spec?.model]; }
  isInstalled(d: any) { return this.model(d)?.spec?.desiredState === 'Installed'; }
  phaseLabel(d: any) { const fm = this.model(d); if (!fm) return '미등록'; return fm.status?.phase || (fm.spec?.desiredState === 'Installed' ? 'Installing(대기)' : 'Disabled'); }
  phaseClass(d: any): Record<string, boolean> {
    const p = this.phaseLabel(d);
    return { 'label': true, 'label-success': p === 'Installed', 'label-warning': p === 'Installing' || p === 'Removing' || p.indexOf('대기') >= 0, 'label-danger': p === 'Degraded', 'label-info': p === 'Disabled' || p === '미등록' };
  }
  toggle(d: any, checked: boolean) {
    const m = d.spec?.model; this.busy.set(m);
    this.svc.setDesired(m, checked ? 'Installed' : 'Disabled').subscribe({
      next: fm => { const map = { ...this.modelsByName() }; map[m] = fm; this.modelsByName.set(map); this.busy.set(null); setTimeout(() => this.load(), 800); },
      error: e => { this.error.set('토글 실패(' + m + '): ' + this.errText(e)); this.busy.set(null); this.load(); },
    });
  }

  // ── operand 모니터링(정직 게이트) ──
  observed(d: any, id: string): any | null { return (this.model(d)?.status?.observed || []).find((o: any) => o.id === id) || null; }
  metricClass(o: any): Record<string, boolean> {
    if (!o) return {};
    const unknown = o.value === 'n/a' || (o.note && /baseline|unreachable|not ready|트래픽 없음/.test(o.note));
    return { 'label-success': o.healthy === true, 'label-warning': unknown, 'label-danger': o.healthy === false && !unknown };
  }
  valUnit(o: any, m: any) { return (o && m?.unit && o.value !== 'n/a' && o.value != null && m.unit !== 'bool') ? ' ' + m.unit : ''; }
  operandMetrics() {
    const r = this.opRoute(); if (!r) return [];
    const defs = r.d?.spec?.monitoring?.metrics || [];
    const ids = r.operand.metricIds;
    const owned = ids && ids.length ? defs.filter((m: any) => ids.includes(m.id)) : [];
    return owned.length ? owned : defs; // 소유 metric 없으면 모델 정의로 폴백(빈 탭 방지)
  }
  opMetric(m: any): { mode: string; o?: any; note?: string } {
    const r = this.opRoute(); if (!r) return { mode: 'planned' };
    if (r.live && r.operand.metricIds?.includes(m.id)) {
      if (hasDeferralTag(m.title)) return { mode: 'deferred', note: '측정 대기 ' + (m.title.match(/\(D-\d+\)/) || [''])[0] };
      const o = this.observed(r.d, m.id);
      return o ? { mode: 'live', o } : { mode: 'pending', note: '라이브 측정 대기(Installing)' };
    }
    return { mode: 'planned', note: '미배포 — 라이브 측정 없음 (' + (r.operand.plannedSlice || 'D-?') + ')' };
  }

  // ── 관계도(모델 수준; 미배포 operand면 declared만) ──
  // 안정 pos 캐시 — 좌표 동일 시 같은 객체를 재사용해 폴링 재계산 때 foblex 재배치/pan-zoom 리셋 방지(VM stable-pos 계약).
  private posCache = new Map<string, { x: number; y: number }>();
  private pos(key: string, x: number, y: number) {
    const c = this.posCache.get(key);
    if (c && c.x === x && c.y === y) return c;
    const p = { x, y }; this.posCache.set(key, p); return p;
  }
  readonly flowNodes = computed<FlowNodeVM[]>(() => this.buildFlow().nodes);
  readonly flowEdges = computed<FlowEdgeVM[]>(() => this.buildFlow().edges);
  private buildFlow(): { nodes: FlowNodeVM[]; edges: FlowEdgeVM[] } {
    const r = this.opRoute(); const d = r?.d;
    if (!d) return { nodes: [], edges: [] };
    const model = d.spec?.model;
    const consumers = d.spec?.relations?.consumers || [];
    const consumed = d.spec?.relations?.consumed || [];
    const nodes: FlowNodeVM[] = []; const edges: FlowEdgeVM[] = [];
    const colL = 20, colC = 340, colR = 660, step = 96;
    consumers.forEach((c: any, i: number) => {
      const id = 'c' + i;
      nodes.push({ id, label: c.ref, sub: c.via || '', side: 'consumer', pos: this.pos('o:' + model + ':' + id, colL, 20 + i * step), hasIn: false, hasOut: true });
      edges.push({ id: 'ec' + i, from: id + ':out', to: 'model:in', cls: 'edge-pending' });
    });
    const rows = Math.max(consumers.length, consumed.length, 1);
    nodes.push({ id: 'model', label: model, sub: 'foundation model', side: 'self', pos: this.pos('o:' + model + ':model', colC, 20 + ((rows - 1) * step) / 2), hasIn: true, hasOut: true });
    consumed.forEach((c: any, i: number) => {
      const id = 'd' + i;
      nodes.push({ id, label: c.ref, sub: c.via || '', side: 'consumed', pos: this.pos('o:' + model + ':' + id, colR, 20 + i * step), hasIn: true, hasOut: false });
      edges.push({ id: 'ed' + i, from: 'model:out', to: id + ':in', cls: c.mode === 'declareOnly' ? 'edge-declare' : 'edge-pending' });
    });
    // 라이브 binding 색은 이 operand가 LIVE일 때만(미배포 operand면 declared topology only)
    if (r?.live) {
      let ai = 0;
      for (const row of this.claimRows(d)) {
        if (!row.bindPhase) continue;
        const id = 'a' + ai;
        nodes.push({ id, label: row.claim, sub: row.capability, side: 'active', pos: this.pos('o:' + model + ':' + id, colL, 20 + (consumers.length + ai) * step), hasIn: false, hasOut: true });
        edges.push({ id: 'ea' + ai, from: id + ':out', to: 'model:in', cls: this.edgeClassFor(row.bindPhase) });
        ai++;
      }
    }
    return { nodes, edges };
  }
  private edgeClassFor(phase: string) { return phase === 'Connected' ? 'edge-connected' : phase === 'Degraded' ? 'edge-degraded' : 'edge-pending'; }

  // ── operand 수준 관계도(보스 요구: 정확한 operand 관계 — consumes 좌측, 자신 중앙, provides 우측) ──
  readonly opConsumes = computed<OperandRelation[]>(() => this.catalog()?.consumes || []);
  readonly opProvides = computed<OperandRelation[]>(() => this.catalog()?.provides || []);
  readonly operandNodes = computed<FlowNodeVM[]>(() => this.buildOperandFlow().nodes);
  readonly operandEdges = computed<FlowEdgeVM[]>(() => this.buildOperandFlow().edges);
  private buildOperandFlow(): { nodes: FlowNodeVM[]; edges: FlowEdgeVM[] } {
    const r = this.opRoute(); const cat = this.catalog();
    if (!r || !cat) return { nodes: [], edges: [] };
    const opId = r.operand.id; const consumes = cat.consumes || []; const provides = cat.provides || [];
    const nodes: FlowNodeVM[] = []; const edges: FlowEdgeVM[] = [];
    const colL = 16, colC = 360, colR = 712, step = 72;
    consumes.forEach((c, i) => {
      const id = 'ic' + i;
      nodes.push({ id, label: c.display || c.ref, sub: c.via || '', side: 'consumer', pos: this.pos('op:' + opId + ':' + id, colL, 16 + i * step), hasIn: false, hasOut: true });
      edges.push({ id: 'eic' + i, from: id + ':out', to: 'opself:in', cls: this.relEdge(c.mode, r.live) });
    });
    const rows = Math.max(consumes.length, provides.length, 1);
    nodes.push({ id: 'opself', label: r.operand.name, sub: cat.type, side: 'self', pos: this.pos('op:' + opId + ':self', colC, 16 + ((rows - 1) * step) / 2), hasIn: true, hasOut: true });
    provides.forEach((p, i) => {
      const id = 'ip' + i;
      nodes.push({ id, label: p.display || p.ref, sub: p.via || '', side: 'consumed', pos: this.pos('op:' + opId + ':' + id, colR, 16 + i * step), hasIn: true, hasOut: false });
      edges.push({ id: 'eip' + i, from: 'opself:out', to: id + ':in', cls: this.relEdge(p.mode, r.live) });
    });
    return { nodes, edges };
  }
  // 라이브 색은 operand가 실제 배포(live)되고 관계 mode가 'live'일 때만. declared=점선, planned=회색점선(정직).
  private relEdge(mode: string, live: boolean): string { if (mode === 'live' && live) return 'edge-connected'; if (mode === 'declared') return 'edge-declare'; return 'edge-pending'; }
  relBadge(rel: OperandRelation): { cls: string; text: string } {
    const live = this.catalogLive();
    if (rel.mode === 'live' && live) return { cls: 'label-success', text: '라이브' };
    if (rel.mode === 'live' && !live) return { cls: 'label-info', text: '배포 후 라이브' };
    if (rel.mode === 'declared') return { cls: 'label-info', text: rel.external ? '외부(선언)' : '선언됨' };
    return { cls: 'label-warning', text: '계획 ' + (rel.slice || '') };
  }

  // ── 모델 간 global 관계(index): foundation-* 참조만 ──
  readonly globalNodes = computed<FlowNodeVM[]>(() => this.buildGlobalFlow().nodes);
  readonly globalEdges = computed<FlowEdgeVM[]>(() => this.buildGlobalFlow().edges);
  private buildGlobalFlow(): { nodes: FlowNodeVM[]; edges: FlowEdgeVM[] } {
    const ds = this.descriptors(); const models = new Set(ds.map(d => d.spec?.model));
    const nodes: FlowNodeVM[] = ds.map((d, i) => {
      const m = d.spec?.model; const live = this.modelsByName()[m]?.status?.phase === 'Installed';
      return { id: m, label: m, sub: this.pdnn(d), side: live ? 'self' : 'consumed', pos: this.pos('g:' + m, 40 + (i % 2) * 300, 20 + Math.floor(i / 2) * 104), hasIn: true, hasOut: true };
    });
    const edges: FlowEdgeVM[] = []; const seen = new Set<string>();
    for (const d of ds) {
      const m = d.spec?.model;
      for (const c of (d.spec?.relations?.consumed || [])) {
        const mt = /^foundation-([a-z]+)/.exec(c.ref || '');
        if (mt && models.has(mt[1]) && mt[1] !== m) { const k = m + '>' + mt[1]; if (seen.has(k)) continue; seen.add(k); edges.push({ id: 'g' + k, from: m + ':out', to: mt[1] + ':in', cls: 'edge-declare' }); }
      }
    }
    return { nodes, edges };
  }

  // ── P6 claim/binding ──
  claimRows(d: any) {
    const model = d?.spec?.model;
    return this.claimsList().filter((c: any) => c.spec?.model === model).map((c: any) => this.toRow(c));
  }
  allClaimRows() { return this.claimsList().map((c: any) => this.toRow(c)); }
  private toRow(c: any) {
    const ns = c.metadata?.namespace, name = c.metadata?.name;
    const b = this.bindingsList().find((x: any) => x.spec?.claimRef?.name === name && x.spec?.claimRef?.namespace === ns);
    const fins: string[] = b?.metadata?.finalizers || [];
    return { claim: name, ns, model: c.spec?.model, capability: c.spec?.capability, claimPhase: c.status?.phase, bindPhase: b?.status?.phase, rtt: b?.status?.connection?.rttMs, guarded: fins.indexOf('foundation.opensphere.io/consumer-protect') >= 0, terminating: !!(b?.metadata?.deletionTimestamp) || !!(c.metadata?.deletionTimestamp) };
  }
  phaseColor(p?: string): Record<string, boolean> { return { 'label-success': p === 'Bound' || p === 'Connected', 'label-warning': p === 'Pending', 'label-danger': p === 'Failed' || p === 'Degraded', 'label-info': p === 'Released' }; }
  requestClaim(d: any) {
    const model = d.spec?.model; this.reqBusy.set(true);
    this.svc.createClaim(model, this.reqNs(), this.reqCap() || (d.spec?.operator?.capability || [])[0] || 'default').subscribe({
      next: () => { this.reqBusy.set(false); this.showRequest.set(false); setTimeout(() => this.load(), 600); },
      error: e => { this.reqBusy.set(false); this.error.set('요청 실패: ' + this.errText(e)); },
    });
  }
  releaseClaim(row: any) { this.svc.deleteClaim(row.ns, row.claim).subscribe({ next: () => setTimeout(() => this.load(), 600), error: e => this.error.set('해제 실패: ' + this.errText(e)) }); }

  private errText(e: any) { return e?.error?.message || e?.error?.error || e?.message || String(e); }
}
