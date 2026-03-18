import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getRuntimeSessionManager, type AppContext } from '../app.js';
import type { SessionInfo, SessionInvocationContext, TurnInput } from '../../backends/cli/pool/types.js';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../../backends/cli/config.js';
import type { StreamEvent } from '../../core/types.js';
import { parseInvocationContext, parseOptionalString } from '../parsing.js';
import { isPiUnknownSessionError } from '../../backends/cli/pi/resume.js';

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

function flushAssistantText(
  sourcePath: string | null,
  assistantText: string,
): string {
  if (!assistantText || !sourcePath) {
    return '';
  }

  appendHistory(sourcePath, {
    type: 'assistant',
    message: { content: [{ type: 'text', text: assistantText }] },
    timestamp: new Date().toISOString(),
  });

  return '';
}

function restoreReadyIfSessionStillInteractive(
  registry: SessionRegistry,
  id: string,
): void {
  const session = registry.get(id);
  if (!session) return;
  if (session.status === 'closing' || session.status === 'closed') return;
  registry.updateStatus(id, 'ready');
}

async function* streamTurnWithPiRecovery(
  ctx: AppContext,
  id: string,
  turnInput: TurnInput,
  onRecovered?: () => void,
): AsyncGenerator<StreamEvent> {
  let recovered = false;

  while (true) {
    const worker = getRuntimeSessionManager(ctx).get(id);
    if (!worker) {
      throw new Error('No active worker. Resume the session first.');
    }
    if (!worker.active) {
      ctx.registry.updateStatus(id, 'closed');
      throw new Error('Worker process has exited');
    }

    let sawEvent = false;

    try {
      for await (const event of worker.streamMessage(turnInput)) {
        sawEvent = true;
        yield event;
      }
      return;
    } catch (err) {
      if (recovered || sawEvent || !recoverPiUnknownSession(ctx, id, err)) {
        throw err;
      }

      recovered = true;
      onRecovered?.();
    }
  }
}

