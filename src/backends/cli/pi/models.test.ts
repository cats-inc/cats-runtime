import { describe, expect, it, vi } from 'vitest';
import {
  discoverPiModels,
  parsePiModelListOutput,
  type PiModelDiscoveryRunner,
} from './models.js';

function createPiInstance() {
  return {
    id: 'default',
    providerName: 'pi',
    commandConfig: {
      path: 'pi',
      runner: 'auto',
      runtime: { mode: 'native' as const },
    },
  };
}

describe('parsePiModelListOutput', () => {
  it('parses columnar pi --list-models output with header rows and dedupes ids', () => {
    const entries = parsePiModelListOutput([
      'provider    model                 context  max-out',
      'openai-codex  gpt-5.4            200k     16k',
      'anthropic     claude-sonnet-4-5  200k     8k',
      'openai-codex  gpt-5.4            200k     16k',
      '',
    ].join('\n'));

    expect(entries).toEqual([
      { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
      { id: 'openai-codex/gpt-5.4', label: 'openai-codex/gpt-5.4' },
    ]);
  });

  it('accepts direct provider/model rows without a header', () => {
    const entries = parsePiModelListOutput([
      'openai-codex/gpt-5.4',
      'anthropic/claude-opus-4-6',
      '',
    ].join('\n'));

    expect(entries).toEqual([
      { id: 'anthropic/claude-opus-4-6', label: 'anthropic/claude-opus-4-6' },
      { id: 'openai-codex/gpt-5.4', label: 'openai-codex/gpt-5.4' },
    ]);
  });
});

describe('discoverPiModels', () => {
  it('runs pi --list-models and returns normalized entries', async () => {
    const runner: PiModelDiscoveryRunner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: [
          'provider    model',
          'openai-codex  gpt-5.4',
          'anthropic     claude-sonnet-4-5',
          '',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 5,
      })),
    };

    const entries = await discoverPiModels(createPiInstance(), {
      cwd: '/tmp/cats-runtime',
      runner,
    });

    expect(entries).toEqual([
      { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
      { id: 'openai-codex/gpt-5.4', label: 'openai-codex/gpt-5.4' },
    ]);
    expect(vi.mocked(runner.run)).toHaveBeenCalledWith(
      expect.objectContaining({ providerName: 'pi' }),
      ['--list-models'],
      '/tmp/cats-runtime',
    );
  });

  it('raises a helpful error when pi --list-models fails', async () => {
    const runner: PiModelDiscoveryRunner = {
      run: vi.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'auth required',
        timedOut: false,
        durationMs: 5,
      })),
    };

    await expect(discoverPiModels(createPiInstance(), {
      cwd: '/tmp/cats-runtime',
      runner,
    })).rejects.toThrow('`pi --list-models` failed: auth required');
  });
});
