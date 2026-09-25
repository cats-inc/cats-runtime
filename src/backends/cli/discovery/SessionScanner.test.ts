import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionScanner } from './SessionScanner.js';

describe('SessionScanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cats-runtime-claude-scan-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Claude names the project directory after its cwd with every
  // non-alphanumeric character written as "-".
  const projectDir = 'C--repo-cats-inc';
  const cwd = 'C:\\repo\\cats-inc';

  function writeTranscript(sessionId: string, records: Record<string, unknown>[]): string {
    const dir = join(tmpDir, projectDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${sessionId}.jsonl`);
    writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    return path;
  }

  const startupRecords = [
    { type: 'mode', mode: 'default' },
    { type: 'permission-mode', permissionMode: 'default' },
    { type: 'system', subtype: 'informational', cwd, timestamp: '2026-09-25T10:00:00.000Z' },
    { type: 'file-history-snapshot' },
  ];

  it('reads cwd from startup records before the first prompt', async () => {
    const sourcePath = writeTranscript('before-prompt', startupRecords);

    await expect(new SessionScanner(tmpDir).scan()).resolves.toEqual([{
      providerSessionId: 'before-prompt',
      projectPath: join(tmpDir, projectDir),
      sourcePath,
      cwd,
      summary: undefined,
      messageCount: 0,
      lastActivity: '2026-09-25T10:00:00.000Z',
    }]);
  });

  it('counts messages and keeps the recorded cwd once the conversation starts', async () => {
    writeTranscript('conversation', [
      ...startupRecords,
      { type: 'user', cwd, message: { content: 'hello' }, timestamp: '2026-09-25T10:01:00.000Z' },
      { type: 'assistant', message: { content: [] }, timestamp: '2026-09-25T10:01:05.000Z' },
    ]);

    const [session] = await new SessionScanner(tmpDir).scan();
    expect(session).toMatchObject({
      cwd,
      summary: 'hello',
      messageCount: 2,
      lastActivity: '2026-09-25T10:01:05.000Z',
    });
  });

  it('skips a transcript that has not recorded a cwd yet', async () => {
    // Decoding the directory name would yield C:/repo/cats/inc, a path that does not exist.
    writeTranscript('no-cwd-yet', [
      { type: 'mode', mode: 'default' },
      { type: 'permission-mode', permissionMode: 'default' },
    ]);

    await expect(new SessionScanner(tmpDir).scan()).resolves.toEqual([]);
  });

  it('reads cwd from the transcript for an index entry without one', async () => {
    writeTranscript('indexed', startupRecords);
    writeFileSync(join(tmpDir, projectDir, 'sessions-index.json'), JSON.stringify({
      indexed: { session_id: 'indexed', summary: 'Indexed session', message_count: 4 },
      'not-started': { session_id: 'not-started', summary: 'No transcript yet' },
    }), 'utf8');

    const sessions = await new SessionScanner(tmpDir).scan();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      providerSessionId: 'indexed',
      cwd,
      summary: 'Indexed session',
      messageCount: 4,
    });
  });
});
