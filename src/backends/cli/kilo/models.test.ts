import { describe, expect, it, vi } from 'vitest';
import {
  discoverKiloModels,
  parseKiloModelListOutput,
} from './models.js';

describe('kilo model discovery', () => {
  it('parses provider/model rows and dedupes entries', () => {
    expect(parseKiloModelListOutput([
      'kilo/openai/gpt-5.4',
      'kilo/openai/gpt-5.4-mini  $0.25 / 1M in',
      '  ',
      'provider/model',
      'kilo/openai/gpt-5.4',
      'kilo/google/gemini-3.1-pro-preview',
    ].join('\n'))).toEqual([
      {
        id: 'kilo/google/gemini-3.1-pro-preview',
        label: 'kilo/google/gemini-3.1-pro-preview',
      },
      {
        id: 'kilo/openai/gpt-5.4',
        label: 'kilo/openai/gpt-5.4',
      },
      {
        id: 'kilo/openai/gpt-5.4-mini',
        label: 'kilo/openai/gpt-5.4-mini',
      },
    ]);
  });

  it('runs `kilo models --refresh` when requested', async () => {
    const runner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'kilo/openai/gpt-5.4\nkilo/openai/gpt-5.4-mini\n',
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })),
    };

    await expect(discoverKiloModels({
      id: 'default',
      providerName: 'kilo',
      commandConfig: {
        path: 'kilo',
        runner: 'auto',
        runtime: { mode: 'native' },
      },
    }, {
      cwd: '/tmp/cats-runtime',
      refresh: true,
      runner,
    })).resolves.toEqual([
      {
        id: 'kilo/openai/gpt-5.4',
        label: 'kilo/openai/gpt-5.4',
      },
      {
        id: 'kilo/openai/gpt-5.4-mini',
        label: 'kilo/openai/gpt-5.4-mini',
      },
    ]);

    expect(runner.run).toHaveBeenCalledWith(
      expect.any(Object),
      ['models', '--refresh'],
      '/tmp/cats-runtime',
    );
  });

  it('raises a helpful error when `kilo models` fails', async () => {
    await expect(discoverKiloModels({
      id: 'default',
      providerName: 'kilo',
      commandConfig: {
        path: 'kilo',
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
    })).rejects.toThrow('`kilo models` failed: auth required');
  });
});
