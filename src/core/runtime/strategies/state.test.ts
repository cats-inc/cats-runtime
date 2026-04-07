import { describe, expect, it } from 'vitest';
import type { RuntimeExecutionStrategyState } from '../../types.js';
import {
  buildRuntimeExecutionStrategySessionPatch,
  normalizeRuntimeExecutionStrategyRequest,
  readRuntimeExecutionStrategyRequest,
  readRuntimeExecutionStrategyState,
  updateRuntimeExecutionStrategyState,
} from './state.js';

describe('runtime execution strategy state helpers', () => {
  it('normalizes additive request fields without mutating the caller payload', () => {
    const rawStrategyContext = { maxSteps: 4 };
    const rawCorrelation = {};

    const normalized = normalizeRuntimeExecutionStrategyRequest({
      requestedStrategy: ' react ' as 'react',
      acceptanceCriteria: '  return a concise answer  ',
      strategyContext: rawStrategyContext,
      correlation: rawCorrelation,
    });

    expect(normalized).toEqual({
      requestedStrategy: 'react',
      acceptanceCriteria: 'return a concise answer',
      strategyContext: { maxSteps: 4 },
    });
    expect(normalized?.strategyContext).not.toBe(rawStrategyContext);
  });

  it('canonicalizes common strategy aliases onto shipped runtime ids', () => {
    expect(normalizeRuntimeExecutionStrategyRequest({
      requestedStrategy: ' ToT ' as 'tree_of_thoughts',
    })).toEqual({
      requestedStrategy: 'tree_of_thoughts',
    });
    expect(normalizeRuntimeExecutionStrategyRequest({
      requestedStrategy: 'plan-execute' as 'plan_execute',
    })).toEqual({
      requestedStrategy: 'plan_execute',
    });
    expect(normalizeRuntimeExecutionStrategyRequest({
      requestedStrategy: 'reflection' as 'reflexion',
    })).toEqual({
      requestedStrategy: 'reflexion',
    });
    expect(normalizeRuntimeExecutionStrategyRequest({
      requestedStrategy: 'DEPS' as 'deps',
    })).toEqual({
      requestedStrategy: 'deps',
    });
  });

  it('merges persisted request metadata into the session patch and remembers runtime preference', () => {
    const existing: RuntimeExecutionStrategyState = {
      preferredStrategy: 'simple_tool_call',
      request: {
        acceptanceCriteria: 'keep prior acceptance criteria',
        correlation: { traceId: 'trace-1' },
      },
      effectiveStrategy: 'simple_tool_call',
      resolutionSource: 'compatibility_fallback',
      summary: {
        status: 'completed',
        stepCount: 1,
        resolutionSource: 'compatibility_fallback',
        updatedAt: '2026-03-26T00:00:00.000Z',
      },
      localState: {
        priorLoop: true,
      },
      updatedAt: '2026-03-26T00:00:00.000Z',
    };

    const patch = buildRuntimeExecutionStrategySessionPatch({
      acceptanceCriteria: 'keep prior acceptance criteria',
      correlation: { traceId: 'trace-1' },
      effectiveStrategy: 'simple_tool_call',
      strategyState: existing,
    }, {
      request: {
        requestedStrategy: 'react',
        strategyContext: { maxSteps: 5 },
      },
      resolution: {
        effectiveStrategy: 'react',
        source: 'explicit_request',
      },
      rememberPreference: true,
      summary: {
        status: 'running',
        stepCount: 1,
        stepLimit: 5,
        resolutionSource: 'explicit_request',
        updatedAt: '2026-03-26T00:00:01.000Z',
      },
      localState: {
        consecutiveDuplicateToolCalls: 0,
      },
      now: '2026-03-26T00:00:02.000Z',
    });

    expect(patch).toEqual({
      strategy: {
        preferredStrategy: 'react',
        request: {
          requestedStrategy: 'react',
          acceptanceCriteria: 'keep prior acceptance criteria',
          strategyContext: { maxSteps: 5 },
          correlation: { traceId: 'trace-1' },
        },
        effectiveStrategy: 'react',
        resolutionSource: 'explicit_request',
        summary: {
          status: 'running',
          stepCount: 1,
          stepLimit: 5,
          resolutionSource: 'explicit_request',
          updatedAt: '2026-03-26T00:00:01.000Z',
        },
        localState: {
          priorLoop: true,
          consecutiveDuplicateToolCalls: 0,
        },
        updatedAt: '2026-03-26T00:00:02.000Z',
      },
    });

    expect(existing.preferredStrategy).toBe('simple_tool_call');
    expect(existing.localState).toEqual({ priorLoop: true });
  });

  it('updates runtime-owned strategy state in place when the request is already normalized', () => {
    const updated = updateRuntimeExecutionStrategyState(undefined, {
      request: {
        requestedStrategy: 'react',
        acceptanceCriteria: 'done',
      },
      resolution: {
        effectiveStrategy: 'react',
        source: 'explicit_request',
      },
      rememberPreference: true,
      summary: {
        status: 'completed',
        stepCount: 2,
        resolutionSource: 'explicit_request',
        updatedAt: '2026-03-26T00:01:00.000Z',
      },
      localState: {
        lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
      },
      now: '2026-03-26T00:01:00.000Z',
    });

    expect(updated).toEqual({
      preferredStrategy: 'react',
      request: {
        requestedStrategy: 'react',
        acceptanceCriteria: 'done',
      },
      effectiveStrategy: 'react',
      resolutionSource: 'explicit_request',
      summary: {
        status: 'completed',
        stepCount: 2,
        resolutionSource: 'explicit_request',
        updatedAt: '2026-03-26T00:01:00.000Z',
      },
      localState: {
        lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
      },
      updatedAt: '2026-03-26T00:01:00.000Z',
    });
  });

  it('prefers nested strategy state over legacy flat fields during migration reads', () => {
    const migrated = {
      strategy: {
        request: {
          requestedStrategy: 'react' as const,
          acceptanceCriteria: 'nested acceptance criteria',
          strategyContext: { maxSteps: 3 },
          correlation: { traceId: 'nested-trace' },
        },
        effectiveStrategy: 'react' as const,
        updatedAt: '2026-03-26T00:02:00.000Z',
      },
      requestedStrategy: 'simple_tool_call' as const,
      acceptanceCriteria: 'legacy acceptance criteria',
      strategyContext: { maxSteps: 1 },
      correlation: { traceId: 'legacy-trace' },
      effectiveStrategy: 'simple_tool_call' as const,
    };

    expect(readRuntimeExecutionStrategyRequest(migrated)).toEqual({
      requestedStrategy: 'react',
      acceptanceCriteria: 'nested acceptance criteria',
      strategyContext: { maxSteps: 3 },
      correlation: { traceId: 'nested-trace' },
    });
    expect(readRuntimeExecutionStrategyState(migrated)).toMatchObject({
      request: {
        requestedStrategy: 'react',
        acceptanceCriteria: 'nested acceptance criteria',
        strategyContext: { maxSteps: 3 },
        correlation: { traceId: 'nested-trace' },
      },
      effectiveStrategy: 'react',
    });
  });
});
