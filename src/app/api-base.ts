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
