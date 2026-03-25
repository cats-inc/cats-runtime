import { randomUUID } from 'node:crypto';
import { mergeRuntimeInstructionLayers } from '../skills/catalog.js';
import type {
  SessionInfo,
  StreamEvent,
  TurnInput,
} from '../types.js';
import {
  createPeerExecutionError,
  isPeerExecutionError,
} from './errors.js';
import { createPeerPayloadSignature } from './auth.js';
import type {
  ParsedPeerMessageRoutingInput,
  PeerExecutionRequest,
  PeerExecutionTrace,
  PeerExecutionTransport,
  PeerRegistryEntry,
  PeerRuntimeConfig,
} from './types.js';

interface PeerExecutionClientOptions {
  config: Pick<PeerRuntimeConfig, 'requestTimeoutMs' | 'sharedSecret'>;
  localPeerId: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface BuildPeerExecutionRequestOptions {
  session: Pick<
    SessionInfo,
    'id'
    | 'providerName'
    | 'providerBackend'
    | 'providerInstanceId'
    | 'model'
    | 'skills'
    | 'instructions'
    | 'context'
    | 'cwd'
  >;
  turn: TurnInput;
  peer: PeerRegistryEntry;
  routing: ParsedPeerMessageRoutingInput;
  runId: string;
  transport: PeerExecutionTransport;
}

export class PeerExecutionClient {
  private readonly fetchImpl: typeof fetch;

  private readonly now: () => number;

  constructor(private readonly options: PeerExecutionClientOptions) {
    this.fetchImpl = options.fetch || fetch;
    this.now = options.now || (() => Date.now());
  }

  buildRequest(
    input: BuildPeerExecutionRequestOptions,
  ): { request: PeerExecutionRequest; trace: PeerExecutionTrace } {
    const requestId = randomUUID();
    const sharedWorkspace = input.routing.shareWorkspace === true;
    const instructions = mergeRuntimeInstructionLayers(
      input.turn.skills ?? input.session.skills,
      input.turn.sessionInstructions ?? input.session.instructions,
      input.turn.instructions,
    );
    const context = sanitizeContext(
      input.turn.context || input.session.context,
      sharedWorkspace,
    );
    const transport = input.transport;

    return {
      request: {
        caller: {
          peerId: this.options.localPeerId,
          sessionId: input.session.id,
          runId: input.runId,
          traceId: requestId,
        },
        target: {
          provider: input.session.providerName,
          backend: input.session.providerBackend || 'cli',
          instance: input.session.providerInstanceId || 'default',
          ...(input.session.model ? { model: input.session.model } : {}),
        },
        workspace: {
          mode: sharedWorkspace ? 'read_only' : 'none',
          ...(sharedWorkspace ? { cwd: input.session.cwd } : {}),
        },
        turn: {
          message: input.turn.message,
          ...(instructions ? { instructions } : {}),
          ...(context ? { context } : {}),
        },
      },
      trace: {
        requestId,
        callerPeerId: this.options.localPeerId,
        callerSessionId: input.session.id,
        callerRunId: input.runId,
        peerId: input.peer.identity.peerId,
        routedAt: new Date(this.now()).toISOString(),
        transport,
        strategy: input.routing.strategy || (input.routing.peerId ? 'explicit' : 'provider_affinity'),
        workspaceMode: sharedWorkspace ? 'read_only' : 'none',
      },
    };
  }

  async *streamExecution(
    peer: PeerRegistryEntry,
    request: PeerExecutionRequest,
    trace: PeerExecutionTrace,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const baseUrl = resolvePeerBaseUrl(peer);
    if (!baseUrl) {
      throw createPeerExecutionError({
        code: 'peer_not_routable',
        message: `Peer '${peer.identity.peerId}' does not advertise a reachable URL.`,
        retryable: false,
        peerId: peer.identity.peerId,
        status: 409,
      });
    }

    const timeoutSignal = AbortSignal.timeout(this.options.config.requestTimeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    const body = JSON.stringify(request);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: trace.transport === 'ndjson'
        ? 'application/x-ndjson'
        : 'text/event-stream',
      'x-cats-peer-id': this.options.localPeerId,
    };
    if (this.options.config.sharedSecret) {
      const timestamp = String(this.now());
      const nonce = randomUUID();
      headers.authorization = `Bearer ${this.options.config.sharedSecret}`;
      headers['x-cats-peer-timestamp'] = timestamp;
      headers['x-cats-peer-nonce'] = nonce;
      headers['x-cats-peer-signature'] = createPeerPayloadSignature(
        this.options.config.sharedSecret,
        body,
        {
          timestamp,
          nonce,
        },
      );
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}/peer/executions`, {
        method: 'POST',
        headers,
        body,
        signal: combinedSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted) {
        throw createPeerExecutionError({
          code: 'peer_request_timeout',
          message: `Peer '${peer.identity.peerId}' did not respond before the routing timeout.`,
          retryable: true,
          peerId: peer.identity.peerId,
          status: 504,
        });
      }

      if (isPeerExecutionError(error)) {
        throw error;
      }

      throw createPeerExecutionError({
        code: 'peer_http_error',
        message: `Failed to reach peer '${peer.identity.peerId}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        retryable: true,
        peerId: peer.identity.peerId,
        status: 502,
      });
    }

    if (!response.ok) {
      throw await buildHttpError(response, peer.identity.peerId);
    }

    const contentType = response.headers.get('content-type') || '';
    const parser = contentType.includes('application/x-ndjson')
      ? parseNdjsonEvents
      : contentType.includes('text/event-stream')
        ? parseSseEvents
        : undefined;

    if (!parser || !response.body) {
      throw createPeerExecutionError({
        code: 'peer_protocol_error',
        message: `Peer '${peer.identity.peerId}' returned an unsupported content type '${contentType || 'unknown'}'.`,
        retryable: false,
        peerId: peer.identity.peerId,
        status: 502,
      });
    }

    let sawTerminalEvent = false;
    for await (const event of parser(response.body)) {
      if (event.type === 'result' || event.type === 'error') {
        sawTerminalEvent = true;
      }
      yield decorateRoutedEvent(event, trace);
    }

    if (!sawTerminalEvent) {
      throw createPeerExecutionError({
        code: 'peer_stream_disconnect',
        message: `Peer '${peer.identity.peerId}' closed the execution stream without a terminal event.`,
        retryable: true,
        peerId: peer.identity.peerId,
        status: 502,
      });
    }
  }
}

