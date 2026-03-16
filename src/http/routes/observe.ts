import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getRuntimeSessionManager, type AppContext } from '../app.js';
import type { StreamEvent } from '../../core/types.js';

export const observeRoutes = new Hono();

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
    return c.json({ error: 'No active worker for this session' }, 404);
  }

  return streamSSE(c, async (stream) => {
    let closed = false;

    const onEvent = (event: StreamEvent) => {
      if (closed) return;
      stream.writeSSE({
        data: JSON.stringify(event),
        event: event.type,
      }).catch(() => {
        closed = true;
      });
    };

    const onExit = () => {
      if (closed) return;
      stream.writeSSE({
        data: JSON.stringify({ type: 'session_closed' }),
        event: 'session_closed',
      }).catch(() => {});
      closed = true;
    };

    worker.on('event', onEvent as (...args: unknown[]) => void);
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
        if (!worker.active) {
          onExit();
          break;
        }
      }
    } finally {
      clearInterval(keepalive);
      worker.off('event', onEvent as (...args: unknown[]) => void);
      worker.off('exit', onExit);
    }
  });
});
