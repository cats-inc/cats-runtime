import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CopilotSessionScanner } from './CopilotSessionScanner.js';

describe('CopilotSessionScanner', () => {
  const testDir = join(tmpdir(), `copilot-scanner-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('directory-based sessions (workspace.yaml)', () => {
    it('parses a valid directory session', async () => {
      const sessionDir = join(testDir, 'cb763eb4-1234');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'workspace.yaml'), [
        'id: cb763eb4-1234',
        'cwd: C:\\Users\\sammy\\Source\\SK2\\trending-viz',
        'summary: Initialize Session',
        'created_at: 2026-03-07T15:35:22.790Z',
        'updated_at: 2026-03-07T15:37:21.307Z',
      ].join('\n'));

      // Create events.jsonl with user messages
      writeFileSync(join(sessionDir, 'events.jsonl'), [
        '{"type":"user.message","data":{"text":"Hello"}}',
        '{"type":"assistant.message","data":{"text":"Hi there"}}',
        '{"type":"user.message","data":{"text":"Fix bug"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].providerSessionId).toBe('cb763eb4-1234');
      expect(results[0].cwd).toBe('C:\\Users\\sammy\\Source\\SK2\\trending-viz');
      expect(results[0].summary).toBe('Initialize Session');
      expect(results[0].messageCount).toBe(2);
      expect(results[0].lastActivity).toBe('2026-03-07T15:37:21.307Z');
    });

    it('uses directory name as sessionId when id missing from yaml', async () => {
      const sessionDir = join(testDir, 'fallback-id');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'workspace.yaml'), [
        'cwd: /tmp/test',
        'summary: Test session',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].providerSessionId).toBe('fallback-id');
    });

    it('extracts model from session.model_change events', async () => {
      const sessionDir = join(testDir, 'model-test');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'workspace.yaml'), 'id: model-test\ncwd: /tmp\n');
      writeFileSync(join(sessionDir, 'events.jsonl'), [
        '{"type":"session.model_change","data":{"model":"gpt-4.1"}}',
        '{"type":"user.message","data":{"text":"hello"}}',
        '{"type":"session.model_change","data":{"model":"gpt-5.1"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      // Last model_change wins
      expect(results[0].model).toBe('gpt-5.1');
    });

    it('handles missing events.jsonl gracefully', async () => {
      const sessionDir = join(testDir, 'no-events');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'workspace.yaml'), 'id: no-events\ncwd: /tmp\n');

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].messageCount).toBe(0);
    });
  });

  describe('flat JSONL sessions', () => {
    it('parses a valid JSONL session', async () => {
      writeFileSync(join(testDir, 'abc-123.jsonl'), [
        '{"type":"session.start","data":{"sessionId":"abc-123","startTime":"2026-03-07T10:00:00Z","context":{"cwd":"/home/user/project"}}}',
        '{"type":"user.message","data":{"text":"Hello","timestamp":"2026-03-07T10:00:01Z"}}',
        '{"type":"assistant.message","data":{"text":"Hi"}}',
        '{"type":"user.message","data":{"text":"Fix it","timestamp":"2026-03-07T10:00:05Z"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].providerSessionId).toBe('abc-123');
      expect(results[0].cwd).toBe('/home/user/project');
      expect(results[0].messageCount).toBe(2);
    });

    it('uses filename as sessionId when data.sessionId missing', async () => {
      writeFileSync(join(testDir, 'file-id.jsonl'), [
        '{"type":"session.start","data":{}}',
        '{"type":"user.message","data":{"text":"hello"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].providerSessionId).toBe('file-id');
    });

    it('skips JSONL without session.start first line', async () => {
      writeFileSync(join(testDir, 'bad.jsonl'), [
        '{"type":"user.message","data":{"text":"hello"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();
      expect(results).toHaveLength(0);
    });

    it('skips JSONL with no user messages', async () => {
      writeFileSync(join(testDir, 'empty.jsonl'), [
        '{"type":"session.start","data":{"sessionId":"empty"}}',
        '{"type":"assistant.message","data":{"text":"Hi"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();
      expect(results).toHaveLength(0);
    });

    it('extracts model from model_change events', async () => {
      writeFileSync(join(testDir, 'model.jsonl'), [
        '{"type":"session.start","data":{"sessionId":"model-sess"}}',
        '{"type":"session.model_change","data":{"model":"claude-sonnet-4"}}',
        '{"type":"user.message","data":{"text":"hello"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].model).toBe('claude-sonnet-4');
    });
  });

  describe('mixed formats', () => {
    it('handles both directory and JSONL sessions', async () => {
      // Directory session
      const sessionDir = join(testDir, 'dir-sess');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'workspace.yaml'), 'id: dir-sess\ncwd: /tmp/a\n');
      writeFileSync(join(sessionDir, 'events.jsonl'), '{"type":"user.message","data":{"text":"hi"}}');

      // JSONL session
      writeFileSync(join(testDir, 'flat-sess.jsonl'), [
        '{"type":"session.start","data":{"sessionId":"flat-sess","context":{"cwd":"/tmp/b"}}}',
        '{"type":"user.message","data":{"text":"hello"}}',
      ].join('\n'));

      const scanner = new CopilotSessionScanner(testDir);
      const results = await scanner.scan();

      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.providerSessionId).sort();
      expect(ids).toEqual(['dir-sess', 'flat-sess']);
    });
  });

  it('returns empty array when directory does not exist', async () => {
    const scanner = new CopilotSessionScanner('/nonexistent/path');
    const results = await scanner.scan();
    expect(results).toEqual([]);
  });

  it('skips empty JSONL files', async () => {
    writeFileSync(join(testDir, 'empty.jsonl'), '');

    const scanner = new CopilotSessionScanner(testDir);
    const results = await scanner.scan();
    expect(results).toHaveLength(0);
  });

  it('skips invalid JSON lines gracefully', async () => {
    const sessionDir = join(testDir, 'bad-json');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'workspace.yaml'), 'id: bad-json\ncwd: /tmp\n');
    writeFileSync(join(sessionDir, 'events.jsonl'), [
      'not valid json',
      '{"type":"user.message","data":{"text":"hello"}}',
      '{also invalid',
    ].join('\n'));

    const scanner = new CopilotSessionScanner(testDir);
    const results = await scanner.scan();

    expect(results).toHaveLength(1);
    expect(results[0].messageCount).toBe(1);
  });
});
