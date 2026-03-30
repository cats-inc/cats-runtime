# PLAN-004: Agent Backend for OpenClaw and Future Agent SDK Runtimes

> Implementation plan for adding `src/backends/agent` beside the existing
> `cli` and `api` runtime tracks, while keeping `local` as a distinct
> routing/config kind that currently shares the API/local runtime manager.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | Gemini |

## Related Spec

[SPEC-003: Agent Backend for External Agent Runtimes](../specs/SPEC-003-agent-backend.md)

## Overview

`cats-runtime` currently separates execution into two concrete families:

- `src/backends/cli` for subprocess-backed tools
- `src/backends/api` for chat/completion and local-model transports

That split is no longer sufficient if the runtime needs to drive external agent
systems such as OpenClaw Gateway or future Agent SDK targets. Those runtimes:

- own more of the session/run lifecycle than a completion API does
- can expose provider-managed session keys or run identifiers
- may surface runtime service metadata or agent-native event streams
- are not well-modeled as local subprocesses

The implementation should add `src/backends/agent` as a sibling backend rather
than stretching `src/backends/api` to cover a second execution model.

This work should start with backend-neutral runtime contracts that benefit more
than just OpenClaw. The most useful immediate gaps are:

- session affinity that lets upstream products intentionally reuse or target a
  logical session across backends
- bootstrap context that lets callers attach instructions and structured
  metadata without inventing provider-specific prompt hacks
- output/artifact surfacing that works for reports, slide decks, documents, and
  coding artifacts alike

Those contracts are a better first step than introducing a Git-specific
workspace materializer such as `git_worktree` into the runtime core.

## Scope

### In Scope

- Add backend kind `agent`
- Introduce an `AgentAdapter` contract and `AgentBackendManager`
- First implementation target: OpenClaw Gateway
- Second design target: future Agent SDK integration
- Add structured invocation context for agent-style runs
- Persist provider-managed agent session state in the runtime registry
- Define backend-neutral session affinity, bootstrap context, and output
  surfacing contracts that agent/api/selected CLI backends can share

### Out of Scope

- Porting Paperclip's heartbeat scheduler or company model
- Reworking the current API backend into an agent orchestration layer
- Moving Pi CLI into `src/backends/agent`
- Implementing every possible external agent runtime in the first pass
- Making `git_worktree` or another Git-specific workspace materializer a
  prerequisite for agent-backend delivery

## Capability Targets

| Capability | CLI Backend | API/Local Backend | Agent Backend | First Target |
|------------|-------------|-------------------|---------------|--------------|
| Local subprocess control | Yes | No | No | Pi stays CLI |
| Transcript replay as source of truth | Optional | Yes | Optional / fallback only | Not primary for OpenClaw |
| Provider-managed session pointer | Partial | Optimization | Yes | OpenClaw |
| Structured wake/invocation context | Limited | Limited | Yes | OpenClaw, Agent SDK |
| External run lifecycle / event stream | No | Limited | Yes | OpenClaw |
| Runtime-managed local tool loop | CLI-native | Yes | Usually no | Not first requirement |
| Adapter-managed runtime services | No | No | Yes | OpenClaw follow-on |

## Recommended Architecture

### 1. Keep Pi in `src/backends/cli`

Pi is a local subprocess-backed runtime with:

- a concrete command (`pi`)
- local session files
- provider/model routing through CLI flags
- local tool execution inside Pi itself

That is aligned with `cli` semantics, not `agent` semantics.

### 2. Add `src/backends/agent` for External Agent Runtimes

This backend should host runtimes that are closer to "remote workers" than to
"completion endpoints". OpenClaw Gateway is the forcing function.

### 3. Preserve the Existing Public Session API

The goal is still one `cats-runtime` session contract:

- `POST /sessions`
- `POST /sessions/:id/messages`
- `POST /sessions/:id/resume`
- `DELETE /sessions/:id`

Internally, those routes should delegate to a third manager, not branch on
OpenClaw-specific details.

### 4. Keep Heartbeat Semantics Out, Keep Invocation Context In

