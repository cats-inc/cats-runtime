import { RuntimeExecutionStrategyRegistry } from '../../../../core/runtime/strategies/registry.js';
import { reactStrategy } from './reactStrategy.js';
import { simpleToolCallStrategy } from './simpleToolCallStrategy.js';
import type { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

export const API_RUNTIME_COMPATIBILITY_STRATEGY = 'simple_tool_call';
export const API_RUNTIME_EXECUTION_STRATEGY_IDS = [
  'simple_tool_call',
  'react',
] as const;

export function createApiRuntimeExecutionStrategyRegistry(): RuntimeExecutionStrategyRegistry<ApiStrategyExecutionContext> {
  return new RuntimeExecutionStrategyRegistry<ApiStrategyExecutionContext>([
    simpleToolCallStrategy,
    reactStrategy,
  ]);
}
