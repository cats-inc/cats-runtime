import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '../../types.js';
import { RuntimeExecutionStrategyRegistry, type RuntimeExecutionStrategy } from './registry.js';

function createStrategy(
  id: string,
): RuntimeExecutionStrategy<{ seen: string[] }> {
  return {
    id,
    async *execute(context): AsyncGenerator<StreamEvent> {
      context.seen.push(id);
      yield { type: 'result' };
    },
  };
}

describe('RuntimeExecutionStrategyRegistry', () => {
  it('registers, lists, and resolves runtime-owned strategies', async () => {
    const registry = new RuntimeExecutionStrategyRegistry([
      createStrategy('simple_tool_call'),
      createStrategy('react'),
    ]);

    expect(registry.has('simple_tool_call')).toBe(true);
    expect(registry.list()).toEqual(['simple_tool_call', 'react']);

    const context = { seen: [] as string[] };
    const strategy = registry.resolve('react');
    const events: StreamEvent[] = [];
    for await (const event of strategy.execute(context)) {
      events.push(event);
    }

    expect(context.seen).toEqual(['react']);
    expect(events).toEqual([{ type: 'result' }]);
  });

  it('throws for unknown strategy ids', () => {
    const registry = new RuntimeExecutionStrategyRegistry();

    expect(() => registry.resolve('missing_strategy')).toThrow(
      "Unknown runtime execution strategy 'missing_strategy'",
    );
  });
});
