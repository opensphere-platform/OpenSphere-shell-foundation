import { Injectable, computed, signal } from '@angular/core';
import { apiBase, isAuthFail, writeHeaders } from '../api-base';

export type CpState = 'pass' | 'warn' | 'fail' | 'loading';

export interface CpItem {
  id: string;
  name: string;
  kind: string;
  scope: string;
  state: CpState;
  message: string;
  required: boolean;
  group?: string;
  created?: string;
}

export interface CpWorkload {
  id: string;
  name: string;
  namespace: string;
  role: string;
  state: CpState;
  ready: string;
  image: string;
  message: string;
}

export interface CpWritePath {
  id: string;
  name: string;
  state: CpState;
  message: string;
}

const CONTRACTS = [
  {
    id: 'foundation-claim',
    name: 'FoundationClaim',
    crd: 'foundationclaims.foundation.opensphere.io',
    scope: 'generic',
    required: true,
    message: 'Foundation 공통 요청 계약',
  },
  {
    id: 'foundation-binding',
    name: 'FoundationBinding',
    crd: 'foundationbindings.foundation.opensphere.io',
    scope: 'generic',
    required: true,
    message: 'Foundation 공통 바인딩 계약',
  },
  {
    id: 'identity-directory-claim',
    name: 'IdentityDirectoryClaim',
    crd: 'identitydirectoryclaims.foundation.opensphere.io',
    scope: 'typed identity',
    required: true,
    message: 'Samba-AD 같은 directory provider에 대한 typed 사용권 요청 계약',
  },
  {
    id: 'identity-directory-binding',
    name: 'IdentityDirectoryBinding',
    crd: 'identitydirectorybindings.foundation.opensphere.io',
    scope: 'typed identity',
    required: true,
    message: 'LDAP endpointRef, secretRef, policyRef를 발급하는 typed 연결 계약',
  },
  {
    id: 'postgres-claim',
    name: 'PostgresClaim',
    crd: 'postgresclaims.provisioning.opensphere.io',
    scope: 'typed data',
    required: false,
    message: 'PostgreSQL 소비자 요청 계약',
  },
  {
    id: 'opensearch-index-claim',
    name: 'OpenSearchIndexClaim',
    crd: 'opensearchindexclaims.provisioning.opensphere.io',
    scope: 'typed data',
    required: false,
    message: 'OpenSearch 인덱스 소비자 요청 계약',
  },
  {
    id: 'vector-retrieval-claim',
    name: 'VectorRetrievalClaim',
    crd: 'vectorretrievalclaims.ai.foundation.opensphere.io',
    scope: 'typed ai',
    required: false,
    message: 'AI/RAG retrieval 소비자 요청 계약',
  },
];

const WORKLOADS = [
  {
    id: 'foundation-control-plane',
    namespace: 'opensphere-system',
    name: 'foundation-control-plane',
    role: 'FoundationModel, operand, Claim/Binding reconcile 권위',
  },
  {
    id: 'foundation-shell',
    namespace: 'opensphere-system',
    name: 'foundation',
    role: 'Foundation subShell backend/API',
  },
  {
    id: 'crossplane',
    namespace: 'crossplane-system',
    name: 'crossplane',
    role: '선언형 write-path 실행 엔진',
  },
  {
    id: 'crossplane-rbac-manager',
    namespace: 'crossplane-system',
    name: 'crossplane-rbac-manager',
    role: 'Crossplane RBAC manager',
  },
];

