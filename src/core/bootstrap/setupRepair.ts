import type { ProviderRemediationStep } from '../provider-install/types.js';
import type { BootstrapScanResult, ProviderSetupObservation } from './BootstrapService.js';

export interface SetupReadModelAction {
  kind: 'none' | 'run_manual_scan' | 'manage_selection' | 'review_remediation' | 'generate_setup_report';
  label: string;
  summary: string;
  path?: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  providers?: string[];
}

export interface SetupRepairSummary {
  status: 'ready' | 'selection_required' | 'scan_required' | 'attention_required';
  summary: string;
  preferredScan: { source: 'scan' | 'manualScan' | 'none'; scannedAt: string | null;
    providerCount: number; availableCount: number; unavailableCount: number; remediationCount: number };
  providersReady: Array<{ provider: string; family: string }>;
  providersNeedingAttention: Array<{ provider: string; family: string;
    remediationCount: number; remediationPreview: ProviderRemediationStep[] }>;
  observationCoverage: { observedCount: number; notDetectedCount: number; configurationChangedCount: number };
  nextAction: SetupReadModelAction;
  actions: SetupReadModelAction[];
}

export function buildRepairSummary(input: {
  bootstrapRequired: boolean;
  scan: BootstrapScanResult | null;
  manualScan: BootstrapScanResult | null;
  selectedCount: number;
  observations: ProviderSetupObservation[];
}): SetupRepairSummary {
  const scan = input.manualScan && (!input.scan || Date.parse(input.manualScan.scannedAt) >= Date.parse(input.scan.scannedAt))
    ? input.manualScan : input.scan;
  const observed = input.observations.filter((entry) => entry.configurationStatus === 'unchanged');
  const configurationChangedCount = input.observations.filter((entry) => entry.configurationStatus === 'changed').length;
  const notDetectedCount = Math.max(0, input.selectedCount - observed.length - configurationChangedCount);
  const needsDetection = configurationChangedCount + notDetectedCount;
  const ready = observed.filter((provider) => provider.available);
  const attention = observed.filter((provider) => !provider.available);
  const manage: SetupReadModelAction = {
    kind: 'manage_selection', label: 'Choose Providers',
    summary: 'Save the providers you want Cats to manage before checking availability.', path: '/setup', method: 'GET',
  };
  const refresh: SetupReadModelAction = {
    kind: 'run_manual_scan', label: 'Check Selected Providers',
    summary: 'Refresh only the saved provider selection.', path: '/setup-scan', method: 'POST', body: { manual: true },
  };
  const report: SetupReadModelAction = {
    kind: 'generate_setup_report', label: 'Generate Setup Report',
    summary: 'Capture a redacted report of the current setup state.',
    path: '/diagnostics/setup-report', method: 'POST', body: { refreshScan: false },
  };
  const idle = input.selectedCount === 0 && !input.bootstrapRequired;
  const status = input.bootstrapRequired ? 'selection_required' : idle ? 'ready'
    : attention.length ? 'attention_required' : needsDetection ? 'scan_required' : 'ready';
  const nextAction: SetupReadModelAction = input.bootstrapRequired ? manage
    : idle ? manage : attention.length ? {
      kind: 'review_remediation', label: 'Review Selected Providers',
      summary: 'Selected providers retain their selection while unavailable.', providers: attention.map((entry) => entry.provider),
    } : needsDetection ? refresh
      : { kind: 'none', label: 'No Action Needed', summary: 'Last observations are available for the selected configuration; they are not live checks.' };
  return {
    status,
    summary: input.bootstrapRequired ? 'Choose providers to finish runtime setup.'
      : idle ? 'No providers selected. Runtime is idle.'
      : attention.length ? `${attention.length} selected provider(s) need attention based on their last observations. ${needsDetection} need detection.`
      : needsDetection ? `${needsDetection} selected provider(s) need detection. Previous results are retained for unchanged targets.`
      : 'Last observations reported the selected providers available; no new detection was performed by this read.',
    preferredScan: {
      source: scan === input.manualScan && scan ? 'manualScan' : scan ? 'scan' : 'none',
      scannedAt: scan?.scannedAt ?? null, providerCount: scan?.providers.length ?? 0,
      availableCount: scan?.providers.filter((entry) => entry.available).length ?? 0,
      unavailableCount: scan?.providers.filter((entry) => !entry.available).length ?? 0,
      remediationCount: scan?.providers.reduce((sum, entry) => sum + entry.remediation.length, 0) ?? 0,
    },
    providersReady: ready.map(({ provider, family }) => ({ provider, family })),
    providersNeedingAttention: attention.map(({ provider, family, remediation }) => ({
      provider, family, remediationCount: remediation.length, remediationPreview: remediation.slice(0, 3),
    })),
    observationCoverage: { observedCount: observed.length, notDetectedCount, configurationChangedCount },
    nextAction,
    actions: input.bootstrapRequired || idle ? [manage, report] : [manage, refresh, report],
  };
}
