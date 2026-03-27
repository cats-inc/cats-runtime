# PLAN-007: StreamEvent Discriminated Union Cleanup

> Minimal technical-debt plan for replacing the flat `StreamEvent` interface
> with a discriminated union without changing the runtime's public wire format.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (First Conservative Slice Landed) |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | Claude / user follow-up |

## Related Spec

N/A. This is a type-safety cleanup that follows shipped work in:

- [PLAN-003: API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama](./PLAN-003-api-backend.md)
- [PLAN-004: Agent Backend for OpenClaw and Future Agent SDK Runtimes](./PLAN-004-agent-backend.md)

## Overview

`cats-runtime` currently models streamed runtime output as one flat
`StreamEvent` interface with a `type` discriminator and many optional fields.
That was acceptable when the event surface was smaller, but it now carries
eight event types:

- `init`
- `text`
- `tool_use`
- `tool_result`
- `result`
- `error`
- `raw`
- `progress`

The current shape has two problems:

- consumers do not get useful type narrowing from `switch (event.type)`
- producers can accidentally construct invalid event payloads without the
  compiler catching obvious mistakes

This plan keeps the scope deliberately small. The goal is to upgrade
`StreamEvent` into a discriminated union, tighten the highest-value producer
and consumer call sites, and preserve the current HTTP/SSE/NDJSON payload shape.

## Scope

### In Scope

- replace the flat `StreamEvent` interface in `src/core/types.ts` with a
  discriminated union
- add small shared event subtypes such as `InitStreamEvent`,
  `TextStreamEvent`, and `ProgressStreamEvent`
- require fields only where current producers already behave consistently
- migrate high-fan-out producers and consumers so the repo typechecks cleanly
- add tests that exercise narrowing-sensitive paths

### Out of Scope

- changing streamed JSON wire format or event names
- redesigning `raw` payload semantics
- changing history JSONL semantics
- introducing new event categories beyond the current eight
- broad metadata normalization work outside the existing `progress` contract

## Proposed Type Shape

The first pass should be conservative. It should only make fields required when
all current producers already supply them, or when the runtime contract already
depends on them.

```ts
interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
}

interface BaseStreamEvent {
  sessionId?: string;
  providerSessionId?: string;
  raw?: unknown;
}

interface InitStreamEvent extends BaseStreamEvent {
  type: 'init';
}

interface TextStreamEvent extends BaseStreamEvent {
  type: 'text';
  text: string;
}

interface ToolUseStreamEvent extends BaseStreamEvent {
  type: 'tool_use';
  toolName: string;
  toolId?: string;
  toolArgs?: Record<string, unknown>;
  text?: string;
}

interface ToolResultStreamEvent extends BaseStreamEvent {
  type: 'tool_result';
  toolName?: string;
  toolId?: string;
  text?: string;
  isError?: boolean;
}

interface ResultStreamEvent extends BaseStreamEvent {
  type: 'result';
  usage?: StreamUsage;
  summary?: string;
  artifacts?: SessionArtifact[];
  services?: AgentRuntimeService[];
  providerState?: SessionProviderState;
  metadata?: Record<string, unknown>;
}

interface ErrorStreamEvent extends BaseStreamEvent {
  type: 'error';
  text: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

interface RawStreamEvent extends BaseStreamEvent {
  type: 'raw';
  text?: string;
  metadata?: Record<string, unknown>;
}

interface ProgressStreamEvent extends BaseStreamEvent {
  type: 'progress';
  text: string;
  metadata: Record<string, unknown>;
}

type StreamEvent =
  | InitStreamEvent
  | TextStreamEvent
  | ToolUseStreamEvent
  | ToolResultStreamEvent
  | ResultStreamEvent
  | ErrorStreamEvent
  | RawStreamEvent
  | ProgressStreamEvent;
```

Design notes:

- `progress.metadata` should be required in the first pass because the shipped
  normalized progress contract already depends on it.
- `tool_result` stays intentionally loose in the first pass because producers
  do not yet expose one strict payload shape.
- `raw` remains backend-neutral and additive; this plan does not attempt to
  standardize provider-native payloads.

## Implementation Phases

### Phase 1: Introduce the Union in Core

- [x] Replace the current flat `StreamEvent` interface in `src/core/types.ts`
      with per-event interfaces and a `StreamEvent` union
- [x] Extract small shared aliases such as `StreamUsage`
- [x] Keep exported names stable so imports outside `src/core/types.ts` do not
      need mass renaming
- [ ] Add a tiny internal helper such as `assertNever()` only if a core
      consumer needs exhaustive switching immediately

