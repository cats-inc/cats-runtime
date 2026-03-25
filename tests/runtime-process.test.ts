import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
  RUNTIME_DIAGNOSTICS_PATHS,
  RUNTIME_SHUTDOWN_REASONS,
  RUNTIME_SHUTDOWN_SIGNALS,
  RUNTIME_STARTUP_CONTRACT_VERSION,
  RUNTIME_VERSION,
} from '../src/startup.js';

interface RuntimeLifecycleEvent {
  event: 'runtime.ready' | 'runtime.startup_error' | 'runtime.stopping' | 'runtime.stopped';
  service: 'cats-runtime';
  contractVersion: number;
  version: string;
  pid: number;
  mode: 'standalone' | 'app-managed';
  managedBy?: string;
  startedAt: string;
  timestamp: string;
  phase: 'starting' | 'ready' | 'stopping' | 'stopped';
  readySignal: 'http';
  readinessPath: '/health';
  ready: boolean;
  host?: string;
  port?: number;
  healthUrl?: string;
  reason?: 'sigint' | 'sigterm' | 'stdin_closed';
  error?: string;
}

const testsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testsDir, '..');
const runtimeEntry = join(runtimeRoot, 'dist', 'index.js');

function createRuntimeProcessEnv(port: number) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-process-'));
  // Write a minimal valid providers.yaml so the process starts in normal mode.
  const configPath = join(root, 'providers.yaml');
  writeFileSync(configPath, [
    'version: 1',
    'backends:',
    '  cli:',
    '    providers:',
    '      claude:',
    '        instances:',
    '          default:',
    '            command: claude',
    '            runner: auto',
    '',
  ].join('\n'), 'utf8');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: String(port),
    CATS_RUNTIME_CONFIG_PATH: configPath,
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

  for (const dir of [
    env.CATS_RUNTIME_DATA_DIR,
    env.CATS_RUNTIME_SESSION_BASE_DIR,
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.GEMINI_SESSIONS_DIR,
    join(root, '.kiro'),
    join(root, '.junie', 'sessions'),
    env.PI_SESSIONS_DIR,
  ]) {
    mkdirSync(dir!, { recursive: true });
  }

  return {
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not reserve a test port');
  }

  await new Promise<void>((resolvePort, rejectPort) => {
    server.close((error) => {
      if (error) {
        rejectPort(error);
        return;
      }
      resolvePort();
    });
  });

  return address.port;
}

function spawnRuntime(
  port: number,
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [
      runtimeEntry,
      '--startup-mode',
      'app-managed',
      '--managed-by',
      'cats-inc',
      '--ready-output',
      'json',
      '--port',
      String(port),
    ],
    {
      cwd: runtimeRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
}

function tryParseLifecycleEvent(line: string): RuntimeLifecycleEvent | null {
  try {
    const parsed = JSON.parse(line) as RuntimeLifecycleEvent;
    if (parsed?.service === 'cats-runtime' && typeof parsed.event === 'string') {
      return parsed;
    }
  } catch {
    // Ignore non-JSON log lines.
  }
  return null;
}

async function waitForLifecycleEvent(
  child: ChildProcessWithoutNullStreams,
  expectedEvent: RuntimeLifecycleEvent['event'],
  timeoutMs = 15000,
): Promise<RuntimeLifecycleEvent> {
  return new Promise((resolveEvent, rejectEvent) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    };

    const fail = (message: string) => {
      cleanup();
      rejectEvent(new Error(message));
    };

    const inspectLines = (buffer: string, source: 'stdout' | 'stderr'): string => {
      const lines = buffer.split(/\r?\n/);
      const nextBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const payload = tryParseLifecycleEvent(line.trim());
        if (!payload) {
          continue;
        }
        if (payload.event === expectedEvent) {
          cleanup();
          resolveEvent(payload);
          return nextBuffer;
        }
        if (expectedEvent !== 'runtime.startup_error' && payload.event === 'runtime.startup_error') {
          fail(
            `Runtime emitted startup_error on ${source}: ${payload.error ?? 'unknown error'}`,
          );
          return nextBuffer;
        }
      }
      return nextBuffer;
    };

    const onStdout = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      stdoutBuffer = inspectLines(stdoutBuffer, 'stdout');
    };

    const onStderr = (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
      stderrBuffer = inspectLines(stderrBuffer, 'stderr');
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(
        `Runtime exited before ${expectedEvent}. code=${code} signal=${signal} `
        + `stdout=${JSON.stringify(stdoutBuffer)} stderr=${JSON.stringify(stderrBuffer)}`,
      );
    };

    const timer = setTimeout(() => {
      fail(
        `Timed out waiting for ${expectedEvent}. stdout=${JSON.stringify(stdoutBuffer)} `
        + `stderr=${JSON.stringify(stderrBuffer)}`,
      );
    }, timeoutMs);

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
  });
}

