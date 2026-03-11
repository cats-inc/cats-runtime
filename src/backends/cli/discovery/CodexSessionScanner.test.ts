import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexSessionScanner } from './CodexSessionScanner.js';

describe('CodexSessionScanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `codex-scan-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when sessions dir does not exist', async () => {
    const scanner = new CodexSessionScanner('/nonexistent/path');
    const result = await scanner.scan();
    expect(result).toEqual([]);
  });

  it('returns empty array when sessions dir is empty', async () => {
    const scanner = new CodexSessionScanner(tmpDir);
    const result = await scanner.scan();
    expect(result).toEqual([]);
  });

  it('discovers a session from YYYY/MM/DD structure', async () => {
    const dayDir = join(tmpDir, '2026', '03', '07');
    mkdirSync(dayDir, { recursive: true });

    const sessionLines = [
      JSON.stringify({
        timestamp: '2026-03-07T10:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'abc-123-def',
          cwd: 'C:\\Users\\test\\project',
          model_provider: 'openai',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-07T10:00:05.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Hello Codex' },
      }),
      JSON.stringify({
        timestamp: '2026-03-07T10:00:10.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message' },
      }),
      JSON.stringify({
        timestamp: '2026-03-07T10:00:15.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Second message' },
      }),
    ];

    writeFileSync(
      join(dayDir, 'rollout-2026-03-07T10-00-00-abc-123-def.jsonl'),
      sessionLines.join('\n') + '\n',
    );

    const scanner = new CodexSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(1);
    expect(result[0].providerSessionId).toBe('abc-123-def');
    expect(result[0].cwd).toBe('C:\\Users\\test\\project');
    expect(result[0].summary).toBe('Second message');
    expect(result[0].messageCount).toBe(3); // 2 user + 1 agent
    expect(result[0].lastActivity).toBe('2026-03-07T10:00:15.000Z');
  });

  it('extracts summary from response_item when no event_msg user_message', async () => {
    const dayDir = join(tmpDir, '2026', '01', '15');
    mkdirSync(dayDir, { recursive: true });

    const sessionLines = [
      JSON.stringify({
        timestamp: '2026-01-15T09:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'uuid-456', cwd: '/home/user/work' },
      }),
      JSON.stringify({
        timestamp: '2026-01-15T09:00:05.000Z',
        type: 'response_item',
        payload: {
          role: 'user',
          content: [{ text: 'Fix the bug in auth module' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-01-15T09:00:10.000Z',
        type: 'response_item',
        payload: { role: 'assistant' },
      }),
    ];

    writeFileSync(
      join(dayDir, 'rollout-2026-01-15T09-00-00-uuid-456.jsonl'),
      sessionLines.join('\n') + '\n',
    );

    const scanner = new CodexSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('Fix the bug in auth module');
    // No event_msg in this transcript, so response_item.role=user is counted as fallback
    expect(result[0].messageCount).toBe(2);
  });

  it('skips files without session_meta', async () => {
    const dayDir = join(tmpDir, '2026', '02', '01');
    mkdirSync(dayDir, { recursive: true });

    writeFileSync(
      join(dayDir, 'broken.jsonl'),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }) + '\n',
    );

    const scanner = new CodexSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(0);
  });

  it('skips empty files', async () => {
    const dayDir = join(tmpDir, '2026', '02', '01');
    mkdirSync(dayDir, { recursive: true });

    writeFileSync(join(dayDir, 'empty.jsonl'), '');

    const scanner = new CodexSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(0);
  });

  it('discovers multiple sessions across dates', async () => {
    const day1 = join(tmpDir, '2026', '01', '10');
    const day2 = join(tmpDir, '2026', '02', '20');
    mkdirSync(day1, { recursive: true });
    mkdirSync(day2, { recursive: true });

    writeFileSync(
      join(day1, 'session1.jsonl'),
      JSON.stringify({ timestamp: 't1', type: 'session_meta', payload: { id: 'id-1', cwd: '/a' } }) + '\n',
    );
    writeFileSync(
      join(day2, 'session2.jsonl'),
      JSON.stringify({ timestamp: 't2', type: 'session_meta', payload: { id: 'id-2', cwd: '/b' } }) + '\n',
    );

    const scanner = new CodexSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.providerSessionId).sort();
    expect(ids).toEqual(['id-1', 'id-2']);
  });
});
