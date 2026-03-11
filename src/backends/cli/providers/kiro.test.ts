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
    provider.prepareEphemeralTurn('Say hi');

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
