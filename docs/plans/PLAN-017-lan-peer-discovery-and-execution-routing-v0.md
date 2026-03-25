# PLAN-017: LAN Peer Discovery and Execution Routing v0

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | runtime workstream |
| **Assigned To** | Unassigned |
| **Reviewer** | User / runtime workstream |

## Related Spec

- [SPEC-016: LAN Peer Discovery and Execution Routing v0](../specs/SPEC-016-lan-peer-discovery-and-execution-routing-v0.md)
- [ADR-019: Scope First LAN Peer Sharing to Execution-Only](../decisions/019-scope-first-lan-peer-sharing-to-execution-only.md)
- [Research: 2026-03-24 LAN Mesh Worker Sharing](../research/2026-03-24-lan-mesh-worker-sharing.md)

## Overview

This plan implements the first peer-sharing slice as an execution-only
extension to `cats-runtime`. The caller runtime remains the owner of the
caller-visible session, history, wakeups, browser state, worktree lifecycle,
and inspection surface. Peer support must land before any `cats` follow-up, so
the rollout must be backward-compatible for existing `cats` consumers.

This is not a plan to treat a peer as a full remote session owner or to tunnel
caller session ownership through peer `/sessions` routes. The first slice needs
its own peer execution contract, caller-side routing seam, and local runtime
read-model relay so existing session observation surfaces continue to work.

## Compatibility Guardrails

- Existing `cats`-consumed routes must keep working without client changes:
  `GET /health`, `POST /sessions`, `POST /sessions/:id/messages`,
  `GET /sessions/:id/observe`, and `GET /sessions/:id/stream`.
- Existing request bodies for `POST /sessions` and `POST /sessions/:id/messages`
  must remain accepted as-is.
- Existing response shapes and fields must remain available. Peer-related data
  is additive only.
- Legacy message requests without new routing hints stay local-only by default.
- Existing SSE and NDJSON behavior must remain intact for legacy callers.
- Any requirement that needs default automatic peer routing, renamed fields, or
  a different stream envelope is blocked on coordinated `cats` changes and must
  be deferred to a later phase.

## Goals

- Add a bounded peer identity and registry contract with explicit liveness and
  capability summaries.
- Add LAN discovery as a separable subsystem with default-off rollout control.
- Add read visibility for peers through dedicated diagnostics/read routes.
- Add an execution-only peer turn contract that preserves caller-owned session
  semantics.
- Add explicit trust/auth gating and explicit failure semantics.
- Preserve current `cats-runtime` session/message/observe/stream contracts for
  existing `cats` consumers during migration.

## Non-Goals

- Full remote session ownership.
- Remote workspace mutation.
- Remote worktree cleanup or retained cleanup ownership.
- Remote browser ownership.
- Wakeup ownership transfer.
- Transparent mid-turn retry or failover.
- Shared-filesystem assumptions or runtime-owned workspace sync.
- Silent default automatic routing for existing clients.
- Replacing the current `/sessions` lifecycle contract with a peer-owned one.

## Implementation Phases

### Phase 1: Peer Identity and Registry Contract

- [ ] Task 1.1: Add bounded peer config and type definitions for identity,
      registry entries, capability summaries, load summaries, trust state, and
      routing decisions.
- [ ] Task 1.2: Implement `PeerIdentityService`, `PeerRegistryService`, and
      `PeerCapabilitySnapshotService` as a discovery-independent core seam.
- [ ] Task 1.3: Add unit tests for identity stability, registry dedupe, stale
      peer expiry, and default-off config behavior.

**Deliverables**: new peer-core types and services exist under a dedicated
peer module; capability advertisements are bounded to routing facts only and do
not expose secrets, workspace paths, or full machine inventory.

### Phase 2: Discovery Substrate

- [ ] Task 2.1: Implement `PeerDiscoveryController` plus a discovery adapter
      seam for LAN advertisement and listener behavior.
- [ ] Task 2.2: Wire peer discovery startup and shutdown from `src/server.ts`
      separately from existing native session discovery.
- [ ] Task 2.3: Add additive LAN discovery state to `GET /discovery/status`.
- [ ] Task 2.4: Add tests for discovery startup/shutdown, duplicate
      advertisement collapse, heartbeat refresh, and TTL-based eviction.

**Deliverables**: LAN discovery can advertise and observe peers behind a
feature flag, while discovery remains separate from trust acceptance and
execution routing.

### Phase 3: Diagnostics and Read Visibility

- [ ] Task 3.1: Add peer read routes: `GET /peers`, `GET /peers/:peerId`, and
      `GET /diagnostics/peers`.
- [ ] Task 3.2: Add additive peer summaries to `GET /diagnostics/runtime` and
      `GET /diagnostics/health` without changing current readiness semantics.
- [ ] Task 3.3: Add tests for peer registry reads, filtered/detail views,
      diagnostics summaries, and redaction.

**Deliverables**: operators can inspect peer identity, health, capability, and
trust summaries through dedicated diagnostics/read routes; `GET /health`
remains unchanged in the first rollout.

