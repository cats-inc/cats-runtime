import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GrokSessionScanner } from './GrokSessionScanner.js';

describe('GrokSessionScanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cats-runtime-grok-scan-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSession(
    groupName: string,
    sessionId: string,
    summary: Record<string, unknown>,
  ): string {
    const sessionDir = join(tmpDir, groupName, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'summary.json'), JSON.stringify(summary), 'utf8');
    return sessionDir;
  }

  it('returns nothing when the sessions dir does not exist', async () => {
    await expect(new GrokSessionScanner('/nonexistent/path').scan()).resolves.toEqual([]);
  });

  it('discovers a session from its summary index entry', async () => {
    const group = 'C%3A%5Crepo';
    const sessionDir = writeSession(group, '01a03519-0a6a-7822-82c4-97321b40491b', {
      info: {
        id: '01a03519-0a6a-7822-82c4-97321b40491b',
        cwd: 'C:\\repo',
      },
      session_summary: 'Exact three-line alpha beta gamma reply',
      generated_title: 'Alpha beta gamma',
      created_at: '2026-08-24T18:47:08.687179Z',
      updated_at: '2026-08-24T18:47:25.318044400Z',
      last_active_at: '2026-08-24T18:47:25.318044400Z',
      num_messages: 13,
      num_chat_messages: 12,
      current_model_id: 'grok-4.6',
    });

    await expect(new GrokSessionScanner(tmpDir).scan()).resolves.toEqual([{
      providerSessionId: '01a03519-0a6a-7822-82c4-97321b40491b',
      projectPath: join(tmpDir, group),
      sourcePath: join(sessionDir, 'summary.json'),
      cwd: 'C:\\repo',
      // The generated title wins: it is regenerated from the whole conversation,
      // while session_summary can still reflect a vague first prompt.
      summary: 'Alpha beta gamma',
      messageCount: 13,
      lastActivity: '2026-08-24T18:47:25.318044400Z',
      model: 'grok-4.6',
    }]);
  });

  it('recovers the working directory from the group when the summary omits it', async () => {
    writeSession('C%3A%5CUsers%5Csammy%5CSource%5Ccats-inc', 'session-a', {
      info: { id: 'session-a' },
    });

    const [session] = await new GrokSessionScanner(tmpDir).scan();
    expect(session.cwd).toBe('C:\\Users\\sammy\\Source\\cats-inc');
  });

  it('prefers the recorded .cwd file that the slug+hash group form leaves behind', async () => {
    // Grok falls back to a slug plus hash when the encoded path would exceed
    // 255 bytes, and writes the real path next to the sessions.
    const group = 'deep-project-a1b2c3';
    writeSession(group, 'session-b', { info: { id: 'session-b' } });
    writeFileSync(join(tmpDir, group, '.cwd'), 'C:\\very\\deep\\project\n', 'utf8');

    const [session] = await new GrokSessionScanner(tmpDir).scan();
    expect(session.cwd).toBe('C:\\very\\deep\\project');
  });

  it('skips session dirs without a usable summary and ignores the search index file', async () => {
    writeFileSync(join(tmpDir, 'session_search.sqlite'), 'not a directory', 'utf8');
    mkdirSync(join(tmpDir, 'C%3A%5Crepo', 'no-summary'), { recursive: true });
    writeSession('C%3A%5Crepo', 'no-id', { info: { cwd: 'C:\\repo' } });
    const halfWritten = join(tmpDir, 'C%3A%5Crepo', 'half-written');
    mkdirSync(halfWritten, { recursive: true });
    writeFileSync(join(halfWritten, 'summary.json'), '{"info": {"id": "half', 'utf8');

    await expect(new GrokSessionScanner(tmpDir).scan()).resolves.toEqual([]);
  });
});
