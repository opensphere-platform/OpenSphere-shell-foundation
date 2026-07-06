import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { SambaService } from './identity.services';
import { PILL } from '../postgres/cnpg.types';

// Samba-AD — host(Foundation)의 안층 마운트 셸 (D1 승격, 2026-07-06).
// 화면 본체는 독립 plugin(OpenSphere-plugin-samba-ad, kind=plugin·hostRef=foundation)이 소유한다:
//   · 콘솔 Extension Host가 DUPA 신뢰체인(서명 이중검증)으로 로드·activate → <osp-samba-ad> 커스텀
//     엘리먼트가 정의됨(plugin은 registerPage를 호출하지 않아 mainShell 1단에는 비노출).
//   · host(여기)는 그 태그를 자기 안층 메뉴 자리에 꽂아 렌더만 한다 — 자기 완결성(§2.8)은 plugin이,
//     표시 거버넌스는 host가, 보안 경계는 mainShell이(감사 D1 보수 해석) 각각 소유.
// plugin 미로드(미설치/검증 실패) 시: 정직한 안내 + health 어댑터(SambaService)는 registry 소유라 유지.
@Component({
  selector: 'app-samba',
  standalone: true,
  imports: [CommonModule, ClarityModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ng-container *ngIf="pluginReady(); else waiting">
      <osp-samba-ad></osp-samba-ad>
      <p class="os-sub os-mono">hosted by foundation · plugin: OpenSphere-plugin-samba-ad (콘솔 신뢰체인 적재 · 안층 마운트)</p>
    </ng-container>
    <ng-template #waiting>
      <div class="os-title-row">
        <h2 class="os-h2">Samba-AD <span class="label label-info">plugin</span></h2>
        <span class="label" [ngClass]="pillCls()">{{ svc.phase() }}</span>
      </div>
      <clr-alert [clrAlertType]="timedOut() ? 'warning' : 'info'" [clrAlertClosable]="false">
        <clr-alert-item><span class="alert-text" *ngIf="!timedOut()">
          Samba-AD plugin 로드 대기 중… (콘솔 Extension Host가 서명 검증 후 적재)
        </span><span class="alert-text" *ngIf="timedOut()">
          Samba-AD plugin(samba-ad)이 로드되지 않았습니다 — 콘솔 관리(Installed Plugins)에서 UIPluginPackage/samba-ad의
          설치·검증 상태(Enabled/Failed·reason)를 확인하세요. operand 수명주기는 Plugins 관리(engines.samba) 소관으로 별개입니다.
        </span></clr-alert-item>
      </clr-alert>
    </ng-template>
  `,
})
export class SambaComponent implements OnInit, OnDestroy {
  readonly svc = inject(SambaService); // health 어댑터(plugins-admin·Overview 집계용) — registry 소유 유지
  readonly pluginReady = signal(false);
  readonly timedOut = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    if (customElements.get('osp-samba-ad')) { this.pluginReady.set(true); return; }
    // 콘솔이 아직 로드 중일 수 있음 — whenDefined 대기 + 8s 타임아웃(미설치 안내).
    void customElements.whenDefined('osp-samba-ad').then(() => this.pluginReady.set(true));
    this.timer = setTimeout(() => { if (!this.pluginReady()) { this.timedOut.set(true); } }, 8000);
  }
  ngOnDestroy(): void { if (this.timer) { clearTimeout(this.timer); } }
  pillCls(): string { return PILL[this.svc.phaseCls()]; }
}
