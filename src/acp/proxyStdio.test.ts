import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from '../http/app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { GooseNativeSessionService } from '../backends/cli/goose/GooseNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { StreamEvent, TurnInput } from '../core/types.js';
import { createRuntimeStartupState } from '../startup.js';
import { createHttpAcpProxyHandler } from './proxy.js';
import { startAcpStdioServer } from './stdio.js';

function encodeMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.from(`Content-Length: ${payload.length}\r\n\r\n${payload.toString('utf8')}`, 'utf8');
}

function decodeMessages(buffer: Buffer): unknown[] {
  const messages: unknown[] = [];
  let remaining = buffer;
  while (remaining.length > 0) {
    const separator = remaining.indexOf('\r\n\r\n');
    if (separator < 0) {
      break;
    }
    const header = remaining.subarray(0, separator).toString('utf8');
    const lengthLine = header.split('\r\n').find((line) => line.toLowerCase().startsWith('content-length:'));
    if (!lengthLine) {
      throw new Error('Missing Content-Length');
    }
    const length = Number.parseInt(lengthLine.split(':')[1].trim(), 10);
    const start = separator + 4;
    const end = start + length;
    messages.push(JSON.parse(remaining.subarray(start, end).toString('utf8')) as unknown);
    remaining = remaining.subarray(end);
  }
  return messages;
}

function makeConfig(rootDir: string): CliRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3110,
    apiKey: '',
    dataDir: join(rootDir, 'data'),
    sessionBaseDir: join(rootDir, 'sessions'),
    auggiePath: 'auggie',
    claudePath: 'claude',
    codexPath: 'codex',
    copilotPath: 'copilot',
    cursorPath: 'cursor-agent',
    antigravityPath: 'agy',
    goosePath: 'goose',
    juniePath: 'junie',
    kiroPath: 'kiro-cli',
    kiloPath: 'kilo',
    opencodePath: 'opencode',
    piPath: 'pi',
    opencodeServerHost: '127.0.0.1',
    opencodeServerPort: 4097,
    opencodeServerStartupTimeoutMs: 10000,
    kiloServerHost: '127.0.0.1',
    kiloServerPort: 4313,
    kiloServerStartupTimeoutMs: 10000,
    auggieSessionsDir: '',
    claudeProjectsDir: '',
    codexSessionsDir: '',
    copilotSessionsDir: '',
    cursorChatsDir: '',
    cursorRuntime: { mode: 'native' },
    kiroDbPath: '',
    kiroRuntime: { mode: 'native' },
    providerCommands: {
      auggie: { path: 'auggie', runner: 'auto', runtime: { mode: 'native' } },
      claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
      copilot: { path: 'copilot', runner: 'auto', runtime: { mode: 'native' } },
      cursor: { path: 'cursor-agent', runner: 'auto', runtime: { mode: 'native' } },
      antigravity: { path: 'agy', runner: 'auto', runtime: { mode: 'native' } },
      goose: { path: 'goose', runner: 'auto', runtime: { mode: 'native' } },
      junie: { path: 'junie', runner: 'auto', runtime: { mode: 'native' } },
      kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } },
      kilo: { path: 'kilo', runner: 'auto', runtime: { mode: 'native' } },
      opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
      pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
    },
    externalSessionLiveWindowMs: 0,
    maxSessions: 10,
  } as unknown as CliRuntimeConfig;
}

describe('ACP stdio proxy integration', () => {
  let rootDir = '';

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
      rootDir = '';
    }
  });

  it('cancels proxied prompt turns through the runtime HTTP ACP facade', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-proxy-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const registry = new SessionRegistry();
    let cancelRequested = false;
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Cancel this proxied prompt once it starts.');
        worker.busy = true;
        yield { type: 'text', text: 'Prompt started.' };

        let remainingPolls = 60;
        while (!cancelRequested && remainingPolls > 0) {
          remainingPolls -= 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        worker.busy = false;
        if (cancelRequested) {
          yield { type: 'error', text: 'Turn cancelled by runtime abort.' };
          return;
        }

        yield { type: 'error', text: 'Prompt timed out waiting for cancellation.' };
      },
    };
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => worker),
      spawn: vi.fn(),
      kill: vi.fn(),
      cancel: vi.fn(() => {
        cancelRequested = true;
        worker.busy = false;
      }),
      status: vi.fn(() => ({ active: 1 })),
    } as unknown as WorkerPool;

    const app = createApp({
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
    });

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      return app.request(`${url.pathname}${url.search}`, init);
    }) as typeof fetch;

    const input = new PassThrough();
    const output = new PassThrough();
    const server = startAcpStdioServer({
      handleJsonRpc: createHttpAcpProxyHandler({
        env: {
          CATS_RUNTIME_ACP_PROXY_URL: 'http://127.0.0.1:3110/acp',
        },
        fetchImpl,
      }),
      input,
      output,
    });
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const cwd = join(rootDir, 'workspace-cancel');
    mkdirSync(cwd, { recursive: true });

    input.write(Buffer.concat([
      encodeMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
        },
      }),
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        params: {
          cwd,
          mcpServers: [],
        },
      }),
    ]));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(2);
    });

    const initialMessages = decodeMessages(Buffer.concat(chunks)) as Array<Record<string, unknown>>;
    expect(initialMessages[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        _meta: {
          catsRuntime: {
            transport: 'stdio',
            sessionLifecycle: 'prompt_enabled_over_stdio_proxy',
            proxy: {
              mode: 'http_proxy',
              upstreamTransport: 'http',
            },
          },
        },
      },
    });

    const sessionId = (initialMessages[1].result as { sessionId: string }).sessionId;
    input.write(encodeMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [
          {
            type: 'text',
            text: 'Cancel this proxied prompt once it starts.',
          },
        ],
      },
    }));

    await vi.waitFor(() => {
      const messages = decodeMessages(Buffer.concat(chunks)) as Array<Record<string, unknown>>;
      expect(messages.some((message) => message.method === 'session/update')).toBe(true);
    });

    input.write(encodeMessage({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: {
        sessionId,
      },
    }));

    await vi.waitFor(() => {
      expect(pool.cancel).toHaveBeenCalledTimes(1);
      const messages = decodeMessages(Buffer.concat(chunks)) as Array<Record<string, unknown>>;
      expect(messages).toContainEqual({
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'cancelled',
          _meta: {
            catsRuntime: {
              source: 'runtime_http_bridge',
              transport: 'stdio',
              turnStream: 'application/x-ndjson',
              proxy: {
                mode: 'http_proxy',
                upstreamTransport: 'http',
                targetUrl: 'http://127.0.0.1:3110/acp',
              },
            },
          },
        },
      });
    });

    await server.close();
  });
});
