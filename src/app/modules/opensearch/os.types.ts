// OpenSearch 콘솔 타입 — PG 콘솔의 generic kit(Phase/State/PILL/phaseClass/age/TlItem) 재사용 + OS 전용 유틸.
import { Phase } from '../postgres/cnpg.types';
export { PILL, phaseClass, age } from '../postgres/cnpg.types';
export type { Phase, State, TlItem } from '../postgres/cnpg.types';

// 바이트 → 사람 읽는 단위.
export function fmtBytes(n: number | string | undefined): string {
  let b = typeof n === 'string' ? parseInt(n, 10) : (n || 0);
  if (!b || isNaN(b)) { return '0'; }
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(b < 10 && i > 0 ? 1 : 0) + u[i];
}

// OpenSearch health 색상 → kit Phase. green/yellow/red 직매핑.
export function osHealthPhase(status: string): Phase {
  return status === 'green' ? 'ok' : status === 'yellow' ? 'warn' : status === 'red' ? 'bad' : '';
}
