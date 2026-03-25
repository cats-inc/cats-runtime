# PLAN-017: LAN Peer Discovery and Execution Routing v0

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Assigned To** | runtime workstream |
| **Reviewer** | User / runtime workstream |

## Related Spec / Decision

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

## Phased Rollout

### Phase 1: Peer Identity and Registry Contract

Focus: establish bounded peer types and registry behavior before any network
transport or routing.

Deliverables:

- Types:
  - `PeerIdentity`
  - `PeerRegistryEntry`
  - `PeerCapabilitySummary`
  - `PeerLoadSummary`
  - `PeerTrustState`
  - `PeerRoutingMode`
  - `PeerDispatchDecision`
- Services:
  - `PeerIdentityService`
  - `PeerRegistryService`
  - `PeerCapabilitySnapshotService`
- Config surface:
  - feature flag defaulting to off
  - advertise/listen address metadata
  - registry TTL / heartbeat timing
  - peer-execution enablement separate from discovery enablement
- Tests:
  - identity stability
  - registry upsert/dedupe
  - expiry and stale-peer eviction
  - default-off config behavior

Implementation notes:

- Capability advertisements must stay bounded to routing facts only: provider
  reachability, supported stream formats, read-only/chat-only support, simple
  load summary, and trust requirement summary.
- Do not include secrets, full machine inventory, or workspace paths.

### Phase 2: Discovery Substrate

Focus: add LAN discovery and advertisement without coupling it to execution or
trust acceptance.

Deliverables:

- Services:
  - `PeerDiscoveryController`
  - discovery adapter abstraction under a new peer/discovery layer
  - heartbeat refresh into `PeerRegistryService`
- Startup wiring:
  - start/stop peer discovery from `src/server.ts`
  - keep it separate from existing native session discovery
- Routes:
  - additive `lan` block on `GET /discovery/status` for discovery process state
- Tests:
  - discovery startup/shutdown
  - duplicate advertisement collapse
  - heartbeat refresh
  - TTL expiry after missed heartbeats

Implementation notes:

- Discovery must not imply trust.
- Discovery library choice is a decision gate; keep the implementation behind an
  adapter seam so the library can change without rewriting registry or routing.

### Phase 3: Diagnostics and Read Visibility

Focus: expose peer state for operators and hosts before peer execution is used.

Deliverables:

- Routes:
  - `GET /peers`
  - `GET /peers/:peerId`
  - `GET /diagnostics/peers`
  - additive `peers` summary on `GET /diagnostics/runtime`
  - additive `peers` summary on `GET /diagnostics/health`
- Types:
  - `PeerDiagnosticsView`
  - `PeerRegistrySummary`
  - `PeerHealthView`
- Tests:
  - registry read route tests
  - diagnostics route tests
  - filtered/detail view tests
  - secret-redaction tests

Implementation notes:

- Keep `GET /health` unchanged in the first rollout.
- `GET /diagnostics/health` may include only additive peer summary metadata; it
  must not change the existing readiness contract used by packaged hosts.

### Phase 4: Bounded Execution Routing Contract

Focus: add the peer turn contract and caller-side routing seam without changing
session ownership.

Deliverables:

- New peer-only execution route:
  - `POST /peer/executions`
- Request/response contract types:
  - `PeerExecutionRequest`
  - `PeerExecutionTarget`
  - `PeerExecutionTrace`
  - `PeerExecutionFailure`
  - `PeerExecutionResultMetadata`
- Caller-side services:
  - `PeerRoutingService`
  - `PeerExecutionClient`
  - local relay/read seam for peer-routed run events
- Existing route changes:
  - additive `routing` field accepted by `POST /sessions/:id/messages`
  - no required changes to existing message body fields
- Existing response/read changes:
  - additive stream event metadata, for example `metadata.execution`
  - additive `session.inspection.currentRun.execution`
  - additive `session.inspection.lastRun.execution`
  - additive observation visibility so `GET /sessions/:id/observe` and
    `GET /sessions/:id/stream` still work during a peer-routed turn
- Tests:
  - legacy local path remains unchanged when `routing` is absent
  - explicit peer selection
  - provider-affinity routing behind opt-in
  - least-busy routing behind opt-in
  - observe/stream relay during peer-routed runs

Implementation notes:

- Do not make the caller runtime proxy its session lifecycle through peer
  `/sessions` routes.
- The peer route is execution-only. The peer may use an internal ephemeral
  execution record, but it must not become the owner of the caller-visible
  session.
- `POST /sessions` should remain unchanged in v0. Session-level peer defaults
  are later work, not part of this rollout.
- Automatic routing must not become the default for legacy callers in this
  phase. The safe first rollout is explicit per-turn opt-in, with other routing
  heuristics guarded behind config or later product work.

### Phase 5: Trust/Auth Gate and Failure Handling

Focus: keep trust separate from discovery and harden the peer-execution path.

Deliverables:

- Services:
  - `PeerTrustService`
  - peer-auth validator/middleware for peer-only routes
- Trust model:
  - config-backed first bootstrap
  - explicit trusted/untrusted/rejected state in registry views
  - outbound credential injection for peer execution calls
- Failure contract:
  - pre-dispatch failures for untrusted, unhealthy, unreachable, or unsupported
    peers
  - mid-stream disconnect failure mapped to normalized `error` events
  - no transparent retry or failover
