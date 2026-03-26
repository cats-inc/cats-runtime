import type {
  SetupDiagnosticArtifact,
  SetupDiagnosticReport,
  SetupDiagnosticService,
} from '../diagnostics/SetupDiagnosticService.js';
import type {
  BootstrapScanResult,
  BootstrapService,
  ProviderScanEntry,
  SetupState,
} from './BootstrapService.js';
import type { ProviderRemediationStep } from '../provider-install/types.js';

const MAX_REMEDIATION_PREVIEW_STEPS = 3;

export interface SetupStateReadModel {
  bootstrapRequired: boolean;
  state: SetupState;
  scan: SetupStateScanSummary | null;
  manualScan: BootstrapScanResult | null;
  universe: Array<{
    provider: string;
    familyLabel: string;
    binaryName: string;
  }>;
  repair: SetupRepairSummary;
  diagnostics: {
    latestReport: SetupLatestDiagnosticReportSummary | null;
  };
}

export interface SetupStateScanSummary extends BootstrapScanResult {
  providerCount: number;
  availableCount: number;
}

export interface SetupRepairSummary {
  status: 'ready' | 'scan_required' | 'attention_required';
  summary: string;
  preferredScan: {
    source: 'scan' | 'manualScan' | 'none';
    scannedAt: string | null;
    providerCount: number;
    availableCount: number;
    unavailableCount: number;
    remediationCount: number;
  };
  providersReadyToApply: Array<{
    provider: string;
    family: string;
  }>;
  providersNeedingAttention: Array<{
    provider: string;
    family: string;
    remediationCount: number;
    remediationPreview: ProviderRemediationStep[];
  }>;
  nextAction: SetupReadModelAction;
  actions: SetupReadModelAction[];
}

export interface SetupReadModelAction {
  kind: 'none' | 'run_manual_scan' | 'apply_config' | 'review_remediation' | 'generate_setup_report';
  label: string;
  summary: string;
  path?: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  providers?: string[];
}

export interface SetupLatestDiagnosticReportSummary {
  artifactId: string;
  artifactPath: string;
  generatedAt: string;
  status: SetupDiagnosticReport['summary']['status'];
  issueCounts: SetupDiagnosticReport['summary']['issueCounts'];
  headline: string;
}

export interface SetupReadModelServiceOptions {
  bootstrapRequired: boolean;
  bootstrapService: Pick<
    BootstrapService,
    'getSetupState' | 'getLatestScan' | 'getLatestManualScan' | 'getProviderUniverse'
  >;
  diagnostics?: Pick<SetupDiagnosticService, 'readLatestReport'>;
}

export class SetupReadModelService {
  private readonly bootstrapRequired: boolean;
  private readonly bootstrapService: SetupReadModelServiceOptions['bootstrapService'];
  private readonly diagnostics?: SetupReadModelServiceOptions['diagnostics'];

  constructor(options: SetupReadModelServiceOptions) {
    this.bootstrapRequired = options.bootstrapRequired;
    this.bootstrapService = options.bootstrapService;
    this.diagnostics = options.diagnostics;
  }

  async read(): Promise<SetupStateReadModel> {
    const [state, scan, manualScan] = await Promise.all([
      this.bootstrapService.getSetupState(),
      this.bootstrapService.getLatestScan(),
      this.bootstrapService.getLatestManualScan(),
    ]);
    const latestReport = this.diagnostics?.readLatestReport() ?? null;

    return {
      bootstrapRequired: this.bootstrapRequired,
      state,
      scan: summarizeScan(scan),
      manualScan: manualScan ?? null,
      universe: this.bootstrapService.getProviderUniverse().map((entry) => ({
        provider: entry.provider,
        familyLabel: entry.familyLabel,
        binaryName: entry.binaryName,
      })),
      repair: buildRepairSummary({
        bootstrapRequired: this.bootstrapRequired,
        scan,
        manualScan,
      }),
      diagnostics: {
        latestReport: summarizeLatestReport(latestReport),
      },
    };
  }
}

function summarizeScan(
  scan: BootstrapScanResult | null,
): SetupStateScanSummary | null {
  if (!scan) {
    return null;
  }

  return {
    ...scan,
    providerCount: scan.providers.length,
    availableCount: scan.providers.filter((provider) => provider.available).length,
  };
}

function summarizeLatestReport(
  artifact: SetupDiagnosticArtifact | null,
): SetupLatestDiagnosticReportSummary | null {
  if (!artifact) {
    return null;
  }

  return {
    artifactId: artifact.report.artifactId,
    artifactPath: artifact.artifactPath,
    generatedAt: artifact.report.generatedAt,
    status: artifact.report.summary.status,
    issueCounts: artifact.report.summary.issueCounts,
    headline: artifact.report.summary.headline,
  };
}

