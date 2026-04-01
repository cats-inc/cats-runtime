import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getAgentTargetEvidenceService,
  getRuntimeBrowserService,
  getRuntimeMeteringService,
  getRuntimeSessionManager,
  type AppContext,
} from '../app.js';
import { toSessionView } from '../../backends/cli/pool/sessionView.js';
import type { SessionInfo, SessionInvocationContext, TurnInput } from '../../backends/cli/pool/types.js';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../../backends/cli/config.js';
import type {
  ErrorStreamEvent,
  InitStreamEvent,
  ResultStreamEvent,
  StreamEvent,
  TextStreamEvent,
  ToolResultStreamEvent,
  ToolUseStreamEvent,
} from '../../core/types.js';
import { hydrateSessionState } from '../../core/hydration/sessionHydration.js';
import { ManagedExecutionHandle } from '../../core/runtime/ManagedExecutionHandle.js';
import {
  buildAgentDiagnosticSessionActivity,
  buildAgentDiagnosticSessionEvidence,
} from '../../core/runtime/agentDiagnosticsEvidence.js';
import { createRuntimeContentBlockProjector } from '../../core/runtime/contentBlocks.js';
import { buildSessionInspection } from '../../core/runtime/sessionInspection.js';
import { buildRuntimeExecutionStrategySessionPatch } from '../../core/runtime/strategies/state.js';
import { parsePeerMessageRoutingInput } from '../../core/peers/PeerRoutingService.js';
import { toPeerExecutionErrorEvent } from '../../core/peers/errors.js';
import { resolveSessionProviderTarget } from '../providerTargets.js';
import {
  extractHydrationMetadata,
  parseInvocationContext,
  parseOptionalString,
  parseRuntimeExecutionStrategyRequest,
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
    sessionInstructions: turnInput.sessionInstructions,
    instructions: turnInput.instructions,
    skills: turnInput.skills,
    context: turnInput.context,
    outputDir: turnInput.outputDir,
    requestedStrategy: turnInput.requestedStrategy,
    acceptanceCriteria: turnInput.acceptanceCriteria,
    strategyContext: turnInput.strategyContext,
    correlation: turnInput.correlation,
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

function isSessionIdentityEvent(
  event: StreamEvent,
): event is InitStreamEvent | ResultStreamEvent {
  return event.type === 'init' || event.type === 'result';
}

function isTextStreamEvent(
  event: StreamEvent,
): event is TextStreamEvent {
  return event.type === 'text';
}

function isToolUseStreamEvent(
  event: StreamEvent,
): event is ToolUseStreamEvent {
  return event.type === 'tool_use';
}

function isToolResultStreamEvent(
  event: StreamEvent,
): event is ToolResultStreamEvent {
  return event.type === 'tool_result';
}

function isResultStreamEvent(
  event: StreamEvent,
): event is ResultStreamEvent {
  return event.type === 'result';
}

function isErrorStreamEvent(
  event: StreamEvent,
): event is ErrorStreamEvent {
  return event.type === 'error';
}

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

function toStreamOutputEvents(
  projector: ReturnType<typeof createRuntimeContentBlockProjector>,
  event: StreamEvent,
) {
  return [event, ...projector.project(event)];
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

async function closeManagedHandle(
  handle: ManagedExecutionHandle | undefined,
): Promise<void> {
  if (!handle?.active) {
    return;
  }

  await handle.close('close').catch(() => {});
}

async function* streamPeerExecutionWithFailures(
  client: NonNullable<AppContext['peerExecutionClient']>,
  peer: NonNullable<NonNullable<ReturnType<NonNullable<AppContext['peerRouting']>['decide']>['peer']>>,
  request: Parameters<NonNullable<AppContext['peerExecutionClient']>['streamExecution']>[1],
  trace: Parameters<NonNullable<AppContext['peerExecutionClient']>['streamExecution']>[2],
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  try {
    for await (const event of client.streamExecution(peer, request, trace, signal)) {
      yield event;
    }
  } catch (error) {
    yield toPeerExecutionErrorEvent(error, {
      code: 'peer_http_error',
      message: `Peer '${peer.identity.peerId}' execution failed.`,
      retryable: true,
      peerId: peer.identity.peerId,
      status: 502,
    });
  }
}

function applyObservedEventToSession(
  ctx: AppContext,
  sessionId: string,
  session: SessionInfo,
  observedEvent: StreamEvent,
  options: {
    peerRouted: boolean;
  },
): void {
  if (
    !options.peerRouted
    && isSessionIdentityEvent(observedEvent)
    && (observedEvent.providerSessionId || observedEvent.sessionId)
  ) {
    ctx.registry.setProviderSessionId(
      sessionId,
      observedEvent.providerSessionId || observedEvent.sessionId!,
    );
  }

  if (!options.peerRouted && observedEvent.providerState !== undefined) {
    ctx.registry.setProviderState(sessionId, observedEvent.providerState);
  }

  if (observedEvent.artifacts !== undefined || observedEvent.summary !== undefined) {
    ctx.registry.updateSessionMetadata(sessionId, {
      artifacts: observedEvent.artifacts ?? session.artifacts,
      summary: observedEvent.summary,
    });
  }
}

function summarizeSessionInputPreview(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

function persistAgentTargetEvidence(
  ctx: AppContext,
  sessionId: string,
): void {
  const session = ctx.registry.get(sessionId);
  if (!session) {
    return;
  }

  let providerTarget;
  try {
    providerTarget = resolveSessionProviderTarget(ctx.config, session);
  } catch {
    return;
  }

  if (providerTarget.backend !== 'agent') {
    return;
  }

  const runtime = getRuntimeSessionManager(ctx);
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  const inspection = buildSessionInspection({
    session,
    view: toSessionView(session, {
      attached: runtime.isAttached(session.id),
      externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
    }),
    trackedState: runtime.getTrackedState(session.id),
    metering: getRuntimeMeteringService(ctx).buildSessionSnapshot(session),
    wakeupPending: Boolean(wakeup?.pending),
    browserSessions: getRuntimeBrowserService(ctx).listSessions({
      runtimeSessionId: session.id,
    }),
  });

  getAgentTargetEvidenceService(ctx).record(providerTarget, {
    activity: buildAgentDiagnosticSessionActivity(session, 'retained_target_evidence'),
    evidence: buildAgentDiagnosticSessionEvidence(
      session,
      inspection,
      'retained_target_evidence',
    ),
  });
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
    requestedStrategy?: string;
    acceptanceCriteria?: string;
    strategyContext?: Record<string, unknown>;
    correlation?: Record<string, unknown>;
    routing?: unknown;
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
  const context = parseInvocationContext(body.context);
  const requestedHydrationMetadata = extractHydrationMetadata(
    context,
    parsedSkills.clear ? undefined : parsedSkills.manifest,
  );
  const strategyRequest = parseRuntimeExecutionStrategyRequest(
    body as unknown as Record<string, unknown>,
  );
  let skills = session.skills;
  let hydration = session.hydration;
  if (parsedSkills.clear) {
    skills = undefined;
  }
  if (body.skills !== undefined || requestedHydrationMetadata !== undefined || !session.hydration) {
    try {
      const providerTarget = resolveSessionProviderTarget(ctx.config, session);
      const hydrated = await hydrateSessionState({
        trigger: 'message',
        sessionId: session.id,
        providerName: providerTarget.providerName,
        providerBackend: providerTarget.backend,
        runtimeCwd: session.cwd,
        workspaceMode: session.workspaceMode,
        sessionBaseDir: ctx.config.sessionBaseDir,
        requestedSkills: parsedSkills.clear ? undefined : parsedSkills.manifest,
        existingSkills: parsedSkills.clear ? undefined : session.skills,
        requestedWorkspaceSourceCwd: session.hydration?.workspace.sourceCwd,
        existingHydration: session.hydration,
        baseInstructionsFile: providerTarget.cliInstance?.piInstructionsFile,
        metadata: requestedHydrationMetadata,
      });
      skills = hydrated.skills;
      hydration = hydrated.hydration;
    } catch (error) {
      const runtimeSkillError = toRuntimeSkillErrorResponse(error);
      if (runtimeSkillError) {
        return c.json(runtimeSkillError.body, runtimeSkillError.status);
      }
      throw error;
    }
  }
  const outputDir = parseOptionalString(body.outputDir);
  const turnInput: TurnInput = {
    message,
    sessionInstructions: session.instructions,
    instructions,
    skills,
    context: context ?? session.context,
    outputDir: outputDir ?? session.outputDir,
    requestedStrategy: strategyRequest?.requestedStrategy,
    acceptanceCriteria: strategyRequest?.acceptanceCriteria,
    strategyContext: strategyRequest?.strategyContext,
    correlation: strategyRequest?.correlation,
  };
  const inputPreview = summarizeSessionInputPreview(message);
  const explicitSkillsMutation = body.skills !== undefined;
  const shouldRespawnPi = shouldRespawnPiWorkerForSkillMutation(
    session,
    skills,
    explicitSkillsMutation,
  );
  if (
    instructions !== undefined
    || body.skills !== undefined
    || context !== undefined
    || outputDir !== undefined
    || strategyRequest !== undefined
    || !session.hydration
  ) {
    ctx.registry.updateSessionMetadata(id, {
      instructions: instructions ?? session.instructions,
      ...buildRuntimeExecutionStrategySessionPatch(session, {
        request: strategyRequest,
      }),
      skills,
      hydration,
      context: turnInput.context,
      outputDir: turnInput.outputDir,
      lastInputPreview: inputPreview,
    });
  } else {
    ctx.registry.updateSessionMetadata(id, {
      lastInputPreview: inputPreview,
    });
  }

  let routingInput;
  try {
    routingInput = parsePeerMessageRoutingInput(body.routing);
  } catch (error) {
    const routingErrorEvent = toPeerExecutionErrorEvent(error, {
      code: 'peer_not_routable',
      message: 'Invalid peer routing input.',
      retryable: false,
      status: 400,
    });
    return c.json({
      error: routingErrorEvent.text,
      code: (routingErrorEvent.metadata as Record<string, unknown>)?.peerRoutingFailure
        ? ((routingErrorEvent.metadata as Record<string, unknown>).peerRoutingFailure as Record<string, unknown>).code
        : 'peer_not_routable',
    }, 400);
  }

  const runtime = getRuntimeSessionManager(ctx);
  let worker = runtime.get(id);
  if (worker?.busy) {
    return c.json({ error: 'Session is busy processing another message' }, 409);
  }

  const executionSession = ctx.registry.get(id) ?? session;
  let routingDecision;
  try {
    if (routingInput?.mode === 'peer') {
      if (!ctx.peerRouting) {
        return c.json({
          error: 'Peer routing service is not initialized.',
          code: 'peer_route_disabled',
        }, 503);
      }
      routingDecision = ctx.peerRouting.decide(executionSession, routingInput);
    } else {
      routingDecision = {
        mode: 'local',
        reason: 'Peer routing was not requested.',
        localFallback: false,
        target: {
          provider: executionSession.providerName,
          backend: executionSession.providerBackend || 'cli',
          instance: executionSession.providerInstanceId || 'default',
          model: executionSession.model,
        },
      };
    }
  } catch (error) {
    const routingErrorEvent = toPeerExecutionErrorEvent(error, {
      code: 'peer_not_routable',
      message: 'Peer routing could not be resolved.',
      retryable: false,
      status: 409,
    });
    const failureMetadata = (routingErrorEvent.metadata || {}) as Record<string, unknown>;
    const failure = failureMetadata.peerRoutingFailure as Record<string, unknown> | undefined;
    return c.json({
      error: routingErrorEvent.text,
      code: typeof failure?.code === 'string' ? failure.code : 'peer_not_routable',
    }, (typeof failure?.status === 'number' ? failure.status : 409) as 400 | 403 | 404 | 409 | 503);
  }

  const peerRouted = routingDecision.mode === 'peer';

  if (peerRouted && (!ctx.peerExecutionClient || !routingInput || !routingDecision.peer)) {
    return c.json({
      error: 'Peer execution client is not initialized.',
      code: 'peer_route_disabled',
    }, 503);
  }

  if (!peerRouted && shouldRespawnPi) {
    const updatedSession = ctx.registry.get(id) ?? session;
    if (tryRespawnPiWorkerForSkillMutation(ctx, updatedSession)) {
      worker = runtime.get(id);
    }
  }

  if (!peerRouted && !worker) {
    return c.json({ error: 'No active worker. Resume the session first.' }, 404);
  }

  if (!peerRouted && worker && !worker.active) {
    ctx.registry.updateStatus(id, 'closed');
    return c.json({ error: 'Worker process has exited' }, 410);
  }

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

  const startedRun = runtime.beginRun(
    executionSession,
    turnInput,
    preflight.outcome === 'warned' ? { guardrail: preflight } : {},
  );
  ctx.registry.updateStatus(id, 'busy');

  // Check Accept header for format preference
  const accept = c.req.header('Accept') || '';
  const wantsNDJSON = accept.includes('application/x-ndjson');
  let peerHandle: ManagedExecutionHandle | undefined;

  if (peerRouted) {
    const peerExecutionClient = ctx.peerExecutionClient!;
    const peerEntry = routingDecision.peer!;
    const parsedRouting = routingInput!;
    const { request, trace } = peerExecutionClient.buildRequest({
      session: executionSession,
      turn: turnInput,
      peer: peerEntry,
      routing: parsedRouting,
      runId: startedRun.id,
      transport: wantsNDJSON ? 'ndjson' : 'sse',
    });
    peerHandle = new ManagedExecutionHandle({
      streamMessage: (_, signal) => streamPeerExecutionWithFailures(
        peerExecutionClient,
        peerEntry,
        request,
        trace,
        signal,
      ),
      onClose: async () => {
        runtime.detachExecutionHandle(id);
      },
    });
    runtime.attachExecutionHandle(id, peerHandle);
    worker = runtime.get(id);
  }

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
        const contentBlocks = createRuntimeContentBlockProjector();
        try {
          if (warningEvent) {
            runtime.observeEvent(id, warningEvent);
            for (const outputEvent of toStreamOutputEvents(contentBlocks, warningEvent)) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(outputEvent) + '\n'));
            }
          }
          const eventStream = peerRouted
            ? worker!.streamMessage(turnInput)
            : streamTurnWithPiRecovery(ctx, id, turnInput, () => {
                ensureRecoveredPiHistorySourcePath(ctx, id, turnInput, historyState);
              });
          for await (const event of eventStream) {
            const observedEvent = metering.observeEvent(executionSession, event, { turnStartedAt });
            runtime.observeEvent(id, observedEvent);
            for (const outputEvent of toStreamOutputEvents(contentBlocks, observedEvent)) {
              const line = JSON.stringify(outputEvent) + '\n';
              controller.enqueue(new TextEncoder().encode(line));
            }

            applyObservedEventToSession(ctx, id, session, observedEvent, {
              peerRouted,
            });

            if (isTextStreamEvent(observedEvent)) {
              assistantText += observedEvent.text;
            }

            if (isToolUseStreamEvent(observedEvent) && historyState.sourcePath) {
              assistantText = flushAssistantText(historyState.sourcePath, assistantText);
              appendHistory(historyState.sourcePath, {
                type: 'tool_use',
                toolId: observedEvent.toolId,
                toolName: observedEvent.toolName,
                arguments: observedEvent.toolArgs ?? {},
                timestamp: new Date().toISOString(),
              });
            }

            if (isToolResultStreamEvent(observedEvent) && historyState.sourcePath) {
              appendHistory(historyState.sourcePath, {
                type: 'tool_result',
                toolId: observedEvent.toolId,
                toolName: observedEvent.toolName,
                text: observedEvent.text ?? '',
                isError: observedEvent.isError === true,
                timestamp: new Date().toISOString(),
              });
            }

            if (isResultStreamEvent(observedEvent)) {
              completed = true;
              assistantText = flushAssistantText(historyState.sourcePath, assistantText);
              ctx.registry.recordMessage(
                id,
                observedEvent.usage,
              );
              restoreReadyIfSessionStillInteractive(ctx.registry, id);
            }

            if (isErrorStreamEvent(observedEvent)) {
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
          } satisfies ErrorStreamEvent, { turnStartedAt });
          runtime.observeEvent(id, errorEvent);
          assistantText = flushAssistantText(historyState.sourcePath, assistantText);
          for (const outputEvent of toStreamOutputEvents(contentBlocks, errorEvent)) {
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify(outputEvent) + '\n'),
            );
          }
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        } finally {
          await closeManagedHandle(peerHandle);
          persistAgentTargetEvidence(ctx, id);
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
    const contentBlocks = createRuntimeContentBlockProjector();
    try {
      if (warningEvent) {
        runtime.observeEvent(id, warningEvent);
        for (const outputEvent of toStreamOutputEvents(contentBlocks, warningEvent)) {
          await stream.writeSSE({
            data: JSON.stringify(outputEvent),
            event: outputEvent.type,
          });
        }
      }
      const eventStream = peerRouted
        ? worker!.streamMessage(turnInput)
        : streamTurnWithPiRecovery(ctx, id, turnInput, () => {
            ensureRecoveredPiHistorySourcePath(ctx, id, turnInput, sseHistoryState);
          });
      for await (const event of eventStream) {
        const observedEvent = metering.observeEvent(executionSession, event, { turnStartedAt });
        runtime.observeEvent(id, observedEvent);
        for (const outputEvent of toStreamOutputEvents(contentBlocks, observedEvent)) {
          await stream.writeSSE({
            data: JSON.stringify(outputEvent),
            event: outputEvent.type,
          });
        }

        applyObservedEventToSession(ctx, id, session, observedEvent, {
          peerRouted,
        });

        if (isTextStreamEvent(observedEvent)) {
          assistantText += observedEvent.text;
        }

        if (isToolUseStreamEvent(observedEvent) && sseHistoryState.sourcePath) {
          assistantText = flushAssistantText(sseHistoryState.sourcePath, assistantText);
          appendHistory(sseHistoryState.sourcePath, {
            type: 'tool_use',
            toolId: observedEvent.toolId,
            toolName: observedEvent.toolName,
            arguments: observedEvent.toolArgs ?? {},
            timestamp: new Date().toISOString(),
          });
        }

        if (isToolResultStreamEvent(observedEvent) && sseHistoryState.sourcePath) {
          appendHistory(sseHistoryState.sourcePath, {
            type: 'tool_result',
            toolId: observedEvent.toolId,
            toolName: observedEvent.toolName,
            text: observedEvent.text ?? '',
            isError: observedEvent.isError === true,
            timestamp: new Date().toISOString(),
          });
        }

        if (isResultStreamEvent(observedEvent)) {
          completed = true;
          assistantText = flushAssistantText(sseHistoryState.sourcePath, assistantText);
          ctx.registry.recordMessage(
            id,
            observedEvent.usage,
          );
          restoreReadyIfSessionStillInteractive(ctx.registry, id);
        }

        if (isErrorStreamEvent(observedEvent)) {
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
      } satisfies ErrorStreamEvent, { turnStartedAt });
      runtime.observeEvent(id, errorEvent);
      for (const outputEvent of toStreamOutputEvents(contentBlocks, errorEvent)) {
        await stream.writeSSE({
          data: JSON.stringify(outputEvent),
          event: outputEvent.type,
        });
      }
      restoreReadyIfSessionStillInteractive(ctx.registry, id);
    } finally {
      await closeManagedHandle(peerHandle);
      persistAgentTargetEvidence(ctx, id);
    }
  });
});
