import type { StreamEvent, RuntimeExecutionStrategyId } from '../../types.js';

export interface RuntimeExecutionStrategy<TContext> {
  readonly id: RuntimeExecutionStrategyId;
  execute(context: TContext): AsyncGenerator<StreamEvent>;
}

export class RuntimeExecutionStrategyRegistry<TContext> {
  private readonly strategies = new Map<RuntimeExecutionStrategyId, RuntimeExecutionStrategy<TContext>>();

  constructor(
    strategies: RuntimeExecutionStrategy<TContext>[] = [],
  ) {
    for (const strategy of strategies) {
      this.register(strategy);
    }
  }

  register(
    strategy: RuntimeExecutionStrategy<TContext>,
  ): RuntimeExecutionStrategy<TContext> {
    this.strategies.set(strategy.id, strategy);
    return strategy;
  }

  has(id: RuntimeExecutionStrategyId): boolean {
    return this.strategies.has(id);
  }

  get(
    id: RuntimeExecutionStrategyId,
  ): RuntimeExecutionStrategy<TContext> | undefined {
    return this.strategies.get(id);
  }

  resolve(
    id: RuntimeExecutionStrategyId,
  ): RuntimeExecutionStrategy<TContext> {
    const strategy = this.get(id);
    if (!strategy) {
      throw new Error(`Unknown runtime execution strategy '${id}'`);
    }

    return strategy;
  }

  list(): RuntimeExecutionStrategyId[] {
    return Array.from(this.strategies.keys());
  }
}
