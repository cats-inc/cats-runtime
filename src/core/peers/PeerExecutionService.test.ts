import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionHandle, StreamEvent } from '../types.js';
import { loadConfig } from '../config.js';
import { PeerExecutionService } from './PeerExecutionService.js';
import type { PeerExecutionRequest } from './types.js';
import { createRuntimeTestEnv } from '../../../tests/support/runtimeTestPaths.js';

const createdRoots: string[] = [];

function createConfig() {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-peer-exec-service-'));
  createdRoots.push(root);
  return {
    ...loadConfig(createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
    }), { skipProviderFile: true }),
    providerDefaultTargets: {
      codex: { backend: 'api', instance: 'main' },
    },
    remoteProviderCatalog: {
      api: {
        codex: {
          main: {
            id: 'main',
            providerName: 'codex',
            backend: 'api',
            transport: 'openai',
            apiKeyEnv: 'OPENAI_API_KEY',
            baseUrl: 'https://example.test',
            model: 'gpt-5.4',
          },
        },
      },
      local: {},
      agent: {},
    },
  };
}

function createRequest(
  overrides: Partial<PeerExecutionRequest> = {},
): PeerExecutionRequest {
  return {
    caller: {
      peerId: 'caller-peer',
      sessionId: 'session-1',
      runId: 'run-1',
      traceId: 'trace-1',
    },
    target: {
      provider: 'codex',
      backend: 'api',
      instance: 'main',
      model: 'gpt-5.4',
    },
    workspace: {
      mode: 'read_only',
      cwd: 'C:/outside-workspace',
    },
    turn: {
      message: 'hello peer',
      context: {
        source: 'interactive',
      },
    },
    ...overrides,
  };
}

async function collectEvents(
  stream: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function createHandle(
  events: StreamEvent[] = [{ type: 'result', summary: 'done' }],
): { handle: ExecutionHandle; kill: ReturnType<typeof vi.fn> } {
  const kill = vi.fn();
  const handle: ExecutionHandle = {
    active: true,
    busy: false,
    async *streamMessage() {
      yield* events;
    },
    kill,
    on() {
      return this;
    },
    off() {
      return this;
    },
  };
  return { handle, kill };
}

describe('PeerExecutionService', () => {
  afterEach(() => {
    while (createdRoots.length > 0) {
      const root = createdRoots.pop();
      if (root) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('ignores remote workspace cwd values outside the local session base dir', async () => {
    const config = createConfig();
    const { handle, kill } = createHandle();
    const registry = {
      create: vi.fn((session) => session),
      updateStatus: vi.fn(),
      remove: vi.fn(),
    };
    const runtime = {
      getCapabilities: vi.fn(() => ({ permissions: true })),
      spawn: vi.fn(() => handle),
      dropSession: vi.fn(),
    };
    const service = new PeerExecutionService({
      config,
      registry: registry as never,
      runtime: runtime as never,
      localPeerId: 'callee-peer',
    });

    await expect(collectEvents(service.execute(createRequest()))).resolves.toEqual([
      expect.objectContaining({
        type: 'result',
        metadata: expect.objectContaining({
          peerExecution: expect.objectContaining({
            executorPeerId: 'callee-peer',
          }),
        }),
      }),
    ]);

    expect(registry.create).toHaveBeenCalledWith(expect.objectContaining({
      cwd: config.sessionBaseDir,
      workspaceMode: 'read_only',
    }));
    expect(kill).toHaveBeenCalledTimes(1);
    expect(runtime.dropSession).toHaveBeenCalledTimes(1);
    expect(registry.remove).toHaveBeenCalledTimes(1);
  });

  it('cleans up the transient session when runtime spawn fails', async () => {
    const config = createConfig();
    const registry = {
      create: vi.fn((session) => session),
      updateStatus: vi.fn(),
      remove: vi.fn(),
    };
    const runtime = {
      getCapabilities: vi.fn(() => ({ permissions: true })),
      spawn: vi.fn(() => undefined),
      dropSession: vi.fn(),
    };
    const service = new PeerExecutionService({
      config,
      registry: registry as never,
      runtime: runtime as never,
      localPeerId: 'callee-peer',
    });

    await expect(collectEvents(service.execute(createRequest()))).rejects.toThrow(
      "Failed to initialize peer execution for 'codex/api/main'.",
    );

    const createdSession = registry.create.mock.calls[0]?.[0] as { id: string };
    expect(createdSession.id).toMatch(/^peer-exec-/);
    expect(registry.remove).toHaveBeenCalledWith(createdSession.id);
    expect(runtime.dropSession).not.toHaveBeenCalled();
  });
});
