import { describe, expect, it } from 'vitest';

import {
  RUNTIME_VERSION,
  applyRuntimeCliEnvOverrides,
  createRuntimeStartupState,
  formatRuntimeReadyMessage,
  formatRuntimeStartupError,
  getRuntimeHelpText,
  parseRuntimeCliOptions,
  resolveRuntimeStartupState,
} from '../src/startup.js';

describe('runtime startup helpers', () => {
  it('parses startup CLI options including inline values', () => {
    expect(parseRuntimeCliOptions([
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
    expect(startup.readyOutput).toBe('json');
    expect(startup.readySignal).toBe('http');
    expect(startup.ready).toBe(false);
  });

  it('formats JSON ready and startup error messages for managed startup', () => {
    const startup = createRuntimeStartupState({
      mode: 'app-managed',
      managedBy: 'cats-inc',
      readyOutput: 'json',
      pid: 1234,
      startedAt: '2026-03-19T00:00:00.000Z',
    });

    const readyMessage = formatRuntimeReadyMessage(startup, {
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
    });
    expect(JSON.parse(readyMessage!)).toEqual({
      event: 'runtime.ready',
      service: 'cats-runtime',
      version: RUNTIME_VERSION,
      pid: 1234,
      mode: 'app-managed',
      managedBy: 'cats-inc',
      startedAt: '2026-03-19T00:00:00.000Z',
      readySignal: 'http',
      ready: true,
      host: '127.0.0.1',
      port: 3110,
      healthUrl: 'http://127.0.0.1:3110/health',
    });

    const errorMessage = formatRuntimeStartupError(startup, new Error('boom'));
    expect(JSON.parse(errorMessage)).toEqual({
      event: 'runtime.startup_error',
      service: 'cats-runtime',
      version: RUNTIME_VERSION,
      pid: 1234,
      mode: 'app-managed',
      managedBy: 'cats-inc',
      startedAt: '2026-03-19T00:00:00.000Z',
      error: expect.stringContaining('boom'),
    });
  });

  it('renders help text with supported flags', () => {
    const help = getRuntimeHelpText();
    expect(help).toContain('Usage: cats-runtime [options]');
    expect(help).toContain('--startup-mode <standalone|app-managed>');
    expect(help).toContain('--ready-output <plain|json|silent>');
  });
});
