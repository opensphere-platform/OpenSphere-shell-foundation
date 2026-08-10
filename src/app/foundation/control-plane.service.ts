import { Injectable, computed, signal } from '@angular/core';
import { apiBase, hostFetch } from '../api-base';

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

export interface PfsEstablishmentCondition {
  key: string;
  label: string;
  ready: boolean;
  state: string;
  detail: string;
}

export interface PfsEstablishment {
  schema: 'foundation-establishment.opensphere.io/v1alpha1';
  phase: 'NotEstablished' | 'Establishing' | 'Established' | 'Blocked';
  established: boolean;
  shellReady: boolean;
  conditions: PfsEstablishmentCondition[];
  blockers: Array<{ key: string; state: string; detail: string }>;
  evidence: {
    contractCRDs: Array<{ name: string; ready: boolean }>;
    models: number;
    descriptors: number;
    bindings: number;
    connectedBindings: number;
    protectedConnectedBindings: number;
  };
  extensionPhase?: string;
  extensionDesiredState?: string;
}

export interface FoundationLifecycleView {
  schema: 'foundation-lifecycle-view.opensphere.io/v1alpha1';
  observedAt: string;
  supportProfile: { phase: string; ready: boolean; declared: boolean; name: string };
  extension: { phase: string; desiredState: string };
  pfs: PfsEstablishment;
  prerequisites: Array<{ key: string; label: string; ready: boolean; detail: string; route?: string }>;
  capabilities: Array<{ type: string; status: string; reason: string; message: string }>;
  admission: {
    foundationActivationAllowed: boolean;
    pfsPluginActivationAllowed: boolean;
    reason: string;
  };
}

export interface FoundationBootstrapPlan {
  schema: 'foundation-bootstrap-plan.opensphere.io/v1alpha1';
  checkedAt: string;
  readyToRequest: boolean;
  changeControlUrl: string;
  gate: {
    supportProfileReady: boolean;
    pfsEstablished: boolean;
    reason: '' | 'PFSAlreadyEstablished' | 'PlatformSupportProfileRequired' | 'BootstrapRequestInProgress';
  };
  template: {
    id: string;
    displayName: string;
    target: string;
    reasonPlaceholder: string;
    desiredState: {
      contract?: string;
      catalog?: { version?: string; sha256?: string };
      components?: string[];
      verification?: string[];
      securityBoundaries?: string[];
    };
  };
  request: {
    requestId: string;
    phase: string;
    message: string;
    reason?: string;
    pullRequest?: { number?: number; url?: string };
    reconciler?: string;
    reconcilerStatus?: string;
    approvalCount?: number;
    lastError?: string;
    checkedAt?: string;
  } | null;
  blockers: Array<{ key: string; state?: string; detail: string }>;
}

const CONTRACTS = [
  {
    id: 'foundation-model',
    name: 'FoundationModel',
    crd: 'foundationmodels.foundation.opensphere.io',
    scope: 'domain lifecycle',
    required: true,
    message: 'PFS 도메인 desired/observed state 정본',
  },
  {
    id: 'foundation-module-descriptor',
    name: 'FoundationModuleDescriptor',
    crd: 'foundationmoduledescriptors.foundation.opensphere.io',
    scope: 'module catalog',
    required: true,
    message: '서명된 PFSS 모듈 schema와 dependency DAG 계약',
  },
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
    namespace: 'opensphere-console',
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

@Injectable({ providedIn: 'root' })
export class ControlPlaneService {
  readonly contracts = signal<CpItem[]>([]);
  readonly workloads = signal<CpWorkload[]>([]);
  readonly writePaths = signal<CpWritePath[]>([]);
  readonly establishment = signal<FoundationLifecycleView | null>(null);
  readonly establishmentError = signal('');
  readonly bootstrapPlan = signal<FoundationBootstrapPlan | null>(null);
  readonly bootstrapPlanError = signal('');
  readonly busy = signal(false);
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
      const [contracts, workloads, writePaths, establishment, bootstrapPlan] = await Promise.all([
        this.loadContracts(),
        this.loadWorkloads(),
        this.loadWritePaths(),
        this.loadEstablishment(),
        this.loadBootstrapPlan(),
      ]);
      this.contracts.set(contracts);
      this.workloads.set(workloads);
      this.writePaths.set(writePaths);
      this.establishment.set(establishment.view);
      this.establishmentError.set(establishment.error);
      this.bootstrapPlan.set(bootstrapPlan.plan);
      this.bootstrapPlanError.set(bootstrapPlan.error);
      this.lastSync.set(new Date().toLocaleTimeString());
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }

  private async get(path: string): Promise<{ ok: boolean; status: number; body: any | null }> {
    try {
      const r = await hostFetch(this.k(path));
      const text = await r.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      return { ok: r.ok, status: r.status, body };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  }

  private async loadEstablishment(): Promise<{ view: FoundationLifecycleView | null; error: string }> {
    try {
      const r = await hostFetch(`${apiBase()}/api/foundation/establishment/status`);
      const text = await r.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; }
      catch { return { view: null, error: 'PFS 설립 권위가 JSON이 아닌 응답을 반환했습니다.' }; }
      if (!r.ok) {
        return { view: null, error: body?.error || `PFS 설립 권위 조회 실패 HTTP ${r.status}` };
      }
      const phases = ['NotEstablished', 'Establishing', 'Established', 'Blocked'];
      if (body?.schema !== 'foundation-lifecycle-view.opensphere.io/v1alpha1'
        || body?.pfs?.schema !== 'foundation-establishment.opensphere.io/v1alpha1'
        || !phases.includes(body?.pfs?.phase)) {
        return { view: null, error: 'PFS 설립 권위의 versioned contract가 올바르지 않습니다.' };
      }
      return { view: body as FoundationLifecycleView, error: '' };
    } catch {
      return { view: null, error: 'PFS 설립 권위에 연결할 수 없습니다.' };
    }
  }

  private async loadBootstrapPlan(): Promise<{ plan: FoundationBootstrapPlan | null; error: string }> {
    try {
      const r = await hostFetch(`${apiBase()}/api/foundation/bootstrap/plan`);
      const text = await r.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; }
      catch { return { plan: null, error: 'Foundation bootstrap 계획이 JSON이 아닌 응답을 반환했습니다.' }; }
      if (!r.ok) {
        return { plan: null, error: body?.error || `Foundation bootstrap 계획 조회 실패 HTTP ${r.status}` };
      }
      if (body?.schema !== 'foundation-bootstrap-plan.opensphere.io/v1alpha1'
        || body?.template?.id !== 'foundation-control-plane-bootstrap'
        || typeof body?.changeControlUrl !== 'string') {
        return { plan: null, error: 'Foundation bootstrap 계획의 versioned contract가 올바르지 않습니다.' };
      }
      return { plan: body as FoundationBootstrapPlan, error: '' };
    } catch {
      return { plan: null, error: 'Foundation bootstrap 계획 권위에 연결할 수 없습니다.' };
    }
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