- Tests:
  - auth rejection
  - untrusted peer rejection
  - unhealthy peer rejection before dispatch
  - timeout/disconnect mid-turn
  - session state remains caller-owned after peer failure

Implementation notes:

- Reuse existing bearer-token patterns if possible, but keep peer auth separate
  from discovery.
- Any richer enrollment workflow, rotating credentials, or mTLS-style identity
  is later work unless separately decided.

### Phase 6: Verification and Documentation Follow-Through

Focus: finish the rollout with implementation evidence and post-code docs.

Deliverables:

- Integration harness with at least two runtime instances.
- Compatibility regression coverage for existing `cats` flows.
- Post-implementation doc updates:
  - `docs/api.md`
  - `docs/architecture.md`
  - `docs/testing.md`
  - `docs/setup-guide.md`
  - `.env.example`
- Operator notes for enabling discovery, trust bootstrap, and peer diagnostics.

Implementation notes:

- This planning task does not update those docs now.
- The implementation PR should include the matching docs after code lands.

## Recommended File Areas

Expected module areas to touch during implementation:

- `src/core/config.ts`
- `src/core/types.ts`
- `src/core/runtime/RuntimeSessionManager.ts`
- `src/server.ts`
- `src/http/app.ts`
- `src/http/auth.ts` or a dedicated peer-auth helper
- `src/http/streaming.ts`
- `src/http/routes/discovery.ts`
- `src/http/routes/diagnostics.ts`
- `src/http/routes/messages.ts`
- `src/http/routes/observe.ts`
- `src/core/peers/*` (new)
- `src/http/routes/peers.ts` (new)
- `src/http/routes/peerExecutions.ts` (new)

Expected test areas to touch during implementation:

- `src/core/peers/*.test.ts` (new)
- `src/http/peer*.test.ts` (new)
- `src/http/messagesRoute.test.ts`
- `tests/runtime-server.test.ts`
- new multi-runtime integration tests under `tests/`

Areas that should stay mostly untouched unless a small extraction is needed:

- provider-specific CLI adapters under `src/backends/cli/providers/*`
- existing session lifecycle semantics in `src/http/routes/sessions.ts`
- browser and wakeup subsystems

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

## Boundaries and Risks

Hard scope boundaries for v0:

- No full remote session ownership.
- No remote workspace mutation.
- No remote browser ownership.
- No wakeup ownership transfer.
- No remote retained cleanup ownership.
- No transparent failover.
- No hidden session creation/resume/close delegation through peer `/sessions`
  routes.

Primary risks to manage:

- Legacy behavior drift if automatic routing becomes implicit.
- Observation regressions if peer-routed runs bypass the current local worker
  event path.
- Security drift if discovery is treated as trust.
- Capability over-advertising that leaks machine details or creates unstable
  routing decisions.
- Scope creep into workspace sync, worktree cleanup, or browser ownership.

## Testing Strategy

- Registry tests:
  - peer identity stability
  - registry dedupe
  - TTL expiry
  - stale peer removal
  - trust-state persistence rules
- Routing tests:
  - legacy `POST /sessions/:id/messages` remains local when `routing` is absent
  - explicit peer selection
  - routing refusal when peer cannot satisfy provider/backend constraints
  - opt-in heuristic routing only when enabled
- Stream relay tests:
  - peer NDJSON end-to-end
  - peer SSE end-to-end
  - caller observe stream during peer-routed turn
  - additive metadata only, existing event parsing still valid
- Disconnect/auth failure tests:
  - auth reject before dispatch
  - unhealthy peer before dispatch
  - disconnect or timeout mid-turn
  - no transparent retry/failover
- Diagnostics route tests:
  - `GET /peers`
  - `GET /peers/:peerId`
  - `GET /diagnostics/peers`
  - additive peer summaries on runtime/health diagnostics
- Compatibility smoke tests:
  - current `cats` client create/send/observe/stream flows still succeed
  - `cats` NDJSON parser still sees the same `text`, `result`, and `error`
    semantics

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

## Progress Log / Checklist

- [ ] Confirm discovery library decision.
- [ ] Confirm first trust bootstrap decision.
- [ ] Add peer config, identity, capability, and registry types.
- [ ] Add `PeerRegistryService` and capability snapshot service.
- [ ] Add `PeerDiscoveryController` and default-off startup wiring.
- [ ] Add additive `lan` discovery status reporting.
- [ ] Add `GET /peers`, `GET /peers/:peerId`, and `GET /diagnostics/peers`.
- [ ] Add additive peer summaries to runtime and health diagnostics.
- [ ] Add dedicated `POST /peer/executions` execution-only contract.
- [ ] Add caller-side `PeerRoutingService` and `PeerExecutionClient`.
- [ ] Extend `POST /sessions/:id/messages` with additive optional `routing`.
- [ ] Add runtime-owned relay/read seam so observe/stream continue to work for
      peer-routed turns.
- [ ] Add additive run/stream routing metadata.
- [ ] Add trust/auth middleware and explicit failure mapping.
- [ ] Add registry, routing, stream relay, disconnect/auth failure, and
      diagnostics tests.
- [ ] Run compatibility smoke tests against current `cats` runtime client flows.
- [ ] Update API/architecture/setup/testing docs after implementation lands.

---

*Created: 2026-03-25*
*Author: Codex*
