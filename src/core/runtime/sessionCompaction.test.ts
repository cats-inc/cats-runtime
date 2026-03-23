import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compactRuntimeManagedTranscript } from './sessionCompaction.js';

describe('compactRuntimeManagedTranscript', () => {
  it('repairs malformed transcript lines, archives the repaired transcript, and aggressively compacts older entries', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-compaction-'));
    const sessionBaseDir = join(rootDir, 'sessions');
    const transcriptPath = join(sessionBaseDir, 'history', 'session-1.jsonl');
    mkdirSync(join(sessionBaseDir, 'history'), { recursive: true });

    writeFileSync(transcriptPath, [
      JSON.stringify({
        type: 'user',
        message: { content: 'Need a repo health check.' },
        timestamp: '2026-03-24T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Starting with Git status.' }] },
        timestamp: '2026-03-24T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'tool_use',
        toolId: 'tool-1',
        toolName: 'inspect-repo-status',
        arguments: { path: '.' },
        timestamp: '2026-03-24T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'tool_result',
        toolId: 'tool-1',
        toolName: 'inspect-repo-status',
        text: 'dirty worktree',
        timestamp: '2026-03-24T00:00:03.000Z',
      }),
      'not-json-at-all',
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Starting with Git status.' }] },
        timestamp: '2026-03-24T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'user',
        message: { content: 'Now prepare a cleanup plan.' },
        timestamp: '2026-03-24T00:00:04.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Plan drafted with minimal steps.' }] },
        timestamp: '2026-03-24T00:00:05.000Z',
      }),
      JSON.stringify({
        type: 'user',
        message: { content: 'Re-run after fixing the merge conflict.' },
        timestamp: '2026-03-24T00:00:06.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Retrying after the conflict was resolved.' }] },
        timestamp: '2026-03-24T00:00:07.000Z',
      }),
    ].join('\n') + '\n', 'utf8');

    try {
      const result = compactRuntimeManagedTranscript({
        sessionId: 'session-1',
        session: {
          sourcePath: transcriptPath,
          messageCount: 40,
          totalInputTokens: 9_000,
          totalOutputTokens: 5_000,
        },
        sessionBaseDir,
        now: new Date('2026-03-24T01:00:00.000Z'),
      });

      expect(result).toBeDefined();
      expect(result?.record).toEqual(expect.objectContaining({
        baselineMessageCount: 40,
        baselineTotalTokens: 14_000,
        repairedLineCount: 1,
        compactedEntryCount: expect.any(Number),
        retainedEntryCount: expect.any(Number),
        aggressivePassCount: expect.any(Number),
        archivePath: expect.any(String),
      }));
      expect(result?.record.compactedEntryCount).toBeGreaterThan(0);
      expect(result?.record.retainedEntryCount).toBeLessThan(8);
      expect(result?.summaryText).toContain('Runtime compaction summary');
      expect(existsSync(result!.record.archivePath!)).toBe(true);

      const archiveContent = readFileSync(result!.record.archivePath!, 'utf8');
      expect(archiveContent).not.toContain('not-json-at-all');

      const compactedContent = readFileSync(transcriptPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(compactedContent[0]).toEqual(expect.objectContaining({
        type: 'compaction_summary',
        text: expect.stringContaining('Earlier user focus'),
      }));
      expect(compactedContent.length).toBeLessThan(archiveContent.trim().split('\n').length);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
