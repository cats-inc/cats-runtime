import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadConfig } from '../dist/core/config.js';
import { createRuntimeServer } from '../dist/server.js';

function createTestConfig(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-test-'));
  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
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

async function withRuntime(overrides, run) {
  const { config, cleanup } = createTestConfig(overrides);
  const runtime = createRuntimeServer(config);
  try {
    const address = await runtime.start();
    await run(address, runtime);
  } finally {
    await runtime.close();
    cleanup();
  }
}

test('GET /health enforces optional inbound auth', async () => {
  await withRuntime({ apiKey: 'runtime-secret' }, async (address) => {
    const unauthenticated = await fetch(`http://${address.host}:${address.port}/health`);
    assert.equal(unauthenticated.status, 401);

    const authenticated = await fetch(
      `http://${address.host}:${address.port}/health`,
      {
        headers: { authorization: 'Bearer runtime-secret' },
      },
    );

    assert.equal(authenticated.status, 200);
    const payload = await authenticated.json();
    assert.equal(payload.service, 'cats-runtime');
    assert.equal(payload.status, 'ok');
    assert.equal(payload.version, '0.1.0');
    assert.equal(typeof payload.timestamp, 'string');
  });
});

test('GET /sessions returns the embedded registry state', async () => {
  await withRuntime({}, async (address) => {
    const response = await fetch(`http://${address.host}:${address.port}/sessions`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sessions: [],
      count: 0,
    });
  });
});

test('POST /sessions rejects unknown providers before spawning', async () => {
  await withRuntime({}, async (address) => {
    const response = await fetch(`http://${address.host}:${address.port}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'unknown-cli', cwd: 'C:/repo' }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /Unknown provider 'unknown-cli'/);
  });
});

test('GET /kiro/models returns the local catalog without an upstream proxy', async () => {
  await withRuntime({ kiroRuntime: { mode: 'wsl' } }, async (address) => {
    const response = await fetch(`http://${address.host}:${address.port}/kiro/models`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      runtime: { mode: 'wsl' },
      source: 'static',
      models: ['claude-sonnet-4.5', 'deepseek-3.2', 'minimax-m2.1'],
    });
  });
});