const IDENTITY_DIRECTORY_CRDS: Record<string, unknown>[] = [
  {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: {
      name: 'identitydirectoryclaims.foundation.opensphere.io',
      labels: {
        'app.kubernetes.io/part-of': 'foundation-control-plane',
        'foundation.opensphere.io/contract-pack': 'identity-directory',
      },
    },
    spec: {
      group: 'foundation.opensphere.io',
      names: {
        kind: 'IdentityDirectoryClaim',
        listKind: 'IdentityDirectoryClaimList',
        plural: 'identitydirectoryclaims',
        singular: 'identitydirectoryclaim',
        shortNames: ['idclaim'],
      },
      scope: 'Namespaced',
      versions: [{
        name: 'v1alpha1',
        served: true,
        storage: true,
        subresources: { status: {} },
        additionalPrinterColumns: [
          { name: 'Provider', type: 'string', jsonPath: '.spec.provider' },
          { name: 'Realm', type: 'string', jsonPath: '.spec.realm' },
          { name: 'Phase', type: 'string', jsonPath: '.status.phase' },
        ],
        schema: {
          openAPIV3Schema: {
            type: 'object',
            required: ['spec'],
            properties: {
              spec: {
                type: 'object',
                properties: {
                  provider: { type: 'string', enum: ['samba-ad'], default: 'samba-ad' },
                  realm: { type: 'string' },
                  consumerRef: {
                    type: 'object',
                    properties: {
                      apiVersion: { type: 'string' },
                      kind: { type: 'string' },
                      name: { type: 'string' },
                      namespace: { type: 'string' },
                    },
                  },
                  parameters: { type: 'object', 'x-kubernetes-preserve-unknown-fields': true },
                },
              },
              status: {
                type: 'object',
                properties: {
                  phase: { type: 'string', enum: ['Pending', 'Bound', 'Failed'] },
                  reason: { type: 'string' },
                  bindingRef: {
                    type: 'object',
                    properties: { name: { type: 'string' }, namespace: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      }],
    },
  },
  {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: {
      name: 'identitydirectorybindings.foundation.opensphere.io',
      labels: {
        'app.kubernetes.io/part-of': 'foundation-control-plane',
        'foundation.opensphere.io/contract-pack': 'identity-directory',
      },
    },
    spec: {
      group: 'foundation.opensphere.io',
      names: {
        kind: 'IdentityDirectoryBinding',
        listKind: 'IdentityDirectoryBindingList',
        plural: 'identitydirectorybindings',
        singular: 'identitydirectorybinding',
        shortNames: ['idbind'],
      },
      scope: 'Namespaced',
      versions: [{
        name: 'v1alpha1',
        served: true,
        storage: true,
        subresources: { status: {} },
        additionalPrinterColumns: [
          { name: 'Claim', type: 'string', jsonPath: '.spec.claimRef.name' },
          { name: 'Endpoint', type: 'string', jsonPath: '.spec.endpointRef.url' },
          { name: 'Phase', type: 'string', jsonPath: '.status.phase' },
        ],
        schema: {
          openAPIV3Schema: {
            type: 'object',
            required: ['spec'],
            properties: {
              spec: {
                type: 'object',
                required: ['claimRef'],
                properties: {
                  claimRef: {
                    type: 'object',
                    required: ['name', 'namespace'],
                    properties: { name: { type: 'string' }, namespace: { type: 'string' } },
                  },
                  endpointRef: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      namespace: { type: 'string' },
                      service: { type: 'string' },
                      port: { type: 'integer' },
                      protocol: { type: 'string' },
                      url: { type: 'string' },
                    },
                  },
                  secretRef: {
                    type: 'object',
                    properties: { name: { type: 'string' }, namespace: { type: 'string' } },
                  },
                  policyRef: {
                    type: 'object',
                    properties: { name: { type: 'string' }, namespace: { type: 'string' } },
                  },
                },
              },
              status: {
                type: 'object',
                properties: {
                  phase: { type: 'string', enum: ['Pending', 'Connected', 'Degraded', 'Released'] },
                  connection: {
                    type: 'object',
                    properties: { lastCheck: { type: 'string' }, rttMs: { type: 'integer' } },
                  },
                },
              },
            },
          },
        },
      }],
    },
  },
];

@Injectable({ providedIn: 'root' })
export class ControlPlaneService {
  readonly contracts = signal<CpItem[]>([]);
  readonly workloads = signal<CpWorkload[]>([]);
  readonly writePaths = signal<CpWritePath[]>([]);
  readonly busy = signal(false);
  readonly repairBusy = signal(false);
  readonly repairMessage = signal('');
  readonly lastSync = signal('');
  readonly error = signal('');
  private started = false;

  readonly blockers = computed(() => [
    ...this.contracts().filter((x) => x.required && x.state === 'fail'),
    ...this.workloads().filter((x) => x.state === 'fail'),
    ...this.writePaths().filter((x) => x.state === 'fail'),
  ]);

  readonly summary = computed(() => {
    const all = [...this.contracts(), ...this.workloads(), ...this.writePaths()];
    return {
      pass: all.filter((x) => x.state === 'pass').length,
      warn: all.filter((x) => x.state === 'warn').length,
      fail: all.filter((x) => x.state === 'fail').length,
      total: all.length,
    };
  });

  start(): void {
    if (this.started) { return; }
    this.started = true;
    void this.refresh();
  }

  private k(path: string): string { return `${apiBase()}/api/k8s/${path}`; }

  async refresh(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const [contracts, workloads, writePaths] = await Promise.all([
        this.loadContracts(),
        this.loadWorkloads(),
        this.loadWritePaths(),
      ]);
      this.contracts.set(contracts);
      this.workloads.set(workloads);
      this.writePaths.set(writePaths);
      this.lastSync.set(new Date().toLocaleTimeString());
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }

  private async get(path: string): Promise<{ ok: boolean; status: number; body: any | null }> {
    try {
      const r = await fetch(this.k(path));
      const text = await r.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      return { ok: r.ok, status: r.status, body };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  }

  async repairIdentityDirectoryContracts(): Promise<void> {
    this.repairBusy.set(true);
    this.repairMessage.set('');
    this.error.set('');
    try {
      for (const crd of IDENTITY_DIRECTORY_CRDS) {
        await this.applyCrd(crd);
      }
      this.repairMessage.set('Identity Directory Contract Pack 적용 요청이 완료되었습니다. 상태를 다시 확인합니다.');
      await this.refresh();
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.repairBusy.set(false);
    }
  }

  private async applyCrd(obj: Record<string, unknown>): Promise<void> {
    const name = String((obj['metadata'] as any)?.name ?? '');
    const create = await fetch(this.k('apis/apiextensions.k8s.io/v1/customresourcedefinitions'), {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify(obj),
    });
    if (create.ok) { return; }
    const createBody = await create.text();
    if (create.status === 409) {
      const patch = await fetch(this.k(`apis/apiextensions.k8s.io/v1/customresourcedefinitions/${name}`), {
        method: 'PATCH',
        headers: { ...writeHeaders(), 'content-type': 'application/merge-patch+json' },
        body: JSON.stringify({ metadata: obj['metadata'], spec: obj['spec'] }),
      });
      if (patch.ok) { return; }
      const patchBody = await patch.text();
      throw new Error(`Contract Pack 업데이트 실패: ${name} HTTP ${patch.status} ${patchBody}`);
    }
    if (isAuthFail(create.status, createBody)) {
      throw new Error('세션이 만료되었습니다. 콘솔을 새로고침한 뒤 다시 실행하세요.');
    }
    if (create.status === 403) {
      throw new Error(`OpenSphere admin 승인 경로가 아직 CRD 적용 권한을 받지 못했습니다. 플랫폼 릴리스 권한/RBAC 보강이 필요합니다. (${name})`);
    }
    throw new Error(`Contract Pack 적용 실패: ${name} HTTP ${create.status} ${createBody}`);
  }

  private async loadContracts(): Promise<CpItem[]> {
    const out: CpItem[] = [];
    for (const c of CONTRACTS) {
      const r = await this.get(`apis/apiextensions.k8s.io/v1/customresourcedefinitions/${c.crd}`);
      const spec = r.body?.spec || {};
      out.push({
        id: c.id,
        name: c.name,
        kind: c.crd,
        scope: c.scope,
        required: c.required,
        state: r.ok ? 'pass' : (c.required ? 'fail' : 'warn'),
        group: spec.group || '',
        created: r.body?.metadata?.creationTimestamp || '',
        message: r.ok
          ? `${c.message}. group=${spec.group || '-'}`
          : `${c.message}. CRD ${r.status === 404 ? '미설치' : `조회 실패 HTTP ${r.status}`}`,
      });
    }
    return out;
  }

  private async loadWorkloads(): Promise<CpWorkload[]> {
    const rows: CpWorkload[] = [];
    for (const w of WORKLOADS) {
      const r = await this.get(`apis/apps/v1/namespaces/${w.namespace}/deployments/${w.name}`);
      const specReplicas = Number(r.body?.spec?.replicas ?? 0);
      const ready = Number(r.body?.status?.readyReplicas ?? 0);
      const available = Number(r.body?.status?.availableReplicas ?? 0);
      const container = r.body?.spec?.template?.spec?.containers?.[0] || {};
      const ok = r.ok && ready >= specReplicas && available >= specReplicas && specReplicas > 0;
      rows.push({
        id: w.id,
        name: w.name,
        namespace: w.namespace,
        role: w.role,
        state: ok ? 'pass' : (r.ok ? 'warn' : 'fail'),
        ready: r.ok ? `${ready}/${specReplicas}` : '-',
        image: container.image || '',
        message: r.ok ? `Deployment ready ${ready}/${specReplicas}` : `Deployment 조회 실패 HTTP ${r.status}`,
      });
    }
    return rows;
  }

  private async loadWritePaths(): Promise<CpWritePath[]> {
    const crossplane = await this.get('apis/apps/v1/namespaces/crossplane-system/deployments/crossplane');
    const provider = await this.get('apis/pkg.crossplane.io/v1/providers/provider-helm');
    const argocd = await this.get('apis/apps/v1/namespaces/argocd/deployments/argocd-server');
    const providers = await this.get('apis/pkg.crossplane.io/v1/providers');
    const providerItems = providers.body?.items || [];
    const helmProvider = provider.body || providerItems.find((x: any) => x?.metadata?.name === 'provider-helm');
    const providerHealthy = this.condition(helmProvider, 'Healthy') === 'True';
    const providerInstalled = this.condition(helmProvider, 'Installed') === 'True';
    const desired = Number(crossplane.body?.spec?.replicas ?? 0);
    const ready = Number(crossplane.body?.status?.readyReplicas ?? 0);
    return [
      {
        id: 'crossplane-core',
        name: 'Crossplane core',
        state: crossplane.ok && desired > 0 && ready >= desired ? 'pass' : (crossplane.ok ? 'warn' : 'fail'),
        message: crossplane.ok ? `crossplane deployment ready ${ready}/${desired}` : `crossplane deployment 조회 실패 HTTP ${crossplane.status}`,
      },
      {
        id: 'crossplane-provider-helm',
        name: 'Crossplane provider-helm',
        state: provider.ok && providerHealthy && providerInstalled ? 'pass' : (provider.ok ? 'warn' : 'fail'),
        message: provider.ok
          ? `Installed=${providerInstalled ? 'True' : 'False'}, Healthy=${providerHealthy ? 'True' : 'False'}`
          : `provider-helm 조회 실패 HTTP ${provider.status}`,
      },
      {
        id: 'argocd',
        name: 'Argo CD / GitOps',
        state: argocd.ok ? 'pass' : 'warn',
        message: argocd.ok ? 'argocd-server deployment 확인' : '현재 클러스터에서 argocd-server deployment를 확인하지 못함',
      },
    ];
  }

  private condition(obj: any, type: string): string {
    const conditions = obj?.status?.conditions || [];
    return conditions.find((c: any) => c.type === type)?.status || '';
  }
}
