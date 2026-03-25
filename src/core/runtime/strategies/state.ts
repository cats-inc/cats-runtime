import type {
  RuntimeExecutionStrategyId,
  RuntimeExecutionStrategyRequest,
  RuntimeExecutionStrategyState,
  RuntimeExecutionStrategySummary,
} from '../../types.js';
import type { RuntimeExecutionStrategyResolution } from './resolution.js';

export interface RuntimeExecutionStrategySessionStateLike {
  requestedStrategy?: RuntimeExecutionStrategyId;
  acceptanceCriteria?: string;
  strategyContext?: Record<string, unknown>;
  correlation?: Record<string, unknown>;
  effectiveStrategy?: RuntimeExecutionStrategyId;
  strategyState?: RuntimeExecutionStrategyState;
}

export interface RuntimeExecutionStrategyStateUpdate {
  request?: RuntimeExecutionStrategyRequest;
  resolution?: RuntimeExecutionStrategyResolution;
  summary?: RuntimeExecutionStrategySummary;
  localState?: Record<string, unknown>;
  rememberPreference?: boolean;
  preferredStrategy?: RuntimeExecutionStrategyId;
  now?: string;
}

export interface RuntimeExecutionStrategySessionPatch {
  requestedStrategy?: RuntimeExecutionStrategyId;
  acceptanceCriteria?: string;
  strategyContext?: Record<string, unknown>;
  correlation?: Record<string, unknown>;
  effectiveStrategy?: RuntimeExecutionStrategyId;
  strategyState?: RuntimeExecutionStrategyState;
}

export function normalizeRuntimeExecutionStrategyRequest(
  request: RuntimeExecutionStrategyRequest | undefined,
): RuntimeExecutionStrategyRequest | undefined {
  if (!request) {
    return undefined;
  }

  const normalized: RuntimeExecutionStrategyRequest = {
    requestedStrategy: normalizeStrategyId(request.requestedStrategy),
    acceptanceCriteria: normalizeNonEmptyString(request.acceptanceCriteria),
    strategyContext: cloneRecord(request.strategyContext),
    correlation: cloneRecord(request.correlation),
  };

  return hasDefinedValue(normalized) ? normalized : undefined;
}

export function mergeRuntimeExecutionStrategyRequests(
  base: RuntimeExecutionStrategyRequest | undefined,
  override: RuntimeExecutionStrategyRequest | undefined,
): RuntimeExecutionStrategyRequest | undefined {
  const normalizedBase = normalizeRuntimeExecutionStrategyRequest(base);
  const normalizedOverride = normalizeRuntimeExecutionStrategyRequest(override);
  if (!normalizedBase) {
    return normalizedOverride;
  }
  if (!normalizedOverride) {
    return normalizedBase;
  }

  return {
    requestedStrategy: normalizedOverride.requestedStrategy ?? normalizedBase.requestedStrategy,
    acceptanceCriteria: normalizedOverride.acceptanceCriteria ?? normalizedBase.acceptanceCriteria,
    strategyContext: normalizedOverride.strategyContext ?? normalizedBase.strategyContext,
    correlation: normalizedOverride.correlation ?? normalizedBase.correlation,
  };
}

export function updateRuntimeExecutionStrategyState(
  existing: RuntimeExecutionStrategyState | undefined,
  input: RuntimeExecutionStrategyStateUpdate,
): RuntimeExecutionStrategyState | undefined {
  const request = input.request
    ? normalizeRuntimeExecutionStrategyRequest(input.request)
    : existing?.request
      ? normalizeRuntimeExecutionStrategyRequest(existing.request)
      : undefined;
  const preferredStrategy = input.preferredStrategy
    ?? (input.rememberPreference && request?.requestedStrategy
      ? request.requestedStrategy
      : existing?.preferredStrategy);
  const effectiveStrategy = input.resolution?.effectiveStrategy ?? existing?.effectiveStrategy;
  const resolutionSource = input.resolution?.source ?? existing?.resolutionSource;
  const summary = input.summary
    ? cloneSummary(input.summary)
    : existing?.summary
      ? cloneSummary(existing.summary)
      : undefined;
  const localState = mergeLocalState(existing?.localState, input.localState);

  if (
    !request
    && !preferredStrategy
    && !effectiveStrategy
    && !resolutionSource
    && !summary
    && !localState
  ) {
    return undefined;
  }

  return {
    ...(preferredStrategy ? { preferredStrategy } : {}),
    ...(request ? { request } : {}),
    ...(effectiveStrategy ? { effectiveStrategy } : {}),
    ...(resolutionSource ? { resolutionSource } : {}),
    ...(summary ? { summary } : {}),
    ...(localState ? { localState } : {}),
    updatedAt: input.now || new Date().toISOString(),
  };
}

export function buildRuntimeExecutionStrategySessionPatch(
  existing: RuntimeExecutionStrategySessionStateLike | undefined,
  input: RuntimeExecutionStrategyStateUpdate,
): RuntimeExecutionStrategySessionPatch {
  const request = mergeRuntimeExecutionStrategyRequests(
    existing
      ? {
          requestedStrategy: existing.requestedStrategy,
          acceptanceCriteria: existing.acceptanceCriteria,
          strategyContext: existing.strategyContext,
          correlation: existing.correlation,
        }
      : undefined,
    input.request,
  );
  const strategyState = updateRuntimeExecutionStrategyState(existing?.strategyState, {
    ...input,
    request,
  });

  return {
    requestedStrategy: request?.requestedStrategy,
    acceptanceCriteria: request?.acceptanceCriteria,
    strategyContext: request?.strategyContext,
    correlation: request?.correlation,
    effectiveStrategy: input.resolution?.effectiveStrategy ?? existing?.effectiveStrategy,
    strategyState,
  };
}

function normalizeNonEmptyString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeStrategyId(
  value: RuntimeExecutionStrategyId | undefined,
): RuntimeExecutionStrategyId | undefined {
  return normalizeNonEmptyString(value) as RuntimeExecutionStrategyId | undefined;
}

function cloneRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  const cloned = structuredClone(value);
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

function cloneSummary(
  summary: RuntimeExecutionStrategySummary,
): RuntimeExecutionStrategySummary {
  return structuredClone(summary);
}

function mergeLocalState(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !patch) {
    return undefined;
  }

  const merged = {
    ...(existing ? structuredClone(existing) : {}),
    ...(patch ? structuredClone(patch) : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function hasDefinedValue(
  value: RuntimeExecutionStrategyRequest,
): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}
