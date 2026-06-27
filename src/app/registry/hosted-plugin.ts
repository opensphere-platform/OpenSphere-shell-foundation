import { Phase, State } from '../modules/postgres/cnpg.types';

// Foundation이 호스팅하는 plugin = '등록된 관리 대상'(메뉴 항목이 아님, §2.7).
// nav·카드·트리는 모두 이 레지스트리의 파생물(§3.3 메뉴=실재의 투영). 역이 아니다.
export interface HostedPlugin {
  id: 'postgres' | 'opensearch' | 'rustfs' | 'keycloak' | 'samba';
  name: string;
  icon: 'db' | 'search' | 'storage' | 'key' | 'users';
  kind: 'plugin';                 // leaf — host(foundation subShell)와 구분
  hostRef: 'foundation';          // §2.7 필수 — 귀속. 트리에 글자로 렌더
  capability: string;             // 'data.sql.postgres' 등 — 제공 역량(머신 식별)
  capabilityLabel: string;        // '관계형 DB' 등 — 칩 표시용
  desc: string;
  consumePoint: string;           // 백킹서비스 소비 엔드포인트(이 plugin이 '제공하는 것')
  healthRef: 'cnpg' | 'os' | 'rustfs' | 'keycloak' | 'samba'; // ⬅ probe() 대체. 어느 서비스가 이 plugin의 health 진실인가
  view: { module: string };       // ViewRouter.setModule 대상(메뉴=등록의 파생)
}

// 두 데이터 서비스(CnpgService/OsService)의 이질적 signal을 통일한 health 투영.
// registry가 계산하지 않는다 — service가 답하고 registry-service가 어댑트한다.
export interface PluginHealth {
  phase: Phase;          // 'ok' | 'warn' | 'bad' | '' (기존 PILL 팔레트)
  pill: string;          // PILL[phase]
  label: string;         // 'Healthy' | 'Degraded' | 'Progressing' | '미발견' | '권한 없음' | '미배포'
  state: State;          // 6-state 원본(noperm/nocrd 보존)
  ready: boolean;
  metrics: { val: string | number; lab: string }[];
}