Do not import Paperclip's scheduler/run-store model. Do preserve the useful
subset of heartbeat metadata as structured invocation context:

- why the run is happening
- which task/comment/approval it relates to
- which workspace is authoritative

### 5. Prioritize Generic Session, Context, and Output Contracts

Before deep OpenClaw-specific work, the runtime should lock in three generic
contracts:

- `sessionKey` or equivalent session-affinity semantics so upstream apps can
  intentionally reuse a logical session instead of guessing from `group` or
  workspace alone
- bootstrap context fields such as optional `instructions` and structured
  `context` metadata on session create/message flows
- output/artifact surfacing such as `outputDir` hints and session-visible
  artifact metadata for non-code workflows

These additions are useful to agent, API, and selected CLI backends and avoid
coupling the runtime to coding-only assumptions.

### 6. Make Session Affinity Explicit

The shared session-affinity contract should not be left implicit:

- `sessionKey` identifies a caller-visible logical conversation, task, or work
  item across backends
- callers may provide `sessionKey`; if omitted, the runtime may return an
  opaque generated key for later reuse
- reuse behavior should remain explicit through a request policy rather than
  being inferred from `group`, `cwd`, or the presence of a provider session id
- `providerSessionId` remains a backend-owned continuity pointer, not the
  caller-facing identity of the session

This keeps runtime continuity predictable for upstream apps while preserving the
difference between logical session identity and provider-managed resume tokens.

## Proposed Phases

### Phase 0: Record the Architecture Extension

- [x] Add `ADR-006` for `agent` backend introduction
- [x] Document the distinction between `api` and `agent`
- [x] Record that Pi remains a `cli` provider family

**Deliverables**:

- accepted ADR explaining why `agent` is a separate backend kind
- docs alignment between spec, plan, and architecture notes

### Phase 1: Core Type, Config, and Shared Session Contract Expansion

#### Phase 1a: Shared Runtime Contract Clarification

- [x] Record and document the `sessionKey` contract before adapter-specific
      implementations begin
- [x] Define whether a missing `sessionKey` returns no affinity guarantee or an
      opaque runtime-assigned key, and document the resulting client behavior
- [x] Define explicit reuse policy semantics for create/resume flows so reuse is
      never guessed from `group`, `cwd`, or provider state
- [x] Define provider-session invalidation fallback semantics: preserve logical
      session identity and runtime transcript, clear provider continuity state,
      then fresh-create when resume is no longer possible
- [x] Define a minimal backend-neutral turn/bootstrap contract that can carry
      `message`, optional `instructions`, and structured `context` metadata
- [x] Define optional output hints and surfaced artifact metadata so sessions
      can model reports/documents/media outputs without assuming a Git repo

#### Phase 1b: Backend Type and Config Expansion

- [x] Extend `ProviderBackend` from `cli | api | local` to
      `cli | api | local | agent`
- [x] Clarify in code docs and architecture docs that `local` remains a
      distinct backend kind in config/routing, but currently shares runtime
      execution machinery with `api`
- [x] Add `backends.agent.providers.<name>.instances.<id>` support in
      `providers.yaml`
- [x] Extend provider catalog and route validation to include `agent`
- [x] Generalize `SessionProviderState` so it can store agent session metadata,
      not only Gemini cache state
- [x] Define backend-neutral `AgentInvocationContext` and `AgentSessionState`

**Deliverables**:

- config parser accepts agent-backed instances
- provider catalog can render agent targets
- shared types can carry provider-managed agent state
- public and internal session contracts can express affinity, bootstrap
  context, and output expectations without backend-specific hacks

### Phase 2: `src/backends/agent` Skeleton

- [x] Create `src/backends/agent/types.ts`
- [x] Create `src/backends/agent/runtime/AgentBackendManager.ts`
- [x] Create `src/backends/agent/adapters/registry.ts`
- [x] Introduce `AgentAdapter` contract
- [x] Extend `RuntimeSessionManager` to dispatch into `AgentBackendManager`
- [x] Add agent backend status/probe aggregation to pool/status or a sibling
      runtime status surface

