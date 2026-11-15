import {
  getProviderDefaultInstanceId,
  resolveProviderInstance,
} from '../backends/cli/config.js';
import type { ProviderName } from '../backends/cli/providers/types.js';
import { resolveFileBackedProviderPath } from '../backends/cli/providerPaths.js';
import { KimiNativeSessionService } from '../backends/cli/kimi/KimiNativeSessionService.js';
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

export function getKimiNative(ctx: AppContext, instanceId?: string): KimiNativeSessionService {
  if (ctx.resolveKimiNative) return ctx.resolveKimiNative(instanceId);
  const defaultInstanceId = getProviderDefaultInstanceId(ctx.config, 'kimi');
  if (ctx.kimiNative && (!instanceId || instanceId === defaultInstanceId)) return ctx.kimiNative;
  // Hand-built contexts without a resolver read the configured instance directly.
  return new KimiNativeSessionService({
    commandConfig: resolveProviderInstance(ctx.config, 'kimi', instanceId).commandConfig,
  });
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
  if (!instanceId || instanceId === defaultInstanceId) {
    return fallback;
  }

  resolveProviderInstance(ctx.config, provider, instanceId);
  throw new Error(
    `Internal error: ${provider} service resolver is unavailable for instance '${instanceId}'`,
  );
}
