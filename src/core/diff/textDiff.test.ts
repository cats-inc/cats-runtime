import { describe, expect, it } from 'vitest';
import { buildTextDiffPreview } from './textDiff.js';

describe('buildTextDiffPreview', () => {
  it('returns a no-changes sentinel when contents match', () => {
    const diff = buildTextDiffPreview('src/app.ts', 'const value = 1;\n', 'const value = 1;\n');

    expect(diff).toEqual({
      text: '--- src/app.ts\n+++ src/app.ts\n@@ no changes @@',
      stats: {
        changed: false,
        addedLines: 0,
        removedLines: 0,
      },
    });
  });

  it('returns a bounded unified diff when contents differ', () => {
    const diff = buildTextDiffPreview(
      'src/app.ts',
      'const a = 1;\nconst b = 2;\n',
      'const a = 1;\nconst b = 3;\nconst c = 4;\n',
    );

    expect(diff.text).toBe([
      '--- src/app.ts',
      '+++ src/app.ts',
      '@@ -2,1 +2,2 @@',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
    ].join('\n'));
    expect(diff.stats).toEqual({
      changed: true,
      addedLines: 2,
      removedLines: 1,
    });
  });
});