**Deliverables**: a compile-visible discriminated union with no wire-format
change.

### Phase 2: Migrate High-Fan-Out Producers

- [x] Update `src/core/runtime/ManagedExecutionHandle.ts` to emit exact error
      events
- [ ] Update `src/backends/api/runtime/ApiBackendManager.ts` to emit exact
      `init`, `text`, `tool_use`, `tool_result`, `result`, and `progress`
      events
- [ ] Update agent adapters and managers under `src/backends/agent/*` where
      they build event objects directly
- [ ] Update CLI parsers/providers that construct event literals so the new
      union compiles without broad `as` casts

**Deliverables**: main event producers emit union members rather than relying
on a bag-of-optionals shape.

### Phase 3: Harden Core Consumers

- [ ] Update `src/http/routes/messages.ts` so event handling benefits from
      narrowing in the main streaming path
- [ ] Update `src/backends/cli/pool/WorkerProcess.ts` and
      `src/backends/cli/providers/junie.ts` where event-type branching is
      already dense enough to benefit from the union
- [ ] Keep `src/http/streaming.ts` unchanged unless type fallout requires a
      helper wrapper
- [ ] Avoid mechanical repo-wide switch rewrites; only touch consumers that
      currently branch on `event.type` or persist event payload fields

**Deliverables**: the highest-risk event consumers compile cleanly and gain
useful narrowing.

### Phase 4: Verification and Cleanup

- [ ] Add or update tests for event construction and event-consumer branches
- [ ] Run `npm run build`
- [ ] Run targeted Vitest suites covering HTTP message streaming, worker
      process behavior, and parser/provider event translation
- [ ] Document any event variants that remain intentionally loose after the
      first pass

**Deliverables**: type-safe event modeling with regression coverage and a
documented residual debt list.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/types.ts` | Modify | Replace flat `StreamEvent` interface with union members |
| `src/core/runtime/ManagedExecutionHandle.ts` | Modify | Emit exact typed error events |
| `src/backends/api/runtime/ApiBackendManager.ts` | Modify | Emit exact API/local event variants |
| `src/backends/agent/*` | Modify | Align agent runtime/adapters with the union |
| `src/backends/cli/providers/*` | Modify | Update parser/provider event literals that no longer satisfy the union |
| `src/backends/cli/pool/WorkerProcess.ts` | Modify | Tighten high-fan-out consumer branches |
| `src/http/routes/messages.ts` | Modify | Use narrowing-friendly event handling |
| `tests/*` / `src/**/*.test.ts` | Modify | Regression coverage for producer/consumer paths touched by the refactor |

## Technical Decisions

- The migration should be staged, not a single giant refactor.
- The first pass should prefer conservative required fields over an overly
  strict union that forces broad semantic changes.
- Public event names and streamed JSON structure should remain unchanged.
- `progress` should be the first event variant with a stricter payload contract
  because its metadata is already provider-agnostic and runtime-owned.
- Exhaustive switching is valuable in core/high-fan-out consumers, but it is
  not required in every producer/parser on day one.

## Testing Strategy

- **Unit Tests**:
  - event constructors/helpers if any are introduced
  - parser/provider translations that now rely on exact event variants
  - `messages` route branches that read `toolName`, `text`, `usage`, or
    `metadata`
- **Integration Tests**:
  - HTTP message streaming for CLI, API/local, and agent-backed sessions
  - worker-process aggregation and terminal event handling
  - API/local progress-event streaming
- **Manual Testing**:
  - send a normal CLI-backed turn and inspect SSE/NDJSON payloads
  - send an API/local turn with a `progress` event and verify payload shape is
    unchanged
  - resume a session with tool activity and confirm history persistence remains
    stable

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| The union is made too strict too early and forces semantic churn across parsers | High | Only require fields that current producers already provide consistently |
| High fan-out compile fallout slows delivery | Medium | Migrate core producers and core consumers first, then clean up leaf providers/parsers |
| Developers reintroduce `as StreamEvent` casts to bypass the new model | Medium | Treat broad casts as a regression and prefer exact event literals |
| `tool_result` remains under-specified after the first pass | Medium | Keep it intentionally conservative in Phase 1 and track stricter follow-up separately |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-21 | Plan created after post-commit review flagged `StreamEvent` narrowing debt |
| 2026-03-27 | First conservative slice landed: `src/core/types.ts` now exports discriminated `StreamEvent` members while keeping the wire shape stable; runtime build and full test suite stayed green after compile fallout was resolved without broad `as` casts. |

---

*Created: 2026-03-21*
*Author: Codex*
