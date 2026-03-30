import {
  getProviderDefaultInstanceId,
  resolveProviderInstance,
} from '../backends/cli/config.js';
import type { ProviderName } from '../backends/cli/providers/types.js';
import { resolveFileBackedProviderPath } from '../backends/cli/providerPaths.js';
import type { AppContext } from './app.js';

export function getCursorNative(ctx: AppContext, instanceId?: string) {
  return resolveNativeService(
    ctx,
    'cursor',
    instanceId,
    ctx.resolveCursorNative,
    ctx.cursorNative,
  );
}

export function getGooseNative(ctx: AppContext, instanceId?: string) {
  return resolveNativeService(
    ctx,
    'goose',
    instanceId,
    ctx.resolveGooseNative,
    ctx.gooseNative,
  );
}

export function getKiroNative(ctx: AppContext, instanceId?: string) {
  return resolveNativeService(
    ctx,
    'kiro',
    instanceId,
    ctx.resolveKiroNative,
    ctx.kiroNative,
  );
}

export function getKiloNative(ctx: AppContext, instanceId?: string) {
  return resolveNativeService(
    ctx,
    'kilo',
    instanceId,
    ctx.resolveKiloNative,
    ctx.kiloNative,
  );
}

export function getAuggieSessions(ctx: AppContext, instanceId?: string) {
  return resolveNativeService(
    ctx,
    'auggie',
    instanceId,
    ctx.resolveAuggieSessions,
    ctx.auggieSessions,
  );
}

export function getOpencodeNative(ctx: AppContext, instanceId?: string) {
  return resolveNativeService(
    ctx,
    'opencode',
    instanceId,
    ctx.resolveOpencodeNative,
    ctx.opencodeNative,
  );
}

export function getClaudeProjectsDir(ctx: AppContext, instanceId?: string) {
  return resolveFileBackedProviderPath(ctx.config, 'claude', instanceId);
}

export function getCodexSessionsDir(ctx: AppContext, instanceId?: string) {
  return resolveFileBackedProviderPath(ctx.config, 'codex', instanceId);
}

export function getCopilotSessionsDir(ctx: AppContext, instanceId?: string) {
  return resolveFileBackedProviderPath(ctx.config, 'copilot', instanceId);
}

export function getGeminiSessionsDir(ctx: AppContext, instanceId?: string) {
  return resolveFileBackedProviderPath(ctx.config, 'gemini', instanceId);
}

function resolveNativeService<T>(
  ctx: AppContext,
  provider: ProviderName,
  instanceId: string | undefined,
  resolver: ((instanceId?: string) => T) | undefined,
  fallback: T,
): T {
  if (resolver) {
    return resolver(instanceId);
  }

  const defaultInstanceId = getProviderDefaultInstanceId(ctx.config, provider);
  if (!instanceId || instanceId === 'default' || instanceId === defaultInstanceId) {
    return fallback;
  }

  resolveProviderInstance(ctx.config, provider, instanceId);
  throw new Error(
    `Internal error: ${provider} service resolver is unavailable for instance '${instanceId}'`,
  );
}
