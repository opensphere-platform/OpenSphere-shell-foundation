import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import { VeleroService, BackupTarget } from './velero.service';
import { ViewRouter } from '../../view-router';
import { State } from '../../modules/postgres/cnpg.types';
import { CarbonIcon } from '../../carbon-icon';
import CheckmarkFilled20 from '@carbon/icons/es/checkmark--filled/20';
import Misuse20 from '@carbon/icons/es/misuse/20';
import WarningAltFilled20 from '@carbon/icons/es/warning--alt--filled/20';
import Information20 from '@carbon/icons/es/information/20';
import Download16 from '@carbon/icons/es/download/16';
import ArrowLeft16 from '@carbon/icons/es/arrow--left/16';

const LOGO = 'https://cdn.statically.io/gh/openplatform-labs/images@main/logos/velero.svg';

// Velero 전용 페이지 — BSS(Host 연결) 카탈로그의 Velero 카드 클릭 시 열림(/p/foundation/bss/velero).
// Velero는 워크로드 무관 범용 DR 도구라 BSS 소속으로 재확정됨(2026-07-04, 사용자).
// 톤: shell-template overview(IBM Cloud식 히어로 + 섹션 h2 + Carbon Tile 룩 + Carbon 아이콘).
// 설치 전: 의존성 경보 + 버전 선택 + 설치 준비. 설치 후: 라이브 상태. 데이터·검사는 전부 VeleroService.
@Component({
  selector: 'app-velero',
  standalone: true,
  imports: [CommonModule, FormsModule, ClarityModule, CarbonIcon],
  template: `
    <a class="vl-back" (click)="back()" (keydown.enter)="back()" role="button" tabindex="0">
      <os-cicon [icon]="iBack" [size]="16" /> BSS
    </a>

    <section class="vl-hero">
      <div class="vl-hero__copy">
        <span class="vl-eyebrow">Foundation · 백업 업스트림</span>
        <h1>Velero</h1>
        <p>
          Kubernetes 리소스와 볼륨을 실제로 백업·복구하는 엔진. 이 페이지는 <strong>Velero 설치·상태</strong>와
          <strong>공용 기본 백업 대상(외부 S3)</strong>을 책임진다. 개별 plugin은 이 대상을 쓰거나 자기 전용 대상으로 override한다.
        </p>
        <div class="vl-hero__meta">
          <span class="label" [ngClass]="phasePill()">{{ svc.phaseLabel() }}</span>
          <span class="vl-dim">velero.io · CNCF Sandbox · Apache-2.0</span>
          <button class="btn btn-sm btn-link vl-refresh" (click)="svc.refresh()" [disabled]="svc.busy()">
            {{ svc.busy() ? '동기화…' : '새로고침' }}
          </button>
        </div>
      </div>
      <div class="vl-hero__art" aria-hidden="true"><img [src]="LOGO" alt="Velero" /></div>
    </section>

    <!-- 필수 의존성 미충족 경보 -->
    <div class="vl-note vl-note--danger" *ngIf="svc.blockingUnmet().length">
      <os-cicon [icon]="iMisuse" [size]="20" />
      <div>
        <strong>필수 의존성 미충족 — 설치할 수 없습니다</strong>
        <p *ngFor="let d of svc.blockingUnmet()">{{ d.label }}: {{ d.fixHint }}</p>
      </div>
    </div>

    <section class="vl-section">
      <h2>의존성</h2>
      <div class="vl-tile-grid">
        <div class="vl-tile" *ngFor="let d of svc.deps()">
          <os-cicon [icon]="depIcon(d.state, d.required)" [size]="20" [ngClass]="depCls(d.state, d.required)" />
          <h3>{{ d.label }} <span class="label" [ngClass]="d.required ? '' : 'label-info'">{{ d.required ? '필수' : '선택' }}</span></h3>
          <p>{{ d.detail }}</p>
        </div>
      </div>
    </section>

    <!-- 설치됨: 라이브 상태(15초 자동 갱신) -->
    <section class="vl-section" *ngIf="svc.installed()">
      <h2>설치 상태</h2>
      <div class="vl-tile vl-tile--wide">
        <dl class="os-kv">
          <dt>상태</dt>
          <dd>
            <span class="label" [ngClass]="svc.ready() ? 'label-success' : 'label-warning'">{{ svc.ready() ? 'Running' : '기동 중' }}</span>
            <span class="vl-dim" *ngIf="svc.ready()"> 정상 운영중 — 레플리카 {{ svc.readyN() }}/{{ svc.totalN() }}</span>
            <span class="vl-dim" *ngIf="!svc.ready()"> 파드 준비 대기 — 레플리카 {{ svc.readyN() }}/{{ svc.totalN() }} (15초마다 자동 갱신)</span>
          </dd>
          <dt>버전</dt><dd>Velero {{ svc.installedVersion() }}</dd>
          <dt>image</dt><dd class="os-mono">{{ svc.installedImage() }}</dd>
          <dt>네임스페이스</dt><dd class="os-mono">velero</dd>
        </dl>
      </div>
    </section>

    <!-- 백업 대상(외부 S3) — 공용 기본. 저장 시 Release CR 선언형 재구성 → BSL + node-agent -->
    <section class="vl-section" *ngIf="svc.installed()">
      <h2>백업 대상 <span class="vl-dim">— 외부 S3 호환 서비스 · 공용 기본</span></h2>

      <div class="vl-tile vl-tile--wide">
        <dl class="os-kv">
          <dt>기본 저장위치 (BSL)</dt>
          <dd *ngIf="svc.defaultBsl() as b">
            <span class="label" [ngClass]="b.phase === 'Available' ? 'label-success' : 'label-warning'">{{ b.phase }}</span>
            <span class="vl-dim"> {{ b.bucket }} @ {{ b.endpoint || 'AWS S3' }}{{ b.region ? ' · ' + b.region : '' }}</span>
            <span class="vl-dim" *ngIf="b.message"> · {{ b.message }}</span>
          </dd>
          <dd *ngIf="!svc.defaultBsl()">
            <span class="label label-warning">미구성</span>
            <span class="vl-dim"> 아래 폼에서 외부 S3 대상을 설정하세요.</span>
          </dd>
          <dt>node-agent <span class="vl-dim">(파일시스템 백업)</span></dt>
          <dd *ngIf="svc.nodeAgent() as na">
            <span class="label" [ngClass]="na.ready > 0 ? 'label-success' : 'label-warning'">{{ na.ready }}/{{ na.desired }} Ready</span>
          </dd>
          <dd *ngIf="!svc.nodeAgent()">
            <span class="label label-warning">미배포</span>
            <span class="vl-dim"> 대상 저장 시 함께 활성화됩니다.</span>
          </dd>
        </dl>
      </div>

      <div class="vl-install">
        <div class="vl-install-row">
          <label class="vl-field">
            <span class="vl-field-l">엔드포인트 (s3Url)</span>
            <input class="os-filter" [(ngModel)]="bt.endpoint" placeholder="https://s3.ap-northeast-2.amazonaws.com" />
          </label>
          <label class="vl-field">
            <span class="vl-field-l">버킷</span>
            <input class="os-filter" [(ngModel)]="bt.bucket" placeholder="opensphere-backup" />
          </label>
          <label class="vl-field">
            <span class="vl-field-l">리전</span>
            <input class="os-filter" [(ngModel)]="bt.region" placeholder="us-east-1" />
          </label>
        </div>
        <div class="vl-install-row">
          <label class="vl-field">
            <span class="vl-field-l">Access Key</span>
            <input class="os-filter" [(ngModel)]="bt.accessKey" autocomplete="off" />
          </label>
          <label class="vl-field">
            <span class="vl-field-l">Secret Key</span>
            <input class="os-filter" type="password" [(ngModel)]="bt.secretKey" autocomplete="off" />
          </label>
          <button class="btn btn-primary vl-install-btn" [disabled]="svc.saveBusy()" (click)="svc.saveBackupTarget(bt)">
            <os-cicon [icon]="iDownload" [size]="16" /> {{ svc.saveBusy() ? '저장…' : '백업 대상 저장' }}
          </button>
        </div>
        <p class="vl-nocap">
          외부 S3 호환 서비스(AWS S3 · MinIO · Wasabi 등)의 접속 정보. 저장하면 Velero Release가 선언형으로 재구성되어
          자격증명·저장위치(BSL)·node-agent가 적용됩니다. 자격증명은 클러스터 Secret에만 보관되고 화면에 다시 표시되지 않습니다.
        </p>
        <div class="vl-note" *ngIf="svc.saveMsg()">
          <os-cicon [icon]="iInfo" [size]="20" />
          <div><p>{{ svc.saveMsg() }} <a class="vl-link" (click)="svc.clearSaveMsg()">닫기</a></p></div>
        </div>
        <div class="vl-note vl-note--danger" *ngIf="svc.saveErr()">
          <os-cicon [icon]="iMisuse" [size]="20" />
          <div><p>{{ svc.saveErr() }} <a class="vl-link" (click)="svc.clearSaveMsg()">닫기</a></p></div>
        </div>
      </div>
    </section>

    <!-- Prometheus(kube-prometheus-stack) 연계 — 백업/복원 이력 지표 -->
    <section class="vl-section" *ngIf="svc.installed()">
      <h2>백업 · 복원 이력 <span class="vl-dim">— kube-prometheus-stack 연계</span></h2>
      <div class="vl-tile vl-tile--wide" *ngIf="svc.metricsState() === 'ok' && svc.metrics() as m">
        <div class="vl-stat-grid">
          <div class="vl-stat"><span class="vl-stat-n">{{ m.backupTotal }}</span><span class="vl-stat-l">백업 시도</span></div>
          <div class="vl-stat"><span class="vl-stat-n vl-ok-n">{{ m.backupSuccess }}</span><span class="vl-stat-l">백업 성공</span></div>
          <div class="vl-stat"><span class="vl-stat-n" [ngClass]="m.backupFailure ? 'vl-bad-n' : ''">{{ m.backupFailure }}</span><span class="vl-stat-l">백업 실패</span></div>
          <div class="vl-stat"><span class="vl-stat-n" [ngClass]="m.backupPartial ? 'vl-warn-n' : ''">{{ m.backupPartial }}</span><span class="vl-stat-l">부분 실패</span></div>
          <div class="vl-stat"><span class="vl-stat-n">{{ m.restoreTotal }}</span><span class="vl-stat-l">복원 시도</span></div>
          <div class="vl-stat"><span class="vl-stat-n vl-ok-n">{{ m.restoreSuccess }}</span><span class="vl-stat-l">복원 성공</span></div>
          <div class="vl-stat"><span class="vl-stat-n" [ngClass]="m.restoreFailure ? 'vl-bad-n' : ''">{{ m.restoreFailure }}</span><span class="vl-stat-l">복원 실패</span></div>
        </div>
        <p class="vl-plan-note" *ngIf="!m.backupTotal">아직 실행된 백업이 없음 — 위 "백업 대상"에서 외부 S3를 구성하면, 각 plugin(예: Samba-AD)이 자기 백업 일정을 등록해 여기 이력이 쌓입니다.</p>
      </div>
      <p class="vl-nocap" *ngIf="svc.metricsState() === 'loading'">지표 조회 중…</p>
      <p class="vl-nocap" *ngIf="svc.metricsState() === 'error' || svc.metricsState() === 'noperm'">Prometheus 지표를 가져올 수 없음 — kube-prometheus-stack 연결을 확인하세요.</p>
    </section>

    <!-- 미설치: 설치 준비 / 설치 진행 -->
    <section class="vl-section" *ngIf="!svc.installed()">
      <h2>설치</h2>

      <!-- 설치 실패 -->
      <div class="vl-note vl-note--danger" *ngIf="svc.installState() === 'error'">
        <os-cicon [icon]="iMisuse" [size]="20" />
        <div>
          <strong>설치 실패</strong>
          <p>{{ svc.installError() }} <a class="vl-link" (click)="svc.dismissError()">다시 시도</a></p>
        </div>
      </div>

      <!-- 설치 진행 중: 진행바 + 로그 -->
      <div class="vl-progress-wrap" *ngIf="svc.installState() === 'installing'">
        <div class="vl-progress-head">
          <span>설치 진행 중… Velero {{ svc.plan().app }}</span>
          <span class="vl-progress-pct">{{ svc.progress() }}%</span>
        </div>
        <div class="vl-progress-track"><div class="vl-progress-bar" [style.width.%]="svc.progress()"></div></div>
        <div class="vl-log" #logbox>
          <div class="vl-log-line" *ngFor="let l of svc.logs()">{{ l }}</div>
          <div class="vl-log-empty" *ngIf="!svc.logs().length">로그 대기 중…</div>
        </div>
      </div>

      <!-- 설치 전: 버전 선택 + 설치 버튼 + 계획 -->
      <div class="vl-install" *ngIf="svc.installState() === 'idle'">
        <div class="vl-install-row">
          <label class="vl-field">
            <span class="vl-field-l">버전</span>
            <select class="os-filter" (change)="onSelect($event)">
              <option *ngFor="let v of svc.versions" [value]="v.chart" [selected]="v.chart === svc.selectedChart()">
                chart {{ v.chart }} · Velero {{ v.app }}{{ v.note ? ' (' + v.note + ')' : '' }}
              </option>
            </select>
          </label>
          <button class="btn btn-primary vl-install-btn" [disabled]="!svc.canInstall()" (click)="svc.install()">
            <os-cicon [icon]="iDownload" [size]="16" /> 설치
          </button>
        </div>
        <p class="vl-nocap" *ngIf="svc.depsResolving()">의존성 확인 중…</p>
        <p class="vl-nocap" *ngIf="!svc.canInstall() && !svc.depsResolving()">필수 의존성이 충족돼야 설치할 수 있습니다 — 위 경보를 먼저 해결하세요.</p>

        <div class="vl-tile vl-tile--wide vl-plan">
          <h3>설치 계획</h3>
          <dl class="os-kv">
            <dt>차트 / Velero</dt><dd>{{ svc.plan().chart }} / {{ svc.plan().app }}</dd>
            <dt>네임스페이스</dt><dd class="os-mono">{{ svc.plan().namespace }}</dd>
            <dt>image</dt><dd class="os-mono">{{ svc.plan().image }} <span class="vl-dim">← {{ svc.plan().imageOrigin }}</span></dd>
            <dt>설치 방식</dt><dd>Crossplane provider-helm · Release CR (선언형)</dd>
          </dl>
          <p class="vl-plan-note">설치 후 이 페이지의 <strong>"백업 대상"</strong> 섹션에서 외부 S3(공용 기본)를 구성한다. 개별 plugin은 필요 시 자기 전용 대상으로 override한다.</p>
        </div>
      </div>
    </section>

    <p class="vl-sync" *ngIf="svc.lastSync()">마지막 확인: {{ svc.lastSync() }}</p>
  `,
})
export class VeleroComponent {
  readonly svc = inject(VeleroService);
  private vr = inject(ViewRouter);
  readonly LOGO = LOGO;
  readonly iBack = ArrowLeft16;
  readonly iMisuse = Misuse20;
  readonly iInfo = Information20;
  readonly iDownload = Download16;

