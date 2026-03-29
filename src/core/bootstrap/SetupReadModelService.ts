import type {
  SetupDiagnosticArtifact,
  SetupDiagnosticReport,
  SetupDiagnosticService,
} from '../diagnostics/SetupDiagnosticService.js';
import type {
  BootstrapScanResult,
  BootstrapService,
  SetupState,
} from './BootstrapService.js';
import {
  buildRepairSummary,
  type SetupRepairSummary,
} from './setupRepair.js';
export type { SetupReadModelAction, SetupRepairSummary } from './setupRepair.js';

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

export interface SetupLatestDiagnosticReportSummary {
  artifactId: string;
  artifactPath: string;
  generatedAt: string;
  status: SetupDiagnosticReport['summary']['status'];
  issueCounts: SetupDiagnosticReport['summary']['issueCounts'];
  headline: string;
  highlights: string[];
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
    highlights: [...artifact.report.summary.highlights],
  };
}