**Deliverables**:

- empty-but-functional agent backend seam
- route layer no longer assumes only `cli` or `api/local`

### Phase 3: OpenClaw Gateway MVP

- [x] Create `src/backends/agent/adapters/openclaw/`
- [x] Port the protocol ideas from Paperclip without importing its company
      domain
- [x] Implement WebSocket connect/challenge/auth flow
- [x] Bind OpenClaw session continuity to the shared session-affinity contract
      and provider-managed state persistence
- [x] Map gateway event frames into `StreamEvent`
- [x] Support close/cancel semantics as far as gateway capabilities allow
- [x] Add OpenClaw-specific `probe()`
- [x] Support optional OpenClaw model listing if the target exposes it

**Deliverables**:

- `openclaw` provider family or `agent/openclaw` instance target that can be
  created, messaged, resumed, and deleted from `cats-runtime`

### Phase 4: Public Invocation Context, Bootstrap, and Artifact Surfacing

- [x] Extend internal message dispatch to carry structured invocation context
- [x] Extend `POST /sessions` and `POST /sessions/:id/messages` to accept
      optional `sessionKey`, `instructions`, and `context` metadata while
      keeping the current message-only flow valid
- [x] Persist invocation metadata that matters for later resume/observability
- [x] Add session-level output hints such as `outputDir` and surface generated
      artifact metadata in history/dashboard views
- [x] Surface agent-backed session metadata in history and dashboard views
- [x] Clarify `close`, `resume`, and `delete` semantics for provider-managed
      sessions

**Deliverables**:

- agent backends are not limited to plain chat text
- UI and HTTP routes can manage agent-backed sessions intentionally
- non-code outputs are first-class runtime results without introducing a
  Git-specific workflow dependency

### Phase 5: Agent SDK Adapter

- [x] Implement a second adapter against the same contract
- [x] Validate that the contract was not accidentally OpenClaw-specific
- [x] Add adapter-specific config examples and tests
- [x] Document how a future third-party agent runtime should plug in

**Deliverables**:

- proof that `src/backends/agent` is a real category, not a one-off folder

## Follow-through Notes

- OpenClaw remote tool discovery now covers both provider-level
  `tools.catalog` and session-scoped `tools.effective` through the existing
  `GET /providers/{provider}/tools` surface via `scope=effective` plus
  `sessionId` / `sessionKey`.
- The same session-effective OpenClaw tool truth now also projects through
  live `GET /diagnostics/providers` plus MCP `provider_diagnostics`, using
  shared `sessionId` / `sessionKey` resolution instead of a diagnostics-only
  adapter seam.
