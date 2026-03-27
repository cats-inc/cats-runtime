import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { AppContext } from '../http/app.js';
import { createRuntimeStartupState } from '../startup.js';
import type { StreamEvent, TurnInput } from '../core/types.js';
import { startMcpStdioServer } from './stdio.js';

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
    claudePath: 'claude',
    providerCommands: {
      claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
    },
    providerDefaultInstances: {
      claude: 'default',
    },
    providerInstances: {
      claude: {
        default: {
          id: 'default',
          providerName: 'claude',
          commandConfig: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
        },
      },
    },
    externalSessionLiveWindowMs: 0,
    maxSessions: 10,
  } as unknown as CliRuntimeConfig;
}

describe('MCP stdio transport', () => {
  let rootDir: string;
  let registry: SessionRegistry;
  let workers: Map<string, {
    alive: boolean;
    busy: boolean;
    streamMessage: (turn: string | TurnInput) => AsyncGenerator<StreamEvent>;
  }>;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-mcp-stdio-'));
    mkdirSync(join(rootDir, 'sessions'), { recursive: true });
    mkdirSync(join(rootDir, 'data'), { recursive: true });
    registry = new SessionRegistry();
    workers = new Map();
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('handles initialize, tools/list, read, and mutation tool calls over stdio frames', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const workerStream = async function* (turn: string | TurnInput): AsyncGenerator<StreamEvent> {
      const message = typeof turn === 'string' ? turn : turn.message;
      yield { type: 'text', text: `reply: ${message}` };
      yield { type: 'result', summary: `completed: ${message}` };
    };

    const pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn((sessionId: string) => workers.get(sessionId)),
      spawn: vi.fn((sessionId: string) => {
        const worker = {
          alive: true,
          busy: false,
          streamMessage: workerStream,
        };
        workers.set(sessionId, worker);
        return worker;
      }),
      kill: vi.fn((sessionId: string) => {
        workers.delete(sessionId);
      }),
      killAll: vi.fn(() => {
        workers.clear();
      }),
      status: vi.fn(() => ({ active: workers.size, busy: 0, idle: workers.size, providers: { claude: workers.size } })),
    } as unknown as WorkerPool;

    const ctx: AppContext = {
      config: makeConfig(rootDir),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog: {} as never,
    };

    const closeSpy = vi.fn(async () => {});
    const server = startMcpStdioServer({
      ctx,
      input,
      output,
      onClose: closeSpy,
    });

    const chunks: Buffer[] = [];
    output.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    input.write(Buffer.concat([
      encodeMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
      encodeMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_session',
          arguments: {
            provider: 'claude',
            cwd: join(rootDir, 'workspace'),
          },
        },
      }),
      encodeMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            sortBy: 'id',
            sortDirection: 'desc',
            limit: 3,
          },
        },
      }),
    ]));

    await vi.waitFor(() => {
      expect(decodeMessages(Buffer.concat(chunks))).toHaveLength(4);
    });

    const messages = decodeMessages(Buffer.concat(chunks)) as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: {
          tools: {},
        },
      },
    });
    expect(messages[1]).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
        result: {
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'create_session' }),
            expect.objectContaining({ name: 'send_message' }),
            expect.objectContaining({ name: 'close_session' }),
            expect.objectContaining({ name: 'reset_session' }),
            expect.objectContaining({ name: 'delete_session' }),
            expect.objectContaining({ name: 'cleanup_session_workspace' }),
            expect.objectContaining({ name: 'compact_session' }),
            expect.objectContaining({ name: 'report_session_maintenance_follow_through' }),
            expect.objectContaining({ name: 'report_compaction_follow_through' }),
            expect.objectContaining({ name: 'runtime_diagnostics' }),
            expect.objectContaining({ name: 'health_diagnostics' }),
            expect.objectContaining({ name: 'read_session' }),
            expect.objectContaining({ name: 'session_history' }),
            expect.objectContaining({ name: 'session_lineage' }),
            expect.objectContaining({ name: 'providers_config' }),
            expect.objectContaining({ name: 'provider_tools' }),
            expect.objectContaining({ name: 'provider_models' }),
            expect.objectContaining({ name: 'providers_models' }),
            expect.objectContaining({ name: 'provider_advanced_models' }),
            expect.objectContaining({ name: 'provider_diagnostics' }),
            expect.objectContaining({ name: 'reprobe_provider_diagnostics' }),
            expect.objectContaining({ name: 'list_compatibility_evidence_artifacts' }),
            expect.objectContaining({ name: 'read_compatibility_evidence_artifact' }),
            expect.objectContaining({ name: 'list_provider_evolution_artifacts' }),
            expect.objectContaining({ name: 'read_provider_evolution_artifact' }),
            expect.objectContaining({ name: 'review_provider_evolution_artifact' }),
            expect.objectContaining({ name: 'generate_setup_diagnostic_report' }),
            expect.objectContaining({ name: 'list_setup_diagnostic_reports' }),
            expect.objectContaining({ name: 'read_latest_setup_diagnostic_report' }),
            expect.objectContaining({ name: 'read_setup_diagnostic_report' }),
            expect.objectContaining({ name: 'setup_state' }),
            expect.objectContaining({ name: 'run_setup_scan' }),
            expect.objectContaining({ name: 'apply_setup_config' }),
            expect.objectContaining({ name: 'list_wakeups' }),
            expect.objectContaining({ name: 'read_wakeup' }),
            expect.objectContaining({ name: 'list_runtime_skills' }),
            expect.objectContaining({ name: 'browser_summary' }),
            expect.objectContaining({ name: 'cleanup_browser_sessions' }),
            expect.objectContaining({ name: 'commit_changes' }),
          ]),
        },
    });
    expect(messages[2]).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        structuredContent: {
          responseStatus: 201,
          session: {
            providerName: 'claude',
          },
        },
      },
    });
    expect(messages[3]).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      result: {
        structuredContent: {
          contract: {
            version: 1,
          },
          query: {
            hasFilters: false,
            filters: {},
            sort: {
              by: 'id',
              direction: 'desc',
            },
          },
          catalogPath: '/skills/catalog?sortBy=id&sortDirection=desc&limit=3',
          skills: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
            }),
          ]),
        },
      },
    });

    await server.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
