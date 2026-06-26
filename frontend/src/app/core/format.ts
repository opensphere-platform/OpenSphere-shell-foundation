// format.ts — 공용 표현 헬퍼 + resolveCell(값 출처 단일 관문 — 위조 구조적 차단).
import { OperandField } from './operands';

export function logoUrl(slug: string) { return `https://cdn.simpleicons.org/${slug}`; }
export function monoText(name: string) { const w = (name.match(/[A-Za-z0-9가-힣]+/g) || ['·']); return (w[w.length - 1] || w[0]).slice(0, 2).toUpperCase(); }
export function monoStyle(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 42% 45%)`; }

export function metricClass(o: any): Record<string, boolean> {
  if (!o) return {};
  const unknown = o.value === 'n/a' || (o.note && /baseline|unreachable|not ready|트래픽 없음/.test(o.note));
  return { 'label-success': o.healthy === true, 'label-warning': unknown, 'label-danger': o.healthy === false && !unknown };
}
export function valUnit(o: any, m: any) { return (o && m?.unit && o.value !== 'n/a' && o.value != null && m.unit !== 'bool') ? ' ' + m.unit : ''; }

export interface ResolvedCell { state: 'live' | 'scrape-pending' | 'planned' | 'n-a' | 'label'; value?: string; unit?: string; slo?: string; note?: string; sourceLabel?: string; slice?: string; }

/** resolveCell — 필드의 출처(field.source)에 따라 값을 실제 소스에서만 읽는다. planned는 절대 숫자를 만들지 않는다.
 *  - real-live: fm.status[statusPath] 또는 fm.status.observed[observedId]. live 아니면 planned로 강등.
 *  - realm-export: REALM_FACTS[realmKey] — 항상 live(배포 구성 기준, 파드 무관).
 *  - scrape: fm.status.scrape[scrapeKey] — live면서 키 있으면 live, live인데 없으면 scrape-pending, 아니면 planned.
 *  - {planned:D-x}: 항상 planned — SLO를 목표로만 표시, 숫자 없음. */
export function resolveCell(field: OperandField, fm: any, live: boolean, facts: Record<string, any>): ResolvedCell {
  if (field.text != null) return { state: 'label', value: field.text, slo: field.slo, sourceLabel: '카탈로그' };
  const src = field.source;
  if (typeof src === 'object' && 'planned' in src) {
    return { state: 'planned', slo: field.slo, slice: src.planned, sourceLabel: '계획 ' + src.planned, unit: field.unit };
  }
  if (src === 'realm-export') {
    const v = facts?.[field.realmKey || ''];
    return { state: 'live', value: v != null ? String(v) : '—', unit: field.unit, slo: field.slo, sourceLabel: '배포 구성 기준' };
  }
  if (src === 'real-live') {
    let v: any;
    if (field.statusPath) v = fm?.status?.[field.statusPath];
    else if (field.observedId) v = (fm?.status?.observed || []).find((x: any) => x.id === field.observedId)?.value;
    if (!live) return { state: 'planned', slo: field.slo, slice: field.contract ? undefined : 'D-?', sourceLabel: '미배포', unit: field.unit };
    if (v === 'n/a') return { state: 'n-a', note: 'n/a', slo: field.slo, sourceLabel: 'live' };
    if (v == null || v === '') return { state: 'scrape-pending', note: '측정 대기', slo: field.slo, sourceLabel: 'live' };
    return { state: 'live', value: String(v), unit: field.unit, slo: field.slo, sourceLabel: 'live' };
  }
  if (src === 'scrape') {
    const v = fm?.status?.scrape?.[field.scrapeKey || ''];
    if (!live) return { state: 'planned', slo: field.slo, sourceLabel: '미배포', unit: field.unit };
    if (v == null || v === '') return { state: 'scrape-pending', note: '측정 대기(scrape)', slo: field.slo, sourceLabel: 'scrape' };
    return { state: 'live', value: String(v), unit: field.unit, slo: field.slo, sourceLabel: 'scrape' };
  }
  return { state: 'planned', slo: field.slo, unit: field.unit };
}
