// operands.ts — 모듈별 구성 제품(operand) 카탈로그 메타 + 정직(live/planned) 판정 엔진.
// 표현·카탈로그 메타(계약 CRD 불변). live-ness는 저장하지 않고 FoundationModel.status에서 파생한다.

export interface OperandMeta {
  name: string;
  slug?: string;          // simpleicons 브랜드 로고 슬러그(없으면 모노그램)
  id: string;             // 라우팅 키(모델 내 유일). 같은 name이 모델 간 재등장 가능(Langfuse, RustFS·MinIO) → {model,id}로 구분
  primary?: boolean;      // 모델이 reconcile-Installed될 때 control plane이 실제 배포하는 operand(모델당 1개). 오늘은 identity→Keycloak, observability→OpenTelemetry만 true(나머지는 deep-link용)
  role?: string;          // 한 줄 역할
  capability?: string[];  // 이 operand가 받치는 capability(디스크립터 operator.capability의 부분집합) — 카탈로그/브랜딩 메타(계약 단정 아님)
  description?: string;
  plannedSlice?: string;  // 'D-2'|'D-4'|'D-5'|'D-6'|'D-7' — 미배포 operand의 전달 슬라이스
  metricIds?: string[];   // 이 operand가 소유하는 디스크립터 metric id(모니터링 탭 필터). 없으면 모델 전체 metric 정의로 폴백
  catalog?: OperandCatalog; // 제품급 정보(패널/관계/액션) — 표현 카탈로그 메타(계약 CRD 불변). 별도 CATALOGS에서 주입
}

// ── 제품급 operand 정보 모델(표현 카탈로그 메타. 값 출처를 명시해 위조 불가) ──
// 출처: real-live(status에 이미 존재) | realm-export(배포 구성 정본) | scrape(control-plane 스크레이프 필요) | {planned} 정의만
export type FieldSource = 'real-live' | 'realm-export' | 'scrape' | { planned: string };
export interface OperandField {
  label: string;
  unit?: string;
  slo?: string;          // 목표/임계 텍스트
  source: FieldSource;
  liveToday?: boolean;   // 실값을 지금 렌더 가능한가(real-live/realm-export/배포된 scrape)
  statusPath?: string;   // real-live: fm.status 의 키(issuerURL/jwksURL)
  observedId?: string;   // real-live: fm.status.observed[].id (keycloak_up/otlp_ingest_rate)
  scrapeKey?: string;    // scrape: fm.status.discovery{}/collector{} 의 키
  realmKey?: string;     // realm-export: REALM_FACTS 의 키
  text?: string;         // 정적 카탈로그 라벨(표 셀의 이름/목적 등) — 출처 무관 표시값
  hint?: string;
  contract?: boolean;    // true=디스크립터 단정 metric, false/undefined=제품 카탈로그 필드
}
export interface OperandPanel {
  title: string;
  kind?: 'fields' | 'kv' | 'list' | 'chips' | 'table';
  fields: OperandField[];        // table: 컬럼 정의
  tableRows?: OperandField[][];  // table: 행(미리 작성된 realm-export 행 등)
  note?: string;
  kpi?: boolean;
}
export interface OperandRelation {
  ref: string;
  display?: string;
  via: string;
  mode: 'live' | 'declared' | 'planned';
  slice?: string;
  external?: boolean;
  contract?: boolean;
}
export interface OperandAction {
  label: string;
  kind: 'link' | 'copy' | 'reveal' | 'external';
  target?: string;
  liveOnly?: boolean;
}
export interface OperandCatalog {
  type: string; // idp|db|cache|objstore|index|docdb|llm-router|tracing|metrics|logs|notify|mail|backup|directory|iga|policy|scim|snapshot
  panels: OperandPanel[];
  consumes: OperandRelation[];
  provides: OperandRelation[];
  actions?: OperandAction[];
  note?: string;  // operand 전체에 적용되는 정직 단서(예: 백엔드 미연결로 현재 미저장)
}

