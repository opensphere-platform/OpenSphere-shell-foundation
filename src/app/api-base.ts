// 셸 임베드 시 자신의 style 링크(data-osp-plugin="foundation")에서 proxy base 도출.
// window 전역은 멀티 subShell 충돌 → 링크 기반(로드순서 무관).
export function apiBase(): string {
  try {
    const l = document.querySelector('link[data-osp-plugin="foundation"]') as HTMLLinkElement | null;
    if (l) {
      const m = new URL(l.href).pathname.match(/^(.*)\/app\/styles\.css$/);
      if (m) return m[1];
    }
  } catch {
    /* noop */
  }
  return '';
}

/** opensphere-foundation 네임스페이스(백킹서비스가 사는 곳). */
export const FND_NS = 'opensphere-foundation';

type HostFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function hostApiFetch(): HostFetch | undefined {
  const w = window as Window & { __OPENSPHERE_HOST_CONTEXTS__?: Record<string, { api?: { fetch?: HostFetch } }> };
  return w.__OPENSPHERE_HOST_CONTEXTS__?.['foundation']?.api?.fetch;
}

/** Main Shell capability를 사용한다. standalone 개발에서는 인증 없는 same-origin fetch로 폴백한다. */
export function hostFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const mediated = hostApiFetch();
  return mediated ? mediated(input, init) : fetch(input, init);
}

/** 쓰기 호출 공통 헤더. 인증은 raw token 대신 Main Shell hostFetch가 주입한다. */
export function writeHeaders(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

/** 응답이 인증 실패(만료/무토큰)인지 — status 401 또는 본문 신호. */
export function isAuthFail(status: number, body?: string): boolean {
  return status === 401 || /token expired|token missing|unauthorized/i.test(String(body || ''));
}