### Phase 4: Bounded Execution Routing Contract

- [ ] Task 4.1: Add a dedicated peer-only execution route,
      `POST /peer/executions`, with separate request/response types for
      execution target, trace, failure, and result metadata.
- [ ] Task 4.2: Implement caller-side `PeerRoutingService` and
      `PeerExecutionClient` without delegating caller-visible session ownership
      to peer `/sessions` routes.
- [ ] Task 4.3: Extend `POST /sessions/:id/messages` with additive optional
      `routing` input while keeping existing request bodies valid and local-only
      by default.
- [ ] Task 4.4: Add runtime-owned relay/read state so peer-routed runs remain
      visible through `GET /sessions/:id/observe` and `GET /sessions/:id/stream`.
- [ ] Task 4.5: Add routing tests for explicit peer selection, opt-in routing
      heuristics, legacy local fallback, and observe/stream relay behavior.

**Deliverables**: one bounded peer turn can be routed through a dedicated
execution contract while the caller runtime remains the owner of the
caller-visible session, history, and inspection state.

### Phase 5: Trust/Auth Gate and Failure Handling

- [ ] Task 5.1: Implement `PeerTrustService` and peer-auth middleware for
      peer-only routes.
- [ ] Task 5.2: Add config-backed trust bootstrap plus explicit
      trusted/untrusted/rejected registry state.
- [ ] Task 5.3: Map pre-dispatch auth/health failures and mid-stream disconnects
      onto explicit runtime-visible failure semantics.
- [ ] Task 5.4: Add auth rejection, unhealthy peer, timeout, disconnect, and
      caller-owned state regression tests.

**Deliverables**: peer execution fails closed when trust or auth checks fail,
and disconnect behavior is explicit rather than hidden behind transparent retry
or failover.

### Phase 6: Verification and Documentation Follow-Through

- [ ] Task 6.1: Build a two-runtime integration harness for peer discovery,
      diagnostics, routing, and failure-path verification.
- [ ] Task 6.2: Run compatibility regression coverage against current `cats`
      create/send/observe/stream flows.
- [ ] Task 6.3: Update `docs/api.md`, `docs/architecture.md`,
      `docs/testing.md`, `docs/setup-guide.md`, and `.env.example` after code
      lands.