// 배포된 realm-export(control-plane/identity_bundle.yaml)의 정적 사실 — 파드 가동과 무관하게 참(배포 구성 기준).
export const REALM_FACTS: Record<string, any> = {
  realm: 'opensphere-workforce', enabled: 'true',
  registrationAllowed: 'false', registrationEmailAsUsername: 'false', resetPasswordAllowed: 'false',
  rememberMe: 'false', verifyEmail: 'false', loginWithEmailAllowed: 'true', duplicateEmailsAllowed: 'false',
  identityProviders: '0', seededUsers: '0',
  clientId: 'workforce-oidc', clientPublic: 'true', clientStandardFlow: 'on', clientDirectAccess: 'off',
  clientServiceAccounts: 'off', clientPkce: 'S256',
  redirectUris: 'edge.opensphere.local/oidc/* · console.opensphere.local/oidc/*',
  webOrigins: 'edge.opensphere.local · console.opensphere.local',
  datastore: 'H2 (start-dev, /opt/keycloak/data — Pod 임시·비영속)', mode: 'start-dev',
};

export const OPERANDS: Record<string, OperandMeta[]> = {
  identity: [
    { id: 'keycloak', name: 'Keycloak', slug: 'keycloak', primary: true, role: 'OIDC issuer', capability: ['OIDC'], description: 'OIDC/OAuth2 발급자 — 토큰 발급·JWKS·표준 인증 흐름.', metricIds: ['keycloak_up'] },
    { id: 'samba-ad', name: 'Samba AD', role: 'workforce 디렉터리', description: '직원 신원 디렉터리(AD). federation 옵션: Azure AD/Entra.', plannedSlice: 'D-7' },
    { id: 'syncope', name: 'Apache Syncope', role: 'IGA master', description: '신원 거버넌스·프로비저닝 단일권위(JIT 금지, INV-2).', plannedSlice: 'D-7' },
    { id: 'opa', name: 'OPA', role: '정책 게이트', capability: ['OPA'], description: '정책 기반 인가(Rego) 게이트.', plannedSlice: 'D-7' },
    { id: 'scim-gw', name: 'SCIM-GW', role: 'SCIM 2.0 GW', capability: ['SCIM'], description: 'SCIM 2.0 프로비저닝 게이트웨이.', plannedSlice: 'D-7', metricIds: ['scim_sync_lag_s'] },
  ],
  data: [
    { id: 'postgresql', name: 'PostgreSQL', slug: 'postgresql', primary: true, role: '관계형 DB(Pg)', capability: ['Pg'], description: '관계형 데이터베이스 — Pg claim 백엔드.', plannedSlice: 'D-2', metricIds: ['bind_ready_ratio', 'connection_rtt_ms'] },
    { id: 'mongodb', name: 'MongoDB', slug: 'mongodb', role: '문서 DB', description: '문서형 데이터베이스.', plannedSlice: 'D-2' },
    { id: 'redis', name: 'Redis', slug: 'redis', role: '캐시(Cache)', capability: ['Cache'], description: '인메모리 캐시.', plannedSlice: 'D-2' },
    { id: 'rustfs-minio', name: 'RustFS · MinIO', slug: 'minio', role: '오브젝트 스토어(Bucket)', capability: ['Bucket'], description: 'S3 호환 오브젝트 스토리지.', plannedSlice: 'D-2' },
    { id: 'opensearch', name: 'OpenSearch', slug: 'opensearch', role: '인덱스(Index)', capability: ['Index'], description: '검색·벡터 인덱스.', plannedSlice: 'D-2' },
  ],
  ai: [
    { id: 'litellm', name: 'LiteLLM', primary: true, role: 'LLM 라우트', capability: ['LLMRoute'], description: 'LLM 3-tier 라우팅(추론 substrate).', plannedSlice: 'D-4', metricIds: ['llmroute_p95_ms', 'route_error_ratio'] },
    { id: 'langfuse', name: 'Langfuse', role: 'LLM 관측', description: 'LLM 추적·평가(observability 연계).', plannedSlice: 'D-4' },
  ],
  comm: [
    { id: 'novu', name: 'Novu', primary: true, role: '알림 채널', capability: ['Notify'], description: '멀티채널 알림.', plannedSlice: 'D-5', metricIds: ['notify_delivery_ratio'] },
    { id: 'stalwart', name: 'Stalwart', role: '메일(JMAP/SMTP)', capability: ['Mail'], description: 'JMAP/SMTP 메일 백본.', plannedSlice: 'D-5', metricIds: ['mail_queue_depth'] },
  ],
  observability: [
    { id: 'opentelemetry', name: 'OpenTelemetry', slug: 'opentelemetry', primary: true, role: 'OTLP collector', capability: ['OTLP'], description: 'OTLP 수집기 — 추적·메트릭·로그 수신 후 처리.', metricIds: ['otlp_ingest_rate', 'collector_up'] },
    { id: 'prometheus', name: 'Prometheus', slug: 'prometheus', role: '메트릭', capability: ['ServiceMonitor'], description: '메트릭 수집·저장.', plannedSlice: 'D-2' },
    { id: 'grafana-loki', name: 'Grafana · Loki', slug: 'grafana', role: '대시보드·로그', description: '시각화 + 로그 집계.', plannedSlice: 'D-2' },
    { id: 'jaeger-tempo', name: 'Jaeger · Tempo', slug: 'jaeger', role: '트레이싱', capability: ['Trace'], description: '분산 트레이싱 백엔드.', plannedSlice: 'D-2' },
    { id: 'langfuse', name: 'Langfuse', role: 'LLM 관측', description: 'LLM 추적(ADR-084).', plannedSlice: 'D-2' },
  ],
  backup: [
    { id: 'rustfs-minio', name: 'RustFS · MinIO', slug: 'minio', primary: true, role: '백업 스토어(S3)', capability: ['BackupPolicy'], description: '백업 대상 S3 스토리지.', plannedSlice: 'D-6', metricIds: ['backup_success_ratio', 'last_restore_age_h'] },
    { id: 'ptm', name: '.ptm 스냅샷', role: '스냅샷 포맷', description: '동일시점 멀티-Foundation 스냅샷 포맷.', plannedSlice: 'D-6' },
  ],
};

