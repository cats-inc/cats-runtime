import type {
  RuntimeExecutionStrategyId,
  RuntimeExecutionStrategyResolutionSource,
} from '../../types.js';

export interface RuntimeExecutionStrategyResolutionInput {
  requestedStrategy?: RuntimeExecutionStrategyId;
  preferredStrategy?: RuntimeExecutionStrategyId;
  fallbackStrategy: RuntimeExecutionStrategyId;
}

export interface RuntimeExecutionStrategyResolution {
  effectiveStrategy: RuntimeExecutionStrategyId;
  source: RuntimeExecutionStrategyResolutionSource;
}

export function resolveRuntimeExecutionStrategy(
  input: RuntimeExecutionStrategyResolutionInput,
): RuntimeExecutionStrategyResolution {
  if (input.requestedStrategy) {
    return {
      effectiveStrategy: input.requestedStrategy,
      source: 'explicit_request',
    };
  }

  if (input.preferredStrategy) {
    return {
      effectiveStrategy: input.preferredStrategy,
      source: 'runtime_preference',
    };
  }

  return {
    effectiveStrategy: input.fallbackStrategy,
    source: 'compatibility_fallback',
  };
}
