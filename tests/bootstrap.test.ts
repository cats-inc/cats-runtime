import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  inspectRuntimeConfig,
  shouldEnterBootstrapMode,
  type ConfigInspection,
} from '../src/core/configInspection.js';
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

function createTestRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cats-bootstrap-test-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createTestEnv(root: string, configPath?: string): NodeJS.ProcessEnv {
  return {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: configPath ?? join(root, 'config', 'providers.yaml'),
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
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
  };
}

function ensureDirs(env: NodeJS.ProcessEnv): void {
  for (const key of [
    'CATS_RUNTIME_SESSION_BASE_DIR',
    'CATS_RUNTIME_DATA_DIR',
    'AUGGIE_SESSIONS_DIR',
    'CLAUDE_PROJECTS_DIR',
    'CODEX_SESSIONS_DIR',
    'COPILOT_SESSIONS_DIR',
    'CURSOR_CHATS_DIR',
    'GEMINI_SESSIONS_DIR',
    'PI_SESSIONS_DIR',
  ]) {
    if (env[key]) {
      mkdirSync(env[key]!, { recursive: true });
    }
  }
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
      const configPath = env.CATS_RUNTIME_CONFIG_PATH!;
      mkdirSync(join(root, 'config'), { recursive: true });
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
      const configPath = env.CATS_RUNTIME_CONFIG_PATH!;
      mkdirSync(join(root, 'config'), { recursive: true });
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
      const configPath = env.CATS_RUNTIME_CONFIG_PATH!;
      mkdirSync(join(root, 'config'), { recursive: true });
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

  it('returns true when config has no usable targets', () => {
    expect(shouldEnterBootstrapMode(
      { ...baseInspection, parsedProviderCount: 0, hasUsableTargets: false },
      false,
    )).toBe(true);
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

describe('bootstrap mode server', () => {
  it('GET / serves provider setup page in bootstrap mode', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/');
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('Provider Setup');
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /dashboard always serves the dashboard', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/dashboard');
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('Cats Runtime Dashboard');
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('session routes return 409 in bootstrap mode', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/sessions', { method: 'GET' });
        expect(response.status).toBe(409);
        const body = await response.json() as Record<string, unknown>;
        expect(body.error).toBe('runtime_bootstrap_required');
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /providers/setup/state returns bootstrap state', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/providers/setup/state');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(body.bootstrapRequired).toBe(true);
        expect(body.state).toBeTruthy();
        expect(body.universe).toBeTruthy();
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('BootstrapService scan persists artifacts', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const dataDir = env.CATS_RUNTIME_DATA_DIR!;
      const configPath = join(root, 'config', 'providers.yaml');
      const config = loadConfig(env);
      // Use a stub compatibility service that returns fast
      const { ProviderCompatibilityService } = await import(
        '../src/core/compatibility/ProviderCompatibilityService.js'
      );
      const compatibility = new ProviderCompatibilityService(config, {
        runner: {
          run: async () => ({
            exitCode: null, stdout: '', stderr: '',
            timedOut: false, durationMs: 0,
            error: 'Stub for test.',
          }),
        },
        installCheckRunner: {
          lookupCommand: async () => ({ available: false, timedOut: false }),
          checkPath: async () => ({ exists: false, timedOut: false }),
          checkNpmPackage: async () => ({ exists: false, timedOut: false }),
          checkShellRcEntry: async () => ({ exists: false, timedOut: false }),
          getNpmPrefix: async () => ({ value: undefined, timedOut: false }),
        },
      });
      const { BootstrapService } = await import(
        '../src/core/bootstrap/BootstrapService.js'
      );
      const bootstrap = new BootstrapService({
        dataDir,
        configPath,
        config,
        compatibility,
      });

      const result = await bootstrap.scan({ manual: true });
      expect(result.scanType).toBe('manual');
      expect(result.providers.length).toBeGreaterThan(0);

      const scanPath = join(dataDir, 'setup', 'provider-scan.json');
      expect(existsSync(scanPath)).toBe(true);
      const manualScanPath = join(dataDir, 'setup', 'provider-manual-scan.json');
      expect(existsSync(manualScanPath)).toBe(true);

      const state = await bootstrap.getSetupState();
      expect(state.status).toBe('ready');
      expect(state.lastScanAt).toBeTruthy();
      expect(state.lastManualScanAt).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it('POST /providers/setup/apply writes config and exits bootstrap mode', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const configPath = env.CATS_RUNTIME_CONFIG_PATH!;
      mkdirSync(join(root, 'config'), { recursive: true });
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0, configPath };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        // Apply with claude selected
        const response = await runtime.app.request('/providers/setup/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providers: ['claude'] }),
        });
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(body.status).toBe('applied');
        expect(body.bootstrapRequired).toBe(false);
        expect(body.restart).toBe(false);

        // Verify config file written
        expect(existsSync(configPath)).toBe(true);
        const yaml = readFileSync(configPath, 'utf8');
        expect(yaml).toContain('claude');

        // Verify bootstrap mode exited
        expect(startup.bootstrapRequired).toBe(false);

        // Session routes should now work (not 409)
        const sessionResponse = await runtime.app.request('/sessions', { method: 'GET' });
        expect(sessionResponse.status).not.toBe(409);

        // /providers/config should reflect the reloaded topology (only claude)
        const configResponse = await runtime.app.request('/providers/config');
        expect(configResponse.status).toBe(200);
        const configBody = await configResponse.json() as { providers: Record<string, unknown> };
        expect(configBody.providers).toHaveProperty('claude');
        // Providers NOT selected should not appear in the reloaded config
        expect(configBody.providers).not.toHaveProperty('codex');
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /health reflects bootstrap mode', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/health');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        const startupState = body.startup as Record<string, unknown>;
        expect(startupState.bootstrapRequired).toBe(true);
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('valid config does not enter bootstrap mode', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const configPath = env.CATS_RUNTIME_CONFIG_PATH!;
      mkdirSync(join(root, 'config'), { recursive: true });
      writeFileSync(configPath, 'version: 1\nbackends:\n  cli:\n    providers:\n      claude:\n        instances:\n          default:\n            command: claude\n            runner: auto\n', 'utf8');
      const inspection = inspectRuntimeConfig(env);
      expect(shouldEnterBootstrapMode(inspection, false)).toBe(false);
    } finally {
      cleanup();
    }
  });
});
