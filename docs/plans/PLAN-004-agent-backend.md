# PLAN-004: Agent Backend for OpenClaw and Future Agent SDK Runtimes

> Implementation plan for adding `src/backends/agent` beside the existing
> `cli` and `api` runtime tracks, while keeping `local` as a distinct
> routing/config kind that currently shares the API/local runtime manager.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Assigned To** | Claude |
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

## Proposed Phases

### Phase 0: Record the Architecture Extension

- [ ] Add `ADR-006` for `agent` backend introduction
- [ ] Document the distinction between `api` and `agent`
- [ ] Record that Pi remains a `cli` provider family

**Deliverables**:

- accepted ADR explaining why `agent` is a separate backend kind
- docs alignment between spec, plan, and architecture notes

### Phase 1: Core Type, Config, and Shared Session Contract Expansion

- [ ] Extend `ProviderBackend` from `cli | api | local` to
      `cli | api | local | agent`
- [ ] Clarify in code docs and architecture docs that `local` remains a
      distinct backend kind in config/routing, but currently shares runtime
      execution machinery with `api`
- [ ] Add `backends.agent.providers.<name>.instances.<id>` support in
      `providers.yaml`
- [ ] Extend provider catalog and route validation to include `agent`
- [ ] Generalize `SessionProviderState` so it can store agent session metadata,
      not only Gemini cache state
- [ ] Define a backend-neutral session affinity contract for `POST /sessions`
      and resume flows (`sessionKey` and/or explicit reuse policy)
- [ ] Define backend-neutral `AgentInvocationContext` and `AgentSessionState`
- [ ] Define a minimal backend-neutral turn/bootstrap contract that can carry
      `message`, optional `instructions`, and structured `context` metadata
- [ ] Define optional output hints and surfaced artifact metadata so sessions
      can model reports/documents/media outputs without assuming a Git repo

**Deliverables**:

- config parser accepts agent-backed instances
- provider catalog can render agent targets
- shared types can carry provider-managed agent state
- public and internal session contracts can express affinity, bootstrap
  context, and output expectations without backend-specific hacks

### Phase 2: `src/backends/agent` Skeleton

- [ ] Create `src/backends/agent/types.ts`
- [ ] Create `src/backends/agent/runtime/AgentBackendManager.ts`
- [ ] Create `src/backends/agent/adapters/registry.ts`
- [ ] Introduce `AgentAdapter` contract
- [ ] Extend `RuntimeSessionManager` to dispatch into `AgentBackendManager`
- [ ] Add agent backend status/probe aggregation to pool/status or a sibling
      runtime status surface

**Deliverables**:

- empty-but-functional agent backend seam
- route layer no longer assumes only `cli` or `api/local`

### Phase 3: OpenClaw Gateway MVP

- [ ] Create `src/backends/agent/adapters/openclaw/`
- [ ] Port the protocol ideas from Paperclip without importing its company
      domain
- [ ] Implement WebSocket connect/challenge/auth flow
- [ ] Bind OpenClaw session continuity to the shared session-affinity contract
      and provider-managed state persistence
- [ ] Map gateway event frames into `StreamEvent`
- [ ] Support close/cancel semantics as far as gateway capabilities allow
- [ ] Add OpenClaw-specific `probe()`
- [ ] Support optional OpenClaw model listing if the target exposes it

**Deliverables**:

- `openclaw` provider family or `agent/openclaw` instance target that can be
  created, messaged, resumed, and deleted from `cats-runtime`

### Phase 4: Public Invocation Context, Bootstrap, and Artifact Surfacing

- [ ] Extend internal message dispatch to carry structured invocation context
- [ ] Extend `POST /sessions` and `POST /sessions/:id/messages` to accept
      optional `sessionKey`, `instructions`, and `context` metadata while
      keeping the current message-only flow valid
- [ ] Persist invocation metadata that matters for later resume/observability
- [ ] Add session-level output hints such as `outputDir` and surface generated
      artifact metadata in history/dashboard views
- [ ] Surface agent-backed session metadata in history and dashboard views
- [ ] Clarify `close`, `resume`, and `delete` semantics for provider-managed
      sessions

**Deliverables**:

- agent backends are not limited to plain chat text
- UI and HTTP routes can manage agent-backed sessions intentionally
- non-code outputs are first-class runtime results without introducing a
  Git-specific workflow dependency

### Phase 5: Agent SDK Adapter

- [ ] Implement a second adapter against the same contract
- [ ] Validate that the contract was not accidentally OpenClaw-specific
- [ ] Add adapter-specific config examples and tests
- [ ] Document how a future third-party agent runtime should plug in

**Deliverables**:

- proof that `src/backends/agent` is a real category, not a one-off folder

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
| `docs/decisions/006-agent-backend.md` | Create | Record architecture decision |

## Technical Decisions

- `agent` is a separate backend kind, not a flavor of `api`.
- `OpenClaw` is the first adapter because it stresses the new contract the most.
- `Agent SDK` should be the second adapter so the contract does not collapse
  into an OpenClaw-specific API.
- Shared session-affinity semantics should land before OpenClaw-specific
  session-key behavior so upstream callers get one reusable continuity model.
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

---

*Created: 2026-03-17*
*Author: Codex*
