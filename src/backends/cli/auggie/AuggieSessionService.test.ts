import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuggieSessionService } from './AuggieSessionService.js';

describe('AuggieSessionService', () => {
  let sessionsDir = '';

  afterEach(async () => {
    if (sessionsDir) {
      await rm(sessionsDir, { recursive: true, force: true });
    }
  });

  it('filters saved sessions by overlapping workspace path', async () => {
    sessionsDir = await mkdtemp(join(tmpdir(), 'auggie-service-test-'));
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'auggie-1',
        created: '2026-03-10T00:00:00.000Z',
        modified: '2026-03-10T00:02:00.000Z',
        name: 'cats-runtime work',
        chatHistory: [
          {
            exchange: {
              request_message: 'Inspect cats-runtime',
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
            finishedAt: '2026-03-10T00:01:00.000Z',
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const service = new AuggieSessionService(sessionsDir);
    const sessions = await service.listSessions(
      'C:/Users/kenne/Source/SK2/one-man-digital-company/cats-runtime',
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      providerSessionId: 'auggie-1',
      cwd: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
      summary: 'cats-runtime work',
      messageCount: 1,
      exchangeCount: 1,
    });
  });

  it('loads conversation history from Auggie session JSON files', async () => {
    sessionsDir = await mkdtemp(join(tmpdir(), 'auggie-history-test-'));
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'auggie-1',
        created: '2026-03-10T00:00:00.000Z',
        modified: '2026-03-10T00:02:00.000Z',
        name: 'History test',
        chatHistory: [
          {
            exchange: {
              request_message: 'Review this repo',
              response_text: 'I will inspect the structure first.',
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
              response_nodes: [
                {
                  type: 0,
                  content: 'I will inspect the structure first.',
                  timestamp_ms: 1773100101020,
                },
              ],
            },
            finishedAt: '2026-03-10T00:01:00.000Z',
          },
          {
            exchange: {
              request_message: '',
              response_nodes: [
                {
                  type: 0,
                  content: 'I found the provider wiring gap.',
                  timestamp_ms: 1773100111020,
                },
              ],
            },
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const service = new AuggieSessionService(sessionsDir);
    const messages = await service.loadHistory({ providerSessionId: 'auggie-1' });

    expect(messages).toEqual([
      {
        role: 'user',
        text: 'Review this repo',
        timestamp: '2026-03-10T00:01:00.000Z',
      },
      {
        role: 'assistant',
        text: 'I will inspect the structure first.',
        timestamp: '2026-03-10T00:01:00.000Z',
      },
      {
        role: 'assistant',
        text: 'I found the provider wiring gap.',
        timestamp: '2026-03-09T23:48:31.020Z',
      },
    ]);
  });

});