function recoverPiUnknownSession(
  ctx: AppContext,
  id: string,
  error: unknown,
): boolean {
  const session = ctx.registry.get(id);
  if (
    !session
    || session.providerName !== 'pi'
    || session.providerBackend !== 'cli'
    || !isPiUnknownSessionError(error)
  ) {
    return false;
  }

  getRuntimeSessionManager(ctx).kill(id);
  ctx.registry.clearProviderResumeState(id, { clearProviderSourcePath: true });
  getRuntimeSessionManager(ctx).spawn(id, session.providerName, {
    cwd: session.cwd,
    workspaceMode: session.workspaceMode,
    model: session.model,
    permissionMode: session.permissionMode,
    allowedTools: session.allowedTools,
  }, session.providerInstanceId, 'cli');

  return true;
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

  const body = await c.req.json<{
    message: string;
    instructions?: string;
    context?: SessionInvocationContext;
    outputDir?: string;
  }>();
  const message = parseOptionalString(body.message);
  if (!message) {
    return c.json({ error: 'message is required' }, 400);
  }

  const instructions = parseOptionalString(body.instructions);
  const context = parseInvocationContext(body.context);
  const outputDir = parseOptionalString(body.outputDir);
  const turnInput: TurnInput = {
    message,
    instructions: instructions ?? session.instructions,
    context: context ?? session.context,
    outputDir: outputDir ?? session.outputDir,
  };
  if (instructions !== undefined || context !== undefined || outputDir !== undefined) {
    ctx.registry.updateSessionMetadata(id, {
      instructions: turnInput.instructions,
      context: turnInput.context,
      outputDir: turnInput.outputDir,
    });
  }

  const worker = getRuntimeSessionManager(ctx).get(id);
  if (!worker) {
    return c.json({ error: 'No active worker. Resume the session first.' }, 404);
  }

  if (!worker.active) {
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
    let sourcePath = session.providerSourcePath
      ? null
      : getOrCreateSourcePath(session, ctx.registry, ctx.config);
    if (sourcePath) {
      appendHistory(sourcePath, {
        type: 'user',
        message: { content: message },
        instructions: turnInput.instructions,
        context: turnInput.context,
        outputDir: turnInput.outputDir,
        timestamp: new Date().toISOString(),
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        let assistantText = '';
        let completed = false;
        try {
          for await (const event of streamTurnWithPiRecovery(ctx, id, turnInput, () => {
            if (!sourcePath) {
              const updatedSession = ctx.registry.get(id);
              if (updatedSession) {
                sourcePath = getOrCreateSourcePath(updatedSession, ctx.registry, ctx.config);
                appendHistory(sourcePath, {
                  type: 'user',
                  message: { content: message },
                  instructions: turnInput.instructions,
                  context: turnInput.context,
                  outputDir: turnInput.outputDir,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          })) {
            const line = JSON.stringify(event) + '\n';
            controller.enqueue(new TextEncoder().encode(line));

            if ((event.type === 'init' || event.type === 'result') && (event.providerSessionId || event.sessionId)) {
              ctx.registry.setProviderSessionId(id, event.providerSessionId || event.sessionId!);
            }
            if (event.providerState !== undefined) {
              ctx.registry.setProviderState(id, event.providerState);
            }
            if (event.artifacts !== undefined || event.summary !== undefined) {
              ctx.registry.updateSessionMetadata(id, {
                artifacts: event.artifacts ?? session.artifacts,
                summary: event.summary,
              });
            }

            if (event.type === 'text') {
              assistantText += event.text ?? '';
            }

            if (event.type === 'tool_use' && sourcePath) {
              assistantText = flushAssistantText(sourcePath, assistantText);
              appendHistory(sourcePath, {
                type: 'tool_use',
                toolId: event.toolId,
                toolName: event.toolName,
                arguments: event.toolArgs ?? {},
                timestamp: new Date().toISOString(),
              });
            }

            if (event.type === 'tool_result' && sourcePath) {
              appendHistory(sourcePath, {
                type: 'tool_result',
                toolId: event.toolId,
                toolName: event.toolName,
                text: event.text ?? '',
                isError: event.isError === true,
                timestamp: new Date().toISOString(),
              });
            }

            if (event.type === 'result') {
              completed = true;
              assistantText = flushAssistantText(sourcePath, assistantText);
              ctx.registry.recordMessage(
                id,
                event.usage?.inputTokens,
                event.usage?.outputTokens,
              );
              restoreReadyIfSessionStillInteractive(ctx.registry, id);
            }

            if (event.type === 'error') {
              completed = true;
              assistantText = flushAssistantText(sourcePath, assistantText);
              restoreReadyIfSessionStillInteractive(ctx.registry, id);
            }
          }

          if (!completed) {
            assistantText = flushAssistantText(sourcePath, assistantText);
            ctx.registry.recordMessage(id);
            restoreReadyIfSessionStillInteractive(ctx.registry, id);
          }
        } catch (err) {
          const errorEvent = { type: 'error', text: String(err) };
          assistantText = flushAssistantText(sourcePath, assistantText);
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
  let sseSourcePath = session.providerSourcePath
    ? null
    : getOrCreateSourcePath(session, ctx.registry, ctx.config);
  if (sseSourcePath) {
    appendHistory(sseSourcePath, {
      type: 'user',
      message: { content: message },
      instructions: turnInput.instructions,
      context: turnInput.context,
      outputDir: turnInput.outputDir,
      timestamp: new Date().toISOString(),
    });
  }

  return streamSSE(c, async (stream) => {
    let assistantText = '';
    let completed = false;
    try {
      for await (const event of streamTurnWithPiRecovery(ctx, id, turnInput, () => {
        if (!sseSourcePath) {
          const updatedSession = ctx.registry.get(id);
          if (updatedSession) {
            sseSourcePath = getOrCreateSourcePath(updatedSession, ctx.registry, ctx.config);
            appendHistory(sseSourcePath, {
              type: 'user',
              message: { content: message },
              instructions: turnInput.instructions,
              context: turnInput.context,
              outputDir: turnInput.outputDir,
              timestamp: new Date().toISOString(),
            });
          }
        }
      })) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });

        if ((event.type === 'init' || event.type === 'result') && (event.providerSessionId || event.sessionId)) {
          ctx.registry.setProviderSessionId(id, event.providerSessionId || event.sessionId!);
        }
        if (event.providerState !== undefined) {
          ctx.registry.setProviderState(id, event.providerState);
        }
        if (event.artifacts !== undefined || event.summary !== undefined) {
          ctx.registry.updateSessionMetadata(id, {
            artifacts: event.artifacts ?? session.artifacts,
            summary: event.summary,
          });
        }

        if (event.type === 'text') {
          assistantText += event.text ?? '';
        }

        if (event.type === 'tool_use' && sseSourcePath) {
          assistantText = flushAssistantText(sseSourcePath, assistantText);
          appendHistory(sseSourcePath, {
            type: 'tool_use',
            toolId: event.toolId,
            toolName: event.toolName,
            arguments: event.toolArgs ?? {},
            timestamp: new Date().toISOString(),
          });
        }

        if (event.type === 'tool_result' && sseSourcePath) {
          appendHistory(sseSourcePath, {
            type: 'tool_result',
            toolId: event.toolId,
            toolName: event.toolName,
            text: event.text ?? '',
            isError: event.isError === true,
            timestamp: new Date().toISOString(),
          });
        }

        if (event.type === 'result') {
          completed = true;
          assistantText = flushAssistantText(sseSourcePath, assistantText);
          ctx.registry.recordMessage(
            id,
            event.usage?.inputTokens,
            event.usage?.outputTokens,
          );
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        }

        if (event.type === 'error') {
          completed = true;
          assistantText = flushAssistantText(sseSourcePath, assistantText);
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        }
      }

      if (!completed) {
        assistantText = flushAssistantText(sseSourcePath, assistantText);
        ctx.registry.recordMessage(id);
        restoreReadyIfSessionStillInteractive(ctx.registry, id);
      }
    } catch (err) {
      assistantText = flushAssistantText(sseSourcePath, assistantText);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', text: String(err) }),
        event: 'error',
      });
      restoreReadyIfSessionStillInteractive(ctx.registry, id);
    }
  });
});
