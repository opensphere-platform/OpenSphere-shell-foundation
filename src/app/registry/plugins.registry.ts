import { HostedPlugin } from './hosted-plugin';

// 선언형 SoT — hostRef=foundation으로 귀속된 plugin 매니페스트. 하드코딩 MODULES 배열을 대체.
// 형태가 '관리 대상(kind/hostRef/capability/healthRef/lifecycle)'이지 'id+name+icon 메뉴'가 아니다.
// 진화(후속): controller registry(/api/.../registrations?hostRef=foundation)에서 hydrate.
export const FOUNDATION_PLUGINS: HostedPlugin[] = [
  {
    id: 'postgres', name: 'PostgreSQL', icon: 'db', kind: 'plugin', hostRef: 'foundation',
    capability: 'data.sql.postgres', capabilityLabel: '관계형 DB',
    desc: '공용 관계형 데이터베이스 capability · CloudNativePG. PostgresClaim으로 전용 DB 발급.',
    consumePoint: 'opensphere-pg-rw.opensphere-foundation.svc:5432',
    healthRef: 'cnpg', view: { module: 'postgres' },
  },
  {
    id: 'opensearch', name: 'OpenSearch', icon: 'search', kind: 'plugin', hostRef: 'foundation',
    capability: 'data.search.opensearch', capabilityLabel: '검색/인덱스',
    desc: '공용 검색·인덱스 capability · OpenSearch. Help Center 종합검색의 백본.',
    consumePoint: 'opensphere-search.opensphere-foundation.svc:9200',
    healthRef: 'os', view: { module: 'opensearch' },
  },
];