**Deliverables**: peer execution changes are covered by multi-runtime tests,
legacy `cats` compatibility is verified, and public docs match the shipped
behavior.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/peers/*` | Create | Peer identity, registry, discovery, routing, and trust services. |
| `src/core/config.ts` | Modify | Add peer discovery, registry, routing, and trust configuration. |
| `src/core/types.ts` | Modify | Add peer routing, diagnostics, and additive execution metadata types. |
| `src/core/runtime/RuntimeSessionManager.ts` | Modify | Add caller-owned relay/read seams for peer-routed run state. |
| `src/server.ts` | Modify | Wire peer discovery lifecycle separately from native session discovery. |
| `src/http/app.ts` | Modify | Register peer routes and any required auth/read middleware. |
| `src/http/auth.ts` or `src/http/peerAuth.ts` | Modify / Create | Add peer-only auth enforcement without changing current host auth behavior. |
| `src/http/streaming.ts` | Modify | Keep SSE and NDJSON transport handling distinct for peer execution support. |
| `src/http/routes/discovery.ts` | Modify | Additive LAN discovery status surface. |
| `src/http/routes/diagnostics.ts` | Modify | Add peer diagnostics summaries and dedicated peer diagnostics route. |
| `src/http/routes/messages.ts` | Modify | Add additive optional routing input and caller-side peer dispatch path. |
| `src/http/routes/observe.ts` | Modify | Keep observe/stream visibility working for peer-routed turns. |
| `src/http/routes/peers.ts` | Create | Peer registry read routes. |
| `src/http/routes/peerExecutions.ts` | Create | Dedicated execution-only peer route. |
| `src/core/peers/*.test.ts` | Create | Peer-core unit tests. |
| `src/http/peer*.test.ts` | Create | Peer route and relay tests. |
| `src/http/messagesRoute.test.ts` | Modify | Compatibility coverage for legacy and peer-routed message paths. |
| `tests/runtime-server.test.ts` | Modify | Startup and integration wiring coverage. |
| `tests/*peer*.test.ts` | Create | Multi-runtime integration coverage. |

## Technical Decisions

- Keep discovery, registry, routing, and trust as separate modules because
  discovery must not imply execution trust or session ownership.
- Use a dedicated `POST /peer/executions` route instead of peer reuse of
  `/sessions` ownership routes because ADR-019 keeps the caller runtime as the
  owner of the caller-visible session.
- Keep `POST /sessions` unchanged in v0; peer-routing hints are additive on
  `POST /sessions/:id/messages` only, and legacy requests remain local-only by
  default.
- Preserve SSE and NDJSON as separate transport contracts and test them
  separately; do not assume a merged wire format.
- Add runtime-owned relay/read state for peer-routed runs so existing observe
  and stream routes remain viable before any `cats` follow-up lands.
- Defer remote workspace mutation, remote browser ownership, wakeup ownership
  transfer, full remote session ownership, and transparent failover to later
  coordinated work.

## Streaming Contract Planning

- Do not assume a merged wire format such as "NDJSON over SSE."
- `POST /sessions/:id/messages` must keep its current transport negotiation:
  `text/event-stream` or `application/x-ndjson`.
- `POST /peer/executions` should support the same two response formats.
- Keep SSE encoding/decoding and NDJSON encoding/decoding as separate code
  paths with separate tests.
- The caller runtime may request the same transport from the peer that the host
  requested, but the implementation must still preserve the two-format model.
- `GET /sessions/:id/stream` remains SSE-only, but it cannot stay coupled only
  to backend worker events if peer-routed turns are supported. A runtime-owned
  relay/read seam is needed so observation still works for local and peer turns.
- Peer-routing metadata for streams must be additive only, preferably under
  event metadata rather than by replacing the existing event union.

## Trust/Auth Planning

Trust/auth is a distinct workstream, not part of discovery.

- Discovery may find a peer that is not trusted.
- Registry views must expose trust state separately from liveness.
- Peer execution must fail closed when trust/auth checks are not satisfied.
- The first bootstrap should be config-backed and operator-explicit.
- Dynamic peer enrollment UX is later work unless separately approved.

## Open Questions and Decision Gates

Must be decided before implementation starts:

- Which discovery library is acceptable for Windows/macOS/Linux parity and WSL
  coexistence?
- What is the first trust bootstrap: shared bearer secret, per-peer token, or
  another config-backed mechanism?
- Should v0 allow only explicit peer selection for routing, or also opt-in
  heuristic routing? Recommendation: explicit peer selection first; heuristic
  routing only if separately enabled.
- Confirm the dedicated peer execution contract path. Recommendation:
  `POST /peer/executions`, not peer reuse of `/sessions` ownership routes.

Can converge during the implementation phases:

- Exact bounded capability fields to advertise.
- Exact additive diagnostics shape for peer summaries.
- Exact load heuristic for "least busy."
- Whether caller-to-peer transport mirrors upstream transport exactly on every
  request or normalizes internally while still preserving SSE/NDJSON as distinct
  formats.

Blocked until coordinated `cats` follow-up or separate design work:

- Default automatic peer routing for legacy clients.
- Session-level peer routing defaults on `POST /sessions`.
- Any contract that changes existing stream envelopes or removes old fields.
- Remote workspace mutation or sync semantics.
- Remote browser ownership.
- Wakeup ownership transfer.
- Full remote session ownership.
- Transparent failover.

## Scope Boundaries

Hard scope boundaries for v0:

- No full remote session ownership.
- No remote workspace mutation.
- No remote browser ownership.
- No wakeup ownership transfer.
- No remote retained cleanup ownership.
- No transparent failover.
- No hidden session creation/resume/close delegation through peer `/sessions`
  routes.

## Testing Strategy

- **Registry Tests**: identity stability, registry dedupe, TTL expiry, stale
  peer removal, and trust-state persistence rules.
- **Routing Tests**: legacy local behavior when `routing` is absent, explicit
  peer selection, routing refusal on capability mismatch, and opt-in heuristic
  routing.
- **Stream Relay Tests**: peer NDJSON, peer SSE, caller observe stream during a
  peer-routed turn, and additive metadata compatibility.
- **Disconnect/Auth Failure Tests**: auth rejection, unhealthy peer rejection,
  timeout/disconnect mid-turn, and no transparent retry/failover.
- **Diagnostics Route Tests**: `GET /peers`, `GET /peers/:peerId`,
  `GET /diagnostics/peers`, and additive peer summaries on runtime/health
  diagnostics.
- **Compatibility Smoke Tests**: current `cats` create/send/observe/stream
  flows still succeed, and the current NDJSON parser still sees the same
  `text`, `result`, and `error` semantics.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Automatic routing leaks into legacy paths and changes current `cats` behavior. | High | Keep peer routing opt-in and additive on `POST /sessions/:id/messages`; require explicit config gates for heuristics. |
| Peer-routed runs break `GET /sessions/:id/observe` or `GET /sessions/:id/stream`. | High | Add runtime-owned relay/read state and cover both observe and SSE read paths with regression tests. |
| Discovery is mistakenly treated as trust. | High | Keep trust/auth as a separate phase, expose trust state explicitly, and fail closed on peer execution. |
| Capability advertisements leak too much host detail or create unstable routing. | Medium | Bound advertisements to routing facts only and add redaction tests for diagnostics surfaces. |
| Scope expands into workspace sync, browser ownership, or wakeup ownership transfer. | High | Keep these items explicitly blocked in this plan and require separate coordinated follow-up work before implementation. |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-25 | Plan created for SPEC-016 / ADR-019 with compatibility-first execution-only scope. |
| 2026-03-25 | Reworked plan structure to align more closely with `docs/plans/000-template.md` and kept deferred follow-on reminders explicit. |

---

*Created: 2026-03-25*
*Author: Codex*
