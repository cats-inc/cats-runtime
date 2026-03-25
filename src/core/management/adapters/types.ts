import type {
  RuntimeManagementDomain,
  RuntimeManagementAction,
  RuntimeManagementRequest,
  RuntimeManagementResult,
} from '../types.js';

// ---------------------------------------------------------------------------
// Adapter descriptor
// ---------------------------------------------------------------------------

export interface ManagementAdapterCapability {
  domain: RuntimeManagementDomain;
  actions: RuntimeManagementAction[];
}

export interface ManagementAdapterDescriptor {
  id: string;
  label: string;
  transport: 'cli' | 'api';
  capabilities: ManagementAdapterCapability[];
}

// ---------------------------------------------------------------------------
// Adapter diagnostics
// ---------------------------------------------------------------------------

export interface ManagementAdapterDiagnosticCheck {
  code: string;
  status: 'ok' | 'degraded' | 'unavailable';
  message: string;
  details?: Record<string, unknown>;
}

export interface ManagementAdapterDiagnostics {
  available: boolean;
  commandFound: boolean;
  authenticated: boolean;
  version?: string;
  checks: ManagementAdapterDiagnosticCheck[];
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ManagementAdapter {
  readonly descriptor: ManagementAdapterDescriptor;
  execute(request: RuntimeManagementRequest): Promise<RuntimeManagementResult>;
  diagnose(workspacePath?: string): Promise<ManagementAdapterDiagnostics>;
}
