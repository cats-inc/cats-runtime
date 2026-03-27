# SPEC-020: Pluggable Execution Strategy Substrate

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

Add a runtime-owned execution-strategy substrate so `cats-runtime` can run
session-local strategies such as `simple_tool_call`, `react`, `pdca`,
`reflexion`, and `tree_of_thoughts` without depending on product task types.
Products supply generic strategy hints and correlation metadata; runtime owns
selection, execution, streaming, and resume semantics inside one session.

## Goals

- introduce a pluggable runtime strategy contract for single-session execution
- preserve the current `cats` -> `cats-runtime` boundary direction
- support strategy-aware execution for API/local/agent-managed loops
- stream strategy progress in a runtime-owned, product-neutral way
- allow additive rollout beginning with `simple_tool_call` and `react`

## Non-Goals

- importing `CoreTaskRecord` or other `cats` product contracts into runtime
- moving task graphs, approvals, or cross-session orchestration into runtime
- requiring all planned strategies to ship in the first slice
- redefining CLI-native loop behavior where the CLI already owns execution

## User Stories

- As a product host, I want to request a strategy such as `react` or `pdca`
  without teaching the host how to execute that loop itself.
- As a runtime maintainer, I want one place to implement stuck detection, step
  limits, and strategy-local resume state.
- As a future Work/Code integrator, I want richer execution modes without
  forcing `cats-runtime` to understand product task graphs.

## Requirements

### Functional Requirements

1. `cats-runtime` shall define a runtime-owned strategy registry and strategy
   interface for session-local execution.
2. The runtime-owned strategy request shall remain product-neutral and shall
   support at least:
   - `requestedStrategy?: string`
   - `acceptanceCriteria?: string`
   - `strategyContext?: Record<string, unknown>`
   - `correlation?: Record<string, unknown>`
3. The runtime shall support an `effectiveStrategy` concept separate from the
   requested one, so inspection can show what actually ran.
4. The runtime shall support a strategy resolution order of:
   - explicit `requestedStrategy`
   - runtime-owned session/skill execution preference when available
   - compatibility fallback strategy
5. The compatibility fallback strategy shall preserve existing behavior for
   callers that do not send strategy hints.
6. The first implemented strategies shall be:
   - `simple_tool_call`
   - `react`
7. The registry contract shall allow later additive strategies such as:
   - `plan_execute`
   - `pdca`
   - `reflexion`
   - `tree_of_thoughts`
   - `deps`
8. Strategy execution shall surface additive runtime events over existing
   streaming surfaces rather than requiring a new task event bus.
9. Strategy events shall remain runtime-neutral. At minimum the design shall
   allow events such as:
   - `strategy_started`
   - `strategy_step`
   - `strategy_tool_call`
   - `strategy_tool_result`
   - `strategy_evaluation`
   - `strategy_stuck`
   - `strategy_replan`
   - `strategy_completed`
   - `strategy_failed`
10. Runtime session inspection/observe payloads shall add strategy metadata
    additively, including at least:
    - `requestedStrategy`
    - `effectiveStrategy`
    - strategy-local state snapshot or summary when available
11. Strategy-local resume state shall remain runtime-owned and shall not be
    written back into product task records.
12. The first slice shall apply to runtime-hosted loops, especially API/local
    flows. CLI-native execution loops may remain outside this substrate where
    appropriate.

### Non-Functional Requirements

- **Compatibility**: existing callers remain valid when they send no strategy
  hints
- **Boundary integrity**: runtime contracts stay free of direct `cats` task
  types
- **Observability**: strategy progress must be visible through existing runtime
  stream/inspect surfaces
- **Incrementality**: new strategies can land one by one without reworking the
  public direction each time

## Design Overview

```text
product host
  requestedStrategy + acceptanceCriteria + strategyContext + correlation
              |
              v
runtime strategy resolution
  explicit request
  -> session/skill preference
  -> compatibility fallback
              |
              v
selected ExecutionStrategy
  execute inside one session
  persist runtime-owned strategy state
  emit additive stream/observe events
```

### Illustrative Runtime Contract

```ts
interface RuntimeExecutionStrategyRequest {
  requestedStrategy?: string;
  acceptanceCriteria?: string;
  strategyContext?: Record<string, unknown>;
  correlation?: {
    taskId?: string;
    conversationId?: string;
    workItemId?: string;
    product?: string;
    [key: string]: unknown;
  };
}

interface ExecutionStrategyContext {
  sessionId: string;
  message: string;
  tools: ToolCatalog;
  history: MessageHistory;
  constraints: {
    maxSteps?: number;
    timeoutMs?: number;
    stuckThreshold?: number;
  };
  request: RuntimeExecutionStrategyRequest;
}

interface ExecutionStrategy {
  readonly id: string;
  execute(context: ExecutionStrategyContext): AsyncIterable<RuntimeStrategyEvent>;
}
```

The exact field names may evolve, but the boundary must stay generic and
runtime-owned.

### Streaming Direction

- No separate runtime task event bus is required.
- Existing stream surfaces should carry additive strategy events.
- Products continue to own task status transitions and cross-session plan
  reconciliation.

## Dependencies

- [ADR 024](../decisions/024-own-pluggable-execution-strategies-as-runtime-session-local-substrate.md)
- [ADR 005](../decisions/005-backend-neutral-runtime-and-api-backend.md)
- [ADR 006](../decisions/006-agent-backend-and-shared-runtime-contracts.md)
- [ADR 017](../decisions/017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- companion product-side spec:
  [cats SPEC-035](../../../cats/docs/specs/SPEC-035-cross-product-task-strategy-handoff-and-runtime-bridge.md)

## Open Questions

- [ ] Which strategy-local state should be persisted verbatim versus reduced to
      a summary in observe payloads?
- [ ] Should `react` become the default fallback after migration, or should the
      runtime preserve `simple_tool_call` as the long-term compatibility mode?
- [ ] Which runtime-hosted execution families besides API/local should adopt
      this substrate in the first implementation plan?

## References

- [Research: Pluggable Execution Strategy Architecture](../research/2026-03-26-pluggable-execution-strategy-architecture.md)
- [Research: Gemini Reasoning Strategy Substrate](../research/2026-03-26-gemini-reasoning-strategy-substrate.md)
- [cats ADR-032](../../../cats/docs/decisions/032-own-task-substrate-in-core-not-runtime.md)
- [cats SPEC-032](../../../cats/docs/specs/SPEC-032-core-task-lifecycle-and-wakeup-integration.md)

---

*Created: 2026-03-26*
*Author: Codex*
*Related Plan: TBD*
