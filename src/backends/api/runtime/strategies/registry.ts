import { depsStrategy } from './depsStrategy.js';
import { RuntimeExecutionStrategyRegistry } from '../../../../core/runtime/strategies/registry.js';
import { planExecuteStrategy } from './planExecuteStrategy.js';
import { pdcaStrategy } from './pdcaStrategy.js';
import { reactStrategy } from './reactStrategy.js';
import { reflexionStrategy } from './reflexionStrategy.js';
import { simpleToolCallStrategy } from './simpleToolCallStrategy.js';
import { treeOfThoughtsStrategy } from './treeOfThoughtsStrategy.js';
import type { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

export const API_RUNTIME_COMPATIBILITY_STRATEGY = 'simple_tool_call';
export const API_RUNTIME_EXECUTION_STRATEGY_IDS = [
  'simple_tool_call',
  'react',
  'plan_execute',
  'pdca',
  'deps',
  'reflexion',
  'tree_of_thoughts',
] as const;

export function createApiRuntimeExecutionStrategyRegistry(): RuntimeExecutionStrategyRegistry<ApiStrategyExecutionContext> {
  return new RuntimeExecutionStrategyRegistry<ApiStrategyExecutionContext>([
    simpleToolCallStrategy,
    reactStrategy,
    planExecuteStrategy,
    pdcaStrategy,
    depsStrategy,
    reflexionStrategy,
    treeOfThoughtsStrategy,
  ]);
}
