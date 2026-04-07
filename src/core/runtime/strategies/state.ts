import type {
  RuntimeExecutionStrategyId,
  RuntimeExecutionStrategyRequest,
  RuntimeExecutionStrategyState,
  RuntimeExecutionStrategySummary,
} from '../../types.js';
import type { RuntimeExecutionStrategyResolution } from './resolution.js';

const STRATEGY_ID_ALIASES = new Map<string, RuntimeExecutionStrategyId>([
  ['simple_tool_call', 'simple_tool_call'],
  ['simpletoolcall', 'simple_tool_call'],
  ['compatibility', 'simple_tool_call'],
  ['react', 'react'],
  ['re_act', 'react'],
  ['reason_act', 'react'],
  ['plan_execute', 'plan_execute'],
  ['planexecute', 'plan_execute'],
  ['pdca', 'pdca'],
  ['deps', 'deps'],
  ['reflexion', 'reflexion'],
  ['reflection', 'reflexion'],
  ['tree_of_thoughts', 'tree_of_thoughts'],
  ['treeofthoughts', 'tree_of_thoughts'],
  ['tot', 'tree_of_thoughts'],
]);

export interface RuntimeExecutionStrategySessionStateLike {
  strategy?: RuntimeExecutionStrategyState;
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
  strategy?: RuntimeExecutionStrategyState;
}

export function cloneRuntimeExecutionStrategyState(
  state: RuntimeExecutionStrategyState | undefined,
): RuntimeExecutionStrategyState | undefined {
  return state ? structuredClone(state) : undefined;
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

export function readRuntimeExecutionStrategyRequest(
  source: RuntimeExecutionStrategySessionStateLike | undefined,
): RuntimeExecutionStrategyRequest | undefined {
  const nestedRequest = source?.strategy?.request
    ?? source?.strategyState?.request;
  const legacyRequest = normalizeRuntimeExecutionStrategyRequest(source
    ? {
        requestedStrategy: source.requestedStrategy,
        acceptanceCriteria: source.acceptanceCriteria,
        strategyContext: source.strategyContext,
        correlation: source.correlation,
      }
    : undefined);

  // Nested runtime-owned strategy state is canonical; legacy flat fields only
  // backfill missing request details during migration.
  return mergeRuntimeExecutionStrategyRequests(legacyRequest, nestedRequest);
}

export function readRuntimeExecutionStrategyState(
  source: RuntimeExecutionStrategySessionStateLike | undefined,
): RuntimeExecutionStrategyState | undefined {
  const nested = cloneRuntimeExecutionStrategyState(source?.strategy);
  const legacy = cloneRuntimeExecutionStrategyState(source?.strategyState);
  const base = nested ?? legacy;
  const request = readRuntimeExecutionStrategyRequest(source);
  const effectiveStrategy = source?.strategy?.effectiveStrategy
    ?? source?.effectiveStrategy
    ?? source?.strategyState?.effectiveStrategy;

  if (!base && !request && !effectiveStrategy) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(request ? { request } : {}),
    ...(effectiveStrategy ? { effectiveStrategy } : {}),
    updatedAt: base?.updatedAt ?? new Date().toISOString(),
  };
}

export function readRuntimeExecutionStrategyEffectiveStrategy(
  source: RuntimeExecutionStrategySessionStateLike | undefined,
): RuntimeExecutionStrategyId | undefined {
  return readRuntimeExecutionStrategyState(source)?.effectiveStrategy;
}

export function mergeRuntimeExecutionStrategyStates(
  base: RuntimeExecutionStrategyState | undefined,
  override: RuntimeExecutionStrategyState | undefined,
): RuntimeExecutionStrategyState | undefined {
  const normalizedBase = cloneRuntimeExecutionStrategyState(base);
  const normalizedOverride = cloneRuntimeExecutionStrategyState(override);

  if (!normalizedBase) {
    return normalizedOverride;
  }
  if (!normalizedOverride) {
    return normalizedBase;
  }

  const request = mergeRuntimeExecutionStrategyRequests(
    normalizedBase.request,
    normalizedOverride.request,
  );
  const summary = normalizedOverride.summary
    ? cloneSummary(normalizedOverride.summary)
    : normalizedBase.summary
      ? cloneSummary(normalizedBase.summary)
      : undefined;
  const localState = mergeLocalState(
    normalizedBase.localState,
    normalizedOverride.localState,
  );

  return {
    ...normalizedBase,
    ...normalizedOverride,
    ...(request ? { request } : {}),
    ...(summary ? { summary } : {}),
    ...(localState ? { localState } : {}),
    updatedAt: normalizedOverride.updatedAt || normalizedBase.updatedAt || new Date().toISOString(),
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
    readRuntimeExecutionStrategyRequest(existing),
    input.request,
  );
  const strategy = updateRuntimeExecutionStrategyState(readRuntimeExecutionStrategyState(existing), {
    ...input,
    request,
  });

  return strategy ? { strategy } : {};
}

function normalizeNonEmptyString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeStrategyId(
  value: RuntimeExecutionStrategyId | undefined,
): RuntimeExecutionStrategyId | undefined {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return undefined;
  }

  const aliasKey = normalized
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return STRATEGY_ID_ALIASES.get(aliasKey) ?? normalized as RuntimeExecutionStrategyId;
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
