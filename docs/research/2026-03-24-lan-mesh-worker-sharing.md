# Research Log: LAN Mesh Discovery and Worker Sharing

Date: 2026-03-24
Topic: LAN discovery between `cats-runtime` instances, mesh interconnection, and remote CLI worker sharing
Last updated: 2026-03-25

## Sources

- Internal architecture review: `src/backends/cli/pool/WorkerPool.ts`, `WorkerProcess.ts`
- Internal discovery review: `src/backends/cli/discovery/`, `DiscoveryController`
- Internal contracts: `ExecutionHandle`, `StreamEvent`, `RuntimeAdapter`
- Internal HTTP streaming review: `src/http/routes/messages.ts`, `src/http/streaming.ts`
- Internal runtime ownership review: `src/server.ts`, `src/http/routes/sessions.ts`
- Internal agent backend: `src/backends/agent/`, `AgentBackendManager`
- mDNS/DNS-SD: RFC 6762 (mDNS), RFC 6763 (DNS-SD)
- Node.js ecosystem: `bonjour-service`, `@homebridge/ciao`

## Summary

Multiple `cats-runtime` instances on the same LAN could eventually discover
each other and share execution capacity, but the current repo reality only
supports a bounded first slice.

The codebase already has reusable adapter, discovery, and streaming pieces.
However, session lifecycle, maintenance follow-through, wakeups, browser
maintenance, worktree cleanup, and inspection state are still owned by the
local runtime process. A naive "remote worker proxy" is therefore not just an
additive `ExecutionHandle` wrapper if it also tries to move session ownership
across nodes.

The practical v1 direction is:

- keep caller-visible session ownership in the requesting runtime
- scope peer sharing to execution-only, read-only/chat-oriented turns
- treat workspace mutation and full remote session delegation as later work

This research now aligns with [ADR-019](../decisions/019-scope-first-lan-peer-sharing-to-execution-only.md).

## Existing Architectural Affordances

- **`ExecutionHandle`** is still the right local abstraction for a peer-backed
  execution path. A remote execution adapter can emit the same normalized
  `StreamEvent` stream back into the caller runtime.
- **`AgentBackendManager`** shows that `cats-runtime` can already bridge to
  external runtimes over HTTP while keeping upper layers on a runtime-owned
  contract.
- **`DiscoveryController`** remains a reasonable pattern for LAN peer scan and
  registry lifecycle.
- **HTTP readiness and message surfaces** (`GET /health`,
  `POST /sessions/{id}/messages`) already expose useful ingredients for peer
  capability checks and streamed turn execution.

## Reality Check Against Current Repo

### Session and Maintenance Ownership Are Still Local

Runtime bootstrap wires together:

- `SessionRegistry`
- `RuntimeSessionManager`
- `RuntimeWakeupService`
- `RuntimeBrowserMaintenanceService`
- `RuntimeWorktreeMaintenanceService`

Those services are composed in one local runtime process and the session routes
depend on them directly for:

- session inspection and hydration
- maintenance request and follow-through tracking
- retained cleanup and auto-settlement
- worktree/browser lifecycle management

This means remote peer sharing is not "no major refactoring" if it implies full
remote session ownership.

### Streaming Is Two Formats, Not "NDJSON over SSE"

`StreamEvent` is normalized in-process, but the HTTP layer currently supports
two transport encodings:

- SSE by default
- NDJSON when the client sends `Accept: application/x-ndjson`

Any cross-node proxy should preserve or explicitly normalize those two formats
rather than assuming one combined wire format.

### Discovery Is the Easy Part

mDNS/DNS-SD discovery and peer heartbeats still look straightforward. The hard
part is the boundary between:

- caller-owned session lifecycle
- peer-executed turn work
- any future workspace or browser side effects

## Recommended First Slice

1. **Peer discovery and registry**
   - advertise `_cats-runtime._tcp`
   - collect peer health and capability summaries
   - keep this independent from execution routing
2. **Execution-only peer adapter**
   - allow the caller runtime to route a single turn to a peer
   - keep the caller runtime authoritative for the session it exposes upstream
   - treat the peer as a bounded execution substrate, not as the owner of the
     caller's session record
3. **Read-only / chat-only scope**
   - allow analysis, Q&A, review, and similar non-mutating work
   - keep workspace mutation, retained cleanup, wakeups, browser state, and
     compaction follow-through local until a stronger contract exists
4. **Explicit failure semantics**
   - surface peer disconnects as execution failures
   - do not promise transparent mid-turn failover in v1

## Workspace Consistency

CLI workers operate on the local filesystem. When a remote peer executes a
turn, it reads and writes files on its machine, not the caller's.

Options:

- **Option A — Chat-only sharing**: restrict remote workers to stateless or
  read-only tasks. Simplest and best aligned with current repo reality.
- **Option B — Shared filesystem**: require a shared mount so both nodes see
  the same tree. Useful for advanced home-lab setups, but not a runtime
  default.
- **Option C — Runtime-owned workspace sync**: clone/sync a workspace on the
  remote peer before execution. This is materially larger work and should not
  be implied by the first peer-sharing slice.

Recommendation: start with Option A. Treat B as operator-managed infrastructure
and C as future design work.

## Security

- LAN trust does not remove the need for explicit peer acceptance.
- Existing bearer-token patterns may be reusable for a first slice.
- mTLS or stronger host identity can remain optional follow-on work.

## Value Proposition

- **Provider diversity amplification**: one machine may host Claude CLI, another
  Codex, another Cursor; peer discovery can widen what one runtime can reach.
- **Good fit for a personal operator lab**: desktop, laptop, and small server
  deployments are common in this repo's intended usage.
- **Still differentiated**: runtime-to-runtime peer execution would remain a
  distinctive capability, but only if the ownership boundary stays crisp.

## Suggested Implementation Phases

- **Phase 1 — Discovery + Registry**
  - mDNS advertisement/listener
  - peer capability registry
  - dashboard/diagnostics visibility
- **Phase 2 — Execution-Only Peer Routing**
  - bounded peer execution adapter
  - caller-owned session semantics
  - chat-only/read-only routing policy
- **Phase 3 — Workspace-Aware Execution**
  - separate spec and ADR required
  - shared filesystem or sync strategy
  - explicit file-mutation conflict model

## Follow-Through Documents

- [ADR-019](../decisions/019-scope-first-lan-peer-sharing-to-execution-only.md)
- [SPEC-016](../specs/SPEC-016-lan-peer-discovery-and-execution-routing-v0.md)

## Action Items

- [x] Replace the earlier "light proxy" framing with a caller-owned,
      execution-only boundary
- [x] Draft ADR-019 for the first peer-sharing boundary
- [ ] Draft a dedicated peer execution protocol spec if implementation is
      scheduled
- [ ] Validate mDNS behavior on Windows + WSL mixed environments before coding

---

Logged by: Claude
Reality-checked and updated by: Codex
