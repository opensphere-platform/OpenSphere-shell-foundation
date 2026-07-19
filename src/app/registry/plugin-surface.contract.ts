export const POSTGRES_LEVEL_SURFACE = 'postgres-v1' as const;

export type PluginSurfaceCapability =
  | 'overview'
  | 'dependency'
  | 'plan'
  | 'topology'
  | 'consumers'
  | 'protection'
  | 'events'
  | 'upgrade'
  | 'documentation';

/** 신규 Foundation plugin이 등록되기 위해 반드시 선언해야 하는 관리 표면 계약. */
export interface PluginSurfaceContract {
  standard: typeof POSTGRES_LEVEL_SURFACE;
  capabilities: readonly PluginSurfaceCapability[];
}

export const REQUIRED_POSTGRES_LEVEL_CAPABILITIES: readonly PluginSurfaceCapability[] = [
  'overview', 'dependency', 'plan', 'topology', 'consumers', 'protection', 'events', 'upgrade', 'documentation',
];

export function verifyPluginSurface(id: string, surface: PluginSurfaceContract): void {
  const missing = REQUIRED_POSTGRES_LEVEL_CAPABILITIES.filter((capability) => !surface.capabilities.includes(capability));
  if (surface.standard !== POSTGRES_LEVEL_SURFACE || missing.length) {
    throw new Error(`Foundation plugin ${id} does not satisfy ${POSTGRES_LEVEL_SURFACE}: ${missing.join(', ')}`);
  }
}
