import { describe, expect, it } from 'vitest';
import { resolveRuntimeExecutionStrategy } from './resolution.js';

describe('resolveRuntimeExecutionStrategy', () => {
  it('prefers explicit requested strategy over runtime preference', () => {
    expect(resolveRuntimeExecutionStrategy({
      requestedStrategy: 'react',
      preferredStrategy: 'simple_tool_call',
      fallbackStrategy: 'simple_tool_call',
    })).toEqual({
      effectiveStrategy: 'react',
      source: 'explicit_request',
    });
  });

  it('uses runtime-owned preference when there is no explicit request', () => {
    expect(resolveRuntimeExecutionStrategy({
      preferredStrategy: 'react',
      fallbackStrategy: 'simple_tool_call',
    })).toEqual({
      effectiveStrategy: 'react',
      source: 'runtime_preference',
    });
  });

  it('falls back to compatibility strategy when no hint exists', () => {
    expect(resolveRuntimeExecutionStrategy({
      fallbackStrategy: 'simple_tool_call',
    })).toEqual({
      effectiveStrategy: 'simple_tool_call',
      source: 'compatibility_fallback',
    });
  });
});
