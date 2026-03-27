# SPEC-014: Session Maintenance, Worktree Isolation, and Compaction Hooks

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented (Maintenance and Runtime Compaction Slices) |
| **Owner** | Codex |
| **Reviewer** | User / runtime-maintenance workstream |

## Summary

`cats-runtime` now has delivered reset-boundary hooks, worktree-backed session
lifecycle helpers, and a runtime-managed transcript compaction slice, but the
contract is still underspecified for deeper session discipline work.

This specification defines the runtime-owned maintenance contract for:

- session isolation mode
- worktree lifecycle
- reset and delete cleanup
- pre-maintenance hooks
- future compaction boundaries

The goal is not to ship a full provider-agnostic OpenClaw-style compactor in
one step. The goal is to make long-running session behavior predictable and
safe enough that product memory flush, worktree cleanup, and future/external
compaction can plug in without hidden lifecycle assumptions.

## Goals

- define one session-maintenance contract across shared, isolated, and
  worktree-backed sessions
- make reset/delete cleanup semantics explicit
- provide additive pre-maintenance hooks for product-owned memory flush and
  later compaction-related behaviors
- keep worktree lifecycle tied to session lifecycle rather than ad hoc shell
  commands

## Non-Goals

- implementing a full provider-agnostic compaction engine in this spec
- defining product memory internals
- moving workspace delivery policy into runtime
- designing visible operator UI for maintenance

## User Stories

- As a runtime maintainer, I want reset and delete flows to clean up worktrees
  and other session-owned resources consistently.
- As a product integrator, I want a hook to flush product-owned memory before
  a runtime reset or discard.
- As an operator, I want worktree-backed sessions to have clear merge/discard
  semantics instead of ad hoc cleanup.

## Requirements

### Functional Requirements

1. `cats-runtime` shall expose explicit session isolation semantics at least
   for:
   - `shared`
   - `isolated`
   - `worktree`
2. Worktree-backed sessions shall have deterministic prepare/create and cleanup
   behavior tied to runtime session lifecycle.
3. The runtime shall support explicit maintenance actions such as:
   - `reset`
   - `close`
   - `delete`
   - future `compact` / `prepare_compaction`
4. Maintenance actions shall surface machine-readable metadata describing:
   - maintenance type
   - isolation mode
   - owned resources
   - cleanup actions performed
   - warnings or skipped cleanup
5. Worktree-backed sessions shall support explicit end-of-life disposition:
   - `discard`
   - `merge`
   - `preserve` (reserved for exceptional/manual handling)
6. The runtime shall provide additive pre-maintenance hooks that can be
   invoked before reset/delete/discard.
7. Pre-maintenance hooks shall be able to carry:
   - maintenance reason
   - session identity
   - workspace/isolation metadata
   - optional product-owned payloads such as memory flush requests
8. Hook invocation failures shall be observable, but they shall not require the
   runtime to understand product-owned memory internals.
9. The runtime shall persist enough maintenance metadata that history/observe
   surfaces can explain what happened to a session.
10. Future compaction boundaries shall reuse the same maintenance framework
    instead of inventing a parallel lifecycle.
11. Worktree cleanup shall not be left to caller convention alone; runtime
    shall own the canonical cleanup path.

### Non-Functional Requirements

- **Predictability**: the same maintenance action should produce the same class
  of cleanup behavior for the same session shape
- **Safety**: cleanup and merge/discard behavior should be explicit, not
  accidental
- **Extensibility**: future compaction and memory-flush work should attach to
  the same maintenance seam
- **Observability**: operators and products should be able to inspect
  maintenance outcomes

## Conceptual Model

```text
session lifecycle
   |
   +--> active
   +--> maintenance requested
           |
           +--> pre-maintenance hooks
           +--> cleanup / merge / discard
           +--> maintenance outcome recorded
```

## Maintenance Hook Contract

Illustrative shape:

```ts
interface SessionMaintenanceRequest {
  action: 'reset' | 'close' | 'delete' | 'compact';
  sessionId: string;
  isolation: 'shared' | 'isolated' | 'worktree';
  reason?: string;
  worktreeDisposition?: 'discard' | 'merge' | 'preserve';
  hookPayloads?: Array<{
    kind: string;
    payload: unknown;
  }>;
}
```

The key requirement is not the exact type name. It is that runtime maintenance
becomes one explicit contract that later memory/product work can consume.

## Worktree Lifecycle Guidance

For `worktree` sessions, the runtime should own:

- deterministic worktree naming
- prepare/create behavior
- registry linkage between session and worktree
- merge/discard/preserve disposition
- cleanup on reset/delete

The runtime may expose helper inspection APIs, but callers should not need to
remember raw filesystem paths in order to clean up correctly.

## Relationship to Existing Specs

- `SPEC-008` defines the workspace substrate primitives and deterministic
  collaboration files
- this spec defines how session lifecycle and worktree isolation use those
  substrates operationally
- `SPEC-005` remains responsible for runtime-managed skill re-entry and should
  later use the same maintenance seam for skill-aware resume/compaction

## Dependencies

- [SPEC-008](./SPEC-008-workspace-substrate-init-audit-and-update.md)
- [SPEC-011](./SPEC-011-session-fork-and-context-transplant-primitives.md)
- [ADR-015](../decisions/015-own-workspace-substrate-tools-in-cats-runtime.md)

## Open Questions

- [ ] Should `preserve` remain an operator-only escape hatch, or become a
      first-class product option?
- [ ] Which maintenance outcomes should become separate run-history events
      versus additive session-state metadata only?
- [ ] Should worktree merge behavior remain runtime-owned in the first slice,
      or require caller-supplied merge approval before apply?

## References

- [cats OpenClaw gap analysis](../../../cats/docs/research/2026-03-20-openclaw-chat-runtime-gap-analysis.md)
- [SPEC-008: Workspace Substrate Init, Audit, and Update](./SPEC-008-workspace-substrate-init-audit-and-update.md)
- [ADR-015: Own Workspace Substrate Tools in cats-runtime](../decisions/015-own-workspace-substrate-tools-in-cats-runtime.md)

---

*Created: 2026-03-24*
*Author: Codex*
*Last updated: 2026-03-24*