- The remaining gap for this plan family is no longer basic OpenClaw adapter
  breadth; it is broader non-OpenClaw remote-tool evidence and richer later-target
  semantic probing beyond the current Agent SDK provider-registry plus bounded
  probe-session create/read/delete lifecycle validation.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/types.ts` | Modify | Add `agent` backend kind and generalized provider state |
| `src/backends/cli/pool/types.ts` | Modify | Carry session affinity, bootstrap, and artifact/output metadata in the registry model |
| `src/core/providerCatalog.ts` | Modify | Surface agent-backed instances |
| `src/core/runtime/RuntimeSessionManager.ts` | Modify | Dispatch sessions to agent backend manager |
| `src/backends/cli/config.ts` | Modify | Parse `backends.agent` config topology |
| `src/backends/agent/types.ts` | Create | Agent backend contract and shared types |
| `src/backends/agent/runtime/AgentBackendManager.ts` | Create | Session lifecycle manager for agent-backed sessions |
| `src/backends/agent/adapters/registry.ts` | Create | Adapter lookup/registration |
| `src/backends/agent/adapters/openclaw/*` | Create | OpenClaw Gateway adapter |
| `src/http/routes/sessions.ts` | Modify | Create/resume/delete behavior through agent backend plus session affinity/bootstrap/output inputs |
| `src/http/routes/messages.ts` | Modify | Support optional structured invocation context and bootstrap extensions |
| `src/http/routes/history.ts` | Modify | Surface artifact/output metadata alongside session history where appropriate |
| `src/http/routes/providers.ts` | Modify | Return agent-backed catalog entries |
| `public/index.html` | Modify | Let dashboard create/select agent-backed targets |
| `docs/api.md` | Modify | Document session affinity, bootstrap context, and artifact/output fields |
| `tests/*` | Modify/Create | Route, manager, and adapter regression coverage |
| `docs/decisions/006-agent-backend-and-shared-runtime-contracts.md` | Create | Record architecture decision |

## Technical Decisions

- `agent` is a separate backend kind, not a flavor of `api`.
- `OpenClaw` is the first adapter because it stresses the new contract the most.
- `Agent SDK` should be the second adapter so the contract does not collapse
  into an OpenClaw-specific API.
- Shared session-affinity semantics should land before OpenClaw-specific
  session-key behavior so upstream callers get one reusable continuity model.
- `sessionKey` is the caller-visible logical identity; `providerSessionId` is a
  backend-owned continuity pointer that may be cleared and reacquired.
- Provider resume failure should degrade to fresh provider session creation
  without discarding runtime-owned logical session identity.
- Bootstrap context and output contracts should stay backend-neutral and should
  not assume Git repositories or code-generation workflows.
- Provider-managed session state becomes the authoritative continuity mechanism
  for agent backends when supported.
- Runtime transcript remains necessary for UI history and observability even
  when it is not the authoritative state source.
- Pi remains a `cli` provider family and should not be reclassified just because
  it is "agent-like" at the product level.
- "Heartbeat" should not be imported as a runtime concept; instead the plan
  keeps a smaller `AgentInvocationContext` inspired by the useful subset of
  heartbeat metadata.

## Testing Strategy

- **Unit Tests**:
  - config parsing for `backends.agent`
  - provider catalog rendering for agent instances
  - agent session state persistence
  - OpenClaw event parser / session-key helpers
- **Integration Tests**:
  - mock OpenClaw Gateway server for connect/challenge/agent/agent.wait flows
  - route tests for create/message/resume/delete on agent-backed sessions
  - dashboard/provider catalog tests for agent-backed instances
- **Manual Testing**:
  - create an OpenClaw-backed session from the UI
  - send a message with and without structured invocation context
  - close and resume the same session
  - verify delete removes runtime-managed metadata but handles provider cleanup
    safely

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `agent` becomes a dumping ground for unrelated integrations | High | Keep the category definition strict: external agent runtimes with their own run/session semantics |
| Route layer becomes over-specialized for OpenClaw | High | Force a second adapter target in the plan: Agent SDK |
| Public API drifts toward Paperclip scheduler semantics | Medium | Limit new inputs to optional invocation metadata, not scheduler/run-store concepts |
| Runtime contracts drift toward coding-only Git assumptions | Medium | Keep workspace/output additions generic (`sessionKey`, `instructions`, `context`, `outputDir`, artifacts) and defer Git-specific materializers |
| Session history becomes misleading when provider-managed state is authoritative | Medium | Persist both transcript visibility data and provider-managed session metadata explicitly |
| Pi integration is delayed because attention shifts to `agent` | Medium | Keep Pi documented as its own `cli` track and plan it separately |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-17 | Plan created from direct `cats-runtime` vs `paperclip` comparison, with OpenClaw chosen as first target and Agent SDK reserved as second target |
| 2026-03-17 | Reprioritized immediate follow-on work toward shared session affinity, bootstrap context, and artifact/output contracts instead of any Git-specific workspace dependency |
| 2026-03-17 | Added ADR-006 and clarified `sessionKey` semantics, explicit reuse policy, provider-session fallback, and non-Git output assumptions |
| 2026-03-17 | Landed Phase 1-4 core implementation: shared session/bootstrap/output contract, `backends.agent` config/catalog plumbing, and OpenClaw Gateway MVP |
| 2026-03-17 | Added `agent_sdk_bridge` as the second adapter target using the external `genai-gateway-agent` boundary and shared agent contract |
| 2026-03-26 | OpenClaw `models.list` discovery, agent runtime inspection, live tool-catalog summaries, and retained provider-evolution summaries landed on runtime diagnostics/config surfaces; remaining work is now limited to third-party adapter plug-in guidance rather than missing runtime seams |
| 2026-03-27 | Agent SDK bridge adapter now derives bounded remote tool catalogs from the shared provider registry, and the same tool-discovery truth is surfaced on `/providers/{provider}/tools` plus live provider diagnostics alongside the existing bridge model/streaming checks |
| 2026-03-27 | Third-party adapter plug-in guidance is now documented in `docs/architecture.md`, so the plan scope is fully delivered: future agent runtimes can add transport-local adapters and registry wiring without reshaping routes or runtime-owned session contracts. |
| 2026-03-30 | OpenClaw tool discovery now also supports session-scoped `tools.effective`, and Agent SDK live diagnostics now validate a bounded probe-session create/read/delete lifecycle instead of stopping at provider-registry visibility alone |
| 2026-03-30 | Live `/diagnostics/providers` and MCP `provider_diagnostics` now also accept shared session context so OpenClaw session-effective `tools.effective` evidence can flow through the same diagnostics read model as provider-wide tool catalogs |
| 2026-03-30 | Agent SDK bridge live diagnostics now treat provider-registry tool metadata as part of semantic readiness, surfacing explicit `bridge_provider_tool_catalog_visible` checks plus `toolCatalogVisible` / `toolCount` / `toolGroupCount` truth before the bounded probe-session lifecycle runs |
| 2026-03-30 | Agent SDK bridge session streams now persist bounded remote tool/service activity summaries into provider-managed session state, and session/history/observe inspection now reuses that `agentSession.activity` truth instead of making hosts replay raw stream events |
| 2026-03-30 | Session-aware provider diagnostics now keep OpenClaw on `tools.effective`, but let Agent SDK bridge targets fall back to provider-wide tool catalogs plus runtime session activity evidence instead of degrading on unsupported effective-tool requests |
| 2026-03-30 | Session-aware agent diagnostics now also project bounded runtime-session work-product evidence (`config.sessionEvidence`) from the shared session inspection read model, so hosts can inspect recent services/artifacts/preview surfaces on the provider diagnostics seam without a second session fetch |
| 2026-03-30 | Provider-only agent diagnostics now also project bounded retained-session evidence (`config.latestSessionEvidence`) for the most recent exact-target runtime session, so operator flows can inspect known work products even without a caller-supplied `sessionId` |
| 2026-03-30 | Provider-only agent diagnostics now also project bounded retained-session activity (`config.latestSessionActivity`) for the most recent exact-target runtime session, so operator flows can inspect known remote tool/service activity even before pinning one session |
| 2026-03-30 | The runtime now retains target-level agent diagnostics evidence beyond session deletion through a repo-owned `AgentTargetEvidenceService`, so provider diagnostics can still surface the last known activity/work-product summary after the runtime session itself is gone |
| 2026-03-30 | Agent diagnostics activity/work-product summaries now also preserve provenance/freshness metadata (`source`, `observedAt`, `retainedAt`) on both config payloads and matching checks, so operators can judge how recent retained evidence is without a second read surface |
| 2026-03-30 | `/providers/config` now also reuses the same bounded latest-session agent evidence read model, so provider-selection surfaces can show recent exact-target work products and bridge activity without requiring a second `/diagnostics/providers` fetch |
| 2026-03-30 | Agent evidence summaries now also preserve bounded workspace locator metadata (`cwd`, optional `outputDir`, optional `workspaceMode`) across diagnostics, provider topology reads, retained-target persistence, and MCP mirrors so operators can locate the most recent work-product context without re-reading the full session |
| 2026-03-30 | Agent evidence `latestRun` summaries now also preserve bounded semantic `resultSummary` text when the runtime already has it, so operator read models can surface more than counts/locators without replaying a transcript |

---

*Created: 2026-03-17*
*Author: Codex*
