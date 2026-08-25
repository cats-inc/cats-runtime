import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AntigravitySessionScanner, workspaceUriToPath } from './AntigravitySessionScanner.js';
import type { CommandRunner } from '../pythonScripts.js';

function runnerReturning(payload: unknown): CommandRunner {
  return vi.fn(async () => ({
    code: 0,
    stdout: JSON.stringify(payload),
    stderr: '',
  }));
}

function callCount(runner: CommandRunner): number {
  return (runner as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
}

describe('workspaceUriToPath', () => {
  it('recovers posix and windows workspaces from the recorded URI form', () => {
    expect(workspaceUriToPath('file:///home/dev/project')).toBe('/home/dev/project');
    expect(workspaceUriToPath('file:///C:/Users/dev/project')).toBe('C:/Users/dev/project');
    expect(workspaceUriToPath('file:///home/dev/a%20project')).toBe('/home/dev/a project');
    expect(workspaceUriToPath('file:///home/dev/project/')).toBe('/home/dev/project');
  });

  it('discards anything that is not a file URI rather than guessing a path', () => {
    // The URI is scraped out of an unschema'd protobuf blob, so a printable run
    // that merely looks path-like must not become a session cwd.
    expect(workspaceUriToPath(undefined)).toBeUndefined();
    expect(workspaceUriToPath('')).toBeUndefined();
    expect(workspaceUriToPath('https://example.com/x')).toBeUndefined();
    expect(workspaceUriToPath('/home/dev/project')).toBeUndefined();
    expect(workspaceUriToPath('file:///')).toBeUndefined();
  });
});

describe('AntigravitySessionScanner', () => {
  let conversationsDir: string;

  beforeEach(async () => {
    conversationsDir = await mkdtemp(join(tmpdir(), 'agy-scanner-test-'));
    // Content is irrelevant: every test injects the reader, and the scanner
    // only checks that at least one conversation database is present.
    await writeFile(join(conversationsDir, 'conversation.db'), '', 'utf8');
  });

  afterEach(async () => {
    await rm(conversationsDir, { recursive: true, force: true });
  });

  it('maps one database per conversation onto a discovered session', async () => {
    const runner = runnerReturning([
      {
        conversationId: '4661574b-5e3b-4871-84eb-15603eec6f8c',
        workspaceUri: 'file:///home/dev/project',
        messageCount: 5,
        lastActivity: '2026-08-25T14:15:00.000Z',
      },
    ]);

    expect(await new AntigravitySessionScanner(conversationsDir, { runner }).scan()).toEqual([
      {
        providerSessionId: '4661574b-5e3b-4871-84eb-15603eec6f8c',
        projectPath: conversationsDir,
        sourcePath: join(conversationsDir, '4661574b-5e3b-4871-84eb-15603eec6f8c.db'),
        cwd: '/home/dev/project',
        messageCount: 5,
        lastActivity: '2026-08-25T14:15:00.000Z',
      },
    ]);
  });

  it('keeps a conversation that recorded no workspace instead of dropping it', async () => {
    // agy only writes a workspace when the turn was launched with --add-dir.
    // The runtime always passes it, but conversations started outside the
    // runtime still happened and should stay visible.
    const runner = runnerReturning([
      { conversationId: 'no-workspace', workspaceUri: null, messageCount: 2 },
    ]);

    const [session] = await new AntigravitySessionScanner(conversationsDir, { runner }).scan();
    expect(session.providerSessionId).toBe('no-workspace');
    expect(session.cwd).toBe('');
  });

  it('skips rows the reader could not identify', async () => {
    const runner = runnerReturning([
      { workspaceUri: 'file:///home/dev/project', messageCount: 1 },
      { conversationId: '   ', messageCount: 1 },
      { conversationId: 'good', messageCount: 1 },
    ]);

    const sessions = await new AntigravitySessionScanner(conversationsDir, { runner }).scan();
    expect(sessions.map((session) => session.providerSessionId)).toEqual(['good']);
  });

  it('returns nothing rather than throwing when the reader fails', async () => {
    // This scanner runs inside a FileWatcher; an absent python or a corrupt
    // database must not take the watcher down.
    const failing: CommandRunner = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'python: not found',
    }));
    expect(await new AntigravitySessionScanner(conversationsDir, { runner: failing }).scan())
      .toEqual([]);

    const garbage: CommandRunner = vi.fn(async () => ({
      code: 0,
      stdout: 'not json',
      stderr: '',
    }));
    expect(await new AntigravitySessionScanner(conversationsDir, { runner: garbage }).scan())
      .toEqual([]);
  });

  it('hands the conversations directory to the reader as its only argument', async () => {
    const runner = runnerReturning([]);
    await new AntigravitySessionScanner(conversationsDir, { runner }).scan();

    const call = (runner as unknown as { mock: { calls: Array<[string, string[]]> } }).mock.calls[0];
    expect(call[1][call[1].length - 1]).toBe(conversationsDir);
  });

  it('does not start python when there is no conversation to read', async () => {
    // A FileWatcher scans on start and on every debounced change. Starting an
    // interpreter to discover an empty directory made every runtime boot in the
    // test suite pay for a spawn it could not use.
    const runner = runnerReturning([{ conversationId: 'unreachable' }]);

    await rm(join(conversationsDir, 'conversation.db'));
    expect(await new AntigravitySessionScanner(conversationsDir, { runner }).scan()).toEqual([]);
    expect(callCount(runner)).toBe(0);

    const missing = join(conversationsDir, 'nope', 'conversations');
    expect(await new AntigravitySessionScanner(missing, { runner }).scan()).toEqual([]);
    expect(callCount(runner)).toBe(0);
  });
});
