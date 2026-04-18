import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GooseNativeSessionService } from './GooseNativeSessionService.js';

function createGooseSessionsDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      working_dir TEXT NOT NULL,
      thread_id TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE thread_messages (
      id INTEGER PRIMARY KEY,
      thread_id TEXT NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL
    );
  `);
  return db;
}

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
    const projectsIndexPath = join(root, 'projects.json');
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

      if (args.join(' ') === 'session remove --session-id 20260328_1') {
        return {
          code: 0,
          stdout: '',
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
    expect(runner).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['-c']));
  });

  it('falls back to Goose name-based removal when the session list cannot resolve an id', async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.join(' ') === 'session list --format json') {
        return {
          code: 1,
          stdout: '',
          stderr: 'unsupported',
        };
      }

      if (args.join(' ') === 'session remove --session-id Model') {
        return {
          code: 1,
          stdout: '',
          stderr: 'Session ID not found',
        };
      }

      if (args.join(' ') === 'session remove --name Model') {
        return {
          code: 0,
          stdout: '',
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
    });

    await expect(service.deleteSession('C:/repo', 'Model')).resolves.toBe(true);
  });

  it('resolves the exported Goose session id for index pruning when list discovery is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-goose-delete-export-'));
    tempDirs.push(root);
    const projectsIndexPath = join(root, 'projects.json');
    writeFileSync(projectsIndexPath, `${JSON.stringify({
      projects: {
        repo: {
          path: 'C:/repo',
          last_session_id: '20260328_1',
          last_instruction: 'model',
        },
      },
    }, null, 2)}\n`, 'utf8');

    let deleted = false;
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.join(' ') === 'session list --format json') {
        return {
          code: 1,
          stdout: '',
          stderr: 'unsupported',
        };
      }

      if (
        args.join(' ') === 'session export --session-id Model --format json'
        || args.join(' ') === 'session export --name Model --format json'
      ) {
        if (deleted) {
          return {
            code: 1,
            stdout: '',
            stderr: 'Session not found',
          };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            id: '20260328_1',
            name: 'Model',
            working_dir: 'C:/repo',
            conversation: [],
          }),
          stderr: '',
        };
      }

      if (args.join(' ') === 'session remove --session-id 20260328_1') {
        deleted = true;
        return {
          code: 0,
          stdout: '',
          stderr: '',
        };
      }

      if (
        args.join(' ') === 'session export --session-id 20260328_1 --format json'
        || args.join(' ') === 'session export --name 20260328_1 --format json'
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
    expect(runner).toHaveBeenCalledWith('goose', ['session', 'remove', '--session-id', '20260328_1']);
  });

  it('falls back to direct sqlite delete when Goose CLI aborts with the TTY bug', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-goose-fallback-'));
    tempDirs.push(root);
    const sessionDbPath = join(root, 'sessions.db');
    const projectsIndexPath = join(root, 'projects.json');

    const setup = createGooseSessionsDb(sessionDbPath);
    setup.prepare('INSERT INTO sessions(id, name, working_dir, thread_id) VALUES (?, ?, ?, ?)')
      .run('20260317_1', 'CLI Session', 'C:/repo', null);
    setup.prepare('INSERT INTO sessions(id, name, working_dir, thread_id) VALUES (?, ?, ?, ?)')
      .run('20260414_2', 'CLI Session', 'C:/repo', null);
    setup.prepare('INSERT INTO messages(session_id, role, content_json) VALUES (?, ?, ?)')
      .run('20260317_1', 'user', '{}');
    setup.close();

    writeFileSync(projectsIndexPath, `${JSON.stringify({
      projects: {
        repo: {
          path: 'C:/repo',
          last_session_id: '20260317_1',
          last_instruction: 'hello',
        },
      },
    }, null, 2)}\n`, 'utf8');

    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.join(' ') === 'session list --format json') {
        return {
          code: 0,
          stdout: JSON.stringify([
            { id: '20260317_1', name: 'CLI Session', working_dir: 'C:/repo' },
            { id: '20260414_2', name: 'CLI Session', working_dir: 'C:/repo' },
          ]),
          stderr: '',
        };
      }

      if (args.join(' ') === 'session remove --session-id 20260317_1') {
        // Reproduce Goose 1.31.0's TTY bug.
        return {
          code: 1,
          stdout: 'The following sessions will be removed:\n- 20260317_1 CLI Session\n',
          stderr: 'Error: not connected',
        };
      }

      if (args[0] === 'session' && args[1] === 'export') {
        return { code: 1, stdout: '', stderr: 'Session not found' };
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

    await expect(service.deleteSession('C:/repo', '20260317_1')).resolves.toBe(true);

    const verifyDb = new DatabaseSync(sessionDbPath);
    const remainingIds = (verifyDb.prepare('SELECT id FROM sessions ORDER BY id').all() as Array<{ id: string }>)
      .map((row) => row.id);
    const remainingMessages = (verifyDb.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
    verifyDb.close();
    expect(remainingIds).toEqual(['20260414_2']);
    expect(remainingMessages).toBe(0);

    const projects = JSON.parse(readFileSync(projectsIndexPath, 'utf8')) as {
      projects: Record<string, { path: string; last_session_id: string | null; last_instruction: string | null }>;
    };
    expect(projects.projects.repo).toEqual({
      path: 'C:/repo',
      last_session_id: null,
      last_instruction: null,
    });
  });

  it('preserves other sessions when the deleted session shares a thread', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-goose-thread-'));
    tempDirs.push(root);
    const sessionDbPath = join(root, 'sessions.db');

    const setup = createGooseSessionsDb(sessionDbPath);
    setup.prepare('INSERT INTO threads(id, name) VALUES (?, ?)').run('thread_a', 'Thread A');
    setup.prepare('INSERT INTO threads(id, name) VALUES (?, ?)').run('thread_b', 'Thread B');
    setup.prepare('INSERT INTO sessions(id, name, working_dir, thread_id) VALUES (?, ?, ?, ?)')
      .run('solo', 'CLI Session', 'C:/repo', 'thread_a');
    setup.prepare('INSERT INTO sessions(id, name, working_dir, thread_id) VALUES (?, ?, ?, ?)')
      .run('shared1', 'CLI Session', 'C:/repo', 'thread_b');
    setup.prepare('INSERT INTO sessions(id, name, working_dir, thread_id) VALUES (?, ?, ?, ?)')
      .run('shared2', 'CLI Session', 'C:/repo', 'thread_b');
    setup.prepare('INSERT INTO thread_messages(thread_id, session_id, role, content_json) VALUES (?, ?, ?, ?)')
      .run('thread_a', 'solo', 'user', '{"text":"solo-only"}');
    setup.prepare('INSERT INTO thread_messages(thread_id, session_id, role, content_json) VALUES (?, ?, ?, ?)')
      .run('thread_b', 'shared1', 'user', '{"text":"shared1-only"}');
    setup.prepare('INSERT INTO thread_messages(thread_id, session_id, role, content_json) VALUES (?, ?, ?, ?)')
      .run('thread_b', 'shared2', 'user', '{"text":"shared2-only"}');
    setup.prepare('INSERT INTO thread_messages(thread_id, session_id, role, content_json) VALUES (?, ?, ?, ?)')
      .run('thread_b', null, 'system', '{"text":"thread-scoped"}');
    setup.close();

    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.join(' ') === 'session list --format json') {
        return { code: 0, stdout: '[]', stderr: '' };
      }
      if (args[0] === 'session' && args[1] === 'remove') {
        return { code: 1, stdout: '', stderr: 'Error: not connected' };
      }
      if (args[0] === 'session' && args[1] === 'export') {
        return { code: 1, stdout: '', stderr: 'Session not found' };
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
    });

    await expect(service.deleteSession('C:/repo', 'solo')).resolves.toBe(true);

    let verifyDb = new DatabaseSync(sessionDbPath);
    let threads = (verifyDb.prepare('SELECT id FROM threads ORDER BY id').all() as Array<{ id: string }>)
      .map((row) => row.id);
    let threadMsgs = (verifyDb.prepare('SELECT thread_id, session_id FROM thread_messages ORDER BY thread_id, session_id').all() as Array<{ thread_id: string; session_id: string | null }>);
    verifyDb.close();
    expect(threads).toEqual(['thread_b']);
    expect(threadMsgs).toEqual([
      { thread_id: 'thread_b', session_id: null },
      { thread_id: 'thread_b', session_id: 'shared1' },
      { thread_id: 'thread_b', session_id: 'shared2' },
    ]);

    await expect(service.deleteSession('C:/repo', 'shared1')).resolves.toBe(true);

    verifyDb = new DatabaseSync(sessionDbPath);
    const survivingSessions = (verifyDb.prepare('SELECT id FROM sessions ORDER BY id').all() as Array<{ id: string }>)
      .map((row) => row.id);
    threads = (verifyDb.prepare('SELECT id FROM threads ORDER BY id').all() as Array<{ id: string }>)
      .map((row) => row.id);
    threadMsgs = (verifyDb.prepare('SELECT thread_id, session_id FROM thread_messages ORDER BY thread_id, session_id').all() as Array<{ thread_id: string; session_id: string | null }>);
    verifyDb.close();
    expect(survivingSessions).toEqual(['shared2']);
    expect(threads).toEqual(['thread_b']);
    expect(threadMsgs).toEqual([
      { thread_id: 'thread_b', session_id: null },
      { thread_id: 'thread_b', session_id: 'shared2' },
    ]);

    await expect(service.deleteSession('C:/repo', 'shared2')).resolves.toBe(true);

    verifyDb = new DatabaseSync(sessionDbPath);
    threads = (verifyDb.prepare('SELECT id FROM threads ORDER BY id').all() as Array<{ id: string }>)
      .map((row) => row.id);
    threadMsgs = (verifyDb.prepare('SELECT thread_id, session_id FROM thread_messages').all() as Array<{ thread_id: string; session_id: string | null }>);
    verifyDb.close();
    expect(threads).toEqual([]);
    expect(threadMsgs).toEqual([]);
  });

  it('reports success when the fallback runs against an already-clean sessions.db', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-goose-idempotent-'));
    tempDirs.push(root);
    const sessionDbPath = join(root, 'sessions.db');
    createGooseSessionsDb(sessionDbPath).close();

    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.join(' ') === 'session list --format json') {
        return { code: 0, stdout: '[]', stderr: '' };
      }
      if (args[0] === 'session' && args[1] === 'remove') {
        return { code: 1, stdout: '', stderr: 'Error: not connected' };
      }
      if (args[0] === 'session' && args[1] === 'export') {
        return { code: 1, stdout: '', stderr: 'Session not found' };
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
    });

    await expect(service.deleteSession('C:/repo', 'never_existed')).resolves.toBe(true);
  });
});