  // 백업 대상 입력 폼(공용 기본). 저장 성공 후에도 유지되나 자격증명은 화면 재표시 안 함.
  bt: BackupTarget = { endpoint: '', bucket: '', region: '', accessKey: '', secretKey: '' };

  ngOnInit(): void { this.svc.start(); }
  // 페이지 이탈 시 15초 폴러 정지(설치 감시 watch 포함) — 재진입하면 start()가 재개.
  ngOnDestroy(): void { this.svc.stop(); }

  back(): void { this.vr.setTab('overview'); }
  onSelect(e: Event): void { this.svc.selectChart((e.target as HTMLSelectElement).value); }

  phasePill(): string {
    if (this.svc.installed()) { return this.svc.ready() ? 'label-success' : 'label-warning'; }
    if (this.svc.phaseLabel() === '확인 중') { return ''; }
    return 'label-warning';
  }
  depIcon(s: State, required: boolean): any {
    if (s === 'ok') { return CheckmarkFilled20; }
    if (s === 'loading') { return Information20; }
    return required ? Misuse20 : WarningAltFilled20;
  }
  depCls(s: State, required: boolean): string {
    if (s === 'ok') { return 'vl-ok'; }
    if (s === 'loading') { return 'vl-load'; }
    return required ? 'vl-bad' : 'vl-warn';
  }
}
