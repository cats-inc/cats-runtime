import type { ProviderTargetDescriptor } from '../core/providerCatalog.js';
import type { AppContext } from './app.js';
import { resolveProviderTarget } from '../core/providerCatalog.js';
import { resolveSessionProviderTarget } from './providerTargets.js';

interface ProviderToolCatalogTargetExpectation {
  provider?: string;
  backend?: ProviderTargetDescriptor['backend'];
  instance?: string;
  target?: ProviderTargetDescriptor;
}

export interface ProviderToolCatalogContextRequest extends ProviderToolCatalogTargetExpectation {
  sessionId?: string;
  sessionKey?: string;
}

export interface ResolvedEffectiveToolCatalogContext {
  target: ProviderTargetDescriptor;
  sessionId?: string;
  sessionKey: string;
}

export function resolveEffectiveToolCatalogContext(
  ctx: Pick<AppContext, 'config' | 'registry'>,
  request: ProviderToolCatalogContextRequest,
  createError: (message: string) => Error = (message) => new Error(message),
): ResolvedEffectiveToolCatalogContext {
  if (!request.sessionId && !request.sessionKey) {
    throw createError("Effective tool inspection requires 'sessionId' or 'sessionKey'.");
  }

  const explicitTarget = resolveExplicitTarget(ctx, request, createError);

  if (request.sessionId) {
    const session = ctx.registry.get(request.sessionId);
    if (!session) {
      throw createError(
        `Session '${request.sessionId}' was not found for effective tool inspection.`,
      );
    }

    const resolvedTarget = resolveSessionProviderTarget(ctx.config, session);
    assertExpectedTargetMatches(resolvedTarget, request, createError);
    assertAgentTarget(resolvedTarget, createError);

    const resolvedSessionKey = session.sessionKey || request.sessionId;
    if (request.sessionKey && request.sessionKey !== resolvedSessionKey) {
      throw createError(
        `Session '${request.sessionId}' resolved sessionKey '${resolvedSessionKey}', `
          + `which does not match the requested sessionKey '${request.sessionKey}'.`,
      );
    }

    return {
      target: resolvedTarget,
      sessionId: request.sessionId,
      sessionKey: resolvedSessionKey,
    };
  }

  if (!explicitTarget) {
    throw createError(
      "Effective tool inspection with 'sessionKey' requires 'provider', 'backend', and 'instance'.",
    );
  }

  assertAgentTarget(explicitTarget, createError);

  return {
    target: explicitTarget,
    sessionKey: request.sessionKey as string,
  };
}

function resolveExplicitTarget(
  ctx: Pick<AppContext, 'config'>,
  request: ProviderToolCatalogContextRequest,
  createError: (message: string) => Error,
): ProviderTargetDescriptor | undefined {
  if (request.target) {
    return request.target;
  }

  const hasAnyTargetFilter = Boolean(request.provider || request.backend || request.instance);
  if (!hasAnyTargetFilter) {
    return undefined;
  }

  if (!request.provider || !request.backend || !request.instance) {
    throw createError(
      "Effective tool inspection with 'sessionKey' requires 'provider', 'backend', and 'instance'.",
    );
  }

  return resolveProviderTarget(
    ctx.config,
    request.provider,
    `${request.backend}/${request.instance}`,
  );
}

function assertExpectedTargetMatches(
  target: ProviderTargetDescriptor,
  request: ProviderToolCatalogContextRequest,
  createError: (message: string) => Error,
): void {
  const expectedTarget = request.target;
  if (expectedTarget) {
    if (
      expectedTarget.providerName !== target.providerName
      || expectedTarget.backend !== target.backend
      || expectedTarget.instanceId !== target.instanceId
    ) {
      throw createError(
        `Session '${request.sessionId}' does not belong to `
          + `${expectedTarget.providerName}/${expectedTarget.backend}/${expectedTarget.instanceId}.`,
      );
    }
    return;
  }

  if (
    request.provider && request.provider !== target.providerName
    || request.backend && request.backend !== target.backend
    || request.instance && request.instance !== target.instanceId
  ) {
    throw createError(
      `Session '${request.sessionId}' does not belong to `
        + `${request.provider || target.providerName}/`
        + `${request.backend || target.backend}/`
        + `${request.instance || target.instanceId}.`,
    );
  }
}

function assertAgentTarget(
  target: ProviderTargetDescriptor,
  createError: (message: string) => Error,
): void {
  if (target.backend !== 'agent') {
    throw createError(
      `Session-effective tool inspection is only supported for agent targets; `
        + `${target.providerName}/${target.backend}/${target.instanceId} is not eligible.`,
    );
  }
}
