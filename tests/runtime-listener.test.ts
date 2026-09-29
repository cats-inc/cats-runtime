import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getRuntimeListenerConfig, loadConfig } from '../src/core/config.js';
import { warnIfNonLoopbackBind } from '../src/listener.js';
import { createRuntimeServer } from '../src/server.js';
import { createRuntimeTestEnv } from './support/runtimeTestPaths.js';
import { cleanupTempDirWithRetriesAsync } from './tempCleanup.js';

describe('Runtime listener exposure', () => {
  it.each([undefined, '', 'test-api-key'])('defaults to loopback with API key %s', async (key) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-listener-config-'));
    try {
      const config = loadConfig(createRuntimeTestEnv(root, { CATS_RUNTIME_API_KEY: key }));
      expect(config.host).toBe('127.0.0.1');
      expect(getRuntimeListenerConfig(config).host).toBe('127.0.0.1');
      expect(getRuntimeListenerConfig({ host: '', port: 3110 }).host).toBe('127.0.0.1');
    } finally {
      await cleanupTempDirWithRetriesAsync(root);
    }
  });

  it.each(['0.0.0.0', '192.0.2.10', '::', '::1', 'localhost'])('honors explicit host %s', async (host) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-listener-explicit-'));
    try {
      expect(loadConfig(createRuntimeTestEnv(root, { CATS_RUNTIME_HOST: host })).host).toBe(host);
    } finally {
      await cleanupTempDirWithRetriesAsync(root);
    }
  });

  it.each(['127.0.0.1', '127.10.20.30', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1'])(
    'does not warn for loopback address %s', (address) => {
      const warn = vi.fn();
      warnIfNonLoopbackBind(address, warn);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each(['0.0.0.0', '::', '192.0.2.10', '::ffff:192.0.2.10'])(
    'warns once for non-loopback address %s', (address) => {
      const warn = vi.fn();
      warnIfNonLoopbackBind(address, warn);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(address);
      expect(warn.mock.calls[0][0]).not.toContain('\n');
    },
  );

  it.each([
    [undefined, '127.0.0.1', false],
    ['localhost', null, false],
    ['0.0.0.0', '0.0.0.0', true],
  ] as const)('binds and warns at startup for host %s', async (host, expected, warns) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-listener-start-'));
    const config = loadConfig(createRuntimeTestEnv(root, {
      CATS_RUNTIME_API_KEY: 'listener-test-key', CATS_RUNTIME_HOST: host,
    }));
    config.port = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createRuntimeServer(config);
    try {
      const bound = await runtime.start();
      if (expected) expect(bound.host).toBe(expected);
      else expect(['127.0.0.1', '::1']).toContain(bound.host);
      await runtime.start();
      const networkWarnings = warn.mock.calls.filter(([message]) => String(message).startsWith('[network]'));
      expect(networkWarnings).toHaveLength(warns ? 1 : 0);
      expect(JSON.stringify(networkWarnings)).not.toContain('listener-test-key');
    } finally {
      await runtime.close();
      warn.mockRestore();
      await cleanupTempDirWithRetriesAsync(root);
    }
  }, 30_000);
});
