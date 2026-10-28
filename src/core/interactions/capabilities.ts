import type { EffectiveExecutionPolicy } from './policy.js';
import type { InteractionHost, InteractionKind } from './types.js';

export interface SessionToolServer {
  name: string;
  source: 'provider-configured' | 'session-injected';
  connection: 'notStarted' | 'starting' | 'connected' | 'authenticationRequired' | 'failed' | 'cancelled' | 'disabled' | 'unknown';
  /** An unsupported auth mechanism does not imply unsupported tools. */
  auth: 'unknown' | 'unsupported' | 'notLoggedIn' | 'bearerToken' | 'oAuth';
  tools: Array<{ name: string; qualifiedName: string }>;
  discovery: 'advertised' | 'failed' | 'truncated';
  invocation: 'not_verified';
}

export interface SessionToolInventory {
  state: 'not_observed' | 'observed' | 'partial' | 'unavailable';
  observedAt: string | null;
  stale: boolean;
  /** Top-level discovery cannot enumerate tools lazily exposed inside code-mode hosts. */
  coverage: 'top-level-mcp';
  pages: number;
  servers: SessionToolServer[];
  dynamicTools: Array<{ name: string; source: 'runtime-dynamic' }>;
  builtins: 'not_exposed_by_provider';
  reason?: string;
}

export interface ProviderSessionCapabilities {
  interactions: { version: 1; supported: InteractionKind[]; host?: InteractionHost };
  policy: EffectiveExecutionPolicy;
  inventory: SessionToolInventory;
  dependencies: Array<{ kind: 'computer_use' | 'browser'; status: 'available' | 'unavailable' | 'unknown';
    evidence: string; remediation: string }>;
}

export interface SessionCapabilitiesSnapshot {
  version: 1;
  sessionId: string;
  workerGeneration: string | null;
  supported: boolean;
  observation?: ProviderSessionCapabilities;
  reason?: string;
}
