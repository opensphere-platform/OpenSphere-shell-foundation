import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// DUPA 단일 커스텀 엘리먼트. 셸이 <osp-foundation-shell>을 본문에 꽂으면 렌더.
const TAG = 'osp-foundation-shell';
(async () => {
  const app = await createApplication(appConfig);
  const el = createCustomElement(AppComponent, { injector: app.injector });
  if (!customElements.get(TAG)) customElements.define(TAG, el);
})();
