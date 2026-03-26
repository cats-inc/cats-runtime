import type { ProviderBackend, RuntimeExecutionStrategyId } from '../../../../core/types.js';
import { API_RUNTIME_COMPATIBILITY_STRATEGY } from './registry.js';

type RuntimeHostedStrategyBackend = Extract<ProviderBackend, 'api' | 'local'>;
type StrategyExecutionModel =
  | 'compatibility_loop'
  | 'reactive_loop'
  | 'phase_loop'
  | 'reflection_loop'
  | 'branching_loop'
  | 'deferred';

export type ApiRuntimeExecutionStrategyAvailability = 'supported' | 'fallback_only';

export interface ApiRuntimeExecutionStrategyCatalogEntry {
  id: RuntimeExecutionStrategyId;
  label: string;
  availability: ApiRuntimeExecutionStrategyAvailability;
  executionModel: StrategyExecutionModel;
  runtimeOwnedExecution: boolean;
  runtimeHostedBackends: RuntimeHostedStrategyBackend[];
  description: string;
  requestedContextKeys: string[];
  strategyEvents: string[];
  guardrails: {
    stepLimit: boolean;
    timeoutMs: boolean;
    stuckThreshold: boolean;
    branchCount: boolean;
  };
  fallbackStrategy?: RuntimeExecutionStrategyId;
  notes?: string[];
}

export interface ApiRuntimeExecutionStrategyCatalogSummary {
  totalFamilies: number;
  supportedFamilies: number;
  fallbackOnlyFamilies: number;
  compatibilityDefault: RuntimeExecutionStrategyId;
  runtimeHostedBackends: RuntimeHostedStrategyBackend[];
  summary: string;
}

export interface ApiRuntimeExecutionStrategyCatalog {
  summary: ApiRuntimeExecutionStrategyCatalogSummary;
  strategies: ApiRuntimeExecutionStrategyCatalogEntry[];
}

const RUNTIME_HOSTED_BACKENDS = ['api', 'local'] as const satisfies readonly RuntimeHostedStrategyBackend[];

