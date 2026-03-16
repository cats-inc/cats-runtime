import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiSessionScanner } from './PiSessionScanner.js';

describe('PiSessionScanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pi-scan-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when sessions dir does not exist', async () => {
    const scanner = new PiSessionScanner('/nonexistent/path');
    const result = await scanner.scan();
    expect(result).toEqual([]);
  });

  it('returns empty array when sessions dir is empty', async () => {
    const scanner = new PiSessionScanner(tmpDir);
    const result = await scanner.scan();
    expect(result).toEqual([]);
  });

  it('discovers a session from <cwd-slug>/<file>.jsonl structure', async () => {
    const cwdDir = join(tmpDir, '--home-user-project--');
    mkdirSync(cwdDir, { recursive: true });

    const sessionLines = [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: '7e118491-253c-4270-9787-67e56a2f4bac',
        timestamp: '2026-03-16T19:43:48.937Z',
        cwd: '/home/user/project',
      }),
      JSON.stringify({
        type: 'model_change',
        timestamp: '2026-03-16T19:43:48.939Z',
        provider: 'openai-codex',
        modelId: 'gpt-5.4',
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-16T19:44:24.904Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Fix the login bug' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-16T19:44:33.131Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will fix it.' }],
        },
      }),
    ];

    writeFileSync(
      join(cwdDir, '2026-03-16T19-43-48-937Z_7e118491-253c-4270-9787-67e56a2f4bac.jsonl'),
      sessionLines.join('\n') + '\n',
    );

    const scanner = new PiSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(1);
    expect(result[0].providerSessionId).toBe('7e118491-253c-4270-9787-67e56a2f4bac');
    expect(result[0].cwd).toBe('/home/user/project');
    expect(result[0].summary).toBe('Fix the login bug');
    expect(result[0].messageCount).toBe(2);
    expect(result[0].lastActivity).toBe('2026-03-16T19:44:33.131Z');
    expect(result[0].model).toBe('openai-codex/gpt-5.4');
  });

  it('extracts summary from string content', async () => {
    const cwdDir = join(tmpDir, '--tmp--');
    mkdirSync(cwdDir, { recursive: true });

    const sessionLines = [
      JSON.stringify({
        type: 'session',
        id: 'sess-1',
        timestamp: '2026-01-01T00:00:00Z',
        cwd: '/tmp',
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-01T00:01:00Z',
        message: { role: 'user', content: 'Hello Pi' },
      }),
    ];

    writeFileSync(join(cwdDir, 'sess-1.jsonl'), sessionLines.join('\n') + '\n');

    const scanner = new PiSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('Hello Pi');
    expect(result[0].messageCount).toBe(1);
  });

  it('decodes cwd slug as fallback when session line has no cwd', async () => {
    const cwdDir = join(tmpDir, '--home-sammy-Source-myproject--');
    mkdirSync(cwdDir, { recursive: true });

    writeFileSync(
      join(cwdDir, 'test.jsonl'),
      JSON.stringify({ type: 'session', id: 'no-cwd-sess', timestamp: '2026-01-01T00:00:00Z' }) + '\n',
    );

    const scanner = new PiSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(1);
    expect(result[0].cwd).toBe('/home/sammy/Source/myproject');
  });

  it('skips files without session header', async () => {
    const cwdDir = join(tmpDir, '--tmp--');
    mkdirSync(cwdDir, { recursive: true });

    writeFileSync(
      join(cwdDir, 'broken.jsonl'),
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'hi' } }) + '\n',
    );

    const scanner = new PiSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(0);
  });

  it('skips empty files', async () => {
    const cwdDir = join(tmpDir, '--tmp--');
    mkdirSync(cwdDir, { recursive: true });

    writeFileSync(join(cwdDir, 'empty.jsonl'), '');

    const scanner = new PiSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(0);
  });

  it('discovers multiple sessions across cwd directories', async () => {
    const dir1 = join(tmpDir, '--project-a--');
    const dir2 = join(tmpDir, '--project-b--');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeFileSync(
      join(dir1, 'sess1.jsonl'),
      JSON.stringify({ type: 'session', id: 'id-1', timestamp: 't1', cwd: '/project-a' }) + '\n',
    );
    writeFileSync(
      join(dir2, 'sess2.jsonl'),
      JSON.stringify({ type: 'session', id: 'id-2', timestamp: 't2', cwd: '/project-b' }) + '\n',
    );

    const scanner = new PiSessionScanner(tmpDir);
    const result = await scanner.scan();

    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.providerSessionId).sort();
    expect(ids).toEqual(['id-1', 'id-2']);
  });
});
