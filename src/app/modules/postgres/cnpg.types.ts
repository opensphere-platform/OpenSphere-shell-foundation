// CNPG 콘솔 공유 타입 + 자유함수(전 컴포넌트·서비스 공유).
export type Phase = 'ok' | 'warn' | 'bad' | '';
export type State = 'loading' | 'ok' | 'empty' | 'noperm' | 'nocrd' | 'error';

// 배지 색 매핑 — Clarity .label 변형(label-success/-warning/-danger).
export const PILL: Record<Phase, string> = { ok: 'label-success', warn: 'label-warning', bad: 'label-danger', '': '' };

export interface Instance {
  name: string;
  role: string;       // primary | replica
  ready: boolean;
  status: string;
  node: string;
  restarts: number;
  age: string;
  ip?: string;
}

export interface TlItem {
  cls: Phase;
  title: string;
  msg?: string;
  when?: string;
}

// 단일 phase→색 도출(모든 컴포넌트가 여기서만 색을 얻음).
export function phaseClass(phase: string, allReady: boolean): Phase {
  if (/healthy|completed|running and ready/i.test(phase)) return 'ok';
  if (/fail|down|error|not ready|degrad/i.test(phase)) return 'bad';
  if (/scal|creat|setting|switchover|init|running|upgrad|pending/i.test(phase)) return 'warn';
  if (!phase) return '';
  return allReady ? 'ok' : 'warn';
}

export { age } from '../claims.types';
