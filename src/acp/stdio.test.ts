import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { GooseNativeSessionService } from '../backends/cli/goose/GooseNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { AppContext } from '../http/app.js';
import type { StreamEvent, TurnInput } from '../core/types.js';
import { createRuntimeStartupState } from '../startup.js';
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

describe('ACP stdio transport', () => {
  let rootDir = '';

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
      rootDir = '';
    }
  });

  it('handles initialize, session creation, listing, loading, and cancel notifications over stdio frames', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const input = new PassThrough();
    const output = new PassThrough();
    const registry = new SessionRegistry();
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      cancel: vi.fn(),
      status: vi.fn(() => ({ active: 0 })),
    } as unknown as WorkerPool;

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      providerModelCatalog: {} as never,
    };

    const server = startAcpStdioServer({ ctx, input, output });
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const cwd = join(rootDir, 'workspace');
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

    const firstMessages = decodeMessages(Buffer.concat(chunks)) as Array<Record<string, unknown>>;
    expect(firstMessages[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: 1,
        agentInfo: {
          name: 'cats-runtime',
        },
      },
    });
    expect(firstMessages[1]).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        sessionId: expect.any(String),
        _meta: {
          catsRuntime: {
            source: 'runtime_http_bridge',
          },
        },
      },
    });

    const sessionId = (firstMessages[1].result as { sessionId: string }).sessionId;

    input.write(Buffer.concat([
      encodeMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/list',
        params: {
          cwd,
        },
      }),
      encodeMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'session/load',
        params: {
          sessionId,
          cwd,
          mcpServers: [],
        },
      }),
      encodeMessage({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: {
          sessionId,
        },
      }),
    ]));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(4);
    });

    const messages = decodeMessages(Buffer.concat(chunks)) as Array<Record<string, unknown>>;
    expect(messages[2]).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        sessions: [
          expect.objectContaining({
            sessionId,
            cwd,
          }),
        ],
      },
    });
    expect(messages[3]).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      result: {
        _meta: {
          catsRuntime: {
            resumedFromRuntimeRegistry: true,
          },
        },
      },
    });

    await server.close();
  });

  it('returns parse errors for malformed stdio frames', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const server = startAcpStdioServer({
      handleJsonRpc: vi.fn(async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {},
      })),
      input,
      output,
    });

    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    input.write(Buffer.from('Content-Length: nope\r\n\r\n{}', 'utf8'));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toEqual([
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Missing or invalid Content-Length header',
          },
        },
      ]);
    });

    await server.close();
  });

  it('streams prompt-turn updates over direct ACP stdio transport', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const input = new PassThrough();
    const output = new PassThrough();
    const registry = new SessionRegistry();
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Inspect the workspace and summarize it.');
        yield { type: 'text', text: 'Starting analysis. ' };
        yield {
          type: 'tool_use',
          toolId: 'shell-1',
          toolName: 'run_shell',
          toolArgs: { command: 'pwd' },
        };
        yield {
          type: 'progress',
          text: 'pwd is still running...',
          toolId: 'shell-1',
          toolName: 'run_shell',
        };
        yield {
          type: 'tool_result',
          toolId: 'shell-1',
          toolName: 'run_shell',
          text: rootDir,
        };
        yield { type: 'result', text: 'Workspace inspected.' };
      },
    };
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => worker),
      spawn: vi.fn(),
      kill: vi.fn(),
      cancel: vi.fn(),
      status: vi.fn(() => ({ active: 1 })),
    } as unknown as WorkerPool;

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      providerModelCatalog: {} as never,
    };

    const server = startAcpStdioServer({ ctx, input, output });
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const cwd = join(rootDir, 'workspace');
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
            sessionLifecycle: 'prompt_enabled_over_stdio',
            supportedMethods: expect.arrayContaining(['session/prompt']),
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
            text: 'Inspect the workspace and summarize it.',
          },
        ],
      },
    }));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(8);
    });

    const promptMessages = decodeMessages(Buffer.concat(chunks)).slice(2) as Array<Record<string, unknown>>;
    expect(promptMessages).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Starting analysis. ',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'shell-1',
            title: 'run_shell',
            kind: 'run_shell',
            status: 'pending',
            rawInput: {
              command: 'pwd',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'shell-1',
            status: 'in_progress',
            content: [
              {
                type: 'content',
                content: {
                  type: 'text',
                  text: 'pwd is still running...',
                },
              },
            ],
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'shell-1',
            status: 'completed',
            content: [
              {
                type: 'content',
                content: {
                  type: 'text',
                  text: rootDir,
                },
              },
            ],
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Workspace inspected.',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn',
          _meta: {
            catsRuntime: {
              source: 'runtime_http_bridge',
              transport: 'stdio',
              turnStream: 'application/x-ndjson',
            },
          },
        },
      },
    ]);

    await server.close();
  });

  it('processes session/cancel notifications while a direct stdio prompt turn is still running', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const input = new PassThrough();
    const output = new PassThrough();
    const registry = new SessionRegistry();
    let cancelRequested = false;
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Cancel this prompt once it starts.');
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

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      providerModelCatalog: {} as never,
    };

    const server = startAcpStdioServer({ ctx, input, output });
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
            text: 'Cancel this prompt once it starts.',
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
            },
          },
        },
      });
    });

    await server.close();
  });

  it('projects runtime plan and model-state progress into ACP-native updates', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const input = new PassThrough();
    const output = new PassThrough();
    const registry = new SessionRegistry();
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Show plan and model transitions.');
        yield {
          type: 'progress',
          text: 'Runtime updated the plan (2 steps).',
          metadata: {
            kind: 'plan',
            status: 'updated',
            stepCount: 2,
          },
        };
        yield {
          type: 'progress',
          text: 'Runtime rerouted from gpt-5.4 to gpt-5.4-mini.',
          metadata: {
            kind: 'model_state',
            status: 'updated',
            native: {
              fromModel: 'gpt-5.4',
              toModel: 'gpt-5.4-mini',
            },
          },
        };
        yield { type: 'result', text: 'Projection complete.' };
      },
    };
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => worker),
      spawn: vi.fn(),
      kill: vi.fn(),
      cancel: vi.fn(),
      status: vi.fn(() => ({ active: 1 })),
    } as unknown as WorkerPool;

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      providerModelCatalog: {} as never,
    };

    const server = startAcpStdioServer({ ctx, input, output });
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const cwd = join(rootDir, 'workspace-projection');
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
            text: 'Show plan and model transitions.',
          },
        ],
      },
    }));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(6);
    });

    const promptMessages = decodeMessages(Buffer.concat(chunks)).slice(2) as Array<Record<string, unknown>>;
    expect(promptMessages).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'plan',
            entries: [
              {
                content: 'Runtime updated the plan (2 steps).',
                status: 'pending',
                step: 2,
              },
            ],
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'config_option_update',
            configOptionUpdate: {
              configOptions: [
                {
                  configId: 'model',
                  name: 'Model',
                  payload: {
                    currentValue: 'gpt-5.4-mini',
                  },
                },
              ],
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Projection complete.',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn',
          _meta: {
            catsRuntime: {
              source: 'runtime_http_bridge',
              transport: 'stdio',
              turnStream: 'application/x-ndjson',
            },
          },
        },
      },
    ]);

    await server.close();
  });

  it('projects runtime session mode and usage state into ACP-native updates without duplicates', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const input = new PassThrough();
    const output = new PassThrough();
    const registry = new SessionRegistry();
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Show session-state projections.');
        yield {
          type: 'progress',
          text: 'Runtime entered code mode.',
          providerState: {
            agentSession: {
              adapterState: {
                currentModeId: 'code',
              },
            },
          },
        };
        yield {
          type: 'progress',
          text: 'Runtime usage snapshot updated.',
          providerState: {
            agentSession: {
              adapterState: {
                currentModeId: 'code',
                contextWindowUsage: {
                  used: 53000,
                  size: 200000,
                  costAmount: 0.045,
                  costCurrency: 'USD',
                },
              },
            },
          },
        };
        yield {
          type: 'result',
          text: 'Session-state projection complete.',
          providerState: {
            agentSession: {
              adapterState: {
                currentModeId: 'code',
                contextWindowUsage: {
                  used: 53000,
                  size: 200000,
                  costAmount: 0.045,
                  costCurrency: 'USD',
                },
              },
            },
          },
        };
      },
    };
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => worker),
      spawn: vi.fn(),
      kill: vi.fn(),
      cancel: vi.fn(),
      status: vi.fn(() => ({ active: 1 })),
    } as unknown as WorkerPool;

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      providerModelCatalog: {} as never,
    };

    const server = startAcpStdioServer({ ctx, input, output });
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const cwd = join(rootDir, 'workspace-session-state');
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
            text: 'Show session-state projections.',
          },
        ],
      },
    }));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(6);
    });

    const promptMessages = decodeMessages(Buffer.concat(chunks)).slice(2) as Array<Record<string, unknown>>;
    expect(promptMessages).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'current_mode_update',
            currentModeUpdate: {
              modeId: 'code',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'usage_update',
            usageUpdate: {
              used: 53000,
              size: 200000,
              cost: {
                amount: 0.045,
                currency: 'USD',
              },
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Session-state projection complete.',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn',
          _meta: {
            catsRuntime: {
              source: 'runtime_http_bridge',
              transport: 'stdio',
              turnStream: 'application/x-ndjson',
            },
          },
        },
      },
    ]);

    await server.close();
  });

  it('projects runtime session title and command catalog into ACP-native updates without duplicates', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const input = new PassThrough();
    const output = new PassThrough();
    const registry = new SessionRegistry();
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Show title and command projections.');
        yield {
          type: 'progress',
          text: 'Runtime attached ACP session state.',
          providerState: {
            agentSession: {
              summary: 'Repo Refactor',
              adapterState: {
                sessionTitle: 'Repo Refactor',
                availableCommands: ['/plan', '/review'],
              },
            },
          },
        };
        yield {
          type: 'result',
          text: 'Command projection complete.',
          providerState: {
            agentSession: {
              summary: 'Repo Refactor',
              adapterState: {
                sessionTitle: 'Repo Refactor',
                availableCommands: ['/plan', '/review'],
              },
            },
          },
        };
      },
    };
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => worker),
      spawn: vi.fn(),
      kill: vi.fn(),
      cancel: vi.fn(),
      status: vi.fn(() => ({ active: 1 })),
    } as unknown as WorkerPool;

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      providerModelCatalog: {} as never,
    };

    const server = startAcpStdioServer({ ctx, input, output });
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const cwd = join(rootDir, 'workspace-session-title');
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
            text: 'Show title and command projections.',
          },
        ],
      },
    }));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(6);
    });

    const promptMessages = decodeMessages(Buffer.concat(chunks)).slice(2) as Array<Record<string, unknown>>;
    expect(promptMessages).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'session_info_update',
            sessionInfoUpdate: {
              title: 'Repo Refactor',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'available_commands_update',
            availableCommandsUpdate: {
              availableCommands: [
                { name: '/plan' },
                { name: '/review' },
              ],
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Command projection complete.',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn',
          _meta: {
            catsRuntime: {
              source: 'runtime_http_bridge',
              transport: 'stdio',
              turnStream: 'application/x-ndjson',
            },
          },
        },
      },
    ]);

    await server.close();
  });

  it('projects non-cancel terminal errors into a final ACP agent message before refusal', async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });

    const input = new PassThrough();
    const output = new PassThrough();
    const registry = new SessionRegistry();
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Trigger a runtime refusal.');
        yield {
          type: 'error',
          text: 'Runtime refused to continue because approval is required.',
        };
      },
    };
    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => worker),
      spawn: vi.fn(),
      kill: vi.fn(),
      cancel: vi.fn(),
      status: vi.fn(() => ({ active: 1 })),
    } as unknown as WorkerPool;

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as CursorNativeSessionService,
      gooseNative: {} as GooseNativeSessionService,
      kiroNative: {} as KiroNativeSessionService,
      auggieSessions: {} as AuggieSessionService,
      opencodeNative: {} as OpencodeNativeSessionService,
      providerModelCatalog: {} as never,
    };

    const server = startAcpStdioServer({ ctx, input, output });
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    const cwd = join(rootDir, 'workspace-refusal');
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
            text: 'Trigger a runtime refusal.',
          },
        ],
      },
    }));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(4);
    });

    const promptMessages = decodeMessages(Buffer.concat(chunks)).slice(2) as Array<Record<string, unknown>>;
    expect(promptMessages).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Runtime refused to continue because approval is required.',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'refusal',
          _meta: {
            catsRuntime: {
              source: 'runtime_http_bridge',
              transport: 'stdio',
              turnStream: 'application/x-ndjson',
            },
          },
        },
      },
    ]);

    await server.close();
  });
});
