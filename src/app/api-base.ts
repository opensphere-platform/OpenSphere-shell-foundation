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

/**
 * 콘솔 셸이 노출하는 사용자 id_token(__OS_AUTH__ 브리지 — 콘솔 auth.service.ts 계약, AI Hub 동일 패턴).
 * 쓰기(POST/PATCH/DELETE)는 server.js가 이 토큰을 Kanidm JWKS로 검증해 사용자/그룹 임퍼소네이션한다.
 * standalone dev(콘솔 밖)에선 빈 문자열 → 쓰기는 401(정상 방어).
 */
export function idToken(): string {
  try {
    const w = window as Window & { __OS_AUTH__?: { token?: string | (() => string) } };
    const t = typeof w.__OS_AUTH__?.token === 'function' ? w.__OS_AUTH__.token() : w.__OS_AUTH__?.token;
    return t || '';
  } catch { return ''; }
}

/** 쓰기 호출 공통 헤더 — content-type + x-os-id-token(있을 때만). */
export function writeHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const t = idToken();
  if (t) h['x-os-id-token'] = t;
  return h;
}

/** 콘솔 세션(15분 id_token, 자동 갱신 수단 없음) 만료 여부. 쓰기 전 선차단·안내에 사용.
 *  디코드 불가면 false(서버 검증에 위임 — 선차단하지 않음). 복구 = 페이지 새로고침(SSO 재발급). */
export function tokenExpired(): boolean {
  const t = idToken();
  if (!t) return true;
  try {
    const p = JSON.parse(atob(t.split('.')[1]));
    return (Number(p.exp) - Math.floor(Date.now() / 1000)) <= 5;
  } catch { return false; }
}

/** 응답이 인증 실패(만료/무토큰)인지 — status 401 또는 본문 신호. */
export function isAuthFail(status: number, body?: string): boolean {
  return status === 401 || /token expired|token missing|unauthorized/i.test(String(body || ''));
}