const STRATEGY_CATALOG: readonly ApiRuntimeExecutionStrategyCatalogEntry[] = [
  {
    id: 'simple_tool_call',
    label: 'Simple Tool Call',
    availability: 'supported',
    executionModel: 'compatibility_loop',
    runtimeOwnedExecution: true,
    runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
    description: 'Compatibility wrapper over the legacy runtime-managed tool loop.',
    requestedContextKeys: ['maxSteps'],
    strategyEvents: [
      'strategy_started',
      'strategy_tool_call',
      'strategy_tool_result',
      'strategy_completed',
      'strategy_failed',
    ],
    guardrails: {
      stepLimit: true,
      timeoutMs: false,
      stuckThreshold: false,
      branchCount: false,
    },
    notes: [
      'Default compatibility path for callers that omit strategy hints.',
      'Also handles deferred families through additive compatibility fallback.',
    ],
  },
  {
    id: 'react',
    label: 'ReAct',
    availability: 'supported',
    executionModel: 'reactive_loop',
    runtimeOwnedExecution: true,
    runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
    description: 'Runtime-owned reason/act loop with bounded stuck detection.',
    requestedContextKeys: ['maxSteps', 'timeoutMs', 'stuckThreshold'],
    strategyEvents: [
      'strategy_started',
      'strategy_step',
      'strategy_evaluation',
      'strategy_tool_call',
      'strategy_tool_result',
      'strategy_replan',
      'strategy_completed',
      'strategy_stuck',
      'strategy_failed',
    ],
    guardrails: {
      stepLimit: true,
      timeoutMs: true,
      stuckThreshold: true,
      branchCount: false,
    },
  },
  {
    id: 'plan_execute',
    label: 'Plan Execute',
    availability: 'supported',
    executionModel: 'phase_loop',
    runtimeOwnedExecution: true,
    runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
    description: 'Runtime-owned bounded planning loop that replans after each tool batch.',
    requestedContextKeys: ['maxPlanSteps', 'maxSteps', 'timeoutMs', 'stuckThreshold'],
    strategyEvents: [
      'strategy_started',
      'strategy_plan',
      'strategy_tool_call',
      'strategy_evaluation',
      'strategy_completed',
      'strategy_stuck',
      'strategy_failed',
    ],
    guardrails: {
      stepLimit: true,
      timeoutMs: true,
      stuckThreshold: true,
      branchCount: false,
    },
  },
  {
    id: 'pdca',
    label: 'PDCA',
    availability: 'supported',
    executionModel: 'phase_loop',
    runtimeOwnedExecution: true,
    runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
    description: 'Runtime-owned plan/do/check/act loop with bounded iteration control.',
    requestedContextKeys: ['maxCycles', 'maxSteps', 'timeoutMs', 'stuckThreshold'],
    strategyEvents: [
      'strategy_started',
      'strategy_plan',
      'strategy_do',
      'strategy_check',
      'strategy_act',
      'strategy_completed',
      'strategy_stuck',
      'strategy_failed',
    ],
    guardrails: {
      stepLimit: true,
      timeoutMs: true,
      stuckThreshold: true,
      branchCount: false,
    },
  },
  {
    id: 'reflexion',
    label: 'Reflexion',
    availability: 'supported',
    executionModel: 'reflection_loop',
    runtimeOwnedExecution: true,
    runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
    description: 'Runtime-owned critique/revision loop that persists reflection-local state.',
    requestedContextKeys: ['maxSteps', 'timeoutMs', 'stuckThreshold'],
    strategyEvents: [
      'strategy_started',
      'strategy_step',
      'strategy_reflection',
      'strategy_completed',
      'strategy_stuck',
      'strategy_failed',
    ],
    guardrails: {
      stepLimit: true,
      timeoutMs: true,
      stuckThreshold: true,
      branchCount: false,
    },
  },
  {
    id: 'tree_of_thoughts',
    label: 'Tree of Thoughts',
    availability: 'supported',
    executionModel: 'branching_loop',
    runtimeOwnedExecution: true,
    runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
    description: 'Runtime-owned branch/evaluate/prune/select loop with bounded branch sampling.',
    requestedContextKeys: ['maxDepth', 'maxSteps', 'branchCount', 'timeoutMs', 'stuckThreshold'],
    strategyEvents: [
      'strategy_started',
      'strategy_branch',
      'strategy_prune',
      'strategy_select',
      'strategy_evaluation',
      'strategy_completed',
      'strategy_stuck',
      'strategy_failed',
    ],
    guardrails: {
      stepLimit: true,
      timeoutMs: true,
      stuckThreshold: true,
      branchCount: true,
    },
  },
  {
    id: 'deps',
    label: 'DEPS',
    availability: 'fallback_only',
    executionModel: 'deferred',
    runtimeOwnedExecution: false,
    runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
    description: 'Known deferred family; runtime preserves the hint but does not execute a native loop yet.',
    requestedContextKeys: [],
    strategyEvents: [],
    guardrails: {
      stepLimit: false,
      timeoutMs: false,
      stuckThreshold: false,
      branchCount: false,
    },
    fallbackStrategy: API_RUNTIME_COMPATIBILITY_STRATEGY,
    notes: [
      'Current runtime behavior is an honest compatibility fallback, not a fake DEPS implementation.',
    ],
  },
] as const;

export function buildApiRuntimeExecutionStrategyCatalog(): ApiRuntimeExecutionStrategyCatalog {
  const strategies = STRATEGY_CATALOG.map((entry) => ({
    ...entry,
    runtimeHostedBackends: [...entry.runtimeHostedBackends],
    requestedContextKeys: [...entry.requestedContextKeys],
    strategyEvents: [...entry.strategyEvents],
    guardrails: {
      ...entry.guardrails,
    },
    ...(entry.notes ? { notes: [...entry.notes] } : {}),
  }));

  const supportedFamilies = strategies.filter((entry) => entry.availability === 'supported').length;
  const fallbackOnlyFamilies = strategies.filter((entry) => entry.availability === 'fallback_only').length;

  return {
    summary: {
      totalFamilies: strategies.length,
      supportedFamilies,
      fallbackOnlyFamilies,
      compatibilityDefault: API_RUNTIME_COMPATIBILITY_STRATEGY,
      runtimeHostedBackends: [...RUNTIME_HOSTED_BACKENDS],
      summary: [
        `${supportedFamilies} runtime-hosted strategy families are available for api/local loops.`,
        fallbackOnlyFamilies > 0
          ? `${fallbackOnlyFamilies} known deferred hint family still falls back to '${API_RUNTIME_COMPATIBILITY_STRATEGY}'.`
          : undefined,
      ].filter((part): part is string => Boolean(part)).join(' '),
    },
    strategies,
  };
}
