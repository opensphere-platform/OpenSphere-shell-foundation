import { Injectable, computed, signal } from '@angular/core';
import { apiBase, FND_NS, hostFetch, writeHeaders } from '../../../api-base';

export interface PgAdminDatabase {
  name: string; owner: string; encoding: string; collation: string; connection_limit: number; size_bytes: string;
}
export interface PgAdminObject {
  schema: string; name: string; kind: string; owner: string; estimated_rows: string; size_bytes: string;
  comment?: string; persistence?: string; tablespace?: string; definition?: string;
}
export interface PgAdminCatalog {
  schema: string; actor: string; cluster: string; selectedDatabase: string; rowLimit: number; refreshedAt: string;
  databases: PgAdminDatabase[]; schemas: Array<{ name: string; owner: string }>; objects: PgAdminObject[];
  columns: any[]; indexes: any[]; constraints: any[]; functions: any[]; extensions: any[]; roles: any[]; activity: any[];
  dependencies: any[]; settings: Record<string, unknown>;
}
export interface PgQueryResult {
  command: string; rowCount: number; truncated: boolean; durationMs: number;
  fields: Array<{ name: string; dataTypeID: number }>; rows: Array<Record<string, unknown>>;
}
export interface PgTypedAction {
  action: 'create-schema' | 'drop-schema' | 'create-table' | 'drop-table' | 'create-index' | 'drop-index'
    | 'drop-view' | 'drop-materialized-view' | 'drop-sequence' | 'drop-foreign-table';
  database: string; schema: string; name?: string; table?: string; reason: string; unique?: boolean;
  columns?: Array<{ name: string; type: string; nullable: boolean; default: string }>; indexColumns?: string[];
}

@Injectable({ providedIn: 'root' })
export class PgAdminService {
  readonly selectedCluster = signal(`stackgres:${FND_NS}:pgc-foundation-data-pg`);
  readonly catalog = signal<PgAdminCatalog | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ok' | 'error'>('idle');
  readonly error = signal('');
  readonly selectedDatabase = signal('');
  readonly selectedSchema = signal('public');
  readonly selectedObject = signal<PgAdminObject | null>(null);
  readonly queryState = signal<'idle' | 'running' | 'done' | 'error'>('idle');
  readonly queryResult = signal<PgQueryResult | null>(null);
  readonly queryError = signal('');
  readonly dataState = signal<'idle' | 'loading' | 'done' | 'error'>('idle');
  readonly dataResult = signal<PgQueryResult | null>(null);
  readonly dataError = signal('');
  readonly dataObject = signal('');
  readonly actionState = signal<'idle' | 'running' | 'done' | 'error'>('idle');
  readonly actionResult = signal('');

  readonly visibleObjects = computed(() => {
    const schema = this.selectedSchema();
    return (this.catalog()?.objects ?? []).filter((item) => item.schema === schema);
  });
  readonly selectedColumns = computed(() => this.related('columns'));
  readonly selectedIndexes = computed(() => this.related('indexes'));
  readonly selectedConstraints = computed(() => this.related('constraints'));
  readonly selectedDependencies = computed(() => {
    const object = this.selectedObject();
    if (!object) return [];
    return (this.catalog()?.dependencies ?? []).filter((row: any) => row.schema === object.schema && row.object === object.name);
  });
  readonly selectedDependents = computed(() => {
    const object = this.selectedObject();
    if (!object) return [];
    return (this.catalog()?.dependencies ?? []).filter((row: any) => row.referenced_schema === object.schema && row.referenced_object === object.name);
  });

  private endpoint(path: string): string { return `${apiBase()}/api/foundation/postgres/admin/${path}`; }
  private related(key: 'columns' | 'indexes' | 'constraints'): any[] {
    const object = this.selectedObject();
    if (!object) return [];
    return (this.catalog()?.[key] ?? []).filter((row: any) => row.schema === object.schema && row.table === object.name);
  }
  async refresh(database = this.selectedDatabase()): Promise<void> {
    this.state.set('loading'); this.error.set('');
    try {
      const query = new URLSearchParams({ cluster: this.selectedCluster() });
      if (database) query.set('database', database);
      const suffix = `?${query.toString()}`;
      const response = await hostFetch(`${this.endpoint('catalog')}${suffix}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `PostgreSQL catalog HTTP ${response.status}`);
      this.catalog.set(body as PgAdminCatalog);
      this.selectedDatabase.set(body.selectedDatabase);
      if (!(body.schemas ?? []).some((item: any) => item.name === this.selectedSchema())) {
        this.selectedSchema.set(body.schemas?.find((item: any) => item.name === 'public')?.name || body.schemas?.[0]?.name || 'public');
      }
      const selected = this.selectedObject();
      if (selected) {
        this.selectedObject.set(body.objects.find((item: PgAdminObject) => item.schema === selected.schema && item.name === selected.name) || null);
      }
      this.state.set('ok');
    } catch (error: any) {
      this.error.set(error?.message || String(error)); this.state.set('error');
    }
  }
  async runQuery(sql: string): Promise<void> {
    this.queryState.set('running'); this.queryError.set(''); this.queryResult.set(null);
    try {
      const response = await hostFetch(this.endpoint('query'), {
        method: 'POST', headers: writeHeaders(), body: JSON.stringify({ cluster: this.selectedCluster(), database: this.selectedDatabase(), sql }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `PostgreSQL query HTTP ${response.status}`);
      this.queryResult.set(body as PgQueryResult); this.queryState.set('done');
    } catch (error: any) {
      this.queryError.set(error?.message || String(error)); this.queryState.set('error');
    }
  }
  async loadData(object: PgAdminObject, limit = 100): Promise<void> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const sql = `SELECT * FROM ${quote(object.schema)}.${quote(object.name)} LIMIT ${boundedLimit}`;
    const objectKey = `${this.selectedDatabase()}:${object.schema}.${object.name}`;
    this.dataState.set('loading'); this.dataError.set(''); this.dataResult.set(null); this.dataObject.set(objectKey);
    try {
      const response = await hostFetch(this.endpoint('query'), {
        method: 'POST', headers: writeHeaders(), body: JSON.stringify({ cluster: this.selectedCluster(), database: this.selectedDatabase(), sql }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `PostgreSQL data view HTTP ${response.status}`);
      if (this.dataObject() !== objectKey) return;
      this.dataResult.set(body as PgQueryResult); this.dataState.set('done');
    } catch (error: any) {
      if (this.dataObject() !== objectKey) return;
      this.dataError.set(error?.message || String(error)); this.dataState.set('error');
    }
  }
  async execute(action: PgTypedAction): Promise<boolean> {
    this.actionState.set('running'); this.actionResult.set('');
    try {
      const response = await hostFetch(this.endpoint('action'), {
        method: 'POST', headers: writeHeaders(), body: JSON.stringify({ ...action, cluster: this.selectedCluster() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `PostgreSQL action HTTP ${response.status}`);
      this.actionResult.set(`${body.action} 완료 · ${body.target}`); this.actionState.set('done');
      await this.refresh(action.database); return true;
    } catch (error: any) {
      this.actionResult.set(error?.message || String(error)); this.actionState.set('error'); return false;
    }
  }
}
