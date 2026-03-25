# PLAN-020: Pluggable Execution Strategy Substrate

> Implementation plan for landing a runtime-owned execution strategy substrate
> in `cats-runtime` without inverting the `cats` -> `cats-runtime` boundary or
> breaking current session consumers.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | TBD |
| **Reviewer** | User |

## Related Spec / Decisions

- [SPEC-020: Pluggable Execution Strategy Substrate](../specs/SPEC-020-pluggable-execution-strategy-substrate.md)
- [ADR 024: Own pluggable execution strategies as a runtime session-local substrate](../decisions/024-own-pluggable-execution-strategies-as-runtime-session-local-substrate.md)
- Supporting baseline:
  [ADR 005](../decisions/005-backend-neutral-runtime-and-api-backend.md)
- Supporting baseline:
  [ADR 006](../decisions/006-agent-backend-and-shared-runtime-contracts.md)
- Supporting baseline:
  [ADR 017](../decisions/017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- Companion product work:
  [cats PLAN-021](../../../cats/docs/plans/PLAN-021-cross-product-task-strategy-handoff-and-runtime-bridge.md)

## Runtime-First Framing

This is an additive runtime evolution, not a greenfield rewrite.
`cats-runtime` already has:

- stable session create/message/stream/observe routes
- runtime-hosted API/local execution loops
- CLI-native execution paths that already own their own loop semantics
- existing stream and observe surfaces that callers already consume

The first rollout must preserve current behavior for callers that do not send
strategy hints. The strategy substrate therefore needs to land as:

- additive request fields
- additive inspect/observe/stream fields
- compatibility-preserving fallback behavior

It must not:

- import `CoreTaskRecord`
- require product task graphs
- replace CLI-native loop ownership
- force all future strategies to ship in one slice

## Scope

### In Scope

- runtime-owned strategy registry and contract
- additive session/request strategy fields
- compatibility `simple_tool_call` wrapper
- first real `react` implementation with stuck detection / step limits
- additive strategy metadata in stream / observe / session inspection
- runtime-owned persisted strategy state

### Explicitly Deferred

- public task event bus
- product-default inference from Chat/Work/Code names
- direct imports of `cats` task contracts
- later-family implementation of `reflexion`, `tree_of_thoughts`, or `deps`
- forced CLI migration onto the new substrate

## Implementation Phases

### Phase 1: Strategy Contract, Registry, and Additive Session Request Shape

- [x] Define runtime-owned strategy request and context types
- [x] Add a strategy registry seam for runtime-hosted execution loops
- [x] Add additive request fields such as:
      `requestedStrategy`, `acceptanceCriteria`, `strategyContext`,
      `correlation`
- [x] Add additive session/observe metadata for:
      `requestedStrategy`, `effectiveStrategy`, and strategy-state summary
- [x] Keep existing callers valid when they send none of the new fields

**Deliverables**: a stable runtime-owned contract for strategy selection and
inspection that preserves existing session behavior.

### Phase 2: Compatibility Wrapper for Existing Runtime Loop

- [x] Wrap the current runtime-hosted flat tool-call loop as
      `simple_tool_call`
- [x] Keep current execution behavior as the compatibility fallback
- [x] Ensure current API/local consumers produce the same final behavior when
      they do not send strategy hints
- [x] Add regression coverage proving the fallback path is behaviorally stable

**Deliverables**: the current loop becomes an explicit strategy instead of an
implicit code path.

### Phase 3: First Real Strategy Implementation (`react`)

- [x] Implement `react` as the first non-trivial strategy
- [x] Add step limit enforcement
- [x] Add stuck/duplicate detection
- [x] Add bounded timeout behavior and failure reporting
- [x] Keep tool execution and transcript integration inside the existing runtime
      boundaries

**Deliverables**: `react` is usable as the first strategy that improves on the
current loop semantics.

### Phase 4: Strategy Resolution and Runtime-Owned State Persistence

- [x] Implement resolution order:
      explicit request -> runtime-owned preference -> compatibility fallback
- [x] Persist runtime-owned strategy-local state in session metadata or
      equivalent runtime state
- [x] Support resume/re-entry for runtime-hosted loops without relying on
      product task records
- [x] Ensure correlation metadata remains opaque and does not become a runtime
      task schema

**Deliverables**: strategy choice and strategy-local resume state survive normal
runtime session lifecycle.

### Phase 5: Streaming and Observe Integration

- [x] Add additive strategy events to existing stream surfaces
- [x] Add additive strategy summary/state fields to observe/session inspection
- [x] Reuse existing streaming infrastructure; do not invent a second runtime
      event bus
- [x] Make sure products can consume progress without understanding strategy
      internals deeply

**Deliverables**: runtime strategy progress is observable through current
stream/observe seams.

### Phase 6: Execution-Family Rollout and Guardrails

- [x] Land the substrate first on runtime-hosted API/local flows
- [x] Keep CLI-native loops out of scope unless a provider explicitly opts in
- [x] Audit agent-backend execution paths for future compatibility, but do not
      require full adoption in the first slice
- [x] Add configuration or internal capability flags where staged rollout helps

**Deliverables**: one safe first rollout that improves runtime-hosted loops
without destabilizing unrelated execution families.

### Phase 7: Verification and Documentation

- [x] Add unit tests for registry, resolution, and strategy-local state
- [x] Add integration tests for create/message/stream/observe with and without
      strategy hints
- [x] Add regressions proving current callers still work with fallback behavior
- [x] Update `docs/api.md` and `docs/architecture.md` after implementation
      lands

**Deliverables**: tested, documented, additive rollout of the strategy
substrate.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/runtime/**` | Modify/Create | Add strategy registry, resolution, and runtime-owned state helpers |
| `src/core/types.ts` | Modify | Add additive public/session-facing strategy fields |
| `src/http/routes/sessions.ts` | Modify | Accept additive strategy request fields and expose strategy metadata |
| `src/http/streaming.ts` / related stream helpers | Modify | Surface additive strategy events without replacing current stream contracts |
| `src/backends/api/**` | Modify | Route runtime-hosted API execution through the new strategy substrate |
| `src/backends/local/**` or shared API/local manager paths | Modify | Adopt the substrate for local-model runtime-hosted loops where applicable |
| `src/backends/cli/**` | Audit / minimal modify | Preserve CLI-native behavior unless an explicit integration is needed |
| `tests/**/*.test.ts` | Modify/Create | Add registry, fallback, `react`, `pdca`, stream, and observe regression coverage |
| `docs/api.md` | Modify (follow-on) | Document additive strategy request/response fields |
| `docs/architecture.md` | Modify (follow-on) | Document strategy registry and session-local execution ownership |

## Technical Decisions

- Preserve the current flat loop as explicit `simple_tool_call` rather than
  deleting it immediately.
- Make `react` the first real improved strategy, but not the mandatory default
  for all existing callers yet.
- Keep all strategy inputs runtime-neutral; `taskId` and related fields remain
  opaque correlation metadata only.
- Reuse existing stream/observe seams instead of inventing a task event bus.
- Keep CLI-native loops outside the first migration unless there is a concrete,
  low-risk reason to opt them in.

## Testing Strategy

- **Unit Tests**:
  strategy registry lookup, resolution order, state persistence helpers,
  stuck-detection utilities, timeout handling
- **Integration Tests**:
  session create/message with explicit strategy, fallback behavior with no
  strategy, stream/observe additive strategy metadata, `react` step-limit and
  stuck-detection behavior
- **Manual Testing**:
  run representative API/local sessions with and without strategy hints, verify
  `effectiveStrategy` and stream events, and confirm legacy callers still
  behave as before when they send no new fields

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Runtime accidentally begins depending on product task contracts | High | Keep strategy request fields generic and audit imports at the contract boundary |
| Existing session consumers break because fallback behavior changes | High | Preserve `simple_tool_call` as the compatibility strategy and add regression coverage first |
| Stream payloads become noisy or incompatible | Medium | Add only additive event types and keep existing event categories intact |
| Scope expands into every future strategy at once | Medium | Ship `simple_tool_call` + `react` first and defer the rest to later phases |
| CLI execution paths get destabilized by a runtime-hosted loop refactor | Medium | Keep CLI-native loops explicitly out of first-slice adoption |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-26 | Plan created for additive runtime-owned strategy registry, `simple_tool_call` compatibility wrapping, and first-slice `react` rollout |
| 2026-03-26 | First-slice substrate is landed and verified; follow-through now continues under roadmap item OPT-10, with `pdca` already added as the next runtime-owned family |
| 2026-03-26 | The next follow-through slice is landed and verified; `reflexion` now runs as a bounded runtime-owned critique/revision loop with additive reflection events and strategy-local state |

---

*Created: 2026-03-26*
*Author: Codex*
