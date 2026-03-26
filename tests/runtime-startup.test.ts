import { describe, expect, it } from 'vitest';

import {
  RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
  RUNTIME_DIAGNOSTICS_PATHS,
  RUNTIME_VERSION,
  RUNTIME_SHUTDOWN_REASONS,
  RUNTIME_SHUTDOWN_SIGNALS,
  RUNTIME_STARTUP_CONTRACT_VERSION,
  applyRuntimeCliEnvOverrides,
  createRuntimeStartupState,
  formatRuntimeReadyMessage,
  formatRuntimeStoppedMessage,
  formatRuntimeStoppingMessage,
  formatRuntimeStartupError,
  getRuntimeHelpText,
  getRuntimeLifecycleContract,
  getRuntimeOperationalStatus,
  getRuntimeReadinessSnapshot,
  getRuntimeShutdownContract,
  isRuntimeManagedStdinShutdownEnabled,
  markRuntimeReady,
  markRuntimeStopped,
  markRuntimeStopping,
  parseRuntimeCliOptions,
  resolveRuntimeStartupState,
} from '../src/startup.js';

describe('runtime startup helpers', () => {
  it('parses startup CLI options including inline values', () => {
    expect(parseRuntimeCliOptions([
      '--diagnose-setup',
      '--refresh-setup-scan',
      '--startup-mode=app-managed',
      '--managed-by',
      'cats-inc',
      '--ready-output=json',
      '--host',
      '127.0.0.1',
      '--port=3210',
      '--config',
      'config/providers.yaml',
    ])).toEqual({
      diagnoseSetup: true,
      refreshSetupScan: true,
      startupMode: 'app-managed',
      managedBy: 'cats-inc',
      readyOutput: 'json',
      host: '127.0.0.1',
      port: '3210',
      configPath: 'config/providers.yaml',
    });
  });

  it('rejects unknown CLI arguments', () => {
    expect(() => parseRuntimeCliOptions(['--nope'])).toThrow(/Unknown argument '--nope'/);
  });

  it('applies CLI env overrides for host, port, and config path', () => {
    const env: NodeJS.ProcessEnv = {};
    applyRuntimeCliEnvOverrides({
      host: '127.0.0.1',
      port: '4010',
      configPath: 'tmp/providers.yaml',
    }, env);

    expect(env).toEqual({
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '4010',
      CATS_RUNTIME_CONFIG_PATH: 'tmp/providers.yaml',
    });
  });

  it('defaults app-managed startup to json ready output', () => {
    const startup = resolveRuntimeStartupState(
      { startupMode: 'app-managed', managedBy: 'cats-inc' },
      {},
    );

    expect(startup.mode).toBe('app-managed');
    expect(startup.managedBy).toBe('cats-inc');
    expect(startup.contractVersion).toBe(RUNTIME_STARTUP_CONTRACT_VERSION);
    expect(startup.readinessPath).toBe('/health');
    expect(startup.readyOutput).toBe('json');
    expect(startup.readySignal).toBe('http');
    expect(startup.ready).toBe(false);
    expect(startup.phase).toBe('starting');
  });

  it('formats JSON lifecycle and startup error messages for managed startup', () => {
    const startup = createRuntimeStartupState({
      mode: 'app-managed',
      managedBy: 'cats-inc',
      readyOutput: 'json',
      pid: 1234,
      startedAt: '2026-03-19T00:00:00.000Z',
    });
    markRuntimeReady(startup, {
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
    });

    const readyMessage = formatRuntimeReadyMessage(startup, {
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
    });
    expect(JSON.parse(readyMessage!)).toEqual({
      event: 'runtime.ready',
      service: 'cats-runtime',
      contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
      version: RUNTIME_VERSION,
      pid: 1234,
      mode: 'app-managed',
      managedBy: 'cats-inc',
      startedAt: '2026-03-19T00:00:00.000Z',
      timestamp: expect.any(String),
      phase: 'ready',
      readySignal: 'http',
      ready: true,
      readinessPath: '/health',
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
    });

    markRuntimeStopping(startup, 'stdin_closed');
    const stoppingMessage = formatRuntimeStoppingMessage(startup, 'stdin_closed');
    expect(JSON.parse(stoppingMessage!)).toEqual({
      event: 'runtime.stopping',
      service: 'cats-runtime',
      contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
      version: RUNTIME_VERSION,
      pid: 1234,
      mode: 'app-managed',
      managedBy: 'cats-inc',
      startedAt: '2026-03-19T00:00:00.000Z',
      timestamp: expect.any(String),
      phase: 'stopping',
      readySignal: 'http',
      ready: false,
      readinessPath: '/health',
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
      reason: 'stdin_closed',
    });

    markRuntimeStopped(startup, 'stdin_closed');
    const stoppedMessage = formatRuntimeStoppedMessage(startup, 'stdin_closed');
    expect(JSON.parse(stoppedMessage!)).toEqual({
      event: 'runtime.stopped',
      service: 'cats-runtime',
      contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
      version: RUNTIME_VERSION,
      pid: 1234,
      mode: 'app-managed',
      managedBy: 'cats-inc',
      startedAt: '2026-03-19T00:00:00.000Z',
      timestamp: expect.any(String),
      phase: 'stopped',
      readySignal: 'http',
      ready: false,
      readinessPath: '/health',
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
      reason: 'stdin_closed',
    });

    const errorMessage = formatRuntimeStartupError(startup, new Error('boom'));
    expect(JSON.parse(errorMessage)).toEqual({
      event: 'runtime.startup_error',
      service: 'cats-runtime',
      contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
      version: RUNTIME_VERSION,
      pid: 1234,
      mode: 'app-managed',
      managedBy: 'cats-inc',
      startedAt: '2026-03-19T00:00:00.000Z',
      timestamp: expect.any(String),
      phase: 'stopped',
      readySignal: 'http',
      ready: false,
      readinessPath: '/health',
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
      reason: 'stdin_closed',
      error: expect.stringContaining('boom'),
    });
  });

  it('builds an authoritative readiness snapshot', () => {
    const startup = createRuntimeStartupState({
      mode: 'app-managed',
      managedBy: 'cats-inc',
      readyOutput: 'json',
    });

    expect(getRuntimeReadinessSnapshot(startup)).toEqual({
      endpoint: '/health',
      authoritative: true,
      readySignal: 'http',
      phase: 'starting',
      ready: false,
    });
  });

  it('exposes a shared lifecycle, shutdown, and diagnostics contract', () => {
    const startup = createRuntimeStartupState({
      mode: 'app-managed',
      managedBy: 'cats-inc',
    });

    expect(getRuntimeLifecycleContract(startup)).toEqual({
      startup: RUNTIME_STARTUP_CONTRACT_VERSION,
      diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
      supportedModes: ['standalone', 'app-managed'],
      readinessPath: '/health',
      lifecycleEvents: [
        'runtime.ready',
        'runtime.startup_error',
        'runtime.stopping',
        'runtime.stopped',
      ],
      shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
      shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
      endpoints: {
        health: '/health',
        runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
        providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
        summary: RUNTIME_DIAGNOSTICS_PATHS.health,
      },
    });
    expect(getRuntimeShutdownContract(startup)).toEqual({
      signals: [...RUNTIME_SHUTDOWN_SIGNALS],
      reasons: [...RUNTIME_SHUTDOWN_REASONS],
      stdinCloseEnabled: true,
    });
    expect(isRuntimeManagedStdinShutdownEnabled(startup)).toBe(true);
    expect(getRuntimeOperationalStatus(startup)).toEqual({
      status: 'degraded',
      summary: 'Runtime is starting and is not ready yet.',
    });
  });

  it('renders help text with supported flags', () => {
    const help = getRuntimeHelpText();
    expect(help).toContain('Usage: cats-runtime [options]');
    expect(help).toContain('--diagnose-setup');
    expect(help).toContain('--refresh-setup-scan');
    expect(help).toContain('--startup-mode <standalone|app-managed>');
    expect(help).toContain('--ready-output <plain|json|silent>');
  });
});
