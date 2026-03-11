import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { GeminiSessionScanner } from './GeminiSessionScanner.js';

describe('GeminiSessionScanner', () => {
  const testDir = join(tmpdir(), `gemini-scanner-test-${Date.now()}`);
  const tmpDir = join(testDir, 'tmp');
  const historyDir = join(testDir, 'history');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(historyDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  /** Create a session using legacy SHA256 hash directory layout. */
  function createSessionLegacy(opts: {
    projectPath: string;
    sessionId: string;
    messages?: Array<Record<string, unknown>>;
    summary?: string;
    kind?: string;
  }): void {
    const hash = createHash('sha256').update(opts.projectPath).digest('hex');
    const chatsDir = join(tmpDir, hash, 'chats');
    mkdirSync(chatsDir, { recursive: true });

    // Create history mapping
    const histName = opts.projectPath.replace(/[/\\]/g, '_');
    const histDir = join(historyDir, histName);
    mkdirSync(histDir, { recursive: true });
    writeFileSync(join(histDir, '.project_root'), opts.projectPath);

    const session: Record<string, unknown> = {
      sessionId: opts.sessionId,
      messages: opts.messages || [],
    };
    if (opts.summary) session.summary = opts.summary;
    if (opts.kind) session.kind = opts.kind;

    writeFileSync(
      join(chatsDir, `session-${opts.sessionId}.json`),
      JSON.stringify(session),
    );
  }

  /** Create a session using modern slug directory layout. */
  function createSessionSlug(opts: {
    slug: string;
    projectPath: string;
    sessionId: string;
    messages?: Array<Record<string, unknown>>;
    summary?: string;
    kind?: string;
  }): void {
    const chatsDir = join(tmpDir, opts.slug, 'chats');
    mkdirSync(chatsDir, { recursive: true });

    // Create history mapping using the same slug name
    const histDir = join(historyDir, opts.slug);
    mkdirSync(histDir, { recursive: true });
    writeFileSync(join(histDir, '.project_root'), opts.projectPath);

    const session: Record<string, unknown> = {
      sessionId: opts.sessionId,
      messages: opts.messages || [],
    };
    if (opts.summary) session.summary = opts.summary;
    if (opts.kind) session.kind = opts.kind;

    writeFileSync(
      join(chatsDir, `session-${opts.sessionId}.json`),
      JSON.stringify(session),
    );
  }

  it('discovers sessions with legacy hash directories', async () => {
    createSessionLegacy({
      projectPath: '/home/user/project',
      sessionId: 'abc-123',
      summary: 'Test session',
      messages: [
        { type: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00Z' },
        { type: 'gemini', content: 'Hi there', model: 'gemini-2.5-pro', timestamp: '2025-01-01T00:00:01Z' },
      ],
    });

    const scanner = new GeminiSessionScanner(tmpDir);
    const results = await scanner.scan();

    expect(results).toHaveLength(1);
    expect(results[0].providerSessionId).toBe('abc-123');
    expect(results[0].cwd).toBe('/home/user/project');
    expect(results[0].summary).toBe('Test session');
    expect(results[0].messageCount).toBe(1);
    expect(results[0].model).toBe('gemini-2.5-pro');
  });

  it('discovers sessions with modern slug directories', async () => {
    createSessionSlug({
      slug: 'one-man-digital-company',
      projectPath: 'C:/Users/sammy/Source/SK2/one-man-digital-company',
      sessionId: 'slug-sess-1',
      summary: 'Slug session',
      messages: [
        { type: 'user', content: 'Hello from slug', timestamp: '2026-03-01T00:00:00Z' },
        { type: 'gemini', content: 'Response', model: 'gemini-3.1-pro', timestamp: '2026-03-01T00:00:01Z' },
      ],
    });

    const scanner = new GeminiSessionScanner(tmpDir);
    const results = await scanner.scan();

    expect(results).toHaveLength(1);
    expect(results[0].providerSessionId).toBe('slug-sess-1');
    expect(results[0].cwd).toBe('C:/Users/sammy/Source/SK2/one-man-digital-company');
    expect(results[0].summary).toBe('Slug session');
  });

  it('handles part-list content arrays', async () => {
    createSessionSlug({
      slug: 'test-project',
      projectPath: '/home/user/test',
      sessionId: 'parts-1',
      messages: [
        {
          type: 'user',
          content: [{ text: 'Fix the bug' }, { functionCall: { name: 'test' } }],
          timestamp: '2026-03-01T00:00:00Z',
        },
        {
          type: 'gemini',
          content: [{ text: 'Done fixing' }],
          model: 'gemini-3.0-flash',
          timestamp: '2026-03-01T00:00:01Z',
        },
      ],
    });

    const scanner = new GeminiSessionScanner(tmpDir);
    const results = await scanner.scan();

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Fix the bug');
    expect(results[0].messageCount).toBe(1);
    expect(results[0].model).toBe('gemini-3.0-flash');
  });

  it('skips subagent sessions', async () => {
    createSessionLegacy({
      projectPath: '/home/user/project',
      sessionId: 'sub-1',
      kind: 'subagent',
      messages: [
        { type: 'user', content: 'subtask' },
      ],
    });

    const scanner = new GeminiSessionScanner(tmpDir);
    const results = await scanner.scan();
    expect(results).toHaveLength(0);
  });

  it('skips empty sessions', async () => {
    createSessionLegacy({
      projectPath: '/home/user/project',
      sessionId: 'empty-1',
      messages: [],
    });

    const scanner = new GeminiSessionScanner(tmpDir);
    const results = await scanner.scan();
    expect(results).toHaveLength(0);
  });

  it('falls back to last user message for summary', async () => {
    createSessionLegacy({
      projectPath: '/home/user/project',
      sessionId: 'no-summary',
      messages: [
        { type: 'user', content: 'Fix the bug in auth module' },
        { type: 'gemini', content: 'Done' },
      ],
    });

    const scanner = new GeminiSessionScanner(tmpDir);
    const results = await scanner.scan();

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Fix the bug in auth module');
  });

  it('falls back to last user message with part-list content for summary', async () => {
    createSessionSlug({
      slug: 'partlist-project',
      projectPath: '/home/user/partlist',
      sessionId: 'partlist-summary',
      messages: [
        { type: 'user', content: [{ text: 'Refactor the auth module' }] },
        { type: 'gemini', content: [{ text: 'Done' }] },
      ],
    });

    const scanner = new GeminiSessionScanner(tmpDir);
    const results = await scanner.scan();

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Refactor the auth module');
  });

  it('returns empty array when directory does not exist', async () => {
    const scanner = new GeminiSessionScanner('/nonexistent/path');
    const results = await scanner.scan();
    expect(results).toEqual([]);
  });
});
