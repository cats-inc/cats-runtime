import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getRuntimeBrowserService,
  getRuntimeMeteringService,
  getRuntimeSessionManager,
  type AppContext,
} from '../app.js';
import { buildSessionProviderTargetSummary } from '../sessionProviderTarget.js';
import { toSessionView } from '../../backends/cli/pool/sessionView.js';
import { createRuntimeContentBlockProjector } from '../../core/runtime/contentBlocks.js';
import { buildSessionInspection } from '../../core/runtime/sessionInspection.js';
import type { ContentBlockStreamEvent, StreamEvent } from '../../core/types.js';

export const observeRoutes = new Hono();

function buildSequencedObservedEvent(
  sessionId: string,
  sourceSeq: number,
  outputIndex: number,
  event: StreamEvent | ContentBlockStreamEvent,
): StreamEvent | ContentBlockStreamEvent | Record<string, unknown> {
  return {
    ...event,
    sessionId: typeof event.sessionId === 'string' && event.sessionId.trim().length > 0
      ? event.sessionId
      : sessionId,
    streamSeq: sourceSeq,
    streamSeqIndex: outputIndex,
  };
}

/** GET /sessions/:id/observe — machine-readable session/run inspection payload */
observeRoutes.get('/sessions/:id/observe', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const runtime = getRuntimeSessionManager(ctx);
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  const view = toSessionView(session, {
    attached: runtime.isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });

  return c.json({
    session: {
      ...view,
      providerTarget: buildSessionProviderTargetSummary(ctx, session),
      ...(wakeup ? { wakeup } : {}),
      inspection: buildSessionInspection({
        session,
        view,
        trackedState: runtime.getTrackedState(session.id),
        metering: getRuntimeMeteringService(ctx).buildSessionSnapshot(session),
        browserSessions: getRuntimeBrowserService(ctx).listSessions({
          runtimeSessionId: session.id,
        }),
      }),
    },
    historyPath: `/sessions/${session.id}/history`,
    observePath: `/sessions/${session.id}/observe`,
    stream: {
      path: `/sessions/${session.id}/stream`,
      available: Boolean(runtime.get(session.id)?.active),
    },
  });
});

/** GET /sessions/:id/stream — read-only SSE endpoint for live observation */
observeRoutes.get('/sessions/:id/stream', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const worker = getRuntimeSessionManager(ctx).get(id);
  if (!worker || !worker.active) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'session_closed' }),
        event: 'session_closed',
      });
    });
  }

  return streamSSE(c, async (stream) => {
    const runtime = getRuntimeSessionManager(ctx);
    let closed = false;
    const contentBlocks = createRuntimeContentBlockProjector();
    let writeQueue = Promise.resolve();
    let lastObservedSeq = 0;

    const enqueueObservedEvent = (sourceSeq: number, event: StreamEvent): void => {
      if (closed) return;
      const outputEvents = [event, ...contentBlocks.project(event)];
      writeQueue = writeQueue
        .then(async () => {
          for (const [outputIndex, outputEvent] of outputEvents.entries()) {
            await stream.writeSSE({
              data: JSON.stringify(
                buildSequencedObservedEvent(id, sourceSeq, outputIndex, outputEvent),
              ),
              event: outputEvent.type,
            });
          }
        })
        .catch(() => {
          closed = true;
        });
    };

    const closeStream = () => {
      if (closed) return;
      closed = true;
      // Queued behind events already observed, such as the final result.
      writeQueue = writeQueue
        .then(() => stream.writeSSE({
          data: JSON.stringify({ type: 'session_closed' }),
          event: 'session_closed',
        }))
        .catch(() => {});
    };

    // An ephemeral provider's process exits after every turn, and Auggie and
    // Kiro report the turn's result only after that exit. Closing on the exit
    // would drop the result, so the stream then waits for the run to end.
    let closeWhenRunEnds = false;
    const runInProgress = () => runtime.getTrackedState(id)?.currentRun !== undefined;

    const onObservedEvent = (entry: { seq: number; event: StreamEvent }) => {
      if (closed || entry.seq <= lastObservedSeq) {
        return;
      }
      lastObservedSeq = entry.seq;
      enqueueObservedEvent(entry.seq, entry.event);
      if (closeWhenRunEnds && (entry.event.type === 'result' || entry.event.type === 'error')) {
        closeStream();
      }
    };

    const onExit = () => {
      if (closed) return;
      if (worker.active && runInProgress()) {
        closeWhenRunEnds = true;
        return;
      }
      closeStream();
    };

    const unsubscribeObservedStream = runtime.subscribeObservedStream(id, onObservedEvent);
    for (const entry of runtime.getObservedStreamReplay(id)) {
      if (entry.seq <= lastObservedSeq) {
        continue;
      }
      lastObservedSeq = entry.seq;
      enqueueObservedEvent(entry.seq, entry.event);
    }
    worker.on('exit', onExit);

    // Keepalive every 15s
    const keepalive = setInterval(() => {
      if (closed) return;
      stream.writeSSE({ data: '', event: 'keepalive' }).catch(() => {
        closed = true;
      });
    }, 15_000);

    try {
      // Hold the stream open until client disconnects or worker exits
      while (!closed) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!worker.active || (closeWhenRunEnds && !runInProgress())) {
          closeStream();
          break;
        }
      }
    } finally {
      clearInterval(keepalive);
      unsubscribeObservedStream();
      worker.off('exit', onExit);
    }
    await writeQueue;
  });
});