async function collectLifecycleEventsUntilExit(
  child: ChildProcessWithoutNullStreams,
  triggerShutdown: () => void,
  timeoutMs = 15000,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  events: RuntimeLifecycleEvent[];
}> {
  return new Promise((resolveExit, rejectExit) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const events: RuntimeLifecycleEvent[] = [];

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    };

    const fail = (message: string) => {
      cleanup();
      rejectExit(new Error(message));
    };

    const inspectLines = (buffer: string): string => {
      const lines = buffer.split(/\r?\n/);
      const nextBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const payload = tryParseLifecycleEvent(line.trim());
        if (payload) {
          events.push(payload);
        }
      }
      return nextBuffer;
    };

    const onStdout = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      stdoutBuffer = inspectLines(stdoutBuffer);
    };

    const onStderr = (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
      stderrBuffer = inspectLines(stderrBuffer);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolveExit({ code, signal, events });
    };

    const timer = setTimeout(() => {
      fail(
        `Timed out waiting for runtime exit. stdout=${JSON.stringify(stdoutBuffer)} `
        + `stderr=${JSON.stringify(stderrBuffer)}`,
      );
    }, timeoutMs);

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
    triggerShutdown();
  });
}

async function stopRuntime(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) {
    return child.exitCode;
  }

  const exitPromise = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  child.stdin.end();

  const [code] = await Promise.race([
    exitPromise,
    new Promise<never>((_, rejectExit) => {
      setTimeout(() => {
        rejectExit(new Error('Timed out waiting for runtime shutdown via stdin close'));
      }, 15000);
    }),
  ]);

  return code;
}

