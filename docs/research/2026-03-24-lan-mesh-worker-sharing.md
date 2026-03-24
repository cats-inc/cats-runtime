# Research Log: LAN Mesh Discovery and Worker Sharing

Date: 2026-03-24
Topic: LAN discovery between `cats-runtime` instances, mesh interconnection, and remote CLI worker sharing

## Sources

- Internal architecture review: `src/backends/cli/pool/WorkerPool.ts`, `WorkerProcess.ts`
- Internal discovery review: `src/backends/cli/discovery/`, `DiscoveryController`
- Internal contracts: `ExecutionHandle`, `StreamEvent`, `RuntimeAdapter`
- Internal agent backend: `src/backends/agent/`, `AgentBackendManager`
- mDNS/DNS-SD: RFC 6762 (mDNS), RFC 6763 (DNS-SD)
- Node.js ecosystem: `bonjour-service`, `@homebridge/ciao`

## Summary

Multiple `cats-runtime` instances running on the same LAN could discover each
other, form a lightweight mesh, and share CLI workers across nodes. This would
allow a consumer on one machine to route a turn to a provider that only exists
on a different machine.

### Existing Architectural Affordances

The current codebase already has several abstractions that make this feasible
without major refactoring:

- **`ExecutionHandle`** is a provider-neutral interface. A remote worker proxy
  only needs to implement the same `streamMessage()` → `AsyncGenerator<StreamEvent>`
  contract.
- **`AgentBackendManager`** and adapter pattern already bridge to external
  runtimes over HTTP. A LAN peer is structurally similar to an agent adapter
  target.
- **`StreamEvent`** is a discriminated union that is already serialized as
  NDJSON over SSE. Cross-node streaming requires no new wire format.
- **`DiscoveryController`** pattern (scanner → sync → registry) is reusable.
  A `LanPeerScanner` would follow the same lifecycle as existing scanners.
- **HTTP API** (`POST /sessions/{id}/messages`, `GET /health`) already exposes
  the primitives needed for remote invocation and heartbeat.

### Proposed Mechanism

1. **Discovery** — each `cats-runtime` instance advertises a
   `_cats-runtime._tcp` service via mDNS/DNS-SD on startup. The advertisement
   includes metadata: available providers, current worker count, load level.

2. **Peer Registry** — a `PeerRegistry` (analogous to `SessionRegistry`)
   maintains known peers. Peers are added on mDNS discovery and removed after
   missed heartbeats. LAN scale is typically < 10 nodes; full mesh is
   sufficient without gossip protocols.

3. **Remote Worker Proxy** — a new `RemoteCliBackend` adapter implements
   `ExecutionHandle`. Internally it calls `POST /sessions` and
   `POST /sessions/{id}/messages` on the peer, proxying the SSE stream back
   as local `StreamEvent` emissions.

4. **Worker Scheduling** — a `PeerAwareWorkerPool` wraps the existing
   `WorkerPool`. When a local provider is unavailable or busy, it checks the
   peer registry for a node that has capacity. Strategies:
   - Affinity-first: prefer the node that owns the provider natively
   - Least-busy: route to the peer with the fewest active workers
   - Round-robin: simple fallback

## Feasibility Assessment

- **LAN Discovery (mDNS)** — straightforward
  - Node.js libraries are mature (`bonjour-service`, `@homebridge/ciao`)
  - Standard protocol, works across Windows/macOS/Linux
  - Fits existing `DiscoveryController` lifecycle
- **Peer Registry & Health** — moderate
  - Heartbeat via `GET /health` (already exists)
  - Graceful deregistration on shutdown
  - Stale-peer timeout and cleanup
- **Remote Worker Proxy** — moderate
  - SSE/NDJSON streaming is already the wire format
  - `ExecutionHandle` interface keeps the consumer unaware of locality
  - Need to handle connection drops and reconnect/abort semantics
- **Worker Scheduling** — moderate to hard
  - Simple strategies (affinity, least-busy) are easy
  - Avoiding double-dispatch and race conditions needs care
  - Capacity advertisement must be real-time enough to prevent overload

## Key Challenges

### Workspace Consistency

CLI workers operate on the local filesystem. When a remote peer executes a
turn, it reads and writes files on *its* machine, not the requester's.

Options:
- **Option A — Chat-only sharing**: restrict remote workers to stateless
  tasks (analysis, Q&A, code review). No file mutations cross the network.
  Simplest and safest.
- **Option B — Shared filesystem**: require NFS/SMB mount so both nodes see
  the same directory. Practical for home-lab setups but adds infra
  requirements.
- **Option C — Git worktree sync**: clone/pull the workspace on the remote
  peer, execute, then push results. High latency but hermetic.

Recommendation: start with Option A for v1. Option B can be documented as an
advanced configuration. Option C is future work.

### Mid-Turn Failure

If a peer goes offline while a turn is in progress, the proxy must:
- Detect the broken SSE connection
- Surface an error `StreamEvent` to the consumer
- Optionally retry on another peer (complex, likely v2+)

### Security

- LAN trust model simplifies auth, but a shared secret or pre-shared key
  should gate peer acceptance
- The existing bearer-token auth middleware can be reused between peers
- mTLS is an option for higher-security environments

## Value Proposition

- **Provider diversity amplification** — the core differentiator of
  `cats-runtime` is multi-provider support. Mesh sharing multiplies this:
  one machine runs Claude CLI, another runs Codex, a third runs Cursor.
  Every consumer sees all providers.
- **Natural fit for "one-man digital company"** — a solo operator likely has
  desktop + laptop + NAS/server, each with different CLI tools installed.
  Mesh unifies them without manual routing.
- **Architectural alignment** — the adapter pattern, `ExecutionHandle`
  interface, and discovery lifecycle already anticipate this extension. The
  new code is additive, not structural.
- **Differentiation** — no competing tool (Plandex, Aider, goose, etc.)
  offers LAN-level worker federation. This would be a unique capability.

## Suggested Implementation Phases

- **Phase 1 — Discovery + Registry** (~2-3 days)
  - mDNS advertisement and listener
  - `LanPeerScanner` following existing scanner pattern
  - `PeerRegistry` with heartbeat and cleanup
  - Dashboard UI: show discovered peers
- **Phase 2 — Remote Worker Proxy (chat-only)** (~3-5 days)
  - `RemoteCliBackend` implementing `ExecutionHandle`
  - SSE proxy with error handling
  - `PeerAwareWorkerPool` with affinity-first strategy
  - Provider catalog merging across peers
- **Phase 3 — Workspace-Aware Execution** (future, scope TBD)
  - Shared filesystem documentation and detection
  - Git-based workspace sync
  - File mutation conflict resolution

## Action Items

- [ ] Validate mDNS works reliably on Windows + WSL mixed environments
- [ ] Draft ADR if the feature is approved for implementation
- [ ] Prototype `LanPeerScanner` as a standalone spike
- [ ] Evaluate whether `PeerAwareWorkerPool` should live in `src/core/` or
      `src/backends/cli/`

---

Logged by: Claude