async function buildHttpError(
  response: Response,
  peerId: string,
) {
  let message = `Peer '${peerId}' rejected the execution request with HTTP ${response.status}.`;
  let code: string | undefined;

  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.error === 'string' && body.error.trim().length > 0) {
      message = body.error;
    }
    if (typeof body.code === 'string' && body.code.trim().length > 0) {
      code = body.code;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }

  return createPeerExecutionError({
    code: code === 'peer_auth_required'
      || code === 'peer_auth_failed'
      || code === 'peer_auth_stale'
      || code === 'peer_auth_replayed'
      || code === 'peer_untrusted'
      || code === 'peer_rejected'
      || code === 'peer_execution_rejected'
      ? code
      : 'peer_http_error',
    message,
    retryable: response.status >= 500,
    peerId,
    status: response.status,
  });
}

function resolvePeerBaseUrl(
  peer: Pick<PeerRegistryEntry, 'identity'>,
): string | undefined {
  if (peer.identity.advertisedUrl) {
    return peer.identity.advertisedUrl.replace(/\/+$/, '');
  }

  if (peer.identity.advertisedHost && peer.identity.advertisedPort) {
    return `http://${peer.identity.advertisedHost}:${peer.identity.advertisedPort}`;
  }

  return undefined;
}

function sanitizeContext(
  context: SessionInfo['context'] | TurnInput['context'],
  sharedWorkspace: boolean,
): SessionInfo['context'] | undefined {
  if (!context) {
    return undefined;
  }

  const cloned = structuredClone(context);
  if (!sharedWorkspace && cloned.workspace) {
    delete cloned.workspace.cwd;
  }

  return cloned;
}

function decorateRoutedEvent(
  event: StreamEvent,
  trace: PeerExecutionTrace,
): StreamEvent {
  return {
    ...event,
    metadata: {
      ...(event.metadata || {}),
      peerRouting: {
        mode: 'peer',
        peerId: trace.peerId,
        requestId: trace.requestId,
        callerPeerId: trace.callerPeerId,
        callerSessionId: trace.callerSessionId,
        callerRunId: trace.callerRunId,
        transport: trace.transport,
        strategy: trace.strategy,
        workspaceMode: trace.workspaceMode,
        routedAt: trace.routedAt,
      },
    },
  };
}

async function* parseNdjsonEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      yield parseJsonEvent(line);
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    yield parseJsonEvent(trailing);
  }
}

async function* parseSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const frameIndex = buffer.indexOf('\n\n');
      if (frameIndex < 0) {
        break;
      }
      const frame = buffer.slice(0, frameIndex);
      buffer = buffer.slice(frameIndex + 2);
      const payload = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!payload) {
        continue;
      }
      yield parseJsonEvent(payload);
    }
  }
}

function parseJsonEvent(
  payload: string,
): StreamEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw createPeerExecutionError({
      code: 'peer_protocol_error',
      message: `Peer execution stream contained invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      retryable: false,
      status: 502,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createPeerExecutionError({
      code: 'peer_protocol_error',
      message: 'Peer execution stream yielded a non-object event payload.',
      retryable: false,
      status: 502,
    });
  }

  const event = parsed as StreamEvent;
  if (typeof event.type !== 'string') {
    throw createPeerExecutionError({
      code: 'peer_protocol_error',
      message: 'Peer execution stream yielded an event without a valid type.',
      retryable: false,
      status: 502,
    });
  }

  return event;
}
