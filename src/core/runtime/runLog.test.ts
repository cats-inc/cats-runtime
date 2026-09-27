import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeSessionManager } from './RuntimeSessionManager.js';
import { describeRunTarget, formatRunLogLine } from './runLog.js';
import type { SessionInfo } from '../types.js';

function createRuntimeManager(): RuntimeSessionManager {
  return new RuntimeSessionManager(
    {
      sessionBaseDir: '/tmp/cats-run-log',
      providerInstances: {},
      providerDefaultTargets: { codex: { backend: 'api', instance: 'gateway' } },
      remoteProviderCatalog: {
        api: {
          codex: {
            gateway: {
              id: 'gateway', providerName: 'codex', backend: 'api', transport: 'openai',
              model: 'gpt-4.1', apiKeyEnv: 'OPENAI_API_KEY', baseUrl: 'https://example.test',
            },
          },
        },
        local: {},
        agent: {},
      },
    } as never,
    {
      get: vi.fn(),
      spawn: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn(),
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as never,
  );
}

function createSession(model: string): SessionInfo {
  return {
    id: 'session-1',
    providerName: 'codex',
    providerBackend: 'api',
    providerInstanceId: 'gateway',
    model,
    status: 'ready',
    cwd: '/tmp/cats-run-log/session-1',
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  } as SessionInfo;
}

describe('run log lines', () => {
  it('names the provider, instance and model, or says the provider default applies', () => {
    expect(describeRunTarget({
      providerName: 'opencode', providerBackend: 'cli', providerInstanceId: 'native', model: 'opencode-go/glm-5.3-flash',
    })).toBe('provider=opencode instance=cli/native model=opencode-go/glm-5.3-flash');
    expect(describeRunTarget({ providerName: 'claude', model: undefined }))
      .toBe('provider=claude model=(provider default)');
  });

  it('keeps a provider error on one bounded line', () => {
    const line = formatRunLogLine({
      outcome: 'failed',
      sessionId: 's',
      runId: 'r',
      target: 'provider=opencode model=x',
      durationMs: 1940,
      error: `OpenCode POST failed (500):\n  {"name":"UnknownError"}\n${'x'.repeat(700)}`,
    });
    expect(line).toMatch(/^\[run\] failed session=s run=r provider=opencode model=x duration=1\.9s error=OpenCode POST failed \(500\): \{"name":"UnknownError"\} x+\.\.\. \(\d+ chars\)$/u);
    expect(line).not.toContain('\n');
  });
});

describe('RuntimeSessionManager run logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs each run with its model and outcome, and the error when it fails', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createRuntimeManager();

    const failing = runtime.beginRun(createSession('gpt-withdrawn'), { message: 'private user text' });
    runtime.observeEvent('session-1', { type: 'error', text: 'Model not found: gpt-withdrawn.' });

    const working = runtime.beginRun(createSession('gpt-4.1'), { message: 'private user text' });
    runtime.observeEvent('session-1', { type: 'result', sessionId: 'provider-session' });

    const lines = [...log.mock.calls, ...warn.mock.calls].map(([line]) => String(line));
    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      `[run] started session=session-1 run=${failing.id} provider=codex instance=api/gateway model=gpt-withdrawn`,
      `[run] started session=session-1 run=${working.id} provider=codex instance=api/gateway model=gpt-4.1`,
      expect.stringMatching(new RegExp(`^\\[run\\] succeeded session=session-1 run=${working.id} provider=codex instance=api/gateway model=gpt-4\\.1 duration=\\d+\\.\\ds$`, 'u')),
    ]);
    expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
      expect.stringMatching(new RegExp(`^\\[run\\] failed session=session-1 run=${failing.id} provider=codex instance=api/gateway model=gpt-withdrawn duration=\\d+\\.\\ds error=Model not found: gpt-withdrawn\\.$`, 'u')),
    ]);
    expect(lines.join('\n')).not.toContain('private user text');
  });
});
