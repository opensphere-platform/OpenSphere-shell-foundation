import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, signal } from '@angular/core';
import { ClarityModule } from '@clr/angular';
import { HostedPlugin } from '../registry/hosted-plugin';

@Component({
  selector: 'app-plugin-outlet',
  standalone: true,
  imports: [CommonModule, ClarityModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div #mount [hidden]="!ready()"></div>
    <clr-alert *ngIf="!ready()" [clrAlertType]="timedOut() ? 'warning' : 'info'" [clrAlertClosable]="false">
      <clr-alert-item>
        <span class="alert-text" *ngIf="!timedOut()">
          {{ plugin.name }} plugin 로드 대기 중... UIPluginPackage/{{ packageId() }} 서명 검증과 Extension Host 적재를 기다립니다.
        </span>
        <span class="alert-text" *ngIf="timedOut()">
          {{ plugin.name }} plugin이 아직 로드되지 않았습니다. UIPluginPackage/{{ packageId() }} 설치, digest, manifest signature, registration 상태를 확인하세요.
        </span>
      </clr-alert-item>
    </clr-alert>
  `,
})
export class PluginOutletComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) plugin!: HostedPlugin;
  @ViewChild('mount', { static: true }) mount!: ElementRef<HTMLDivElement>;

  readonly ready = signal(false);
  readonly timedOut = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private mounted: HTMLElement | undefined;

  ngOnChanges(): void { this.render(); }
  ngOnDestroy(): void {
    if (this.timer) { clearTimeout(this.timer); }
    this.mounted?.remove();
  }

  packageId(): string { return this.plugin?.activation?.packageId || this.plugin?.id || 'unknown'; }

  private render(): void {
    const tag = this.plugin?.activation?.element;
    this.ready.set(false);
    this.timedOut.set(false);
    if (this.timer) { clearTimeout(this.timer); }
    this.mounted?.remove();
    this.mounted = undefined;
    if (!tag) {
      this.timedOut.set(true);
      return;
    }
    const mount = () => {
      this.mounted?.remove();
      this.mounted = document.createElement(tag);
      // External custom elements are inline by default.  Foundation's native
      // plugin pages are block hosts; enforce that same shell contract for every
      // hosted plugin so PostgreSQL and ADDC share the full content width.
      this.mounted.style.display = 'block';
      this.mounted.style.width = '100%';
      this.mounted.style.minWidth = '0';
      this.mount.nativeElement.appendChild(this.mounted);
      this.ready.set(true);
    };
    if (customElements.get(tag)) {
      mount();
      return;
    }
    void customElements.whenDefined(tag).then(mount);
    this.timer = setTimeout(() => {
      if (!this.ready()) { this.timedOut.set(true); }
    }, 8000);
  }
}
