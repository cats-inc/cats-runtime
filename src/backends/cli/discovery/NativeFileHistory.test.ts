import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadClineSessionHistory,
  loadGrokSessionHistory,
} from './NativeFileHistory.js';

describe('native file-backed history', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-native-history-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads Cline user and assistant text parts', async () => {
    const historyPath = join(tempDir, 'cline.messages.json');
    writeFileSync(historyPath, JSON.stringify({
      version: 1,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }], ts: 1_786_189_291_153 },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
        { role: 'tool', content: [{ type: 'text', text: 'ignored' }] },
      ],
    }));

    await expect(loadClineSessionHistory(historyPath)).resolves.toEqual([
      { role: 'user', text: 'Hello', timestamp: '2026-08-08T11:41:31.153Z' },
      { role: 'assistant', text: 'Hi' },
    ]);
  });

  it('loads Grok chat messages while ignoring system and reasoning records', async () => {
    const historyPath = join(tempDir, 'chat_history.jsonl');
    writeFileSync(historyPath, [
      JSON.stringify({ type: 'system', content: 'system prompt' }),
      JSON.stringify({ type: 'user', content: 'Question' }),
      JSON.stringify({ type: 'reasoning', summary: 'private reasoning' }),
      JSON.stringify({ type: 'assistant', content: 'Answer' }),
      '{"type":"assistant"',
    ].join('\n'));

    await expect(loadGrokSessionHistory(historyPath)).resolves.toEqual([
      { role: 'user', text: 'Question' },
      { role: 'assistant', text: 'Answer' },
    ]);
  });
});
