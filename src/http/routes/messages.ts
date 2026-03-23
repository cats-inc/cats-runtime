import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getRuntimeMeteringService,
  getRuntimeSessionManager,
  type AppContext,
} from '../app.js';
import type { SessionInfo, SessionInvocationContext, TurnInput } from '../../backends/cli/pool/types.js';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../../backends/cli/config.js';
import type { StreamEvent } from '../../core/types.js';
import {
  resolveRuntimeSkillManifest,
} from '../../core/skills/catalog.js';
import { resolveProviderTarget } from '../../core/providerCatalog.js';
import {
  parseInvocationContext,
  parseOptionalString,
  parseRuntimeSkillManifest,
} from '../parsing.js';
import { isPiUnknownSessionError, resolvePiResumeTarget } from '../../backends/cli/pi/resume.js';
import { toRuntimeSkillErrorResponse } from '../runtimeSkillErrors.js';

function appendHistory(sourcePath: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(sourcePath), { recursive: true });
  appendFileSync(sourcePath, JSON.stringify(entry) + '\n');
}

function appendUserTurnHistory(
  sourcePath: string,
  turnInput: TurnInput,
): void {
  appendHistory(sourcePath, {
    type: 'user',
    message: { content: turnInput.message },
    instructions: turnInput.instructions,
    skills: turnInput.skills,
    context: turnInput.context,
    outputDir: turnInput.outputDir,
    timestamp: new Date().toISOString(),
  });
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
  try {
    getRuntimeSessionManager(ctx).spawn(id, session.providerName, {
      cwd: session.cwd,
      workspaceMode: session.workspaceMode,
      model: session.model,
      instructionsFile: session.skills?.delivery.instructions?.filePath,
      permissionMode: session.permissionMode,
      allowedTools: session.allowedTools,
    }, session.providerInstanceId, 'cli');
  } catch {
    return false;
  }

  return true;
}

function ensureRecoveredPiHistorySourcePath(
  ctx: AppContext,
  id: string,
  turnInput: TurnInput,
  state: { sourcePath: string | null },
): void {
  if (state.sourcePath) {
    return;
  }

  const updatedSession = ctx.registry.get(id);
  if (!updatedSession) {
    return;
  }

  state.sourcePath = getOrCreateSourcePath(updatedSession, ctx.registry, ctx.config);
  appendUserTurnHistory(state.sourcePath, turnInput);
}

function shouldRespawnPiWorkerForSkillMutation(
  session: SessionInfo,
  nextSkills: SessionInfo['skills'],
  explicitSkillsMutation: boolean,
): boolean {
  if (
    !explicitSkillsMutation
    || session.providerName !== 'pi'
    || session.providerBackend !== 'cli'
  ) {
    return false;
  }

  return session.skills?.delivery.instructions?.filePath
    !== nextSkills?.delivery.instructions?.filePath;
}

function tryRespawnPiWorkerForSkillMutation(
  ctx: AppContext,
  session: SessionInfo,
): boolean {
  if (session.providerName !== 'pi' || session.providerBackend !== 'cli') {
    return false;
  }

  let resumeTarget;
  try {
    resumeTarget = resolvePiResumeTarget(ctx.config, session);
  } catch {
    return false;
  }

  const runtime = getRuntimeSessionManager(ctx);
  runtime.kill(session.id);
  runtime.spawn(session.id, session.providerName, {
    cwd: session.cwd,
    workspaceMode: session.workspaceMode,
    model: session.model,
    resumeSourcePath: resumeTarget.runtimeSourcePath,
    instructionsFile: session.skills?.delivery.instructions?.filePath,
    permissionMode: session.permissionMode,
    allowedTools: session.allowedTools,
  }, session.providerInstanceId, 'cli');
  ctx.registry.updateStatus(session.id, 'ready');
  return true;
}