export function operandsOf(model: string): OperandMeta[] { return OPERANDS[model] || []; }
export function primaryOf(model: string): OperandMeta | undefined { return operandsOf(model).find(o => o.primary); }
export function hasDeferralTag(title?: string): boolean { return /\(D-\d+\)/.test(title || ''); }

/** isLive — 단일 정직 판정. primary이고 모델이 실제 reconcile-Installed(desiredState+phase)이며 텔레메트리가 흐를 때만 true.
 *  fm = 해당 모델의 FoundationModel 객체(없으면 false). 오늘 결과: Keycloak·OpenTelemetry 2종만 live(하드코딩 아님, 자동 보정). */
export function isLive(operand: OperandMeta, fm: any): boolean {
  if (!operand?.primary || !fm) return false;
  if (fm.spec?.desiredState !== 'Installed') return false;
  if (fm.status?.phase !== 'Installed') return false;
  const obs: any[] = fm.status?.observed || [];
  if (operand.metricIds && operand.metricIds.length) {
    return operand.metricIds.some(id => obs.some(o => o.id === id));
  }
  // metricIds 없는 primary도 텔레메트리가 흐를 때만 live(구조적 게이트 — 토글만으로 '배포됨' 오표기 방지).
  return obs.length > 0;
}

export function operandChip(operand: OperandMeta, fm: any): { label: string; cls: string } {
  return isLive(operand, fm)
    ? { label: '배포됨', cls: 'label-success' }
    : { label: '미배포 · ' + (operand.plannedSlice || 'D-?'), cls: 'label-info' };
}
