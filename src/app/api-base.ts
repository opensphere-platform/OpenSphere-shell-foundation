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
