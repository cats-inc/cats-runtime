import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  inspectRuntimeConfig,
  shouldEnterBootstrapMode,
  type ConfigInspection,
} from '../src/core/configInspection.js';
import { ProviderCompatibilityService } from '../src/core/compatibility/ProviderCompatibilityService.js';
import { loadConfig } from '../src/core/config.js';
import { createRuntimeServer } from '../src/server.js';
import {
  createRuntimeStartupState,
  parseRuntimeCliOptions,
  getRuntimeHelpText,
  getRuntimeOperationalStatus,
  RUNTIME_VERSION,
} from '../src/startup.js';
import { defaultWslDiscoveryPolicy } from '../src/backends/cli/config.js';
import {
  createRuntimeTestEnv,
  createRuntimeTestPaths,
  ensureRuntimeTestDirs,
} from './support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from './tempCleanup.js';

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-bootstrap-test-'));
  return {
    root,
    cleanup: () => cleanupTempDirWithRetries(root),
  };
}

function createTestEnv(root: string, configPath?: string): NodeJS.ProcessEnv {
  const paths = createRuntimeTestPaths(root);
  if (configPath) {
    throw new Error('createTestEnv no longer accepts configPath overrides; use CATS_RUNTIME_DIR');
  }
  return createRuntimeTestEnv(root, {
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
  });
}

