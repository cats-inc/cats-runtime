import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from '../app.js';
import { formatSSE } from '../streaming.js';
import type { SessionInfo } from '../../backends/cli/pool/types.js';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../../backends/cli/config.js';

function appendHistory(sourcePath: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(sourcePath), { recursive: true });
  appendFileSync(sourcePath, JSON.stringify(entry) + '\n');
}

function getOrCreateSourcePath(
  session: SessionInfo,
  registry: SessionRegistry,
  config: CliRuntimeConfig,
): string {
  // Only reuse sourcePath if it's runtime-managed; never write into provider-native transcripts
  if (session.sourcePath && session.sourcePath.startsWith(config.sessionBaseDir)) {
    return session.sourcePath;
  }
  const historyDir = join(config.sessionBaseDir, 'history');
  const sourcePath = join(historyDir, `${session.id}.jsonl`);
  session.sourcePath = sourcePath;
  registry.setSourcePath(session.id, sourcePath);
  return sourcePath;
}

export const messageRoutes = new Hono();

function restoreReadyIfSessionStillInteractive(
  registry: SessionRegistry,
  id: string,
): void {
  const session = registry.get(id);
  if (!session) return;
  if (session.status === 'closing' || session.status === 'closed') return;
  registry.updateStatus(id, 'ready');
}

/** POST /sessions/:id/messages — send a message, stream response as SSE */
messageRoutes.post('/sessions/:id/messages', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (session.status === 'closed' || session.status === 'closing') {
    return c.json({ error: 'Session is closed. Resume it first.' }, 400);
  }

  const body = await c.req.json<{ message: string }>();
  if (!body.message) {
    return c.json({ error: 'message is required' }, 400);
  }

  const worker = ctx.pool.get(id);
  if (!worker) {
    return c.json({ error: 'No active worker. Resume the session first.' }, 404);
  }

  if (!worker.alive) {
    ctx.registry.updateStatus(id, 'closed');
    return c.json({ error: 'Worker process has exited' }, 410);
  }

  if (worker.busy) {
    return c.json({ error: 'Session is busy processing another message' }, 409);
  }

  ctx.registry.updateStatus(id, 'busy');

  // Check Accept header for format preference
  const accept = c.req.header('Accept') || '';
  const wantsNDJSON = accept.includes('application/x-ndjson');

  if (wantsNDJSON) {
    // Chunked NDJSON response
    c.header('Content-Type', 'application/x-ndjson');
    c.header('Transfer-Encoding', 'chunked');
    c.header('Cache-Control', 'no-cache');

    // Skip runtime-managed synthetic history for sessions with a provider-native transcript
    // (e.g. discovered Claude sessions resumed with --resume write their own)
    const sourcePath = session.providerSourcePath
      ? null
      : getOrCreateSourcePath(session, ctx.registry, ctx.config);
    if (sourcePath) {
      appendHistory(sourcePath, {
        type: 'user',
        message: { content: body.message },
        timestamp: new Date().toISOString(),
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        let assistantText = '';
        let completed = false;
        try {
          for await (const event of worker.streamMessage(body.message)) {
            const line = JSON.stringify(event) + '\n';
            controller.enqueue(new TextEncoder().encode(line));

            if ((event.type === 'init' || event.type === 'result') && event.sessionId) {
              ctx.registry.setProviderSessionId(id, event.sessionId);
            }

            if (event.type === 'text') {
              assistantText += event.text ?? '';
            }

            if (event.type === 'result') {
              completed = true;
              if (assistantText && sourcePath) {
                appendHistory(sourcePath, {
                  type: 'assistant',
                  message: { content: [{ type: 'text', text: assistantText }] },
                  timestamp: new Date().toISOString(),
                });
              }
              ctx.registry.recordMessage(
                id,
                event.usage?.inputTokens,
                event.usage?.outputTokens,
              );
              restoreReadyIfSessionStillInteractive(ctx.registry, id);
            }

            if (event.type === 'error') {
              completed = true;
              restoreReadyIfSessionStillInteractive(ctx.registry, id);
            }
          }

          if (!completed) {
            if (assistantText && sourcePath) {
              appendHistory(sourcePath, {
                type: 'assistant',
                message: { content: [{ type: 'text', text: assistantText }] },
                timestamp: new Date().toISOString(),
              });
            }
            ctx.registry.recordMessage(id);
            restoreReadyIfSessionStillInteractive(ctx.registry, id);
          }
        } catch (err) {
          const errorEvent = { type: 'error', text: String(err) };
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify(errorEvent) + '\n'),
          );
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // Default: SSE response
  const sseSourcePath = session.providerSourcePath
    ? null
    : getOrCreateSourcePath(session, ctx.registry, ctx.config);
  if (sseSourcePath) {
    appendHistory(sseSourcePath, {
      type: 'user',
      message: { content: body.message },
      timestamp: new Date().toISOString(),
    });
  }

  return streamSSE(c, async (stream) => {
    let assistantText = '';
    let completed = false;
    try {
      for await (const event of worker.streamMessage(body.message)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });

        if ((event.type === 'init' || event.type === 'result') && event.sessionId) {
          ctx.registry.setProviderSessionId(id, event.sessionId);
        }

        if (event.type === 'text') {
          assistantText += event.text ?? '';
        }

        if (event.type === 'result') {
          completed = true;
          if (assistantText && sseSourcePath) {
            appendHistory(sseSourcePath, {
              type: 'assistant',
              message: { content: [{ type: 'text', text: assistantText }] },
              timestamp: new Date().toISOString(),
            });
          }
          ctx.registry.recordMessage(
            id,
            event.usage?.inputTokens,
            event.usage?.outputTokens,
          );
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        }

        if (event.type === 'error') {
          completed = true;
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        }
      }

      if (!completed) {
        if (assistantText && sseSourcePath) {
          appendHistory(sseSourcePath, {
            type: 'assistant',
            message: { content: [{ type: 'text', text: assistantText }] },
            timestamp: new Date().toISOString(),
          });
        }
        ctx.registry.recordMessage(id);
        restoreReadyIfSessionStillInteractive(ctx.registry, id);
      }
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', text: String(err) }),
        event: 'error',
      });
      restoreReadyIfSessionStillInteractive(ctx.registry, id);
    }
  });
});
