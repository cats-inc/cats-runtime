import { describe, expect, it } from 'vitest';
import { buildApiRuntimeExecutionStrategyCatalog } from './catalog.js';

describe('buildApiRuntimeExecutionStrategyCatalog', () => {
  it('summarizes supported runtime-hosted families and deferred fallback-only hints', () => {
    const catalog = buildApiRuntimeExecutionStrategyCatalog();

    expect(catalog.summary).toEqual({
      totalFamilies: 7,
      supportedFamilies: 6,
      fallbackOnlyFamilies: 1,
      compatibilityDefault: 'simple_tool_call',
      runtimeHostedBackends: ['api', 'local'],
      summary:
        "6 runtime-hosted strategy families are available for api/local loops. "
        + "1 known deferred hint family still falls back to 'simple_tool_call'.",
    });

    expect(catalog.strategies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'react',
        availability: 'supported',
        runtimeOwnedExecution: true,
        requestedContextKeys: ['maxSteps', 'timeoutMs', 'stuckThreshold'],
        guardrails: {
          stepLimit: true,
          timeoutMs: true,
          stuckThreshold: true,
          branchCount: false,
        },
        strategyEvents: expect.arrayContaining([
          'strategy_started',
          'strategy_replan',
          'strategy_completed',
        ]),
      }),
      expect.objectContaining({
        id: 'tree_of_thoughts',
        availability: 'supported',
        requestedContextKeys: ['maxDepth', 'maxSteps', 'branchCount', 'timeoutMs', 'stuckThreshold'],
        guardrails: expect.objectContaining({
          branchCount: true,
        }),
        strategyEvents: expect.arrayContaining([
          'strategy_branch',
          'strategy_prune',
          'strategy_select',
        ]),
      }),
      expect.objectContaining({
        id: 'deps',
        availability: 'fallback_only',
        runtimeOwnedExecution: false,
        fallbackStrategy: 'simple_tool_call',
        strategyEvents: [],
      }),
    ]));
  });

  it('returns cloned arrays so diagnostics consumers cannot mutate the shared catalog definition', () => {
    const first = buildApiRuntimeExecutionStrategyCatalog();
    first.strategies[0]?.requestedContextKeys.push('mutated');

    const second = buildApiRuntimeExecutionStrategyCatalog();

    expect(second.strategies[0]?.requestedContextKeys).not.toContain('mutated');
  });
});
