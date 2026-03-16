# SPEC-003: Agent Backend for External Agent Runtimes

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Owner** | Codex |
| **Reviewer** | User-approved via planning request |

## Summary

`cats-runtime` already supports two execution families:

- `cli`: subprocess-backed coding tools and native session discovery
- `api` / `local`: API-key and local-model chat backends with runtime-hosted
  tools

There is still a missing category: external agent runtimes that are neither a
local subprocess nor a plain completion API. `OpenClaw Gateway` is the clearest
example. It exposes its own connect/auth/run/session lifecycle, emits
agent-native events, and may manage remote execution resources outside the
runtime.

This specification defines a new `agent` backend family for those systems.

The goal is not to import Paperclip's company model, approval workflow, or
heartbeat scheduler. The goal is to preserve only the runtime-relevant pieces:

- adapter-based execution
- provider-managed session continuity
- structured invocation context
- normalized event streaming
- environment probes and model discovery where available

## Goals

- Add a first-class backend kind for external agent runtimes such as OpenClaw
- Keep the public `cats-runtime` HTTP contract stable for session management
- Support provider-managed session continuity without forcing transcript replay
- Keep agent-specific transport logic out of `src/http`
- Make the first contract generic enough for future `Agent SDK` adapters

## Non-Goals

- Porting Paperclip's company, org chart, ticket, or budget model
- Embedding a heartbeat scheduler into `cats-runtime`
- Replacing the existing `cli` or `api` backends
- Source-importing Paperclip internals into `cats-runtime`
- Converting Pi CLI into an agent backend

## Why a New Backend Is Needed

The current `api` backend is optimized for chat/completion semantics:

- send `messages`
- optionally execute a local tool loop
- persist transcript
- resume via transcript replay and provider-native continuation optimizations

That is a bad fit for systems like OpenClaw Gateway, which instead operate more
like a remote agent runner:

- connect/authenticate with a dedicated protocol
- invoke an agent run with a structured payload
- optionally resume via a provider-managed session key
- stream agent-native lifecycle and assistant events
- return runtime metadata such as managed services or preview URLs

Treating that shape as "just another API transport" would either distort the
current `api` backend or bury a second orchestration model inside it.

## User Stories

- As a runtime operator, I want to create and resume an OpenClaw-backed session
  from the same dashboard and HTTP API used for Claude/Codex/Gemini.
- As an upstream app, I want one stable `cats-runtime` session contract even
  when the underlying execution target is an external agent runtime.
- As a future integrator, I want to plug in an `Agent SDK` runtime without
  pretending it is either a CLI subprocess or a plain completion API.
- As a runtime maintainer, I want structured invocation context available for
  agent-style backends without dragging in Paperclip's scheduler or company
  domain.

## Requirements

### Functional Requirements

1. The runtime shall support a new backend kind named `agent`.
2. The runtime shall allow `providers.yaml` to route a provider family to an
   `agent` instance the same way it currently routes to `cli`, `api`, or
   `local`.
3. The runtime shall define an `AgentAdapter` contract for external runtimes.
4. The runtime shall persist provider-managed agent session state separately
   from runtime-managed transcript state.
5. The runtime shall support normalized streaming of agent events into existing
   `StreamEvent` categories plus provider-specific raw payloads.
6. The runtime shall support runtime `create`, `message/invoke`, `resume`,
   `close`, `delete`, `history`, and `observe` flows for agent-backed sessions.
7. The runtime shall support structured invocation metadata for agent backends,
   including optional wake reason, task identifiers, workspace context, and
   provider-specific metadata.
8. The runtime shall allow adapters to expose `probe()` and `listModels()`
   behavior when the target runtime supports those capabilities.
9. The first reference adapter shall target OpenClaw Gateway.
10. The contract shall remain generic enough for a future `Agent SDK` adapter.

### Non-Functional Requirements

- **Compatibility**: Existing `cli` and `api` behavior shall remain intact.
- **Separation of concerns**: Company workflow and scheduling concerns shall
  stay outside `cats-runtime`.
- **Observability**: Agent runs shall remain visible through session history and
  streaming APIs even when provider-managed state is authoritative.
- **Extensibility**: The adapter contract shall support more than one external
  agent runtime.

## Design Overview

### Backend Positioning

The new backend taxonomy becomes:

- `cli`: local subprocess runtimes with local session ownership
- `api`: chat/completion transports where `cats-runtime` owns transcript and
  tool orchestration
- `local`: a distinct routing/config kind for local HTTP model runtimes such as
  Ollama; today it still shares the same runtime manager and turn machinery as
  `api`
- `agent`: external agent runtimes that own more of the run/session lifecycle

