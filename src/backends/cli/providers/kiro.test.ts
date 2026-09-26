import { describe, expect, it, vi } from 'vitest';
import { KiroProvider } from './kiro.js';
import type { KiroNativeSessionService } from '../kiro/KiroNativeSessionService.js';

describe('KiroProvider', () => {
  it('builds ephemeral spawn args with model, trust, and resume support', () => {
    const native = {
      canResumeSession: vi.fn(),
      getLatestSession: vi.fn(),
    } as unknown as KiroNativeSessionService;
    const provider = new KiroProvider(native);
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    const args = provider.buildSpawnArgs({
      cwd: '/tmp/repo',
      model: 'claude-sonnet-4.5',
      resumeSessionId: 'kiro-session-1',
      permissionMode: 'skip',
    });

    expect(args).toEqual([
      'chat',
      '--no-interactive',
      '--wrap',
      'never',
      '--model',
      'claude-sonnet-4.5',
      '--trust-all-tools',
      '--resume',
      'Say hi',
    ]);
  });

  it('passes the selected effort after the model and omits it when absent', () => {
    const provider = new KiroProvider({} as unknown as KiroNativeSessionService);

    expect(provider.buildSpawnArgs({
      cwd: '/tmp/repo',
      model: 'gpt-5.6-sol',
      modelControls: { 'kiro.reasoning_effort': 'none' },
    })).toEqual([
      'chat', '--no-interactive', '--wrap', 'never',
      '--model', 'gpt-5.6-sol', '--effort', 'none',
    ]);
    expect(provider.buildSpawnArgs({ cwd: '/tmp/repo', model: 'auto', modelControls: {} })).toEqual([
      'chat', '--no-interactive', '--wrap', 'never', '--model', 'auto',
    ]);
    // Another provider's control is never forwarded as a Kiro flag.
    expect(provider.buildSpawnArgs({
      cwd: '/tmp/repo', model: 'claude-haiku-4.5',
      modelControls: { 'claude.reasoning_effort': 'high' },
    })).not.toContain('--effort');
  });

  it('rejects a non-string or control-character effort instead of emitting it', () => {
    const provider = new KiroProvider({} as unknown as KiroNativeSessionService);

    for (const effort of [true, '', ' ', 'low\nhigh']) {
      expect(() => provider.buildSpawnArgs({
        cwd: '/tmp/repo',
        model: 'claude-opus-5',
        modelControls: { 'kiro.reasoning_effort': effort },
      })).toThrow('Unsupported Kiro reasoning effort.');
    }
  });

  it('strips ANSI output and emits text lines', () => {
    const native = {
      canResumeSession: vi.fn(),
      getLatestSession: vi.fn(),
    } as unknown as KiroNativeSessionService;
    const provider = new KiroProvider(native);

    expect(provider.parseStreamLine('\u001b[38;5;141m> \u001b[0mOK')).toEqual({
      type: 'text',
      text: 'OK\n',
    });
  });

  it('checks resume viability before turn', async () => {
    const native = {
      canResumeSession: vi.fn(async () => false),
      getLatestSession: vi.fn(),
    } as unknown as KiroNativeSessionService;
    const provider = new KiroProvider(native);

    await expect(provider.beforeTurn?.({
      cwd: 'C:/repo',
      resumeSessionId: 'kiro-old',
    })).rejects.toThrow('latest one');
  });

  it('emits a synthetic result event after turn with the latest session id', async () => {
    const native = {
      canResumeSession: vi.fn(async () => true),
      getLatestSession: vi.fn(async () => ({
        providerSessionId: 'kiro-123',
        cwd: 'C:/repo',
        summary: 'Latest',
        messageCount: 2,
      })),
    } as unknown as KiroNativeSessionService;
    const provider = new KiroProvider(native);

    await expect(provider.afterTurn?.({
      cwd: 'C:/repo',
    })).resolves.toEqual({
      type: 'result',
      sessionId: 'kiro-123',
    });
  });
});