function buildRepairSummary(input: {
  bootstrapRequired: boolean;
  scan: BootstrapScanResult | null;
  manualScan: BootstrapScanResult | null;
}): SetupRepairSummary {
  const preferredScan = pickPreferredScan(input.scan, input.manualScan);
  if (!preferredScan) {
    const actions = [
      createRunManualScanAction(),
      createGenerateSetupReportAction(true),
    ];
    return {
      status: 'scan_required',
      summary: 'No persisted setup scan is available yet. Run a manual scan to capture current provider readiness and remediation.',
      preferredScan: {
        source: 'none',
        scannedAt: null,
        providerCount: 0,
        availableCount: 0,
        unavailableCount: 0,
        remediationCount: 0,
      },
      providersReadyToApply: [],
      providersNeedingAttention: [],
      nextAction: actions[0]!,
      actions,
    };
  }

  const readyProviders = preferredScan.scan.providers.filter((provider) => provider.available);
  const unavailableProviders = preferredScan.scan.providers.filter((provider) => !provider.available);
  const remediationCount = preferredScan.scan.providers.reduce(
    (count, provider) => count + provider.remediation.length,
    0,
  );
  const availableCount = preferredScan.scan.providers.length - unavailableProviders.length;
  const providersReadyToApply = readyProviders.map((provider) => ({
    provider: provider.provider,
    family: provider.family,
  }));

  if (unavailableProviders.length === 0) {
    const actions = input.bootstrapRequired
      ? [
          createApplyConfigAction(readyProviders),
          createGenerateSetupReportAction(false),
        ]
      : [
          createGenerateSetupReportAction(false),
        ];
    return {
      status: 'ready',
      summary: input.bootstrapRequired
        ? 'Ready providers are available. Select one or more providers and apply the generated config to exit bootstrap mode.'
        : 'All providers in the latest setup scan are currently available.',
      preferredScan: {
        source: preferredScan.source,
        scannedAt: preferredScan.scan.scannedAt,
        providerCount: preferredScan.scan.providers.length,
        availableCount,
        unavailableCount: 0,
        remediationCount,
      },
      providersReadyToApply,
      providersNeedingAttention: [],
      nextAction: input.bootstrapRequired ? actions[0]! : createNoAction(),
      actions,
    };
  }

  const providersNeedingAttention = unavailableProviders.map((provider) =>
    summarizeAttentionProvider(provider),
  );
  const actions = [
    ...(input.bootstrapRequired && availableCount > 0 ? [createApplyConfigAction(readyProviders)] : []),
    createReviewRemediationAction(unavailableProviders),
    createGenerateSetupReportAction(false),
    ...(input.bootstrapRequired && availableCount === 0 ? [createRunManualScanAction()] : []),
  ];

  return {
    status: 'attention_required',
    summary: unavailableProviders.length === preferredScan.scan.providers.length
      ? 'Every provider in the latest setup scan needs repair or reconfiguration before it can be used.'
      : `${unavailableProviders.length} provider(s) in the latest setup scan still need repair or reconfiguration.`,
    preferredScan: {
      source: preferredScan.source,
      scannedAt: preferredScan.scan.scannedAt,
      providerCount: preferredScan.scan.providers.length,
      availableCount,
      unavailableCount: unavailableProviders.length,
      remediationCount,
    },
    providersReadyToApply,
    providersNeedingAttention,
    nextAction: actions[0]!,
    actions,
  };
}

function summarizeAttentionProvider(
  provider: ProviderScanEntry,
): SetupRepairSummary['providersNeedingAttention'][number] {
  return {
    provider: provider.provider,
    family: provider.family,
    remediationCount: provider.remediation.length,
    remediationPreview: provider.remediation.slice(0, MAX_REMEDIATION_PREVIEW_STEPS),
  };
}

function createNoAction(): SetupReadModelAction {
  return {
    kind: 'none',
    label: 'No Action Needed',
    summary: 'No provider repair action is currently required.',
  };
}

function createRunManualScanAction(): SetupReadModelAction {
  return {
    kind: 'run_manual_scan',
    label: 'Run Manual Scan',
    summary: 'Trigger a manual provider scan and persist the latest repair snapshot.',
    path: '/setup-scan',
    method: 'POST',
    body: {
      manual: true,
    },
  };
}

function createApplyConfigAction(
  providers: ProviderScanEntry[],
): SetupReadModelAction {
  const providerIds = providers.map((provider) => provider.provider);
  return {
    kind: 'apply_config',
    label: providerIds.length > 0 ? 'Apply Ready Providers' : 'Apply Config',
    summary: providerIds.length > 0
      ? 'Apply the currently ready providers now using the generated providers.yaml contract.'
      : 'Choose the ready providers you want to enable and apply the generated providers.yaml.',
    path: '/setup-apply',
    method: 'POST',
    ...(providerIds.length > 0
      ? {
          providers: providerIds,
          body: {
            providers: providerIds,
          },
        }
      : {}),
  };
}

function createReviewRemediationAction(
  providers: ProviderScanEntry[],
): SetupReadModelAction {
  const providerIds = providers.map((provider) => provider.provider);
  return {
    kind: 'review_remediation',
    label: 'Review Remediation',
    summary: 'Review the per-provider remediation hints from the latest setup scan before the next retry.',
    ...(providerIds.length > 0 ? { providers: providerIds } : {}),
  };
}

function createGenerateSetupReportAction(refreshScan: boolean): SetupReadModelAction {
  return {
    kind: 'generate_setup_report',
    label: 'Generate Setup Report',
    summary: refreshScan
      ? 'Capture a redacted setup diagnostic report and refresh the shared setup scan first.'
      : 'Capture a redacted setup diagnostic report for operator review or sharing.',
    path: '/diagnostics/setup-report',
    method: 'POST',
    body: {
      refreshScan,
    },
  };
}

function pickPreferredScan(
  scan: BootstrapScanResult | null,
  manualScan: BootstrapScanResult | null,
): { source: 'scan' | 'manualScan'; scan: BootstrapScanResult } | null {
  if (scan && manualScan) {
    return Date.parse(manualScan.scannedAt) >= Date.parse(scan.scannedAt)
      ? { source: 'manualScan', scan: manualScan }
      : { source: 'scan', scan };
  }

  if (manualScan) {
    return {
      source: 'manualScan',
      scan: manualScan,
    };
  }

  if (scan) {
    return {
      source: 'scan',
      scan,
    };
  }

  return null;
}
