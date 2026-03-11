import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { AuggieSessionService } from '../auggie/AuggieSessionService.js';
import { AuggieSessionScanner } from './AuggieSessionScanner.js';

describe('AuggieSessionScanner', () => {
  let sessionsDir = '';

  afterEach(async () => {
    if (sessionsDir) {
      await rm(sessionsDir, { recursive: true, force: true });
    }
  });

  it('discovers saved Auggie sessions from ~/.augment/sessions-style JSON files', async () => {
    sessionsDir = await mkdtemp(join(tmpdir(), 'auggie-scan-test-'));
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'auggie-1',
        created: '2026-03-10T00:00:00.000Z',
        modified: '2026-03-10T00:01:00.000Z',
        name: 'Repo review',
        agentState: {
          modelId: 'gpt-5-4',
        },
        chatHistory: [
          {
            exchange: {
              request_message: 'Review this repo',
              request_nodes: [
                {
                  ide_state_node: {
                    workspace_folders: [
                      {
                        folder_root: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const scanner = new AuggieSessionScanner(new AuggieSessionService(sessionsDir));
    const result = await scanner.scan();

    expect(result).toEqual([
      {
        providerSessionId: 'auggie-1',
        projectPath: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
        sourcePath: join(sessionsDir, 'session-1.json'),
        cwd: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
        summary: 'Repo review',
        messageCount: 1,
        lastActivity: '2026-03-10T00:01:00.000Z',
        model: 'gpt5.4',
      },
    ]);
  });
});
