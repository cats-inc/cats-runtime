import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AuggieProvider } from './auggie.js';
import type { AuggieSessionService } from '../auggie/AuggieSessionService.js';

describe('AuggieProvider', () => {
  it('builds ephemeral print-mode args with normalized model and resume support', () => {
    const sessions = {
      getLatestSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10);
    provider.prepareEphemeralTurn('Say hi');

    const args = provider.buildSpawnArgs({
      cwd: '/tmp/repo',
      model: 'claude opus 4.6',
      resumeSessionId: 'auggie-session-1',
    });

    expect(args[0]).toBe('--print');
    expect(args[1]).toBe('--quiet');
    expect(args[2]).toBe('--output-format');
    expect(args[3]).toBe('json');
    expect(args[4]).toBe('--max-turns');
    expect(args[5]).toBe('10');
    expect(args[6]).toBe('--workspace-root');
    expect(args[7]).toBe('/tmp/repo');
    expect(args).toContain('--model');
    expect(args).toContain('opus4.6');
    expect(args).toContain('--resume');
    expect(args).toContain('auggie-session-1');
    const instructionIndex = args.indexOf('--instruction-file');
    expect(instructionIndex).toBeGreaterThan(-1);
    const instructionFile = args[instructionIndex + 1]!;
    expect(typeof instructionFile).toBe('string');
    expect(existsSync(instructionFile)).toBe(true);
    expect(readFileSync(instructionFile, 'utf8')).toBe('Say hi');
    unlinkSync(instructionFile);
  });

  it('maps skip permissions to allow policies for every tool', () => {
    const sessions = {
      getLatestSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10);
    provider.prepareEphemeralTurn('Do it');

    const args = provider.buildSpawnArgs({
      cwd: '/tmp/repo',
      permissionMode: 'skip',
    });

    expect(args).toContain('--permission');
    expect(args).toContain('apply_patch:allow');
    expect(args).toContain('launch-process:allow');
  });

  it('parses a successful result into text and resolves the updated local session after exit', async () => {
    const sessions = {
      getLatestSession: vi.fn()
        .mockResolvedValueOnce({
          providerSessionId: 'session-old',
          cwd: '/tmp/repo',
          sourcePath: '/tmp/session-old.json',
          messageCount: 1,
          exchangeCount: 1,
          lastActivity: '2026-03-10T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          providerSessionId: 'session-new',
          cwd: '/tmp/repo',
          sourcePath: '/tmp/session-new.json',
          messageCount: 2,
          exchangeCount: 2,
          lastActivity: '2026-03-10T00:01:00.000Z',
          usage: {
            inputTokens: 21,
            outputTokens: 34,
          },
        }),
      getSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10);

    await provider.beforeTurn?.({ cwd: '/tmp/repo' });
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'result',
      result: '\nAUGGIE_OK\n',
      is_error: false,
      session_id: 'remote-session-id',
    }))).toEqual({
      type: 'text',
      text: '\nAUGGIE_OK\n',
    });

    await expect(provider.afterTurn?.({ cwd: '/tmp/repo' })).resolves.toEqual({
      type: 'result',
      sessionId: 'session-new',
      usage: {
        inputTokens: 21,
        outputTokens: 34,
      },
    });
  });

  it('keeps a resumed local session id instead of the transient print-mode session id', async () => {
    const sessions = {
      getLatestSession: vi.fn().mockResolvedValue(null),
      getSession: vi.fn().mockResolvedValue({
        providerSessionId: 'session-existing',
        cwd: '/tmp/repo',
        sourcePath: '/tmp/session-existing.json',
        messageCount: 2,
        exchangeCount: 2,
        lastActivity: '2026-03-10T00:00:00.000Z',
      }),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10);

    await provider.beforeTurn?.({
      cwd: '/tmp/repo',
      resumeSessionId: 'session-existing',
    });
    provider.parseStreamLine(JSON.stringify({
      type: 'result',
      result: 'AUGGIE_RESUME_OK\n',
      is_error: false,
      session_id: 'remote-session-id',
    }));

    await expect(provider.afterTurn?.({
      cwd: '/tmp/repo',
      resumeSessionId: 'session-existing',
    })).resolves.toEqual({
      type: 'result',
      sessionId: 'session-existing',
    });
  });

  it('fails the turn when Auggie updates a session without streaming assistant text', async () => {
    const sessions = {
      getLatestSession: vi.fn()
        .mockResolvedValueOnce({
          providerSessionId: 'session-existing',
          cwd: '/tmp/repo',
          sourcePath: '/tmp/session-existing.json',
          messageCount: 1,
          exchangeCount: 1,
          lastActivity: '2026-03-10T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          providerSessionId: 'session-existing',
          cwd: '/tmp/repo',
          sourcePath: '/tmp/session-existing.json',
          messageCount: 2,
          exchangeCount: 2,
          lastActivity: '2026-03-10T00:01:00.000Z',
        }),
      getSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10);

    await provider.beforeTurn?.({ cwd: '/tmp/repo' });

    await expect(provider.afterTurn?.({ cwd: '/tmp/repo' })).rejects.toThrow(
      'Auggie completed without streaming assistant text for session session-existing.',
    );
  });

  it('fails the turn when Auggie exits without text', async () => {
    const sessions = {
      getLatestSession: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      getSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10);

    provider.prepareEphemeralTurn('Still waiting');
    const args = provider.buildSpawnArgs({ cwd: '/tmp/repo' });
    const instructionFile = args[args.indexOf('--instruction-file') + 1]!;
    expect(existsSync(instructionFile)).toBe(true);

    await provider.beforeTurn?.({ cwd: '/tmp/repo' });

    await expect(provider.afterTurn?.({ cwd: '/tmp/repo' })).rejects.toThrow(
      'Auggie exited without emitting a usable JSON result.',
    );
    expect(existsSync(instructionFile)).toBe(false);
  });

  it('ignores non-json noise lines from the CLI', () => {
    const sessions = {
      getLatestSession: vi.fn().mockResolvedValue(null),
      getSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuggieSessionService;
    const provider = new AuggieProvider(sessions, 10);

    expect(provider.parseStreamLine('Applying --max-turns override: 1 over agentMaxIterations=500'))
      .toBeNull();
    expect(provider.parseStreamLine('Some unexpected Auggie banner')).toBeNull();
  });
});
