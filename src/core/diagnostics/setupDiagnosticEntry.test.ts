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
        summary: {
          headline: 'Setup report found 2 warning(s).',
          highlights: [
            'Codex CLI is unavailable.',
          ],
        },
      } as never,
    })).toBe([
      'Loaded setup diagnostic report setup-report-1: Setup report found 2 warning(s).',
      '- Codex CLI is unavailable.',
      'Artifact: C:/tmp/runtime-data/diagnostics/setup-report-1.json',
      '',
    ].join('\n'));
  });
});
