import { toSessionView } from '../backends/cli/pool/sessionView.js';
import type { SessionInfo } from '../backends/cli/pool/types.js';
import type { ProviderTargetDescriptor } from '../core/providerCatalog.js';
import {
  buildAgentDiagnosticSessionActivity,
  buildAgentDiagnosticSessionEvidence,
  type AgentDiagnosticSessionActivitySummary,
  type AgentDiagnosticSessionEvidenceSummary,
} from '../core/runtime/agentDiagnosticsEvidence.js';
import { buildSessionInspection } from '../core/runtime/sessionInspection.js';
import type { AppContext } from './app.js';
import {
  getAgentTargetEvidenceService,
  getRuntimeBrowserService,
  getRuntimeMeteringService,
  getRuntimeSessionManager,
} from './app.js';
import { resolveSessionProviderTarget } from './providerTargets.js';

export function buildAgentRuntimeSessionInspection(
  ctx: AppContext,
  session: SessionInfo,
) {
  const runtime = getRuntimeSessionManager(ctx);
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  return buildSessionInspection({
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
}

export function findLatestAgentDiagnosticSessionEvidence(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  excludeSessionId?: string,
): AgentDiagnosticSessionEvidenceSummary | undefined {
  let latest:
    | {
      recency: number;
      evidence: AgentDiagnosticSessionEvidenceSummary;
    }
    | undefined;

  for (const candidate of ctx.registry.list({ provider: target.providerName })) {
    if (excludeSessionId && candidate.id === excludeSessionId) {
      continue;
    }

    let candidateTarget: ProviderTargetDescriptor;
    try {
      candidateTarget = resolveSessionProviderTarget(ctx.config, candidate);
    } catch {
      continue;
    }

    if (
      candidateTarget.providerName !== target.providerName
      || candidateTarget.backend !== target.backend
      || candidateTarget.instanceId !== target.instanceId
    ) {
      continue;
    }

    const evidence = buildAgentDiagnosticSessionEvidence(
      candidate,
      buildAgentRuntimeSessionInspection(ctx, candidate),
      'runtime_registry_latest_session',
    );
    if (!evidence) {
      continue;
    }

    const recency = resolveSessionEvidenceRecency(candidate);
    if (!latest || recency >= latest.recency) {
      latest = { recency, evidence };
    }
  }

  return latest?.evidence;
}

export function findLatestAgentDiagnosticSessionActivity(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  excludeSessionId?: string,
): AgentDiagnosticSessionActivitySummary | undefined {
  let latest:
    | {
      recency: number;
      activity: AgentDiagnosticSessionActivitySummary;
    }
    | undefined;

  for (const candidate of ctx.registry.list({ provider: target.providerName })) {
    if (excludeSessionId && candidate.id === excludeSessionId) {
      continue;
    }

    let candidateTarget: ProviderTargetDescriptor;
    try {
      candidateTarget = resolveSessionProviderTarget(ctx.config, candidate);
    } catch {
      continue;
    }

    if (
      candidateTarget.providerName !== target.providerName
      || candidateTarget.backend !== target.backend
      || candidateTarget.instanceId !== target.instanceId
    ) {
      continue;
    }

    const activity = buildAgentDiagnosticSessionActivity(
      candidate,
      'runtime_registry_latest_session',
    );
    if (!activity) {
      continue;
    }

    const recency = resolveSessionEvidenceRecency(candidate);
    if (!latest || recency >= latest.recency) {
      latest = { recency, activity };
    }
  }

  return latest?.activity;
}

export function readLatestAgentTargetEvidence(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  excludeSessionId?: string,
): {
  activity?: AgentDiagnosticSessionActivitySummary;
  evidence?: AgentDiagnosticSessionEvidenceSummary;
} | undefined {
  const activity = findLatestAgentDiagnosticSessionActivity(ctx, target, excludeSessionId);
  const evidence = findLatestAgentDiagnosticSessionEvidence(ctx, target, excludeSessionId);
  if (activity || evidence) {
    return {
      ...(activity ? { activity } : {}),
      ...(evidence ? { evidence } : {}),
    };
  }

  const retained = getAgentTargetEvidenceService(ctx).get(target);
  if (!retained?.activity && !retained?.evidence) {
    return undefined;
  }

  return retained;
}

function resolveSessionEvidenceRecency(session: SessionInfo): number {
  return Date.parse(session.lastActivity || session.updatedAt || session.createdAt) || 0;
}
