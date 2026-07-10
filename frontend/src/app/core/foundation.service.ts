import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Foundation 계약 객체 클라이언트. 백엔드 /api/k8s/<경로> 제네릭 프록시(k8s-console-ng 동형) 사용.
 *  읽기: SA(+토큰 있으면 임퍼소네이션). 쓰기(토글·Claim 요청/해제): 셸 토큰(X-OS-Id-Token) → 백엔드 JWKS 검증 → 임퍼소네이션(사용자 본인 RBAC). */
const G = '/apis/foundation.opensphere.io/v1alpha1';

@Injectable({ providedIn: 'root' })
export class FoundationService {
  private http = inject(HttpClient);
  // 셸 전역 __OSP_NG_API_BASE__는 같은 window의 다른 플러그인(k8s-console-ng 등)이 덮어쓸 수 있어 신뢰 불가
  // (단일 전역 충돌). 이 플러그인 백엔드는 항상 /api/plugins/foundation-shell 로 프록시되므로,
  // 전역이 '우리 것'일 때만 사용하고 아니면 고정 base를 쓴다 → 자기 server.js(RBAC/임퍼소네이션)로 정확히 라우팅.
  private base() {
    const g = (window as any).__OSP_NG_API_BASE__;
    if (typeof g === 'string' && /\/foundation-shell\/?$/.test(g)) return g.replace(/\/$/, '');
    return '/api/plugins/foundation-shell';
  }
  private hdr(extra?: Record<string, string>) {
    return { headers: { ...(extra || {}) } };
  }
  private url(p: string) { return `${this.base()}/api/k8s${p}`; }

  /** data 설치옵션 '버전' 목록 — 셸 백엔드가 ghcr(CloudNativePG 이미지) 실시간 조회(하드코딩 아님). */
  pgImageTags(): Observable<any> { return this.http.get(`${this.base()}/pg-image-tags`, this.hdr()); }
  /** data 설치옵션 '확장' 목록 — 셸 백엔드가 실행 중 PG의 pg_available_extensions 조회(이미지가 실제 제공하는 확장). */
  pgExtensions(): Observable<any> { return this.http.get(`${this.base()}/pg-extensions`, this.hdr()); }
  /** Bootstrap preflight — 실 클러스터 전제 점검(읽기 SA). */
  storageClasses(): Observable<any> { return this.http.get(this.url('/apis/storage.k8s.io/v1/storageclasses'), this.hdr()); }
  namespaces(): Observable<any> { return this.http.get(this.url('/api/v1/namespaces'), this.hdr()); }
  deployment(ns: string, name: string): Observable<any> { return this.http.get(this.url(`/apis/apps/v1/namespaces/${ns}/deployments/${name}`), this.hdr()); }

  /** 6 모델 카탈로그(고정) */
  descriptors(): Observable<any> { return this.http.get(this.url(`${G}/foundationmoduledescriptors`), this.hdr()); }
  /** 설치 상태(FoundationModel) */
  models(): Observable<any> { return this.http.get(this.url(`${G}/foundationmodels`), this.hdr()); }
  /** P6: 요청(Claim) 전체(클러스터 컬렉션 — 클라이언트에서 model로 필터) */
  claims(): Observable<any> { return this.http.get(this.url(`${G}/foundationclaims`), this.hdr()); }
  /** P6: 발급된 Binding 전체(control plane 소유) */
  bindings(): Observable<any> { return this.http.get(this.url(`${G}/foundationbindings`), this.hdr()); }

  /** desiredState 토글 — server-side apply(선언형 의도 기록). control plane(D-1)이 reconcile.
   *  parameters: 설치 레벨 옵션(토폴로지/스토리지/버전/extension) — operand별 매핑(B). */
  setDesired(model: string, desiredState: 'Installed' | 'Disabled', parameters?: Record<string, unknown>): Observable<any> {
    const spec: any = { model, desiredState, descriptorRef: { name: `foundation-${model}` } };
    if (parameters && Object.keys(parameters).length) spec.parameters = parameters;
    const body = {
      apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'FoundationModel',
      metadata: { name: model }, spec,
    };
    return this.http.patch(
      this.url(`${G}/foundationmodels/${model}?fieldManager=foundation-shell&force=true`),
      body, this.hdr({ 'content-type': 'application/apply-patch+yaml' }));
  }

  /** P6 요청 — FoundationClaim 생성(임퍼소네이션 apply-patch). 브라우저는 의도(Claim)만 쓴다 — Binding은 control plane 전유. */
  createClaim(model: string, ns: string, capability: string, parameters?: Record<string, unknown>): Observable<any> {
    const sfx = Date.now().toString(36).slice(-4);
    const name = `${model}-${capability}-${sfx}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const body: any = {
      apiVersion: 'foundation.opensphere.io/v1alpha1', kind: 'FoundationClaim',
      metadata: { name, namespace: ns, labels: { 'foundation.opensphere.io/model': model } },
      spec: { model, capability, parameters: parameters || {} },
    };
    return this.http.patch(
      this.url(`${G}/namespaces/${ns}/foundationclaims/${name}?fieldManager=foundation-shell&force=true`),
      body, this.hdr({ 'content-type': 'application/apply-patch+yaml' }));
  }

  /** P6 해제 — Claim 삭제(연결담보 finalizer로 release 완료까지 Terminating). */
  deleteClaim(ns: string, name: string): Observable<any> {
    return this.http.delete(this.url(`${G}/namespaces/${ns}/foundationclaims/${name}`), this.hdr());
  }
}
