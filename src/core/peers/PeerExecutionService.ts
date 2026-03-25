import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { RuntimeConfig } from '../config.js';
import type { RuntimeSessionManager } from '../runtime/RuntimeSessionManager.js';
import type { StreamEvent } from '../types.js';
import { resolveProviderTarget } from '../providerCatalog.js';
import { createPeerExecutionError } from './errors.js';
import type {
  PeerExecutionRequest,
} from './types.js';

interface PeerExecutionServiceOptions {
  config: RuntimeConfig;
  registry: SessionRegistry;
  runtime: RuntimeSessionManager;
  localPeerId: string;
}

export class PeerExecutionService {
  constructor(private readonly options: PeerExecutionServiceOptions) {}

  async *execute(
    request: PeerExecutionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const target = resolveProviderTarget(
      this.options.config,
      request.target.provider,
      request.target.backend && request.target.instance
        ? `${request.target.backend}/${request.target.instance}`
        : request.target.instance,
    );
    const capabilities = this.options.runtime.getCapabilities(
      target.providerName,
      target.instanceId,
      target.backend,
    );
    if (!capabilities.permissions) {
      throw createPeerExecutionError({
        code: 'peer_execution_rejected',
        message: `Target '${target.providerName}/${target.backend}/${target.instanceId}' does not support read-only peer execution.`,
        retryable: false,
        status: 409,
      });
    }

    const sessionId = `peer-exec-${randomUUID()}`;
    const session = this.options.registry.create({
      id: sessionId,
      providerName: target.providerName,
      providerBackend: target.backend,
      providerInstanceId: target.instanceId,
      cwd: resolveExecutionCwd(request, this.options.config.sessionBaseDir),
      workspaceMode: 'read_only',
      permissionMode: 'default',
      model: request.target.model,
      group: 'peer-execution',
      instructions: request.turn.instructions,
      context: mergeContext(request, this.options.localPeerId),
    });

    const handle = this.options.runtime.spawn(
      session.id,
      target.providerName,
      {
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        model: request.target.model,
        permissionMode: 'default',
      },
      target.instanceId,
      target.backend,
    );

    if (!handle) {
      this.options.registry.remove(session.id);
      throw createPeerExecutionError({
        code: 'peer_execution_rejected',
        message: `Failed to initialize peer execution for '${target.providerName}/${target.backend}/${target.instanceId}'.`,
        retryable: true,
        status: 503,
      });
    }

    if (target.backend !== 'cli') {
      this.options.registry.updateStatus(session.id, 'ready');
    }

    const abortExecution = () => {
      handle.kill();
    };
    signal?.addEventListener('abort', abortExecution, { once: true });

    try {
      for await (const event of handle.streamMessage({
        message: request.turn.message,
        instructions: request.turn.instructions,
        context: request.turn.context,
      })) {
        yield decorateRemoteEvent(event, request, this.options.localPeerId);
      }
    } finally {
      signal?.removeEventListener('abort', abortExecution);
      handle.kill();
      this.options.runtime.dropSession(session.id);
      this.options.registry.remove(session.id);
    }
  }
}

function resolveExecutionCwd(
  request: PeerExecutionRequest,
  sessionBaseDir: string,
): string {
  const baseDir = resolve(sessionBaseDir);
  const requestedCwd = request.workspace.mode === 'read_only'
    ? request.workspace.cwd
    : undefined;
  if (typeof requestedCwd !== 'string' || requestedCwd.trim().length === 0) {
    return baseDir;
  }
  if (!isAbsolute(requestedCwd)) {
    return baseDir;
  }

  const resolvedRequestedCwd = resolve(requestedCwd);
  const rel = relative(baseDir, resolvedRequestedCwd);
  const withinSessionBaseDir = rel === ''
    || (!rel.startsWith('..') && !isAbsolute(rel));

  return withinSessionBaseDir ? resolvedRequestedCwd : baseDir;
}

function mergeContext(
  request: PeerExecutionRequest,
  localPeerId: string,
) {
  const context = request.turn.context ? structuredClone(request.turn.context) : {};
  const metadata = context.metadata && typeof context.metadata === 'object' && !Array.isArray(context.metadata)
    ? { ...context.metadata }
    : {};

  return {
    ...context,
    metadata: {
      ...metadata,
      peerExecution: {
        callerPeerId: request.caller.peerId,
        callerSessionId: request.caller.sessionId,
        callerRunId: request.caller.runId,
        executorPeerId: localPeerId,
      },
    },
  };
}

function decorateRemoteEvent(
  event: StreamEvent,
  request: PeerExecutionRequest,
  localPeerId: string,
): StreamEvent {
  return {
    ...event,
    metadata: {
      ...(event.metadata || {}),
      peerExecution: {
        requestId: request.caller.traceId,
        callerPeerId: request.caller.peerId,
        callerSessionId: request.caller.sessionId,
        callerRunId: request.caller.runId,
        executorPeerId: localPeerId,
        workspaceMode: request.workspace.mode,
      },
    },
  };
}