async function waitForSetupScanToSettle(
  runtime: ReturnType<typeof createRuntimeServer>,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2400; attempt += 1) {
    const response = await runtime.app.request('/setup-state');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    if ((body.state as { status?: string } | undefined)?.status !== 'scanning') {
      return body;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error('setup scan never left the scanning state');
}

function ensureDirs(env: NodeJS.ProcessEnv): void {
  const paths = createRuntimeTestPaths(env.HOME || env.USERPROFILE || '');
  ensureRuntimeTestDirs(paths);
  for (const key of [
    'AUGGIE_SESSIONS_DIR',
    'CLAUDE_PROJECTS_DIR',
    'CODEX_SESSIONS_DIR',
    'COPILOT_SESSIONS_DIR',
    'CURSOR_CHATS_DIR',
    'PI_SESSIONS_DIR',
  ]) {
    if (env[key]) {
      mkdirSync(env[key]!, { recursive: true });
    }
  }
}

function createFastCompatibility(env: NodeJS.ProcessEnv): ProviderCompatibilityService {
  return new ProviderCompatibilityService(loadConfig(env), {
    runner: {
      run: async (providerName, _commandConfig, args) => ({
        exitCode: 0,
        stdout: args[0] === '--version'
          ? `${providerName} 1.0.0-test\n`
          : 'Usage: --help --version\n',
        stderr: '',
        timedOut: false,
        durationMs: 0,
      }),
    },
    installCheckRunner: {
      lookupCommand: async (command) => ({
        available: true,
        resolvedPath: `/runtime/bin/${command}`,
        timedOut: false,
      }),
      checkPath: async () => ({
        exists: true,
        timedOut: false,
      }),
      checkNpmPackage: async () => ({
        exists: true,
        timedOut: false,
      }),
      checkShellRcEntry: async () => ({
        exists: true,
        timedOut: false,
      }),
      getNpmPrefix: async () => ({
        value: process.platform === 'win32' ? undefined : '/runtime/.npm-global',
        timedOut: false,
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Config Inspection
// ---------------------------------------------------------------------------

describe('config inspection', () => {
  it('detects missing config file', () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      const result = inspectRuntimeConfig(env);
      expect(result.fileExists).toBe(false);
      expect(result.hasUsableTargets).toBe(false);
      expect(result.parsedProviderCount).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('detects invalid YAML config', () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      const configPath = createRuntimeTestPaths(root).configPath;
      mkdirSync(createRuntimeTestPaths(root).configDir, { recursive: true });
      writeFileSync(configPath, '{{{{not valid yaml', 'utf8');
      const result = inspectRuntimeConfig(env);
      expect(result.fileExists).toBe(true);
      expect(result.parseError).toBeTruthy();
      expect(result.hasUsableTargets).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('detects empty config with no providers', () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      const configPath = createRuntimeTestPaths(root).configPath;
      mkdirSync(createRuntimeTestPaths(root).configDir, { recursive: true });
      writeFileSync(configPath, 'providers: {}\n', 'utf8');
      const result = inspectRuntimeConfig(env);
      expect(result.fileExists).toBe(true);
      expect(result.parseError).toBeNull();
      expect(result.parsedProviderCount).toBe(0);
      expect(result.hasUsableTargets).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('detects valid config with usable targets', () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      const configPath = createRuntimeTestPaths(root).configPath;
      mkdirSync(createRuntimeTestPaths(root).configDir, { recursive: true });
      writeFileSync(configPath, 'version: 1\nbackends:\n  cli:\n    providers:\n      claude:\n        instances:\n          default:\n            command: claude\n            runner: auto\n', 'utf8');
      const result = inspectRuntimeConfig(env);
      expect(result.fileExists).toBe(true);
      expect(result.parseError).toBeNull();
      expect(result.parsedProviderCount).toBe(1);
      expect(result.hasUsableTargets).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Bootstrap Mode Decision
// ---------------------------------------------------------------------------

describe('shouldEnterBootstrapMode', () => {
  const baseInspection: ConfigInspection = {
    configPath: '/tmp/test/providers.yaml',
    fileExists: true,
    parseError: null,
    parsedProviderCount: 1,
    hasUsableTargets: true,
  };

  it('returns false for valid config with usable targets', () => {
    expect(shouldEnterBootstrapMode(baseInspection, false)).toBe(false);
  });

  it('returns true when --bootstrap is forced', () => {
    expect(shouldEnterBootstrapMode(baseInspection, true)).toBe(true);
  });

  it('returns true when config file is missing', () => {
    expect(shouldEnterBootstrapMode(
      { ...baseInspection, fileExists: false, hasUsableTargets: false },
      false,
    )).toBe(true);
  });

  it('returns true when config has parse error', () => {
    expect(shouldEnterBootstrapMode(
      { ...baseInspection, parseError: 'bad yaml', hasUsableTargets: false },
      false,
    )).toBe(true);
  });

  it('allows an explicitly empty provider selection', () => {
    expect(shouldEnterBootstrapMode(
      { ...baseInspection, parsedProviderCount: 0, hasUsableTargets: false },
      false,
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI Parsing
// ---------------------------------------------------------------------------

describe('--bootstrap CLI flag', () => {
  it('parses --bootstrap flag', () => {
    const options = parseRuntimeCliOptions(['--bootstrap']);
    expect(options.bootstrap).toBe(true);
  });

  it('parses --bootstrap with other flags', () => {
    const options = parseRuntimeCliOptions(['--bootstrap', '--port', '3210']);
    expect(options.bootstrap).toBe(true);
    expect(options.port).toBe('3210');
  });

  it('includes --bootstrap in help text', () => {
    const help = getRuntimeHelpText();
    expect(help).toContain('--bootstrap');
  });
});

// ---------------------------------------------------------------------------
// Startup State
// ---------------------------------------------------------------------------

describe('bootstrapRequired in startup state', () => {
  it('defaults to false', () => {
    const state = createRuntimeStartupState();
    expect(state.bootstrapRequired).toBe(false);
  });

  it('can be set to true', () => {
    const state = createRuntimeStartupState({ bootstrapRequired: true });
    expect(state.bootstrapRequired).toBe(true);
  });

  it('shows degraded status when bootstrap required and ready', () => {
    const state = createRuntimeStartupState({
      bootstrapRequired: true,
      phase: 'ready',
      ready: true,
    });
    const status = getRuntimeOperationalStatus(state);
    expect(status.status).toBe('degraded');
    expect(status.summary).toContain('bootstrap');
  });

  it('shows ok status when not in bootstrap and ready', () => {
    const state = createRuntimeStartupState({
      bootstrapRequired: false,
      phase: 'ready',
      ready: true,
    });
    const status = getRuntimeOperationalStatus(state);
    expect(status.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// WSL Default Policy
// ---------------------------------------------------------------------------

describe('WSL default discovery policy', () => {
  it('defaults to if_running', () => {
    expect(defaultWslDiscoveryPolicy()).toBe('if_running');
  });
});

// ---------------------------------------------------------------------------
// Bootstrap Server Integration
// ---------------------------------------------------------------------------

describe('selection-first bootstrap HTTP contract', () => {
  const runtimes: ReturnType<typeof createRuntimeServer>[] = [];
  const cleanups: Array<() => void> = [];
  afterEach(async () => {
    for (const runtime of runtimes.splice(0)) await runtime.close();
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  function fixture(apiKey = '') {
    const { root, cleanup } = createTestRoot();
    cleanups.push(cleanup);
    const env = createTestEnv(root);
    ensureDirs(env);
    const config = loadConfig(env);
    Object.assign(config, { host: '127.0.0.1', port: 0, apiKey });
    const runtime = createRuntimeServer(config, { startup: createRuntimeStartupState({ bootstrapRequired: true }),
      compatibility: createFastCompatibility(env) });
    runtimes.push(runtime);
    return { runtime, root, config, app: runtime.app };
  }
  function write(app: ReturnType<typeof createRuntimeServer>['app'], path: string, body: unknown, method = 'PUT', apiKey = '') {
    return app.request(path, { method, headers: { 'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify(body) });
  }

  it('exposes static choices before any provider is active', async () => {
    const { app } = fixture();
    const state = await (await app.request('/setup-state')).json();
    expect(state.selection).toMatchObject({ state: 'missing', targets: [], revision: 'missing' });
    expect(state.universe.length).toBeGreaterThan(16);
    expect(state.repair.status).toBe('selection_required');
    expect((await write(app, '/setup-scan', { manual: true }, 'POST')).status).toBe(409);
    for (const path of ['/', '/dashboard', '/playground']) {
      const response = await app.request(path);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/setup');
    }
  });

  it('saves empty intent, exits bootstrap, and remains idle after restart', async () => {
    const { app, runtime, root } = fixture();
    const saved = await write(app, '/setup-selection', { targets: [], expectedRevision: 'missing' });
    expect(saved.status).toBe(200);
    expect((await saved.json()).selection.state).toBe('empty');
    expect(runtime.context.startup.bootstrapRequired).toBe(false);
    expect((await app.request('/')).status).toBe(200);
    expect(shouldEnterBootstrapMode(inspectRuntimeConfig(createTestEnv(root)))).toBe(false);
    const config = await (await app.request('/providers/config')).json();
    expect(config.providers).toEqual({});
    expect((await write(app, '/setup-apply', { providers: ['claude'] }, 'POST')).status).toBe(404);
  });

  it('does not label a configuration response with a different selection revision', async () => {
    const { app, runtime } = fixture();
    const saved = await (await write(app, '/setup-selection', {
      targets: [{ provider: 'claude', backend: 'cli', instance: 'native' }], expectedRevision: 'missing',
    })).json();
    const inspect = vi.spyOn(runtime.context.providerModelCatalog, 'inspectSummary').mockImplementationOnce(() => {
      runtime.context.bootstrapService!.saveSelection([], saved.selection.revision);
      throw new Error('Target was removed while reading metadata');
    });
    expect((await app.request('/providers/config')).status).toBe(409);
    inspect.mockRestore();
    const current = await (await app.request('/providers/config')).json();
    expect(current.providers).toEqual({});
    expect(current.revision).not.toBe(saved.selection.revision);
  });

  it('saves missing and non-CLI providers without requiring an installed CLI', async () => {
    const { app } = fixture();
    const targets = [{ provider: 'claude', backend: 'cli', instance: 'native' },
      { provider: 'ollama', backend: 'local', instance: 'local' },
      { provider: 'openclaw', backend: 'agent', instance: 'gateway' }];
    const response = await write(app, '/setup-selection', { targets, expectedRevision: 'missing' });
    expect(response.status).toBe(200);
    const saved = (await response.json()).selection;
    expect(saved.targets).toEqual(targets);
    const state = await (await app.request('/setup-state')).json();
    expect(state.bootstrapRequired).toBe(false);
    expect(state.scan).toBeNull();
    expect((await write(app, '/setup-scan', { targets: [{ provider: 'codex', backend: 'cli', instance: 'native' }] }, 'POST')).status).toBe(400);
  });

  it('requires current revision and preserves edits on disk', async () => {
    const { app, root } = fixture();
    const saved = await (await write(app, '/setup-selection', { targets: [], expectedRevision: 'missing' })).json();
    const path = createRuntimeTestPaths(root).configPath;
    writeFileSync(path, 'version: 1\nbackends:\n  local:\n    providers:\n      ollama:\n        instances:\n          local: { transport: ollama }\n');
    expect((await write(app, '/setup-selection', { targets: [], expectedRevision: saved.selection.revision })).status).toBe(409);
    const reloaded = await write(app, '/setup-selection/reload', { expectedRevision: saved.selection.revision }, 'POST');
    expect(reloaded.status).toBe(200);
    expect((await reloaded.json()).selection.targets).toEqual([{ provider: 'ollama', backend: 'local', instance: 'local' }]);
  });

  it('returns retained observations consistently from saves, reads and configuration reloads', async () => {
    const { app, runtime, root } = fixture();
    const claude = { provider: 'claude', backend: 'cli', instance: 'native' };
    const codex = { provider: 'codex', backend: 'cli', instance: 'native' };
    const assessment = vi.spyOn(runtime.context.compatibility!, 'assessCliTarget').mockResolvedValue({
      setup: { command: { status: 'ready' }, version: {}, auth: { status: 'unknown' }, remediation: [] },
    } as never);
    const setupScan = vi.spyOn(runtime.context.bootstrapService!, 'scan');
    const first = await (await write(app, '/setup-selection', { targets: [claude], expectedRevision: 'missing' })).json();
    expect(first.observations).toEqual([]);
    expect((await write(app, '/setup-scan', { manual: true }, 'POST')).status).toBe(202);
    const detected = await waitForSetupScanToSettle(runtime);
    const savedResponse = await write(app, '/setup-selection', { targets: [claude, codex], expectedRevision: first.selection.revision });
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.observations).toEqual(detected.observations);
    expect(saved.observations).toEqual([expect.objectContaining({
      ...claude, available: true, configurationStatus: 'unchanged',
    })]);
    expect(saved.state.status).toBe('applied');
    expect(JSON.stringify(saved)).not.toContain('configurationFingerprint');
    const reread = await (await app.request('/setup-state')).json();
    expect(reread.observations).toEqual(saved.observations);
    expect(reread.repair.observationCoverage).toEqual({ observedCount: 1, notDetectedCount: 1, configurationChangedCount: 0 });
    const path = createRuntimeTestPaths(root).configPath;
    writeFileSync(path, readFileSync(path, 'utf8').replace('command: claude', 'command: changed-claude'));
    const reloadResponse = await write(app, '/setup-selection/reload', { expectedRevision: saved.selection.revision }, 'POST');
    expect(reloadResponse.status).toBe(200);
    const reloaded = await reloadResponse.json();
    expect(reloaded.observations).toEqual([expect.objectContaining({
      ...claude, configurationStatus: 'changed', observedAt: saved.observations[0].observedAt,
    })]);
    expect(JSON.stringify(reloaded)).not.toContain('configurationFingerprint');
    // Activation can prime scoped compatibility diagnostics, but saves/reads
    // must not run another bootstrap scan or replace the retained observation.
    expect(setupScan).toHaveBeenCalledTimes(1);
    expect(setupScan).toHaveBeenCalledWith({ manual: true, targets: undefined, expectedRevision: undefined, includeConnections: false });
    setupScan.mockRestore();
    assessment.mockRestore();
  });

  it('blocks target removal during an admitted helper, then allows it after release', async () => {
    const { app } = fixture();
    const target = { provider: 'ollama', backend: 'local', instance: 'local' };
    const saved = await (await write(app, '/setup-selection', { targets: [target], expectedRevision: 'missing' })).json();
    const operation = await (await write(app, '/setup-operations', { target, expectedRevision: saved.selection.revision }, 'POST')).json();
    expect((await write(app, '/setup-selection', { targets: [], expectedRevision: saved.selection.revision })).status).toBe(409);
    expect((await app.request('/setup-operations/' + operation.operationId, { method: 'DELETE' })).status).toBe(204);
    expect((await write(app, '/setup-selection', { targets: [], expectedRevision: saved.selection.revision })).status).toBe(200);
  });

  it('requires bearer auth for setup reads, writes, scans, reloads, and helper admission', async () => {
    const { app } = fixture('test-secret');
    expect((await app.request('/setup-state')).status).toBe(401);
    for (const [method, path] of [['PUT', '/setup-selection'], ['POST', '/setup-scan'],
      ['POST', '/setup-selection/reload'], ['POST', '/setup-operations'], ['DELETE', '/setup-operations/id']]) {
      expect((await write(app, path!, {}, method!)).status).toBe(401);
    }
    expect((await write(app, '/setup-selection', { targets: [], expectedRevision: 'missing' }, 'PUT', 'test-secret')).status).toBe(200);
  });

  it('returns 202 before a selected scan finishes and exposes the final scoped observation', async () => {
    const { app, runtime } = fixture();
    await write(app, '/setup-selection', { targets: [{ provider: 'claude', backend: 'cli', instance: 'native' }], expectedRevision: 'missing' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const assessment = vi.spyOn(runtime.context.compatibility!, 'assessCliTarget').mockImplementation(async () => {
      await gate;
      return { setup: { command: { status: 'missing_install' }, version: {}, auth: { status: 'unknown' }, remediation: [] } } as never;
    });
    const scan = await write(app, '/setup-scan', { manual: true }, 'POST');
    expect(scan.status).toBe(202);
    const started = await scan.json();
    expect(started.state.status).toBe('scanning');
    expect(started.scanId).toEqual(expect.any(String));
    expect(started.state.scanId).toBe(started.scanId);
    expect((await write(app, '/setup-scan', { manual: true, expectedRevision: 'stale' }, 'POST')).status).toBe(409);
    release();
    const state = await waitForSetupScanToSettle(runtime);
    expect((state.scan as { providers: unknown[] }).providers).toHaveLength(1);
    expect((state.selection as { targets: unknown[] }).targets).toHaveLength(1);
    assessment.mockRestore();
  });
});
