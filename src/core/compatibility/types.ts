import type {
  ProviderCommandConfig,
  ProviderRuntimeConfig,
} from '../../backends/cli/config.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import type { ProviderSetupSummary } from '../provider-install/types.js';
import type { HealthStatus } from '../types.js';

export type CompatibilityClassification =
  | 'ready'
  | 'degraded'
  | 'unsupported_version'
  | 'unrecognized_protocol'
  | 'probe_failed';

export type CompatibilityConfidence = 'exact' | 'fallback' | 'weak';
export type CompatibilityProbeMode = 'light' | 'live';
export type CompatibilityProbeKind = 'version' | 'help' | 'live';

export interface CompatibilityCheck {
  code: string;
  status: HealthStatus['status'];
  message: string;
  details?: Record<string, unknown>;
}

export interface ProviderCompatibilityProfile {
  id: string;
  label: string;
  provider: ProviderName;
  protocolFamily: string;
  parserId: string;
  spawnBaseArgs?: string[];
  supportedVersions?: string[];
  minVersionMajor?: number;
  maxVersionMajor?: number;
  allowUnknownVersion?: boolean;
  helpTokens?: string[];
  liveProbeArgs?: string[];
  liveProbeTokens?: string[];
}

export interface ProviderCompatibilityKnowledge {
  provider: ProviderName;
  familyLabel: string;
  versionArgs?: string[];
  helpArgs?: string[];
  primaryProfile: ProviderCompatibilityProfile;
  fallbackProfile?: ProviderCompatibilityProfile;
}

export interface CompatibilityProbeRecord {
  kind: CompatibilityProbeKind;
  commandSummary: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  ok: boolean;
  stdoutSample?: string;
  stderrSample?: string;
  error?: string;
}

export interface CompatibilityVersionFingerprint {
  raw?: string;
  normalized?: string;
  major?: number;
  minor?: number;
  patch?: number;
  source: 'command' | 'unknown';
  detected: boolean;
}

export interface CompatibilityFingerprint {
  provider: ProviderName;
  instanceId: string;
  command: string;
  runner: ProviderCommandConfig['runner'];
  runtime: ProviderRuntimeConfig;
  resolvedCommand?: string;
  version: CompatibilityVersionFingerprint;
  features: string[];
  checkedAt: string;
}

export interface CompatibilityProfileSelection {
  id: string;
  label: string;
  protocolFamily: string;
  parserId: string;
  spawnBaseArgs?: string[];
  confidence: CompatibilityConfidence;
}

export interface CompatibilityEvidenceArtifact {
  id: string;
  relativePath: string;
  capturedAt: string;
}

export interface CompatibilityAssessment {
  key: string;
  provider: ProviderName;
  instanceId: string;
  checkedAt: string;
  classification: CompatibilityClassification;
  status: HealthStatus['status'];
  summary: string;
  fingerprint: CompatibilityFingerprint;
  profile: CompatibilityProfileSelection;
  warnings: string[];
  setup: ProviderSetupSummary;
  checks: CompatibilityCheck[];
  probes: {
    version?: CompatibilityProbeRecord;
    help?: CompatibilityProbeRecord;
    live?: CompatibilityProbeRecord;
  };
  evidence?: CompatibilityEvidenceArtifact;
  probe: {
    mode: CompatibilityProbeMode;
    supportsLive: boolean;
    liveValidated: boolean;
  };
  cache: {
    hit: boolean;
    stale: boolean;
    ttlMs: number;
    ageMs: number;
    freshUntil: string;
  };
}

export interface CompatibilityAssessmentOptions {
  force?: boolean;
  purpose?: 'diagnostics' | 'execution' | 'setup' | 'health';
  probeMode?: CompatibilityProbeMode;
}

export interface CompatibilitySummaryView {
  classification: CompatibilityClassification;
  status: HealthStatus['status'];
  summary: string;
  checkedAt: string;
  profile: CompatibilityProfileSelection;
  fingerprint: Pick<CompatibilityFingerprint, 'version' | 'features' | 'runtime'>;
  attentionCodes: string[];
  warnings: string[];
  evidence?: CompatibilityEvidenceArtifact;
  probe: CompatibilityAssessment['probe'];
  cache: CompatibilityAssessment['cache'];
}
