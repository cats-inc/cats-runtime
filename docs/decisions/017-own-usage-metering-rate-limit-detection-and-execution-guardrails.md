# ADR-017: Own Usage Metering, Rate-Limit Detection, and Execution Guardrails

> Keep normalized usage telemetry, rate-limit detection, and executable
> guardrails inside `cats-runtime`, while upper-layer products own budget
> policy, approvals, and operator-facing cost control.

## Status

Accepted

## Date

2026-03-20

## Context

The Cats stack now spans three execution families:

- `api` / `local` backends with explicit token-usage reporting and provider
  rate limits
- `cli` backends where some providers report usage, some report only partial
  quota signals, and some expose rate-limit failures through stderr or protocol
  events
- `agent` backends that may emit their own usage or quota events through an
  adapter contract

The current codebase already has pieces of this story:

- `StreamEvent.usage` exists in shared runtime types
- multiple API transports normalize token usage today
- several CLI providers already surface usage from transcripts or stream events
- `SPEC-007` already defines runtime-owned failure categorization, including
  rate-limit signatures

What the stack does not yet have is a clear decision on where the full
metering and guardrail responsibility belongs.

The wrong boundary would be to keep usage/rate logic inside only
`src/backends/api`, because the runtime must also account for CLI and agent
execution. The wrong boundary on the other side would be to push provider-level
metering, cooldowns, and execution blocking entirely up into `cats`.

## Decision

`cats-runtime` will own normalized usage metering, rate-limit detection, and
execution guardrails across backend families.

1. Runtime-owned telemetry covers all execution families.
   - `api` / `local`
   - `cli`
   - `agent`

2. Usage and rate-limit normalization belong in shared runtime layers.
   - shared types and aggregation should live in `src/core`
   - backend modules emit normalized usage or quota events into that shared
     layer
   - `PLAN-003` follow-up about `src/core` vs `src/backends/api` is now
     resolved in favor of `src/core`

3. Runtime guardrails are executable, not policy-owning.
   - runtime may warn, back off, cool down, or block execution when configured
     thresholds or runtime-local safety limits are hit
   - runtime should report those states machine-readably
   - runtime should not decide product budget policy or approval workflow on
     its own

4. Product-owned budget policy remains above runtime.
   - `cats` or another host decides soft vs hard limits
   - `cats` or another host owns approval, override, and operator-facing
     budget governance
   - runtime provides the telemetry and execution controls those policies need

5. CLI rate-limit handling should reuse runtime-owned compatibility knowledge.
   - failure signatures, cooldown hints, and degraded classifications should
     align with `SPEC-007`
   - CLI providers should not each invent a separate product-facing budget or
     rate-limit model

## Rationale

- Usage, quota, and cooldown state are execution facts that originate at the
  runtime boundary.
- The same session contract should expose consistent metering whether work ran
  through an API, a CLI, or an external agent runtime.
- Budget policy, approvals, and war-room dashboards are product/control-plane
  concerns and should stay in `cats`.
- This follows the same split already adopted for skills, MCP/tool intent,
  previews, delivery policy, and delivery primitives.

## Consequences

### Positive

- Metering and rate-limit handling can be shared across all runtime backends.
- Hosts gain one machine-readable source of truth for usage and cooldown state.
- `cats` can build budget dashboards and override flows without parsing raw
  provider output itself.
- CLI quota events become first-class runtime signals instead of ad hoc stderr
  strings.

### Negative

- `cats-runtime` grows another cross-backend control-plane subsystem.
- Some CLI providers will only offer partial or estimated telemetry at first.
- The team must define consistent aggregation and confidence rules for
  reported, derived, and unknown usage.

### Neutral

- This ADR does not require `cats-runtime` to own long-horizon company budgets.
- This ADR does not require every provider to expose exact cost in the first
  slice.
- This ADR does not require `cats` to ship a full Cats Work dashboard
  immediately, only that runtime telemetry makes that possible.

## Alternatives Considered

### Alternative 1: Keep budget and rate-limit handling mostly in `backends/api`

- **Pros**: easiest for the current API backend work
- **Cons**: leaves CLI and agent execution without a shared metering/guardrail
  layer
- **Why rejected**: the runtime needs cross-backend telemetry and blocking
  semantics

### Alternative 2: Push usage aggregation and rate handling entirely into
`cats`

- **Pros**: product gets direct operator control
- **Cons**: product would need to parse provider/runtime-specific execution
  facts and duplicate runtime knowledge
- **Why rejected**: usage and cooldown state originate at runtime

### Alternative 3: Treat budget governance and runtime guardrails as one system

- **Pros**: fewer conceptual layers
- **Cons**: collapses operator policy and execution telemetry into one place
- **Why rejected**: policy belongs above runtime; execution guardrails belong
  inside it

## References

- [SPEC-007](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md)
- [SPEC-003](../specs/SPEC-003-agent-backend.md)
- [ADR-016](./016-own-executable-delivery-primitives-not-delivery-policy.md)
- [cats ADR-023](../../../cats-platform/docs/decisions/023-own-budget-policy-and-cost-control-in-product.md)
- [cats Paperclip Control-Plane Analysis](../../../cats-platform/docs/research/paperclip-control-plane-analysis.md)

---

*Accepted: 2026-03-20*
*Decision makers: user + Codex*

