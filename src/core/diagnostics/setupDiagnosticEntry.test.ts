import { describe, expect, it } from 'vitest';
import { formatSetupDiagnosticEntrySummary } from './setupDiagnosticEntry.js';

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
