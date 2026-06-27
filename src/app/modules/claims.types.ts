// Phase 3 선언형 프로비저닝 — 모듈 Claims UI 공통 타입.
// facade 그룹/버전은 provisioning.opensphere.io/v1alpha1 고정(read RBAC·ApplicationSet·기존 CRD가 못박음).
export const PROV_GROUP = 'provisioning.opensphere.io';
export const PROV_VER = 'v1alpha1';

export interface ClaimRow {
  name: string;
  namespace: string;
  primary: string;   // PG=database/owner, OS=indexName
  phase: string;     // status.phase 또는 conditions[Ready] 도출
  ready: boolean;
  detail: string;    // host/secretRef 등 보조 표시(비밀값 아님 — 이름만)
  age: string;
}

const READY = (s: any) => (s?.conditions || []).find((c: any) => c.type === 'Ready');

export function phaseFromStatus(st: any): { phase: string; ready: boolean } {
  if (!st) return { phase: 'Pending', ready: false };
  const r = READY(st);
  if (r) return { phase: st.phase || (r.status === 'True' ? 'Ready' : r.reason || 'NotReady'), ready: r.status === 'True' };
  return { phase: st.phase || 'Pending', ready: st.phase === 'Ready' || st.ready === true };
}

export function age(ts?: string): string {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 90) return Math.round(s) + 's';
  if (s < 5400) return Math.round(s / 60) + 'm';
  if (s < 129600) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}