### Proposed Core Contract

```ts
interface AgentInvocationContext {
  source?: 'interactive' | 'timer' | 'callback' | 'assignment' | 'automation';
  reason?: string;
  taskId?: string;
  issueId?: string;
  commentId?: string;
  approvalId?: string;
  workspace?: {
    cwd?: string;
    workspaceId?: string;
    repoUrl?: string;
    repoRef?: string;
  };
  labels?: string[];
  metadata?: Record<string, unknown>;
}

interface AgentSessionState {
  providerSessionId?: string;
  sessionKey?: string;
  adapterState?: Record<string, unknown>;
}

interface AgentInvokeInput {
  sessionId: string;
  providerName: string;
  model?: string;
  message: string;
  context?: AgentInvocationContext;
  state?: AgentSessionState;
  signal: AbortSignal;
}

interface AgentAdapter {
  readonly kind: string;
  invoke(input: AgentInvokeInput): AsyncGenerator<StreamEvent>;
  probe?(): Promise<HealthStatus>;
  listModels?(): Promise<Array<{ id: string; label: string }>>;
  cancel?(sessionId: string, state?: AgentSessionState): Promise<void>;
}
```

Notes:

- This is intentionally smaller than Paperclip's adapter contract.
- No company-scoped agent object is required inside `cats-runtime`.
- No heartbeat scheduling semantics are built into the contract.
- Structured invocation context is retained because it is genuinely useful for
  external agent runtimes.

### Session Source of Truth

This backend differs from `src/backends/api`:

- For `api`, runtime-managed transcript is the source of truth and provider
  continuation state is an optimization.
- For `agent`, provider-managed session state may be the primary source of
  continuity because the remote runtime can own execution semantics that cannot
  be reconstructed by transcript replay alone.

Therefore:

- runtime transcript remains the source of truth for UI observability and
  history export
- provider-managed session state becomes the source of truth for resume when an
  adapter declares that capability

### Structured Invocation Context

Paperclip's heartbeat service is not copied over. Instead, the useful runtime
subset is preserved as structured invocation context:

- why this run is happening
- which task/comment/approval triggered it
- which workspace it should consider authoritative
- any adapter-specific metadata the caller wants to attach

This keeps the model general enough for both interactive chat usage and future
timer/callback integrations.

### First-Class Reference Targets

#### OpenClaw Gateway

- Belongs in `agent`, not `api`
- Uses WebSocket gateway transport and provider-managed session keys
- Emits agent-native stream/lifecycle events
- May expose adapter-managed runtime services and preview URLs

#### Agent SDK

- Should be the second target for the contract, not a later afterthought
- Belongs in `agent` if it exposes long-lived run/session/event semantics
- Does not belong in `api` unless it is reduced to plain completion calls

#### Pi CLI

- Explicitly remains a `cli` integration track
- Its model selection, session files, and local tool usage align with
  subprocess-backed execution rather than external agent orchestration

## Acceptance Criteria

- [ ] A new `agent` backend kind is defined in shared runtime types
- [ ] `providers.yaml` can declare `backends.agent.providers.<name>`
- [ ] `RuntimeSessionManager` can route sessions to an `AgentBackendManager`
- [ ] An `AgentAdapter` contract exists in `src/backends/agent`
- [ ] OpenClaw is implementable against that contract without special-casing the
      HTTP layer
- [ ] The contract can also host a future `Agent SDK` adapter
- [ ] Pi remains documented as a `cli` integration, not an `agent` integration

## Open Questions

- [ ] Should the public `POST /sessions/:id/messages` route accept optional
      structured invocation metadata, or should that remain an internal-only
      extension first?
- [ ] How should agent-managed runtime services or preview URLs surface in the
      dashboard session model?
- [ ] Should agent backends expose a stronger typed event taxonomy beyond the
      current `StreamEvent` union, or is `raw` sufficient for the first phase?

## Dependencies

- [ADR 005: Introduce a Backend-Neutral Runtime Facade for CLI and API Backends](../decisions/005-backend-neutral-runtime-and-api-backend.md)
- [PLAN-003: API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama](../plans/PLAN-003-api-backend.md)

## References

- [Paperclip adapter contract](../../../paperclip/packages/adapter-utils/src/types.ts)
- [Paperclip OpenClaw Gateway adapter](../../../paperclip/packages/adapters/openclaw-gateway/src/server/execute.ts)
- [Paperclip Pi local adapter](../../../paperclip/packages/adapters/pi-local/src/server/execute.ts)

---

*Created: 2026-03-17*
*Author: Codex*
*Related Plan: [PLAN-004](../plans/PLAN-004-agent-backend.md)*
