import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClineSessionScanner } from './ClineSessionScanner.js';

describe('ClineSessionScanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cats-runtime-cline-scan-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSession(
    id: string,
    meta: Record<string, unknown>,
    messages?: unknown,
  ): string {
    const sessionDir = join(tmpDir, id);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${id}.json`), JSON.stringify(meta), 'utf8');
    if (messages !== undefined) {
      writeFileSync(
        join(sessionDir, `${id}.messages.json`),
        JSON.stringify({ version: 1, messages }),
        'utf8',
      );
    }
    return sessionDir;
  }

  it('returns nothing when the sessions dir does not exist', async () => {
    await expect(new ClineSessionScanner('/nonexistent/path').scan()).resolves.toEqual([]);
  });

  it('discovers a session from its metadata and message files', async () => {
    const sessionDir = writeSession('1786189291153_wyis2', {
      version: 1,
      session_id: '1786189291153_wyis2',
      source: 'cli',
      status: 'completed',
      provider: 'cline',
      model: 'anthropic/claude-opus-5',
      cwd: 'C:\\repo',
      workspace_root: 'C:\\repo',
      prompt: 'reply with the single word OK',
      started_at: '2026-08-08T11:41:31.362Z',
      ended_at: '2026-08-08T11:41:35.241Z',
      metadata: { title: 'reply with the single word OK' },
    }, [{ role: 'user' }, { role: 'assistant' }]);

    await expect(new ClineSessionScanner(tmpDir).scan()).resolves.toEqual([{
      providerSessionId: '1786189291153_wyis2',
      projectPath: sessionDir,
      sourcePath: join(sessionDir, '1786189291153_wyis2.json'),
      cwd: 'C:\\repo',
      summary: 'reply with the single word OK',
      messageCount: 2,
      lastActivity: '2026-08-08T11:41:35.241Z',
      model: 'anthropic/claude-opus-5',
    }]);
  });

  it('falls back to the prompt, workspace root, and start time when a run is still open', async () => {
    writeSession('1786189330352_kkzk7', {
      session_id: '1786189330352_kkzk7',
      workspace_root: 'C:\\other',
      prompt: 'say HI',
      started_at: '2026-08-08T11:42:00.000Z',
    });

    const [session] = await new ClineSessionScanner(tmpDir).scan();
    expect(session).toMatchObject({
      providerSessionId: '1786189330352_kkzk7',
      cwd: 'C:\\other',
      summary: 'say HI',
      lastActivity: '2026-08-08T11:42:00.000Z',
    });
    // No messages file yet: a missing count is honest, zero would not be.
    expect(session.messageCount).toBeUndefined();
  });

  it('skips a directory whose metadata is absent, unreadable, or has no session id', async () => {
    mkdirSync(join(tmpDir, 'no-metadata'), { recursive: true });
    const halfWritten = join(tmpDir, 'half-written');
    mkdirSync(halfWritten, { recursive: true });
    writeFileSync(join(halfWritten, 'half-written.json'), '{"session_id": "half', 'utf8');
    writeSession('missing-id', { cwd: 'C:\\repo', prompt: 'orphan' });

    await expect(new ClineSessionScanner(tmpDir).scan()).resolves.toEqual([]);
  });
});
