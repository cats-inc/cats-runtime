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

  it('keeps multi-tool turns grouped into one assistant message and one tool-result message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cats-runtime-api-history-'));
    const filePath = join(dir, 'history.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({
        type: 'user',
        message: { content: 'Inspect both files.' },
        timestamp: '2026-03-16T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Checking both files.' }] },
        timestamp: '2026-03-16T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'tool_use',
        toolId: 'call_1',
        toolName: 'read_file',
        arguments: { path: 'src/a.ts' },
        timestamp: '2026-03-16T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'tool_use',
        toolId: 'call_2',
        toolName: 'read_file',
        arguments: { path: 'src/b.ts' },
        timestamp: '2026-03-16T00:00:02.500Z',
      }),
      JSON.stringify({
        type: 'tool_result',
        toolId: 'call_1',
        toolName: 'read_file',
        text: 'export const a = 1;',
        isError: false,
        timestamp: '2026-03-16T00:00:03.000Z',
      }),
      JSON.stringify({
        type: 'tool_result',
        toolId: 'call_2',
        toolName: 'read_file',
        text: 'export const b = 2;',
        isError: false,
        timestamp: '2026-03-16T00:00:03.500Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Both files were inspected.' }] },
        timestamp: '2026-03-16T00:00:04.000Z',
      }),
    ].join('\n') + '\n');

    try {
      await expect(loadTranscriptMessages(filePath)).resolves.toEqual([
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Inspect both files.' }],
        },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Checking both files.' },
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'read_file',
              arguments: { path: 'src/a.ts' },
            },
            {
              type: 'tool_call',
              id: 'call_2',
              name: 'read_file',
              arguments: { path: 'src/b.ts' },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              type: 'tool_result',
              toolCallId: 'call_1',
              name: 'read_file',
              output: 'export const a = 1;',
              isError: false,
            },
            {
              type: 'tool_result',
              toolCallId: 'call_2',
              name: 'read_file',
              output: 'export const b = 2;',
              isError: false,
            },
          ],
        },
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'Both files were inspected.' }],
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replays runtime compaction summaries as a system message before the retained transcript tail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cats-runtime-api-history-'));
    const filePath = join(dir, 'history.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({
        type: 'compaction_summary',
        text: 'Runtime compaction summary\n- Earlier user focus: repo cleanup\n- Earlier assistant outcomes: proposed a minimal patch',
        timestamp: '2026-03-24T01:00:00.000Z',
      }),
      JSON.stringify({
        type: 'user',
        message: { content: 'Continue from the compacted state.' },
        timestamp: '2026-03-24T01:00:01.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Continuing from the retained tail.' }] },
        timestamp: '2026-03-24T01:00:02.000Z',
      }),
    ].join('\n') + '\n');

    try {
      await expect(loadTranscriptMessages(filePath)).resolves.toEqual([
        {
          role: 'system',
          parts: [{
            type: 'text',
            text: 'Runtime compaction summary\n- Earlier user focus: repo cleanup\n- Earlier assistant outcomes: proposed a minimal patch',
          }],
        },
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Continue from the compacted state.' }],
        },
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'Continuing from the retained tail.' }],
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
