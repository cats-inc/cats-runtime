import { describe, expect, it } from 'vitest';
import { parseCursorModelListOutput } from './models.js';

describe('parseCursorModelListOutput', () => {
  it('parses cursor-agent --list-models output and preserves provider order', () => {
    expect(parseCursorModelListOutput([
      '\u001b[2K\u001b[GLoading models…',
      '\u001b[2K\u001b[1A\u001b[2K\u001b[GAvailable models',
      '',
      'auto - Auto',
      'composer-2-fast - Composer 2 Fast',
      'claude-4.6-opus-high-thinking - Opus 4.6 1M Thinking  (default)',
      'gpt-5.4-xhigh - GPT-5.4 1M Extra High  (current)',
      '',
      'Tip: use --model <id> (or /model <id> in interactive mode) to switch.',
    ].join('\n'))).toEqual([
      {
        id: 'auto',
        label: 'Auto',
      },
      {
        id: 'composer-2-fast',
        label: 'Composer 2 Fast',
      },
      {
        id: 'claude-4.6-opus-high-thinking',
        label: 'Opus 4.6 1M Thinking',
        default: true,
      },
      {
        id: 'gpt-5.4-xhigh',
        label: 'GPT-5.4 1M Extra High',
      },
    ]);
  });
});