describe('runtime process startup contract', () => {
  it('emits a JSON ready event and serves managed health metadata', async () => {
    const port = await reservePort();
    const { env, cleanup } = createRuntimeProcessEnv(port);
    const child = spawnRuntime(port, env);

    try {
      const ready = await waitForLifecycleEvent(child, 'runtime.ready');
      expect(ready).toMatchObject({
        event: 'runtime.ready',
        service: 'cats-runtime',
        contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
        mode: 'app-managed',
        managedBy: 'cats-inc',
        phase: 'ready',
        readySignal: 'http',
        readinessPath: '/health',
        ready: true,
        host: '127.0.0.1',
        port,
        healthUrl: `http://127.0.0.1:${port}/health`,
      });

      const response = await fetch(ready.healthUrl!);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'cats-runtime',
        status: 'ok',
        summary: 'Runtime is ready to accept requests.',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        contract: {
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
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'ready',
          ready: true,
        },
        startup: {
          contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
          mode: 'app-managed',
          managedBy: 'cats-inc',
          phase: 'ready',
          readySignal: 'http',
          ready: true,
          bootstrapRequired: false,
          pid: ready.pid,
          startedAt: ready.startedAt,
          address: {
            host: '127.0.0.1',
            port,
            healthUrl: `http://127.0.0.1:${port}/health`,
          },
          shutdownReason: undefined,
          lastEvent: 'runtime.ready',
        },
        shutdown: {
          signals: [...RUNTIME_SHUTDOWN_SIGNALS],
          reasons: [...RUNTIME_SHUTDOWN_REASONS],
          stdinCloseEnabled: true,
        },
      });
    } finally {
      await stopRuntime(child);
      cleanup();
    }
  }, 20000);

  it('emits startup_error when the managed port is already occupied', async () => {
    const occupiedServer = createServer();
    occupiedServer.listen(0, '127.0.0.1');
    await once(occupiedServer, 'listening');
    const occupiedAddress = occupiedServer.address();
    if (!occupiedAddress || typeof occupiedAddress === 'string') {
      throw new Error('Could not resolve occupied test port');
    }

    const port = occupiedAddress.port;
    const { env, cleanup } = createRuntimeProcessEnv(port);
    const child = spawnRuntime(port, env);

    try {
      const startupError = await waitForLifecycleEvent(child, 'runtime.startup_error');
      expect(startupError).toMatchObject({
        event: 'runtime.startup_error',
        service: 'cats-runtime',
        contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
        mode: 'app-managed',
        managedBy: 'cats-inc',
        phase: 'starting',
        readySignal: 'http',
        readinessPath: '/health',
        ready: false,
        error: expect.stringContaining('EADDRINUSE'),
      });

      if (child.exitCode === null) {
        const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
        expect(code).toBe(1);
        expect(signal).toBeNull();
      } else {
        expect(child.exitCode).toBe(1);
      }
    } finally {
      if (child.exitCode === null) {
        child.kill();
      }
      await new Promise<void>((resolveClose, rejectClose) => {
        occupiedServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
      cleanup();
    }
  }, 20000);

  it('emits shutdown lifecycle events when the host closes child stdin', async () => {
    const port = await reservePort();
    const { env, cleanup } = createRuntimeProcessEnv(port);
    const child = spawnRuntime(port, env);

    try {
      const ready = await waitForLifecycleEvent(child, 'runtime.ready');
      const shutdown = await collectLifecycleEventsUntilExit(child, () => {
        child.stdin.end();
      });

      expect(shutdown.code).toBe(0);
      expect(shutdown.signal).toBeNull();
      expect(shutdown.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'runtime.stopping',
          reason: 'stdin_closed',
          phase: 'stopping',
          ready: false,
          contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
        }),
        expect.objectContaining({
          event: 'runtime.stopped',
          reason: 'stdin_closed',
          phase: 'stopped',
          ready: false,
          contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
        }),
      ]));
      await expect(fetch(ready.healthUrl!)).rejects.toThrow();
    } finally {
      if (child.exitCode === null) {
        await stopRuntime(child);
      }
      cleanup();
    }
  }, 20000);

  const signalHandlingIt = process.platform === 'win32' ? it.skip : it;

  signalHandlingIt('emits shutdown lifecycle events when terminated by a signal', async () => {
    const port = await reservePort();
    const { env, cleanup } = createRuntimeProcessEnv(port);
    const child = spawnRuntime(port, env);
    const signal: NodeJS.Signals = 'SIGTERM';
    const reason = 'sigterm';

    try {
      const ready = await waitForLifecycleEvent(child, 'runtime.ready');
      const shutdown = await collectLifecycleEventsUntilExit(child, () => {
        child.kill(signal);
      });

      expect(shutdown.code).toBe(0);
      expect(shutdown.signal).toBeNull();
      expect(shutdown.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'runtime.stopping',
          reason,
          phase: 'stopping',
          ready: false,
        }),
        expect.objectContaining({
          event: 'runtime.stopped',
          reason,
          phase: 'stopped',
          ready: false,
        }),
      ]));
      await expect(fetch(ready.healthUrl!)).rejects.toThrow();
    } finally {
      if (child.exitCode === null) {
        await stopRuntime(child);
      }
      cleanup();
    }
  }, 20000);

});
