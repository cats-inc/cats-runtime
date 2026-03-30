import { inspectAgentTarget } from '../backends/agent/inspection.js';
import type { AgentAdapterInspection } from '../backends/agent/types.js';
import { inspectApiTarget } from '../backends/api/inspection.js';
import type { ApiRuntimeInspection } from '../backends/api/inspection.js';
import type { BackendKind } from '../backends/cli/config.js';
import type { SessionInfo } from '../backends/cli/pool/types.js';
import type { ProviderTargetDescriptor } from '../core/providerCatalog.js';
import { buildProviderContinuitySummary, type ProviderContinuitySummary } from '../core/providerContinuity.js';
import {
  buildProviderToolingSummary,
  type ProviderToolingSummary,
} from '../core/tools/providerTooling.js';
import type { ProviderCapabilities } from '../core/types.js';
import type { AppContext } from './app.js';
import { resolveSessionProviderTarget } from './providerTargets.js';

export interface SessionProviderTargetSummary {
  provider: string;
  backend: BackendKind;
  instance: string;
  target: string;
  resolved: boolean;
  transport?: string;
  model?: string;
  continuity: ProviderContinuitySummary;
  tooling: ProviderToolingSummary;
  apiRuntime?: ApiRuntimeInspection;
  agentRuntime?: AgentAdapterInspection;
  resolutionWarning?: string;
}

interface SessionProviderTargetSummaryOptions {
  expensiveCliCapabilities?: boolean;
}

function getSessionBackend(
  session: Pick<SessionInfo, 'providerBackend'>,
): BackendKind {
  return session.providerBackend || 'cli';
}

function buildFallbackTarget(
  session: Pick<SessionInfo, 'providerName' | 'providerBackend' | 'providerInstanceId'>,
): ProviderTargetDescriptor {
  return {
    providerName: session.providerName,
    backend: getSessionBackend(session),
    instanceId: session.providerInstanceId || 'default',
    defaultTarget: false,
  };
}

function buildFallbackCapabilities(
  session: Pick<SessionInfo, 'providerName' | 'providerBackend'>,
): ProviderCapabilities {
  const backend = getSessionBackend(session);
  if (backend === 'api' || backend === 'local') {
    return {
      resume: true,
      fork: true,
      permissions: true,
    };
  }

  if (backend === 'agent') {
    return {
      resume: true,
      fork: true,
      permissions: false,
    };
  }

  switch (session.providerName) {
    case 'claude':
    case 'codex':
      return {
        resume: true,
        fork: true,
        permissions: true,
      };
    case 'auggie':
    case 'kiro':
    case 'kilo':
    case 'opencode':
      return {
        resume: true,
        fork: false,
        permissions: true,
      };
    default:
      return {
        resume: true,
        fork: false,
        permissions: false,
      };
  }
}

function shouldUseExpensiveCliCapabilities(
  session: Pick<SessionInfo, 'providerBackend'>,
  options: SessionProviderTargetSummaryOptions,
): boolean {
  return getSessionBackend(session) !== 'cli' || options.expensiveCliCapabilities !== false;
}

function resolveSessionCapabilities(
  ctx: AppContext,
  session: Pick<SessionInfo, 'providerName' | 'providerBackend' | 'providerInstanceId'>,
  options: SessionProviderTargetSummaryOptions,
): ProviderCapabilities {
  if (!shouldUseExpensiveCliCapabilities(session, options)) {
    return buildFallbackCapabilities(session);
  }

  const backend = getSessionBackend(session);
  try {
    if (backend === 'cli') {
      return ctx.pool.getCapabilities(session.providerName, session.providerInstanceId);
    }

    if (backend === 'agent') {
      return ctx.agentBackend?.getCapabilities() || buildFallbackCapabilities(session);
    }

    return ctx.apiBackend?.getCapabilities() || buildFallbackCapabilities(session);
  } catch {
    return buildFallbackCapabilities(session);
  }
}

function inspectSessionAgentRuntime(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
): AgentAdapterInspection | undefined {
  if (target.backend !== 'agent' || !target.remoteInstance) {
    return undefined;
  }

  return ctx.agentBackend
    ? ctx.agentBackend.inspect(target)
    : inspectAgentTarget(target.remoteInstance, { env: process.env });
}

function inspectSessionApiRuntime(
  target: ProviderTargetDescriptor,
): ApiRuntimeInspection | undefined {
  return inspectApiTarget(target);
}

function buildSummaryFromTarget(
  target: ProviderTargetDescriptor,
  capabilities: ProviderCapabilities,
  options: {
    resolved: boolean;
    apiRuntime?: ApiRuntimeInspection;
    agentRuntime?: AgentAdapterInspection;
    resolutionWarning?: string;
  },
): SessionProviderTargetSummary {
  return {
    provider: target.providerName,
    backend: target.backend,
    instance: target.instanceId,
    target: `${target.backend}/${target.instanceId}`,
    resolved: options.resolved,
    ...(target.remoteInstance?.transport ? { transport: target.remoteInstance.transport } : {}),
    ...(target.remoteInstance?.model ? { model: target.remoteInstance.model } : {}),
    continuity: buildProviderContinuitySummary(target, {
      capabilities,
      ...(options.agentRuntime ? { agentRuntime: options.agentRuntime } : {}),
    }),
    tooling: buildProviderToolingSummary(target, {
      ...(options.agentRuntime ? { agentRuntime: options.agentRuntime } : {}),
    }),
    ...(options.apiRuntime ? { apiRuntime: options.apiRuntime } : {}),
    ...(options.agentRuntime ? { agentRuntime: options.agentRuntime } : {}),
    ...(options.resolutionWarning ? { resolutionWarning: options.resolutionWarning } : {}),
  };
}

export function buildSessionProviderTargetSummary(
  ctx: AppContext,
  session: Pick<SessionInfo, 'providerName' | 'providerBackend' | 'providerInstanceId'>,
  options: SessionProviderTargetSummaryOptions = {},
): SessionProviderTargetSummary {
  const capabilities = resolveSessionCapabilities(ctx, session, options);

  try {
    const target = resolveSessionProviderTarget(ctx.config, session);
    const apiRuntime = inspectSessionApiRuntime(target);
    const agentRuntime = inspectSessionAgentRuntime(ctx, target);
    return buildSummaryFromTarget(target, capabilities, {
      resolved: true,
      ...(apiRuntime ? { apiRuntime } : {}),
      ...(agentRuntime ? { agentRuntime } : {}),
    });
  } catch (error) {
    return buildSummaryFromTarget(buildFallbackTarget(session), capabilities, {
      resolved: false,
      resolutionWarning: error instanceof Error ? error.message : String(error),
    });
  }
}