function guardrailHttpStatus(
  outcome: 'blocked' | 'cooldown',
): 403 | 429 {
  return outcome === 'cooldown' ? 429 : 403;
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
    skills?: unknown;
    context?: SessionInvocationContext;
    outputDir?: string;
  }>();
  const message = parseOptionalString(body.message);
  if (!message) {
    return c.json({ error: 'message is required' }, 400);
  }

  const instructions = parseOptionalString(body.instructions);
  const parsedSkills = parseRuntimeSkillManifest(body.skills);
  if (parsedSkills.error) {
    return c.json({ error: parsedSkills.error }, 400);
  }
  let skills = session.skills;
  if (parsedSkills.clear) {
    skills = undefined;
  } else {
    try {
      const providerTarget = resolveProviderTarget(
        ctx.config,
        session.providerName,
        session.providerBackend && session.providerInstanceId
          ? `${session.providerBackend}/${session.providerInstanceId}`
          : session.providerInstanceId,
      );
      skills = resolveRuntimeSkillManifest(parsedSkills.manifest, {
        sessionId: session.id,
        providerName: providerTarget.providerName,
        providerBackend: providerTarget.backend,
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        sessionBaseDir: ctx.config.sessionBaseDir,
        baseInstructionsFile: providerTarget.cliInstance?.piInstructionsFile,
      }) ?? session.skills;
    } catch (error) {
      const runtimeSkillError = toRuntimeSkillErrorResponse(error);
      if (runtimeSkillError) {
        return c.json(runtimeSkillError.body, runtimeSkillError.status);
      }
      throw error;
    }
  }
  const context = parseInvocationContext(body.context);
  const outputDir = parseOptionalString(body.outputDir);
  const turnInput: TurnInput = {
    message,
    instructions: instructions ?? session.instructions,
    skills,
    context: context ?? session.context,
    outputDir: outputDir ?? session.outputDir,
  };
  const explicitSkillsMutation = body.skills !== undefined;
  const shouldRespawnPi = shouldRespawnPiWorkerForSkillMutation(
    session,
    skills,
    explicitSkillsMutation,
  );
  if (instructions !== undefined || body.skills !== undefined || context !== undefined || outputDir !== undefined) {
    ctx.registry.updateSessionMetadata(id, {
      instructions: instructions ?? session.instructions,
      skills,
      context: turnInput.context,
      outputDir: turnInput.outputDir,
    });
  }

  const runtime = getRuntimeSessionManager(ctx);
  let worker = runtime.get(id);
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

  if (shouldRespawnPi) {
    const updatedSession = ctx.registry.get(id) ?? session;
    if (tryRespawnPiWorkerForSkillMutation(ctx, updatedSession)) {
      worker = runtime.get(id);
    }
  }

  if (!worker) {
    return c.json({ error: 'No active worker. Resume the session first.' }, 404);
  }

  if (!worker.active) {
    ctx.registry.updateStatus(id, 'closed');
    return c.json({ error: 'Worker process has exited' }, 410);
  }

  const executionSession = ctx.registry.get(id) ?? session;
  const metering = getRuntimeMeteringService(ctx);
  const preflight = metering.evaluatePreflight(executionSession);
  if (preflight.outcome === 'blocked' || preflight.outcome === 'cooldown') {
    runtime.recordRejectedRun(executionSession, turnInput, preflight);
    return c.json({
      error: preflight.reason,
      code: preflight.outcome === 'cooldown' ? 'guardrail_cooldown' : 'guardrail_blocked',
      guardrail: preflight,
    }, {
      status: guardrailHttpStatus(preflight.outcome),
    });
  }
  const warningEvent = preflight.outcome === 'warned'
    ? metering.createWarningProgressEvent(executionSession, preflight)
    : undefined;

  runtime.beginRun(
    executionSession,
    turnInput,
    preflight.outcome === 'warned' ? { guardrail: preflight } : {},
  );
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
    const historyState = {
      sourcePath: session.providerSourcePath
      ? null
      : getOrCreateSourcePath(session, ctx.registry, ctx.config),
    };
    if (historyState.sourcePath) {
      appendUserTurnHistory(historyState.sourcePath, turnInput);
    }

    const stream = new ReadableStream({
      async start(controller) {
        let assistantText = '';
        let completed = false;
        const turnStartedAt = Date.now();
        try {
          if (warningEvent) {
            runtime.observeEvent(id, warningEvent);
            controller.enqueue(new TextEncoder().encode(JSON.stringify(warningEvent) + '\n'));
          }
          for await (const event of streamTurnWithPiRecovery(ctx, id, turnInput, () => {
            ensureRecoveredPiHistorySourcePath(ctx, id, turnInput, historyState);
          })) {
            const observedEvent = metering.observeEvent(executionSession, event, { turnStartedAt });
            runtime.observeEvent(id, observedEvent);
            const line = JSON.stringify(observedEvent) + '\n';
            controller.enqueue(new TextEncoder().encode(line));

            if ((observedEvent.type === 'init' || observedEvent.type === 'result') && (observedEvent.providerSessionId || observedEvent.sessionId)) {
              ctx.registry.setProviderSessionId(id, observedEvent.providerSessionId || observedEvent.sessionId!);
            }
            if (observedEvent.providerState !== undefined) {
              ctx.registry.setProviderState(id, observedEvent.providerState);
            }
            if (observedEvent.artifacts !== undefined || observedEvent.summary !== undefined) {
              ctx.registry.updateSessionMetadata(id, {
                artifacts: observedEvent.artifacts ?? session.artifacts,
                summary: observedEvent.summary,
              });
            }

            if (observedEvent.type === 'text') {
              assistantText += observedEvent.text ?? '';
            }

            if (observedEvent.type === 'tool_use' && historyState.sourcePath) {
              assistantText = flushAssistantText(historyState.sourcePath, assistantText);
              appendHistory(historyState.sourcePath, {
                type: 'tool_use',
                toolId: observedEvent.toolId,
                toolName: observedEvent.toolName,
                arguments: observedEvent.toolArgs ?? {},
                timestamp: new Date().toISOString(),
              });
            }

            if (observedEvent.type === 'tool_result' && historyState.sourcePath) {
              appendHistory(historyState.sourcePath, {
                type: 'tool_result',
                toolId: observedEvent.toolId,
                toolName: observedEvent.toolName,
                text: observedEvent.text ?? '',
                isError: observedEvent.isError === true,
                timestamp: new Date().toISOString(),
              });
            }

            if (observedEvent.type === 'result') {
              completed = true;
              assistantText = flushAssistantText(historyState.sourcePath, assistantText);
              ctx.registry.recordMessage(
                id,
                observedEvent.usage?.inputTokens,
                observedEvent.usage?.outputTokens,
              );
              restoreReadyIfSessionStillInteractive(ctx.registry, id);
            }

            if (observedEvent.type === 'error') {
              completed = true;
              assistantText = flushAssistantText(historyState.sourcePath, assistantText);
              restoreReadyIfSessionStillInteractive(ctx.registry, id);
            }
          }

          if (!completed) {
            assistantText = flushAssistantText(historyState.sourcePath, assistantText);
            ctx.registry.recordMessage(id);
            restoreReadyIfSessionStillInteractive(ctx.registry, id);
          }
        } catch (err) {
          const errorEvent = metering.observeEvent(executionSession, {
            type: 'error',
            text: String(err),
          }, { turnStartedAt });
          runtime.observeEvent(id, errorEvent);
          assistantText = flushAssistantText(historyState.sourcePath, assistantText);
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
  const sseHistoryState = {
    sourcePath: session.providerSourcePath
    ? null
    : getOrCreateSourcePath(session, ctx.registry, ctx.config),
  };
  if (sseHistoryState.sourcePath) {
    appendUserTurnHistory(sseHistoryState.sourcePath, turnInput);
  }

  return streamSSE(c, async (stream) => {
    let assistantText = '';
    let completed = false;
    const turnStartedAt = Date.now();
    try {
      if (warningEvent) {
        runtime.observeEvent(id, warningEvent);
        await stream.writeSSE({
          data: JSON.stringify(warningEvent),
          event: warningEvent.type,
        });
      }
      for await (const event of streamTurnWithPiRecovery(ctx, id, turnInput, () => {
        ensureRecoveredPiHistorySourcePath(ctx, id, turnInput, sseHistoryState);
      })) {
        const observedEvent = metering.observeEvent(executionSession, event, { turnStartedAt });
        runtime.observeEvent(id, observedEvent);
        await stream.writeSSE({
          data: JSON.stringify(observedEvent),
          event: observedEvent.type,
        });

        if ((observedEvent.type === 'init' || observedEvent.type === 'result') && (observedEvent.providerSessionId || observedEvent.sessionId)) {
          ctx.registry.setProviderSessionId(id, observedEvent.providerSessionId || observedEvent.sessionId!);
        }
        if (observedEvent.providerState !== undefined) {
          ctx.registry.setProviderState(id, observedEvent.providerState);
        }
        if (observedEvent.artifacts !== undefined || observedEvent.summary !== undefined) {
          ctx.registry.updateSessionMetadata(id, {
            artifacts: observedEvent.artifacts ?? session.artifacts,
            summary: observedEvent.summary,
          });
        }

        if (observedEvent.type === 'text') {
          assistantText += observedEvent.text ?? '';
        }

        if (observedEvent.type === 'tool_use' && sseHistoryState.sourcePath) {
          assistantText = flushAssistantText(sseHistoryState.sourcePath, assistantText);
          appendHistory(sseHistoryState.sourcePath, {
            type: 'tool_use',
            toolId: observedEvent.toolId,
            toolName: observedEvent.toolName,
            arguments: observedEvent.toolArgs ?? {},
            timestamp: new Date().toISOString(),
          });
        }

        if (observedEvent.type === 'tool_result' && sseHistoryState.sourcePath) {
          appendHistory(sseHistoryState.sourcePath, {
            type: 'tool_result',
            toolId: observedEvent.toolId,
            toolName: observedEvent.toolName,
            text: observedEvent.text ?? '',
            isError: observedEvent.isError === true,
            timestamp: new Date().toISOString(),
          });
        }

        if (observedEvent.type === 'result') {
          completed = true;
          assistantText = flushAssistantText(sseHistoryState.sourcePath, assistantText);
          ctx.registry.recordMessage(
            id,
            observedEvent.usage?.inputTokens,
            observedEvent.usage?.outputTokens,
          );
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        }

        if (observedEvent.type === 'error') {
          completed = true;
          assistantText = flushAssistantText(sseHistoryState.sourcePath, assistantText);
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        }
      }

      if (!completed) {
        assistantText = flushAssistantText(sseHistoryState.sourcePath, assistantText);
        ctx.registry.recordMessage(id);
        restoreReadyIfSessionStillInteractive(ctx.registry, id);
      }
    } catch (err) {
      assistantText = flushAssistantText(sseHistoryState.sourcePath, assistantText);
      const errorEvent = metering.observeEvent(executionSession, {
        type: 'error',
        text: String(err),
      }, { turnStartedAt });
      runtime.observeEvent(id, errorEvent);
      await stream.writeSSE({
        data: JSON.stringify(errorEvent),
        event: errorEvent.type,
      });
      restoreReadyIfSessionStillInteractive(ctx.registry, id);
    }
  });
});
