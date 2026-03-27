import { describe, expect, it, vi } from 'vitest';
import {
  discoverOpencodeModels,
  parseOpencodeModelListOutput,
} from './models.js';

describe('opencode model discovery', () => {
  it('parses provider/model rows and dedupes entries', () => {
    expect(parseOpencodeModelListOutput([
      'anthropic/claude-sonnet-4.5',
      'openai/gpt-5.4  $1.25 / 1M in',
      '  ',
      'provider/model',
      'anthropic/claude-sonnet-4.5',
      'openrouter/xiaomi/mimo-v2-flash:free',
    ].join('\n'))).toEqual([
      {
        id: 'anthropic/claude-sonnet-4.5',
        label: 'anthropic/claude-sonnet-4.5',
      },
      {
        id: 'openai/gpt-5.4',
        label: 'openai/gpt-5.4',
      },
      {
        id: 'openrouter/xiaomi/mimo-v2-flash:free',
        label: 'openrouter/xiaomi/mimo-v2-flash:free',
      },
    ]);
  });

  it('runs `opencode models --refresh` when requested', async () => {
    const runner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'anthropic/claude-sonnet-4.5\nopenai/gpt-5.4\n',
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })),
    };

    await expect(discoverOpencodeModels({
      id: 'default',
      providerName: 'opencode',
      commandConfig: {
        path: 'opencode',
        runner: 'auto',
        runtime: { mode: 'native' },
      },
    }, {
      cwd: '/tmp/cats-runtime',
      refresh: true,
      runner,
    })).resolves.toEqual([
      {
        id: 'anthropic/claude-sonnet-4.5',
        label: 'anthropic/claude-sonnet-4.5',
      },
      {
        id: 'openai/gpt-5.4',
        label: 'openai/gpt-5.4',
      },
    ]);

    expect(runner.run).toHaveBeenCalledWith(
      expect.any(Object),
      ['models', '--refresh'],
      '/tmp/cats-runtime',
    );
  });

  it('raises a helpful error when `opencode models` fails', async () => {
    await expect(discoverOpencodeModels({
      id: 'default',
      providerName: 'opencode',
      commandConfig: {
        path: 'opencode',
        runner: 'auto',
        runtime: { mode: 'native' },
      },
    }, {
      cwd: '/tmp/cats-runtime',
      runner: {
        run: vi.fn(async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'auth required\n',
          timedOut: false,
          durationMs: 3,
        })),
      },
    })).rejects.toThrow('`opencode models` failed: auth required');
  });
});
