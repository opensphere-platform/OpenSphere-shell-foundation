import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { FOUNDATION_PLUGINS } from './app/registry/plugins.registry';

declare global {
  interface Window {
    __OPENSPHERE_FOUNDATION_CHILD_PROJECTIONS__?: ReadonlyArray<Readonly<{
      id: string;
      route: string;
      element: string;
    }>>;
  }
}

// DUPA: 단일 커스텀 엘리먼트로 패키징. 셸이 <osp-foundation-shell>를 본문에 꽂으면 렌더.
// zoneless + Angular Elements → 셸(Angular)과 같은 페이지에서 zone 충돌 없이 공존.
const TAG = 'osp-foundation-shell';

window.__OPENSPHERE_FOUNDATION_CHILD_PROJECTIONS__ = Object.freeze(FOUNDATION_PLUGINS
  .filter((plugin) => plugin.lifecycle === 'registry-backed' && plugin.activation)
  .map((plugin) => Object.freeze({
    id: plugin.activation!.packageId,
    route: `/pfss/${plugin.view.module}`,
    element: plugin.activation!.element,
  })));

(async () => {
  const app = await createApplication(appConfig);
  const el = createCustomElement(AppComponent, { injector: app.injector });
  if (!customElements.get(TAG)) {
    customElements.define(TAG, el);
  }
})();
