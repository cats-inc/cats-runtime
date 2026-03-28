import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GooseNativeSessionService } from './GooseNativeSessionService.js';

describe('GooseNativeSessionService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('uses session ids from Goose JSON exports and skips stale indexed sessions', async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.join(' ') === 'session list --format json') {
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              id: '20260328_1',
              name: 'Model',
              working_dir: 'C:/repo',
              updated_at: '2026-03-28T06:26:10Z',
              message_count: 4,
              model_config: {
                model_name: 'gpt-5.2-codex',
              },
            },
            {
              id: 'stale_1',
              name: 'Stale',
              working_dir: 'C:/repo',
              updated_at: '2026-03-28T06:20:00Z',
              message_count: 1,
            },
          ]),
          stderr: '',
        };
      }

      if (args.join(' ') === 'session export --session-id 20260328_1 --format json') {
        return {
          code: 0,
          stdout: JSON.stringify({
            id: '20260328_1',
            name: 'Model',
            working_dir: 'C:/repo',
            updated_at: '2026-03-28T06:26:10Z',
            message_count: 4,
            model_config: {
              model_name: 'gpt-5.2-codex',
            },
            conversation: [
              {
                role: 'user',
                created: 1774679162,
                content: [{ type: 'text', text: 'model' }],
              },
              {
                role: 'assistant',
                created: 1774679169,
                content: [{ type: 'text', text: 'Ready for your task details.' }],
              },
            ],
          }),
          stderr: '',
        };
      }

      if (
        args.join(' ') === 'session export --session-id stale_1 --format json'
        || args.join(' ') === 'session export --name stale_1 --format json'
      ) {
        return {
          code: 1,
          stdout: '',
          stderr: 'Session not found',
        };
      }

      return {
        code: 1,
        stdout: '',
        stderr: `Unexpected goose invocation: ${args.join(' ')}`,
      };
    });

    const service = new GooseNativeSessionService({
      command: 'goose',
      runner,
    });

    await expect(service.listAllSessions()).resolves.toEqual([
      {
        providerSessionId: '20260328_1',
        cwd: 'C:/repo',
        summary: 'model',
        messageCount: 4,
        lastActivity: '2026-03-28T06:26:10Z',
        model: 'gpt-5.2-codex',
      },
    ]);
  });

  it('prunes Goose project indexes after deleting a session by display name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-goose-delete-'));
    tempDirs.push(root);
    const sessionDbPath = join(root, 'sessions.db');
    const projectsIndexPath = join(root, 'projects.json');
    writeFileSync(sessionDbPath, '');
    writeFileSync(projectsIndexPath, `${JSON.stringify({
      projects: {
        repo: {
          path: 'C:/repo',
          last_session_id: '20260328_1',
          last_instruction: 'model',
        },
      },
    }, null, 2)}\n`, 'utf8');

    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.join(' ') === 'session list --format json') {
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              id: '20260328_1',
              name: 'Model',
              working_dir: 'C:/repo',
            },
          ]),
          stderr: '',
        };
      }

      if (args.includes('-c')) {
        return {
          code: 0,
          stdout: JSON.stringify({ deleted: true }),
          stderr: '',
        };
      }

      if (args[0] === 'session' && args[1] === 'export') {
        return {
          code: 1,
          stdout: '',
          stderr: 'Session not found',
        };
      }

      return {
        code: 1,
        stdout: '',
        stderr: `Unexpected goose invocation: ${args.join(' ')}`,
      };
    });

    const service = new GooseNativeSessionService({
      command: 'goose',
      runner,
      sessionDbPath,
      projectsIndexPath,
    });

    await expect(service.deleteSession('C:/repo', 'Model')).resolves.toBe(true);

    const projects = JSON.parse(readFileSync(projectsIndexPath, 'utf8')) as {
      projects: Record<string, { path: string; last_session_id: string | null; last_instruction: string | null }>;
    };
    expect(projects.projects.repo).toEqual({
      path: 'C:/repo',
      last_session_id: null,
      last_instruction: null,
    });
  });
});
