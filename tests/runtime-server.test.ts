import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/core/config.js';
import { createRuntimeServer } from '../src/server.js';

function createTestConfig(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-test-'));
  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    GEMINI_SESSIONS_DIR: join(root, '.gemini', 'tmp'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
  };

  for (const dir of [
    env.CATS_RUNTIME_SESSION_BASE_DIR,
    env.CATS_RUNTIME_DATA_DIR,
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.GEMINI_SESSIONS_DIR,
    join(root, 'data'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const config = {
    ...loadConfig(env),
    host: '127.0.0.1',
    port: 0,
    ...overrides,
  };

  return { config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function withRuntime(
  overrides: Record<string, unknown>,
  run: (address: { host: string; port: number }) => Promise<void>,
) {
  const { config, cleanup } = createTestConfig(overrides);
  const runtime = createRuntimeServer(config);
  try {
    const address = await runtime.start();
    await run(address);
  } finally {
    await runtime.close();
    cleanup();
  }
}

describe('runtime server', () => {
  it('GET / serves the embedded dashboard', async () => {
    await withRuntime({}, async (address) => {
      const response = await fetch(`http://${address.host}:${address.port}/`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('cats-runtime Dashboard');
      expect(html).toContain('cats-runtime');
    });
  });

  it('GET /health enforces optional inbound auth', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, async (address) => {
      const unauthenticated = await fetch(`http://${address.host}:${address.port}/health`);
      expect(unauthenticated.status).toBe(401);

      const authenticated = await fetch(
        `http://${address.host}:${address.port}/health`,
        {
          headers: { authorization: 'Bearer runtime-secret' },
        },
      );

      expect(authenticated.status).toBe(200);
      expect(await authenticated.json()).toEqual({
        service: 'cats-runtime',
        status: 'ok',
        version: '0.1.0',
        timestamp: expect.any(String),
      });
    });
  });

  it('GET /sessions returns the embedded registry state', async () => {
    await withRuntime({}, async (address) => {
      const response = await fetch(`http://${address.host}:${address.port}/sessions`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [],
        count: 0,
      });
    });
  });

  it('POST /sessions rejects unknown providers before spawning', async () => {
    await withRuntime({}, async (address) => {
      const response = await fetch(`http://${address.host}:${address.port}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'unknown-cli', cwd: 'C:/repo' }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toMatch(/Unknown provider 'unknown-cli'/);
    });
  });

  it('GET /kiro/models returns the local catalog without an upstream proxy', async () => {
    await withRuntime({ kiroRuntime: { mode: 'wsl' } }, async (address) => {
      const response = await fetch(`http://${address.host}:${address.port}/kiro/models`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        runtime: { mode: 'wsl' },
        source: 'static',
        models: ['claude-sonnet-4.5', 'deepseek-3.2', 'minimax-m2.1'],
      });
    });
  });
});
