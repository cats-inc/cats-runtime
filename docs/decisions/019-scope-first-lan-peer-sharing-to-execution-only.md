# ADR-019: Scope First LAN Peer Sharing to Execution-Only

> If `cats-runtime` adds runtime-to-runtime peer sharing, the first slice keeps
> session ownership in the caller runtime and treats remote peers as bounded
> execution substrates.

## Status

Accepted

## Date

2026-03-25

## Context

Research on LAN mesh worker sharing showed real upside:

- peer discovery across a small LAN is feasible
- one runtime could reach providers that only exist on another machine
- the existing adapter/discovery patterns provide useful building blocks

That same research also overstated how additive the first implementation would
be if it were framed as "just a remote `ExecutionHandle` proxy."

Current repo reality is more coupled:

- `src/server.ts` composes `SessionRegistry`, `RuntimeSessionManager`,
  `RuntimeWakeupService`, `RuntimeBrowserMaintenanceService`, and
  `RuntimeWorktreeMaintenanceService` into one local runtime
- `src/http/routes/sessions.ts` owns session inspection, hydration,
  maintenance, retained cleanup, and related lifecycle transitions through that
  local runtime state
- `src/http/routes/messages.ts` exposes message execution, but the surrounding
  session contract is still local-runtime-owned
- streaming supports both SSE and NDJSON, not one combined "NDJSON over SSE"
  transport

If runtime-to-runtime peer sharing tries to delegate full session ownership in
its first slice, it will immediately inherit open questions around:

- authoritative session IDs
- maintenance follow-through ownership
- retained worktree/browser cleanup
- wakeup scheduling ownership
- workspace mutation semantics
- cross-node recovery after mid-turn failure

The project needs a narrower first boundary.

## Decision

If `cats-runtime` adds LAN or peer execution in the near term, the first slice
will be **execution-only**.

This means:

1. The requesting runtime remains the authoritative owner of the session it
   exposes to upstream hosts or users.
2. A remote peer may execute a bounded turn and stream normalized events back,
   but it does not become the owner of the caller-visible session record.
3. The caller runtime continues to own:
   - session inspection state
   - maintenance request/follow-through state
   - wakeups
   - browser/session maintenance
   - worktree lifecycle and retained cleanup
4. The first slice is scoped to read-only or chat-oriented execution. Workspace
   mutation, remote cleanup, and remote browser/worktree side effects are out
   of scope.
5. Discovery and peer registry work may proceed independently from execution
   routing, but they do not imply full remote session delegation.
6. Peer transport must respect the existing runtime streaming contract as two
   formats:
   - SSE
   - NDJSON
   The design must not assume a fictional merged wire format.
7. Any future move toward:
   - remote workspace mutation
   - full remote session ownership
   - cross-node retained cleanup
   - transparent mid-turn failover
   requires a separate spec and ADR.

## Consequences

### Positive

- keeps the first peer-sharing slice aligned with current runtime ownership
- reduces the risk of tearing session lifecycle and maintenance state across
  nodes too early
- allows discovery and bounded peer execution experiments without first solving
  remote worktree/browser semantics
- makes the workspace mutation problem explicit instead of accidentally implied

### Negative

- the first slice will not offer full "any node can own any session" behavior
- peer execution becomes less magical and more policy-constrained
- some high-value workflows still need shared filesystems or later sync work

### Neutral

- this ADR does not reject LAN discovery
- this ADR does not reject future workspace-aware peer execution
- this ADR does not choose the exact discovery library or peer-auth mechanism

## Alternatives Considered

### Alternative 1: Treat a Peer as a Full Remote Session Owner Immediately

- **Pros**: simple conceptual story; the peer API looks like a direct runtime
  proxy
- **Cons**: conflicts with current local ownership of maintenance, wakeups,
  worktrees, browser sessions, and inspection state
- **Why rejected**: too much hidden contract work is smuggled into the first
  slice

### Alternative 2: Only Support Peer Discovery, No Execution Routing

- **Pros**: smallest surface area; useful diagnostics
- **Cons**: does not actually deliver provider sharing
- **Why rejected**: discovery-only is a reasonable phase, but not a sufficient
  long-term boundary on its own

### Alternative 3: Require Shared Filesystem and Allow Full Remote Mutation in v1

- **Pros**: enables richer cross-node workflows faster for advanced operators
- **Cons**: turns infrastructure assumptions into an implicit runtime contract
- **Why rejected**: too environment-specific for the first general peer-sharing
  slice

## References

- [Research: LAN Mesh Discovery and Worker Sharing](../research/2026-03-24-lan-mesh-worker-sharing.md)
- [Architecture](../architecture.md)
- [API](../api.md)
- [server.ts](../../src/server.ts)
- [sessions.ts](../../src/http/routes/sessions.ts)
- [messages.ts](../../src/http/routes/messages.ts)
- [streaming.ts](../../src/http/streaming.ts)

---

*Accepted: 2026-03-25*
*Decision makers: user + Codex*
