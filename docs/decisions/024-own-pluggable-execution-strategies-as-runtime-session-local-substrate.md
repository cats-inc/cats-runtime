# ADR 024: Own Pluggable Execution Strategies as a Runtime Session-Local Substrate

## Status

Proposed

## Date

2026-03-26

## Context

`cats-runtime` already owns session execution for API, local, agent, and CLI
backends, but its runtime-hosted loops are uneven:

- CLI tools often own their own native loop semantics
- API/local backends still rely on a relatively flat tool-call loop
- there is no shared substrate for step limits, stuck detection, re-planning,
  or strategy-local resume state

At the same time, `cats` now owns a shared task substrate and cross-product
task handoff model. That task layer may want to suggest strategies such as
ReAct, PDCA, Reflexion, or Tree-of-Thoughts, but
`cats-runtime` must not take a direct dependency on `CoreTaskRecord` or other
product task contracts.

The decision needed here is not whether the suite should support multiple
execution strategies. It should. The decision is where that strategy substrate
lives and what contract boundary it uses.

## Decision

`cats-runtime` will own a pluggable execution-strategy substrate for
**single-session execution only**.

This decision includes:

1. The runtime owns the strategy registry, strategy lifecycle, and
   strategy-local resume state for session execution.
2. The runtime strategy contract must remain runtime-neutral and must not import
   `cats` task types such as `CoreTaskRecord`.
3. Products may pass runtime-neutral hints such as:
   - `requestedStrategy`
   - `acceptanceCriteria`
   - `strategyContext`
   - opaque correlation metadata such as `taskId` or `conversationId`
4. Product defaults for Chat/Work/Code remain product-owned. The runtime does
   not hardcode product names or product default mappings.
5. The runtime execution-strategy substrate covers only the execution loop
   inside a session. It does not own:
   - task graphs
   - approvals
   - cross-session orchestration
   - fan-out/converge logic
   - product routing between Chat, Work, and Code
6. The initial runtime fallback remains compatibility-oriented. If no explicit
   requested strategy is passed, the runtime may preserve existing simple loop
   behavior rather than inferring product policy.
7. Strategy-local state may be persisted in runtime-owned session metadata or
   equivalent runtime records, not in product-owned task records.

## Consequences

### Positive

- keeps execution-loop quality improvements inside the runtime boundary that
  already owns session execution
- allows products to request richer execution behavior without giving runtime
  ownership of task policy
- supports additive rollout from `simple_tool_call` toward `react`,
  `reflexion`, `pdca`, or `tree_of_thoughts`
- preserves the accepted `cats` -> `cats-runtime` dependency direction

### Negative

- some strategy intent will travel through generic bridge fields instead of a
  strongly typed cross-repo shared model
- products must explicitly resolve and send defaults rather than assuming the
  runtime knows Chat/Work/Code policy
- session inspection and streaming contracts will grow to expose strategy
  state/events

### Neutral

- CLI-native loops may continue to bypass parts of this substrate where the CLI
  already owns the execution rhythm
- strategy implementations can land incrementally; the registry contract does
  not require all strategies to exist immediately

## Alternatives Considered

### Alternative 1: Put planning and strategy state directly into product tasks

- **Pros**: one record could appear to hold both task and execution state
- **Cons**: couples runtime execution to product contracts and blurs the
  runtime boundary
- **Why rejected**: runtime should execute sessions, not own product task state

### Alternative 2: Hardcode one runtime loop such as ReAct

- **Pros**: simplest implementation path
- **Cons**: overfits the runtime to one reasoning rhythm and makes future Work
  or Code execution semantics awkward
- **Why rejected**: the suite already needs more than one execution pattern

### Alternative 3: Let each product implement its own strategy loop above runtime

- **Pros**: runtime stays thinner
- **Cons**: duplicates loop logic across products, weakens backend-neutral
  behavior, and repeats stuck/recovery semantics in app code
- **Why rejected**: execution-loop ownership belongs in runtime, not in each
  product shell

## References

- [ADR 005](./005-backend-neutral-runtime-and-api-backend.md)
- [ADR 006](./006-agent-backend-and-shared-runtime-contracts.md)
- [ADR 017](./017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [cats ADR-001](../../../cats/docs/decisions/001-use-cats-runtime-boundary.md)
- [cats ADR-032](../../../cats/docs/decisions/032-own-task-substrate-in-core-not-runtime.md)
- [Research: Pluggable Execution Strategy Architecture](../research/2026-03-26-pluggable-execution-strategy-architecture.md)
- [Research: Gemini Reasoning Strategy Substrate](../research/2026-03-26-gemini-reasoning-strategy-substrate.md)

---

*Decision made: 2026-03-26*
*Decision makers: Codex + user direction*
