import type { ProviderRemediationStep } from '../provider-install/types.js';
import type { BootstrapScanResult } from './BootstrapService.js';

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
  nextAction: SetupReadModelAction;
  actions: SetupReadModelAction[];
}

export function buildRepairSummary(input: {
  bootstrapRequired: boolean;
  scan: BootstrapScanResult | null;
  manualScan: BootstrapScanResult | null;
  selectedCount?: number;
}): SetupRepairSummary {
  const scan = input.manualScan && (!input.scan || Date.parse(input.manualScan.scannedAt) >= Date.parse(input.scan.scannedAt))
    ? input.manualScan : input.scan;
  const ready = scan?.providers.filter((provider) => provider.available) || [];
  const attention = scan?.providers.filter((provider) => !provider.available) || [];
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
    : !scan ? 'scan_required' : attention.length ? 'attention_required' : 'ready';
  const nextAction: SetupReadModelAction = input.bootstrapRequired ? manage
    : idle ? manage : !scan ? refresh : attention.length ? {
      kind: 'review_remediation', label: 'Review Selected Providers',
      summary: 'Selected providers retain their selection while unavailable.', providers: attention.map((entry) => entry.provider),
    } : { kind: 'none', label: 'No Action Needed', summary: 'Selected provider checks are complete.' };
  return {
    status,
    summary: input.bootstrapRequired ? 'Choose providers to finish runtime setup.'
      : idle ? 'No providers selected. Runtime is idle.'
      : !scan ? 'Provider selection is saved. Check selected providers when ready.'
      : attention.length ? `${attention.length} selected provider(s) need attention or have unknown availability.`
      : 'All checked selected providers are available.',
    preferredScan: {
      source: scan === input.manualScan && scan ? 'manualScan' : scan ? 'scan' : 'none',
      scannedAt: scan?.scannedAt ?? null, providerCount: scan?.providers.length ?? 0,
      availableCount: ready.length, unavailableCount: attention.length,
      remediationCount: scan?.providers.reduce((sum, entry) => sum + entry.remediation.length, 0) ?? 0,
    },
    providersReady: ready.map(({ provider, family }) => ({ provider, family })),
    providersNeedingAttention: attention.map(({ provider, family, remediation }) => ({
      provider, family, remediationCount: remediation.length, remediationPreview: remediation.slice(0, 3),
    })),
    nextAction,
    actions: input.bootstrapRequired || idle ? [manage, report] : [manage, refresh, report],
  };
}
