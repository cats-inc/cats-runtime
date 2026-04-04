import { describe, expect, it } from 'vitest';
import {
  formatSetupDiagnosticEntrySummary,
  formatSetupDiagnosticReportListSummary,
  formatSetupDiagnosticReportReadSummary,
} from './setupDiagnosticEntry.js';

describe('formatSetupDiagnosticEntrySummary', () => {
  it('renders a concise stderr summary for diagnose-setup entrypoints', () => {
    expect(formatSetupDiagnosticEntrySummary({
      artifactPath: 'C:/tmp/runtime-data/diagnostics/setup-report-1.json',
      report: {
        setup: {
          repair: {
            summary: 'Run Scan Providers to capture current provider readiness and remediation.',
            nextAction: {
              kind: 'run_manual_scan',
              label: 'Scan Providers',
              summary: 'Scan all known provider CLIs and persist the latest readiness snapshot.',
              method: 'POST',
              path: '/setup-scan',
            },
          },
        },
        summary: {
          headline: 'Setup report found 2 warning(s).',
          highlights: [
            'Codex CLI is unavailable.',
            'ANTHROPIC_API_KEY is missing.',
          ],
        },
      } as never,
    })).toBe([
      'Setup diagnostic report generated: Setup report found 2 warning(s).',
      'Repair: Run Scan Providers to capture current provider readiness and remediation.',
      'Next action: Scan Providers (run_manual_scan)',
      'Action summary: Scan all known provider CLIs and persist the latest readiness snapshot.',
      'Action route: POST /setup-scan',
      '- Codex CLI is unavailable.',
      '- ANTHROPIC_API_KEY is missing.',
      'Artifact: C:/tmp/runtime-data/diagnostics/setup-report-1.json',
      '',
    ].join('\n'));
  });
});

describe('setup diagnostic retained report summaries', () => {
  it('renders a concise stderr summary for retained report listings', () => {
    expect(formatSetupDiagnosticReportListSummary([
      {
        artifactId: 'setup-report-1',
        artifactPath: 'C:/tmp/runtime-data/diagnostics/setup-report-1.json',
        generatedAt: '2026-03-27T00:00:00.000Z',
        summary: {
          status: 'degraded',
          headline: 'Setup report found 2 warning(s).',
          highlights: [],
        },
      },
    ])).toBe([
      'Listed 1 retained setup diagnostic report(s).',
      '- 2026-03-27T00:00:00.000Z [degraded] Setup report found 2 warning(s).',
      '',
    ].join('\n'));
  });

  it('renders a concise stderr summary for rereading a retained report', () => {
    expect(formatSetupDiagnosticReportReadSummary({
      artifactPath: 'C:/tmp/runtime-data/diagnostics/setup-report-1.json',
      report: {
        artifactId: 'setup-report-1',
        setup: {
          repair: {
            summary: 'Review the per-provider remediation hints from the latest setup scan before the next retry.',
            nextAction: {
              kind: 'review_remediation',
              label: 'Review Remediation',
              summary: 'Review the per-provider remediation hints from the latest setup scan before the next retry.',
            },
          },
        },
        summary: {
          headline: 'Setup report found 2 warning(s).',
          highlights: [
            'Codex CLI is unavailable.',
          ],
        },
      } as never,
    })).toBe([
      'Loaded setup diagnostic report setup-report-1: Setup report found 2 warning(s).',
      'Repair: Review the per-provider remediation hints from the latest setup scan before the next retry.',
      'Next action: Review Remediation (review_remediation)',
      'Action summary: Review the per-provider remediation hints from the latest setup scan before the next retry.',
      '- Codex CLI is unavailable.',
      'Artifact: C:/tmp/runtime-data/diagnostics/setup-report-1.json',
      '',
    ].join('\n'));
  });
});
