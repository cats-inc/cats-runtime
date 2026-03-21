# SPEC-011: Session Fork and Context-Transplant Primitives

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft (Pending Review) |
| **Owner** | Codex |
| **Reviewer** | User / orchestration-runtime workstream |

## Summary

`cats-runtime` already exposes a generic session fork route and some providers
already advertise native fork capability.

That is not yet enough for higher-layer orchestration.

Upper-layer products such as `cats-inc` now need a clearer branching contract
that can support:

- native provider/session fork when available
- curated context transplant into a fresh child session when native fork is not
  available or when the child should move to another provider or Cat role
- machine-readable lineage so product layers can track branch and converge state

The runtime should provide these execution primitives without owning room
workflow policy or scheduler semantics.

## Goals

- formalize session fork as a stable runtime branching primitive
- distinguish native fork from context transplant explicitly
- support branching into same-provider and different-provider child sessions
- preserve branch lineage so upper-layer orchestration stays observable

## Non-Goals

- deciding when a room should branch or converge
- owning `Boss Cat` room workflow policy
- embedding a heartbeat or scheduler subsystem into runtime
- forcing every provider to support native fork

## User Stories

- As an upper-layer product, I want to branch a session without rebuilding all
  context from scratch when the provider supports fork.
- As an upper-layer product, I want to start a child branch on another
  provider/model/Cat role using a curated handoff bundle from the parent.
- As a runtime operator, I want session inspection to show branch lineage rather
  than hiding where a child session came from.
- As a product integrator, I want one branch API surface even when providers
  differ in native fork support.

## Requirements

### Functional Requirements

1. `cats-runtime` shall continue to expose a generic session branching surface
   above provider-specific implementations.
2. The runtime shall explicitly distinguish at least these branch modes:
   - `native_fork`
   - `context_transplant`
3. The runtime shall expose provider/session fork capability machine-readably
   when the underlying provider supports native branch semantics.
4. When a caller requests branching from a parent session and the chosen child
   configuration is compatible with native fork, the runtime should prefer
   `native_fork`.
5. When native fork is unsupported or incompatible with the requested child
   configuration, the runtime shall be able to branch through
   `context_transplant`.
6. Context transplant shall support creating a fresh child session while
   carrying curated parent context into the child.
7. Context transplant inputs should be able to include at least:
   - parent session id
   - parent checkpoint or handoff summary
   - optional transcript excerpt or message bundle
   - optional structured blocks or tool-result-like content when available
   - optional artifact or output references
   - requested child provider/model/instance overrides
   - requested child instructions or contextual labels
8. Context transplant shall not require the child provider to share the same
   native session model as the parent.
9. The runtime shall preserve branch lineage machine-readably for both native
   fork and context transplant.
10. Branch lineage should be able to retain at least:
    - parent session id
    - branch mode
    - parent provider family
    - child provider family
    - branch creation time
11. Forked or transplanted child sessions shall remain normal runtime sessions.
12. Child sessions created from branching shall continue to support normal
    runtime lifecycle operations such as:
    - message
    - resume where supported
    - close
    - observe/history
13. The runtime should allow child branch creation to override at least:
    - provider family or instance
    - model
    - workspace location when safe
    - instructions/context metadata
14. The runtime shall expose branch failures honestly when:
    - native fork is requested but unsupported
    - transplant input is insufficient
    - provider compatibility rules reject the requested child configuration
15. The runtime shall not decide workflow policy such as whether a room should
    wait for all child branches or how a room should converge.
16. The runtime shall not require a heartbeat or scheduler to support branching.

### Non-Functional Requirements

- **Boundary integrity**: runtime owns branch execution primitives; product owns
  branch policy
- **Observability**: branch lineage must remain inspectable
- **Compatibility**: providers without native fork must still participate via
  context transplant where possible
- **Honesty**: unsupported native fork must degrade clearly rather than pretend
  success

## Suggested Runtime Shapes

Illustrative runtime-side types:

```ts
type SessionBranchMode = 'native_fork' | 'context_transplant';

interface SessionBranchLineage {
  parentSessionId: string;
  branchMode: SessionBranchMode;
  parentProvider: string;
  childProvider: string;
  createdAt: string;
}

interface SessionContextTransplant {
  summary?: string;
  transcriptExcerpt?: Array<{ role: 'user' | 'assistant'; content: string }>;
  artifacts?: Array<{ id: string; path?: string; uri?: string }>;
  labels?: string[];
}
```

## Flow

```text
upper-layer branch request
         |
         +--> check provider/session fork capability
         |
         +--> if compatible and supported -> native_fork
         |
         +--> else -> context_transplant
         |
         v
runtime child session creation
         |
         +--> lineage metadata
         +--> normal session lifecycle
         +--> observable child state
```

## First-Slice Direction

The first runtime slice should prioritize:

- stable native fork behavior for providers that already support it
- explicit lineage in session inspection payloads
- a minimal context-transplant request shape usable by `cats-inc`
- clear failure semantics when native fork cannot be honored

The first slice should not require:

- full transcript surgery for every provider
- workflow-aware runtime scheduling
- product-specific `Boss Cat` semantics

## Dependencies

- [SPEC-003](./SPEC-003-agent-backend.md)
- [SPEC-005](./SPEC-005-runtime-managed-skills-v0.md)
- [cats-inc ADR-024](../../../cats/docs/decisions/024-separate-explicit-mentions-from-dynamic-room-workflow.md)
- [cats-inc SPEC-026](../../../cats/docs/specs/SPEC-026-explicit-mentions-and-dynamic-room-workflow-orchestration.md)

## Open Questions

- [ ] Should the first context-transplant slice carry only a summary and curated
      excerpt, or also allow fuller managed transcript cloning when the caller
      requests it?
- [ ] Should transcript excerpts evolve beyond simple user/assistant text into a
      richer block format that can retain tool results, structured data, or
      diagram references?
- [ ] Which session inspection surfaces should expose branch lineage first:
      HTTP only, dashboard only, or both?
- [ ] Should branch creation reuse the current `/sessions/{id}/fork` route with
      a richer request body, or should native fork and context transplant split
      into two explicit routes later?

## References

- [api.md](../api.md)
- [architecture.md](../architecture.md)
- [PLAN-004](../plans/PLAN-004-agent-backend.md)
- [PROGRESS.md](../../PROGRESS.md)

---

*Created: 2026-03-20*
*Author: Codex*
*Related Plan: TBD*
