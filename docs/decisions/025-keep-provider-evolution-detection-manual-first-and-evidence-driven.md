# ADR-025: Keep Provider Evolution Detection Manual-First and Evidence-Driven

Date: 2026-03-27
Status: Proposed

## Context

`cats-runtime` already owns provider compatibility, setup diagnostics, and runtime event normalization. It integrates with multiple fast-moving CLI providers whose event surfaces can evolve independently of runtime release cadence.

The runtime now needs a clear policy for how to detect provider evolution such as:

- new event types appearing
- expected event types disappearing
- known event payloads changing schema
- event content drifting semantically while preserving schema

Without a policy, adapter maintenance becomes reactive and anecdotal. However, making the runtime always-on and self-adapting would add avoidable complexity, user overhead, and safety risk.

## Decision

`cats-runtime` will treat provider evolution detection as a runtime-owned, manual-first, evidence-driven capability.

This means:

1. The runtime will support manual capability probes that gather evidence about provider event behavior.
2. The runtime will preserve and classify evidence for:
   - upgrade detection
   - regression detection
   - schema change detection
   - semantic drift suspicion
3. External release notes and changelogs are context inputs, not evidence produced by the runtime itself.
4. The runtime will not automatically rewrite parser logic or promote new upstream event types without human review.
5. The first slice will not require a dashboard or HTTP control surface; a manual developer/operator entrypoint is sufficient.

## Rationale

This keeps the runtime on the right side of the complexity line.

It provides:

- durable evidence for provider changes
- repeatable comparison against prior baselines
- enough structure to keep adapters current

It avoids:

- always-on user-machine probe overhead
- speculative auto-adaptation
- premature dependency on host UI before the core evidence loop exists

## Scope Boundary

The first implementation should be limited to:

- adapter instrumentation for ignored, raw, normalized, and schema-failure events
- a shared evidence collector
- a manual probe command or equivalent developer-facing entrypoint
- baseline snapshots and comparison output

The first implementation may focus on CLI-backed providers, but the decision itself is not CLI-exclusive. Future protocol-backed adapters, including A2A-facing integrations, should plug into the same evidence model without forcing the collector to assume line-oriented events, flat `kind` discriminators, or explicit final booleans.

The first implementation should explicitly exclude:

- automatic parser mutation
- automatic capability promotion into host-facing UX
- a public dashboard surface
- continuous background probing on end-user machines

## Consequences

### Positive

- Provider evolution becomes observable instead of anecdotal
- Adapter updates can be prioritized using evidence
- The runtime can improve provider UX incrementally without large speculative abstraction work
- Future host features can depend on a firmer capability truth

### Negative

- Manual review is still required
- Semantic drift remains heuristic and may require human interpretation
- The runtime will not automatically benefit from upstream provider improvements until someone reviews the evidence and updates the adapter

## Alternatives Considered

### 1. Do Nothing

Rejected.

This leaves provider evolution invisible until users hit degraded behavior.

### 2. Fully Automatic Self-Adaptation

Rejected for the first slice.

This would require much stronger guarantees around parser safety, capability validation, and rollout discipline than the runtime currently has.

### 3. Rely Only on Upstream Release Notes

Rejected.

Release notes explain change intent but do not prove what the runtime actually observed. Runtime-owned evidence is still required.

## Follow-On Work

- Define the manual probe and evidence bundle contract in a spec
- Instrument provider adapters to make ignored and schema-failure paths observable
- Add baseline compare output for repeated probe runs

## Related

- [2026-03-27 Provider Evolution Evidence Framework](../research/2026-03-27-provider-evolution-evidence-framework.md)
- [2026-03-27 CLI Provider Event Capability Audit](../research/2026-03-27-cli-provider-event-capability-audit.md)
- [SPEC-007 Provider Compatibility and Evidence Engine](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md)
