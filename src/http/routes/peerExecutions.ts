import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from '../app.js';
import { peerExecutionAuth } from '../peerAuth.js';
import { toPeerExecutionErrorEvent } from '../../core/peers/errors.js';
import { parseInvocationContext } from '../parsing.js';
import type {
  PeerExecutionRequest,
} from '../../core/peers/types.js';

export const peerExecutionRoutes = new Hono();

peerExecutionRoutes.use('/peer/executions', peerExecutionAuth());

peerExecutionRoutes.post('/peer/executions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const callerPeerId = c.get('peerCallerId' as never) as string | undefined;
  const request = await c.req.json<unknown>().catch(() => undefined);
  const parsed = parsePeerExecutionRequest(request);

  if (!parsed.ok) {
    return c.json({
      error: parsed.error,
      code: 'peer_execution_rejected',
    }, 400);
  }

  if (callerPeerId && parsed.value.caller.peerId !== callerPeerId) {
    return c.json({
      error: `Peer caller id '${parsed.value.caller.peerId}' does not match authenticated peer '${callerPeerId}'.`,
      code: 'peer_auth_failed',
    }, 403);
  }

  if (!ctx.peerExecutionService) {
    return c.json({
      error: 'Peer execution service is not initialized.',
      code: 'peer_execution_rejected',
    }, 503);
  }

  const accept = c.req.header('Accept') || '';
  const wantsNdjson = accept.includes('application/x-ndjson');
  const signal = c.req.raw.signal;

  if (wantsNdjson) {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of ctx.peerExecutionService!.execute(parsed.value, signal)) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
          }
        } catch (error) {
          const errorEvent = toPeerExecutionErrorEvent(error, {
            code: 'peer_execution_rejected',
            message: 'Peer execution failed before completion.',
            retryable: false,
            status: 500,
          });
          controller.enqueue(new TextEncoder().encode(JSON.stringify(errorEvent) + '\n'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson',
        'cache-control': 'no-cache',
        'transfer-encoding': 'chunked',
      },
    });
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of ctx.peerExecutionService!.execute(parsed.value, signal)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      }
    } catch (error) {
      const errorEvent = toPeerExecutionErrorEvent(error, {
        code: 'peer_execution_rejected',
        message: 'Peer execution failed before completion.',
        retryable: false,
        status: 500,
      });
      await stream.writeSSE({
        data: JSON.stringify(errorEvent),
        event: errorEvent.type,
      });
    }
  });
});

function parsePeerExecutionRequest(
  value: unknown,
): { ok: true; value: PeerExecutionRequest } | { ok: false; error: string } {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Request body must be an object.' };
    }

    const record = value as Record<string, unknown>;
    const caller = record.caller;
    const target = record.target;
    const workspace = record.workspace;
    const turn = record.turn;

    if (!caller || typeof caller !== 'object' || Array.isArray(caller)) {
      return { ok: false, error: 'caller is required.' };
    }
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return { ok: false, error: 'target is required.' };
    }
    if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
      return { ok: false, error: 'workspace is required.' };
    }
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      return { ok: false, error: 'turn is required.' };
    }

    const parsed: PeerExecutionRequest = {
      caller: {
        peerId: parseRequiredString((caller as Record<string, unknown>).peerId, 'caller.peerId'),
        sessionId: parseRequiredString((caller as Record<string, unknown>).sessionId, 'caller.sessionId'),
        runId: parseRequiredString((caller as Record<string, unknown>).runId, 'caller.runId'),
        traceId: parseOptionalString((caller as Record<string, unknown>).traceId),
      },
      target: {
        provider: parseRequiredString((target as Record<string, unknown>).provider, 'target.provider'),
        backend: parseOptionalBackend((target as Record<string, unknown>).backend),
        instance: parseOptionalString((target as Record<string, unknown>).instance),
        model: parseOptionalString((target as Record<string, unknown>).model),
      },
      workspace: {
        mode: parseWorkspaceMode((workspace as Record<string, unknown>).mode),
        cwd: parseOptionalString((workspace as Record<string, unknown>).cwd),
      },
      turn: {
        message: parseRequiredString((turn as Record<string, unknown>).message, 'turn.message'),
        instructions: parseOptionalString((turn as Record<string, unknown>).instructions),
        context: parseContext((turn as Record<string, unknown>).context),
      },
    };

    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseRequiredString(
  value: unknown,
  field: string,
): string {
  const parsed = parseOptionalString(value);
  if (!parsed) {
    throw new Error(`${field} is required.`);
  }
  return parsed;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseOptionalBackend(value: unknown): PeerExecutionRequest['target']['backend'] {
  return value === 'cli' || value === 'api' || value === 'local' || value === 'agent'
    ? value
    : undefined;
}

function parseWorkspaceMode(
  value: unknown,
): PeerExecutionRequest['workspace']['mode'] {
  if (value === 'none' || value === 'read_only') {
    return value;
  }

  throw new Error("workspace.mode must be 'none' or 'read_only'.");
}

function parseContext(
  value: unknown,
): PeerExecutionRequest['turn']['context'] {
  return parseInvocationContext(value);
}
