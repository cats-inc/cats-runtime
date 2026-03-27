# SPEC-016: LAN Peer Discovery and Execution Routing v0

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Owner** | Codex |
| **Reviewer** | User / runtime workstream |

## Summary

`cats-runtime` may eventually support runtime-to-runtime peer discovery on a
small LAN so one instance can route a bounded turn to a peer that has the
needed provider or spare execution capacity.

This first spec intentionally scopes the feature to peer discovery plus
execution-only routing. The requesting runtime remains the owner of the
caller-visible session and all related lifecycle/maintenance state.

## Goals

- discover nearby `cats-runtime` peers and keep a bounded peer registry
- expose peer capability and health summaries for diagnostics or future routing
- route a bounded execution turn to a peer while preserving caller-owned session
  semantics
- keep the first slice compatible with the current SSE and NDJSON streaming
  contract
- make failure and security boundaries explicit

## Non-Goals

- full remote session ownership
- remote workspace mutation by default
- remote browser, wakeup, or maintenance ownership
- transparent mid-turn failover
- large-scale gossip or cluster scheduling
- shared-filesystem orchestration or git-based workspace sync in v0

## User Stories

- As a standalone operator, I want one runtime to discover another runtime on my
  LAN so that provider reachability can expand across machines.
- As a host or upper-layer consumer, I want peer execution to look like normal
  streamed turn output without taking over my session lifecycle contract.
- As a maintainer, I want the first peer-sharing slice to avoid smuggling in
  cross-node worktree and maintenance ownership.

## Requirements

### Functional Requirements

1. The runtime shall support discovery of nearby `cats-runtime` peers on a
   small local network.
2. The discovery subsystem shall maintain a peer registry with bounded metadata,
   including:
   - peer identity
   - base address or connect target
   - liveness/heartbeat summary
   - advertised capabilities relevant to execution routing
3. Peer discovery and peer registry maintenance shall be separable from actual
   execution routing.
4. The first execution-routing slice shall keep the requesting runtime as the
   authoritative owner of the caller-visible session.
5. A peer may execute a bounded turn and stream normalized events back, but it
   shall not become the owner of the caller-visible session record.
6. The first slice shall be limited to read-only or chat-oriented execution.
7. The first slice shall not require remote worktree mutation, retained cleanup,
   browser/session maintenance, or wakeup scheduling on the peer.
8. The routing contract shall support existing streamed turn semantics over:
   - SSE
   - NDJSON
9. The design shall not assume a single merged wire format such as
   "NDJSON over SSE."
10. The runtime shall surface explicit failure results when:
    - a peer disconnects mid-turn
    - a peer becomes unhealthy before dispatch
    - peer auth or trust checks fail
11. The first slice shall not promise transparent mid-turn retry or failover.
12. The runtime shall support an explicit peer trust or auth mechanism before
    accepting remote execution from another runtime.
13. Peer capability advertisements should be bounded to facts needed for:
    - diagnostics visibility
    - provider reachability
    - simple routing heuristics
14. The runtime may implement simple routing strategies such as:
    - provider affinity
    - least-busy peer
    - explicit peer selection
15. Any peer-execution routing metadata exposed to hosts or diagnostics should
    distinguish:
    - local execution
    - peer-routed execution
16. Any future extension to:
    - remote workspace mutation
    - full remote session ownership
    - retained cleanup across nodes
    - cross-node browser/session ownership
    requires a separate spec and ADR.

### Non-Functional Requirements

- **Correctness**: peer routing must not blur ownership of caller-visible
  session lifecycle state
- **Operability**: peer state should be observable through diagnostics
- **Security**: discovery alone must not imply trusted execution
- **Maintainability**: discovery, registry, and routing should remain separable
  modules

## Design Overview

```text
peer discovery
     |
     v
peer registry + health/capability summaries
     |
     +--> diagnostics / visibility
     |
     v
bounded routing decision
     |
     v
peer execution request
     |
     v
SSE or NDJSON stream back to caller runtime
     |
     v
caller runtime remains owner of session-facing lifecycle state
```

The peer is treated as an execution substrate. The caller runtime keeps its own
session inspection, maintenance, wakeup, browser, and worktree contracts.

## Dependencies

- [ADR-019](../decisions/019-scope-first-lan-peer-sharing-to-execution-only.md)
- [Research: LAN Mesh Discovery and Worker Sharing](../research/2026-03-24-lan-mesh-worker-sharing.md)
- [Architecture](../architecture.md)
- [API](../api.md)

## Open Questions

- [ ] Which peer discovery library should be preferred for Windows/macOS/Linux
      parity?
- [ ] What peer capability facts are worth advertising in v0 without leaking too
      much machine detail?
- [ ] Should peer execution routing be fully automatic, opt-in per provider, or
      explicit per request?
- [ ] What is the minimum viable peer trust bootstrap for standalone operators?

## References

- [ADR-019](../decisions/019-scope-first-lan-peer-sharing-to-execution-only.md)
- [Research log](../research/2026-03-24-lan-mesh-worker-sharing.md)
- [server.ts](../../src/server.ts)
- [sessions.ts](../../src/http/routes/sessions.ts)
- [messages.ts](../../src/http/routes/messages.ts)
- [streaming.ts](../../src/http/streaming.ts)

---

*Created: 2026-03-25*
*Author: Codex*
*Related Plan: TBD*
