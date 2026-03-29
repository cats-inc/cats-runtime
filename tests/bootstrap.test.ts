import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
        expect(html).toContain('id="providerCapabilityPreview"');
        expect(html).toContain('id="chatSessionInsights"');
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

  it('GET /setup-state returns bootstrap state', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/setup-state');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(body.bootstrapRequired).toBe(true);
        expect(body.state).toBeTruthy();
        expect(body.universe).toBeTruthy();
        expect(body.repair).toEqual(expect.objectContaining({
          status: 'scan_required',
          nextAction: expect.objectContaining({
            kind: 'run_manual_scan',
            path: '/setup-scan',
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'run_manual_scan',
              path: '/setup-scan',
              body: {
                manual: true,
              },
            }),
            expect.objectContaining({
              kind: 'generate_setup_report',
              path: '/diagnostics/setup-report',
              body: {
                refreshScan: true,
              },
            }),
          ]),
        }));
        expect(body.diagnostics).toEqual({
          latestReport: null,
        });
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('setup routes require auth when apiKey is set, even in bootstrap mode', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0, apiKey: 'test-secret' };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        // Unauthenticated — should get 401 even in bootstrap mode
        const unauthRes = await runtime.app.request('/setup-state');
        expect(unauthRes.status).toBe(401);

        // Authenticated — should get 200
        const authRes = await runtime.app.request('/setup-state', {
          headers: { 'Authorization': 'Bearer test-secret' },
        });
        expect(authRes.status).toBe(200);
        const body = await authRes.json() as Record<string, unknown>;
        expect(body.bootstrapRequired).toBe(true);

        // Setup page HTML is served before auth middleware, so it's always accessible
        const pageRes = await runtime.app.request('/setup');
        expect(pageRes.status).toBe(200);
        const html = await pageRes.text();
        expect(html).toContain('apiKeyInput');
        expect(html).toContain('validateApiKeyInput');
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

  it('POST /setup-apply writes config and exits bootstrap mode', async () => {
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
        const response = await runtime.app.request('/setup-apply', {
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

  it('POST /setup-apply stays in bootstrap mode when config reload fails', async () => {
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
        if (!runtime.context.bootstrapService) {
          throw new Error('Bootstrap service missing for test');
        }
        runtime.context.bootstrapService.applyConfig = async () => {
          writeFileSync(configPath, [
            'version: 1',
            'environments:',
            '  native:',
            '    kind: native',
            'backends:',
            '  cli:',
            '    providers:',
            '      claude:',
            '        instances:',
            '          default:',
            '            environment: native',
            '            command: claude',
            '            runner: auto',
            '            projects_dir: /native/claude/projects',
            '  api:',
            '    providers:',
            '      claude:',
            '        instances:',
            '          sonnet:',
            '            transport: anthropic',
            '            api_key_env: ANTHROPIC_API_KEY',
            '            model: claude-sonnet-4-6',
            '',
          ].join('\n'), 'utf8');
          return { configPath };
        };

        const response = await runtime.app.request('/setup-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providers: ['claude'] }),
        });
        expect(response.status).toBe(500);
        const body = await response.json() as Record<string, unknown>;
        expect(String(body.error)).toContain('configured in multiple backends');
        expect(startup.bootstrapRequired).toBe(true);

        const sessionResponse = await runtime.app.request('/sessions', { method: 'GET' });
        expect(sessionResponse.status).toBe(409);
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

  it('GET /setup-state includes full scan.providers after a scan', { timeout: 60_000 }, async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, {
        startup,
        compatibility: createFastCompatibility(env),
      });
      try {
        // Run a scan first
        await runtime.app.request('/setup-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manual: false }),
        });

        // Now check state
        const response = await runtime.app.request('/setup-state');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        const scan = body.scan as Record<string, unknown>;
        expect(scan).toBeTruthy();
        expect(Array.isArray(scan.providers)).toBe(true);
        expect((scan.providers as unknown[]).length).toBeGreaterThan(0);
        // Backward-compatible summary fields still present
        expect(typeof scan.providerCount).toBe('number');
        expect(typeof scan.availableCount).toBe('number');
        expect(body.repair).toEqual(expect.objectContaining({
          preferredScan: expect.objectContaining({
            source: 'scan',
            providerCount: expect.any(Number),
          }),
          providersReadyToApply: expect.any(Array),
          nextAction: expect.objectContaining({
            kind: 'apply_config',
            path: '/setup-apply',
            providers: expect.any(Array),
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'apply_config',
              path: '/setup-apply',
              providers: expect.any(Array),
            }),
            expect.objectContaining({
              kind: 'generate_setup_report',
              path: '/diagnostics/setup-report',
            }),
          ]),
        }));
        expect((body.repair as { providersReadyToApply: unknown[] }).providersReadyToApply.length)
          .toBeGreaterThan(0);
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /setup-state surfaces remediation previews and repair actions after a manual scan with failures', { timeout: 60_000 }, async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, {
        startup,
        compatibility: createFastCompatibility(env),
      });
      try {
        const bootstrapService = runtime.context.bootstrapService;
        if (!bootstrapService) {
          throw new Error('Bootstrap service missing for test');
        }

        bootstrapService.getLatestManualScan = async () => ({
          scannedAt: '2026-03-26T05:00:00.000Z',
          scanType: 'manual',
          providers: [
            {
              provider: 'claude',
              family: 'Claude',
              commandStatus: 'ready',
              commandPath: 'claude',
              version: '1.0.0',
              authStatus: 'ready',
              available: true,
              install: null,
              remediation: [],
            },
            {
              provider: 'codex',
              family: 'Codex',
              commandStatus: 'missing_install',
              commandPath: null,
              version: null,
              authStatus: 'unknown',
              available: false,
              install: null,
              remediation: [
                {
                  code: 'install_missing',
                  summary: 'Install Codex CLI.',
                },
                {
                  code: 'auth_missing',
                  summary: 'Set OPENAI_API_KEY.',
                },
              ],
            },
          ],
        });

        const response = await runtime.app.request('/setup-state');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(body.repair).toEqual(expect.objectContaining({
          status: 'attention_required',
          providersReadyToApply: [
            {
              provider: 'claude',
              family: 'Claude',
            },
          ],
          providersNeedingAttention: [
            expect.objectContaining({
              provider: 'codex',
              family: 'Codex',
              remediationCount: 2,
              remediationPreview: [
                {
                  code: 'install_missing',
                  summary: 'Install Codex CLI.',
                },
                {
                  code: 'auth_missing',
                  summary: 'Set OPENAI_API_KEY.',
                },
              ],
            }),
          ],
          nextAction: expect.objectContaining({
            kind: 'apply_config',
            path: '/setup-apply',
            providers: ['claude'],
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'apply_config',
              providers: ['claude'],
            }),
            expect.objectContaining({
              kind: 'review_remediation',
              providers: ['codex'],
            }),
            expect.objectContaining({
              kind: 'generate_setup_report',
              path: '/diagnostics/setup-report',
            }),
          ]),
        }));
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /setup-state includes manualScan after manual scan', { timeout: 60_000 }, async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, {
        startup,
        compatibility: createFastCompatibility(env),
      });
      try {
        // Run a manual scan
        await runtime.app.request('/setup-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manual: true }),
        });

        const response = await runtime.app.request('/setup-state');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        const manualScan = body.manualScan as Record<string, unknown>;
        expect(manualScan).toBeTruthy();
        expect(manualScan.scanType).toBe('manual');
        expect(Array.isArray(manualScan.providers)).toBe(true);
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /setup-state surfaces latest setup-report highlights from persisted diagnostics artifacts', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const generateResponse = await runtime.app.request('/diagnostics/setup-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshScan: false }),
        });
        expect(generateResponse.status).toBe(200);
        const generated = await generateResponse.json() as {
          report: {
            artifactId: string;
            generatedAt: string;
            summary: {
              status: string;
              issueCounts: {
                info: number;
                warnings: number;
                errors: number;
              };
              headline: string;
              highlights: string[];
            };
          };
          artifactPath: string;
        };

        const setupStateResponse = await runtime.app.request('/setup-state');
        expect(setupStateResponse.status).toBe(200);
        const body = await setupStateResponse.json() as {
          diagnostics: {
            latestReport: {
              artifactId: string;
              artifactPath: string;
              generatedAt: string;
              status: string;
              issueCounts: {
                info: number;
                warnings: number;
                errors: number;
              };
              headline: string;
              highlights: string[];
            } | null;
          };
        };

        expect(body.diagnostics.latestReport).toEqual({
          artifactId: generated.report.artifactId,
          artifactPath: generated.artifactPath,
          generatedAt: generated.report.generatedAt,
          status: generated.report.summary.status,
          issueCounts: generated.report.summary.issueCounts,
          headline: generated.report.summary.headline,
          highlights: generated.report.summary.highlights,
        });
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /setup-state returns manualScan null when no manual scan run', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/setup-state');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(body.manualScan).toBeNull();
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /setup-state includes full detail in non-bootstrap mode after a scan', { timeout: 60_000 }, async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      // Start in bootstrap, scan, then exit bootstrap to verify detail persists
      const startup = createRuntimeStartupState({ bootstrapRequired: true });
      const runtime = createRuntimeServer(config, {
        startup,
        compatibility: createFastCompatibility(env),
      });
      try {
        // Run a scan while still in bootstrap
        await runtime.app.request('/setup-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manual: true }),
        });

        // Exit bootstrap mode
        startup.bootstrapRequired = false;

        // GET state in non-bootstrap — full detail should still be present
        // because setup routes go through bearer auth like any other route
        const response = await runtime.app.request('/setup-state');
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(body.bootstrapRequired).toBe(false);
        const scan = body.scan as Record<string, unknown>;
        expect(scan).toBeTruthy();
        expect(Array.isArray(scan.providers)).toBe(true);
        expect((scan.providers as unknown[]).length).toBeGreaterThan(0);
        expect(typeof scan.providerCount).toBe('number');
        expect(body.manualScan).toBeTruthy();
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET / in bootstrap mode includes shared UI foundation', async () => {
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
        expect(html).toContain('data-cats-ui');
        expect(html).toContain('window.CatsUI');
        expect(html).toContain('data-runtime-surface-switcher');
        expect(html).toContain('data-active-surface="setup"');
        expect(html).toContain('data-bootstrap-required="true"');
        expect((html.match(/>Locked</g) || []).length).toBe(2);
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /dashboard includes the shared runtime shell', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: false });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/dashboard');
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('Cats Runtime Dashboard');
        expect(html).toContain('data-cats-ui');
        expect(html).toContain('data-runtime-surface-switcher');
        expect(html).toContain('data-active-surface="dashboard"');
        expect(html).toContain('Runtime Health');
        expect(html).toContain('runtimeAuthStatus');
        expect(html).toContain('providerCapabilityPreview');
        expect(html).toContain('chatSessionInsights');
      } finally {
        await runtime.close();
      }
    } finally {
      cleanup();
    }
  });

  it('GET /playground includes shared UI foundation', async () => {
    const { root, cleanup } = createTestRoot();
    try {
      const env = createTestEnv(root);
      ensureDirs(env);
      const config = { ...loadConfig(env), host: '127.0.0.1', port: 0 };
      const startup = createRuntimeStartupState({ bootstrapRequired: false });
      const runtime = createRuntimeServer(config, { startup });
      try {
        const response = await runtime.app.request('/playground');
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('Playground');
        expect(html).toContain('data-cats-ui');
        expect(html).toContain('window.CatsUI');
        expect(html).toContain('data-runtime-surface-switcher');
        expect(html).toContain('data-active-surface="playground"');
        expect(html).toContain('id="api-key"');
        expect(html).toContain('validateRuntimeApiKey');
        expect(html).toContain('/providers/${name}/models/advanced');
        expect(html).toContain('modelSelection');
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
