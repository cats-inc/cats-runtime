import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTranscriptMessages } from './history.js';

describe('API transcript history replay', () => {
  it('reconstructs assistant tool calls and tool results for resume/fork replay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cats-runtime-api-history-'));
    const filePath = join(dir, 'history.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({
        type: 'user',
        message: { content: 'Read src/app.ts and summarize it.' },
        timestamp: '2026-03-16T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Checking the file.' }] },
        timestamp: '2026-03-16T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'tool_use',
        toolId: 'call_1',
        toolName: 'read_file',
        arguments: { path: 'src/app.ts' },
        timestamp: '2026-03-16T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'tool_result',
        toolId: 'call_1',
        toolName: 'read_file',
        text: 'export const value = 7;',
        isError: false,
        timestamp: '2026-03-16T00:00:03.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'The file exports value 7.' }] },
        timestamp: '2026-03-16T00:00:04.000Z',
      }),
    ].join('\n') + '\n');

    try {
      await expect(loadTranscriptMessages(filePath)).resolves.toEqual([
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Read src/app.ts and summarize it.' }],
        },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Checking the file.' },
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'read_file',
              arguments: { path: 'src/app.ts' },
            },
          ],
        },
        {
          role: 'user',
          parts: [{
            type: 'tool_result',
            toolCallId: 'call_1',
            name: 'read_file',
            output: 'export const value = 7;',
            isError: false,
          }],
        },
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'The file exports value 7.' }],
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
