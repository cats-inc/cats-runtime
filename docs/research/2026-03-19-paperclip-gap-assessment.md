# 2026-03-19: cats-runtime vs Paperclip Gap Assessment

## Purpose

Record the current implementation status of `cats-runtime` and identify the
remaining lower-layer gaps when compared against the Paperclip adapter/runtime
model already referenced by this project.

This note is intentionally different from the earlier OpenClaw/Pi alignment
note:

- the 2026-03-17 note answered architecture-shape questions
- this 2026-03-19 note answers maturity-gap questions

## Scope and Caveat

This assessment is based on the current `cats-runtime` source tree plus the
existing Paperclip comparison material already checked into this repo.

Local workspace note:

- the `paperclip/` submodule is not initialized in this checkout
- Paperclip-side claims below therefore rely on the existing research note
  rather than a fresh source read of the current submodule HEAD

That means this document is accurate for the current local workspace and its
recorded comparison inputs, but it is not a live re-audit of the latest
upstream Paperclip main branch.

## Sources

Reviewed local sources:

- [PROGRESS.md](../../PROGRESS.md)
- [README.md](../../README.md)
- [docs/architecture.md](../architecture.md)
- [docs/decisions/006-agent-backend-and-shared-runtime-contracts.md](../decisions/006-agent-backend-and-shared-runtime-contracts.md)
- [docs/specs/SPEC-003-agent-backend.md](../specs/SPEC-003-agent-backend.md)
- [docs/research/2026-03-17-paperclip-openclaw-pi-alignment.md](./2026-03-17-paperclip-openclaw-pi-alignment.md)
- [src/core/types.ts](../../src/core/types.ts)
- [src/core/runtime/RuntimeSessionManager.ts](../../src/core/runtime/RuntimeSessionManager.ts)
- [src/core/runtime/ManagedExecutionHandle.ts](../../src/core/runtime/ManagedExecutionHandle.ts)
- [src/core/tools/LocalToolRuntime.ts](../../src/core/tools/LocalToolRuntime.ts)
- [src/backends/cli/pool/SessionRegistry.ts](../../src/backends/cli/pool/SessionRegistry.ts)
- [src/backends/api/runtime/ApiBackendManager.ts](../../src/backends/api/runtime/ApiBackendManager.ts)
- [src/backends/api/types.ts](../../src/backends/api/types.ts)
- [src/backends/api/transports/anthropic.ts](../../src/backends/api/transports/anthropic.ts)
- [src/backends/api/transports/openai.ts](../../src/backends/api/transports/openai.ts)
- [src/backends/api/transports/gemini.ts](../../src/backends/api/transports/gemini.ts)
- [src/backends/api/transports/ollama.ts](../../src/backends/api/transports/ollama.ts)
- [src/backends/agent/types.ts](../../src/backends/agent/types.ts)
- [src/backends/agent/runtime/AgentBackendManager.ts](../../src/backends/agent/runtime/AgentBackendManager.ts)
- [src/backends/agent/adapters/openclaw/OpenClawAdapter.ts](../../src/backends/agent/adapters/openclaw/OpenClawAdapter.ts)
- [src/backends/agent/adapters/agent-sdk/AgentSdkBridgeAdapter.ts](../../src/backends/agent/adapters/agent-sdk/AgentSdkBridgeAdapter.ts)
- [src/backends/cli/providers/pi.ts](../../src/backends/cli/providers/pi.ts)
- [src/backends/cli/pi/parser.ts](../../src/backends/cli/pi/parser.ts)
- [src/backends/cli/discovery/PiSessionScanner.ts](../../src/backends/cli/discovery/PiSessionScanner.ts)
- [src/http/routes/health.ts](../../src/http/routes/health.ts)
- [src/http/routes/providers.ts](../../src/http/routes/providers.ts)
- [src/http/routes/sessions.ts](../../src/http/routes/sessions.ts)

## Executive Summary

`cats-runtime` has already closed several gaps that were still open in the
2026-03-17 architecture discussion:

- it now has a real backend-neutral runtime seam
- it now has a first-class `agent` backend
- it now ships OpenClaw and Agent SDK bridge adapters
- it now has a concrete Pi provider plus Pi discovery/parsing support
- it now has shared session affinity, invocation context, and artifact/output
  contracts

The remaining lag versus the broader Paperclip adapter/runtime model is mostly
in control-plane completeness, lifecycle rigor, and integration depth rather
than in raw provider count.

## Areas Where cats-runtime Is Already Strong

Before listing gaps, it is useful to record where `cats-runtime` is already not
behind, or is ahead for its current scope.

### 1. Broad Multi-Backend Provider Coverage

`cats-runtime` already spans three concrete runtime families plus the distinct
`local` routing kind:

- subprocess-backed CLI providers
- API-backed providers
- local HTTP model providers
- external agent runtimes

For the current product boundary, this is broader than a narrow
adapter-registry-only comparison.

### 2. Discovery Infrastructure Is Stronger

`cats-runtime` has real discovery and attachment machinery for local sessions:

- file-backed discovery
- file watching
- native discovery helpers
- WSL/Docker-aware discovery policies

That is meaningful runtime infrastructure, not just convenience code.

### 3. Shared Runtime Contract Is Already Coherent

The runtime now has one normalized session and stream contract across backend
families:

- `ExecutionHandle`
- `StreamEvent`
- shared session lifecycle routes
- shared session affinity and invocation metadata

This is one of the main areas where the earlier architectural gap has already
been closed.

### 4. Local Tool Runtime Already Exists

The current local tool layer is still small, but it is real and centrally
enforced. It already includes:

- workspace boundary enforcement
- workspace mode and permission mode checks
- normalized tool-call and tool-result events

That is an important foundation rather than a missing subsystem.

## What Is No Longer a Gap

These items should not be treated as missing anymore:

### 1. Backend-Neutral Execution Boundary

`cats-runtime` no longer routes everything through CLI-only assumptions.
`RuntimeSessionManager` now dispatches to `cli`, `api/local`, or `agent`
execution paths.

### 2. Shared Session and Invocation Contract

The runtime now has shared support for:

- `sessionKey`
- `reusePolicy`
- `instructions`
- structured `context`
- `outputDir`
- `artifacts`

This is broader and cleaner than the earlier "just replay transcript" shape.

### 3. Agent Backend Existence

The `agent` backend is no longer speculative. It is implemented and validated
by two adapters:

- OpenClaw Gateway
- Agent SDK bridge

### 4. Pi CLI Presence

Pi is no longer only a design recommendation. The repo already contains:

- a `pi` CLI provider
- model-format validation
- Pi stream parsing
- Pi session discovery scanning

### 5. API Provider Continuation and Caching Optimizations

The API backend is beyond a naive MVP. It already includes:

- Anthropic prompt-cache breakpoints
- OpenAI `previous_response_id`
- Gemini cached-content reuse

## Confirmed Remaining Gaps

### Gap 1: Provider Health, Readiness, and Model Discovery Are Still Thin

This is the clearest lower-layer gap.

What exists:

- `GET /health` confirms service liveness only
- `AgentAdapter` supports optional `probe()` and `listModels()`
- `ApiTransportClient` supports optional `probe()`
- Kiro has a dedicated model-list route

What is still missing:

- a generic runtime-level provider probe surface
- per-instance readiness in the dashboard/provider metadata
- API transport probes for Anthropic/OpenAI/Gemini/Ollama
- generic model-list surfacing for providers that support it
- OpenClaw model listing
- Ollama model catalog and health surfacing

Impact:

- operators can tell that `cats-runtime` is up, but not whether a specific
  provider target is healthy and ready
- adapter capabilities exist in type definitions but are not yet promoted into
  the control plane

### Gap 2: Agent Lifecycle Control Is Weaker Than the Adapter Contract Suggests

The agent contract includes optional `cancel()`, but the current runtime
management flow does not fully honor adapter-managed remote cleanup.

Observed shape:

- `ManagedExecutionHandle.kill()` aborts the local turn stream and closes the
  local handle
- `AgentBackendManager.kill()` delegates to the handle only
- session close/delete flows do not route agent-specific remote cleanup through
  `AgentAdapter.cancel()`

Impact:

- a remote agent run may continue after the local runtime handle is closed
- delete/close semantics are stronger for native CLI state than for remote
  agent state

This is a real maturity gap versus a broader adapter runtime such as
Paperclip's model.

### Gap 3: cats-runtime Still Has a Narrower Adapter Abstraction Than Paperclip

Paperclip's recorded adapter contract is intentionally broad:

- `execute(ctx)`
- `testEnvironment(ctx)`
- optional `sessionCodec`
- optional `listModels()`

`cats-runtime` remains deliberately stricter and split by backend family:

- `WorkerPool` for subprocess-backed CLI sessions
- `ApiBackendManager` for completion-style API/local sessions
- `AgentBackendManager` for external agent runtimes

This is a good architecture choice for clarity, but it still means
`cats-runtime` lags Paperclip in adapter-platform breadth.

Practical consequences:

- environment validation is inconsistent across backends
- session serialization/codec behavior is not a first-class cross-backend
  concept
- third-party adapter plug-in guidance remains thin

### Gap 4: Pi Integration Is Real but Still Shallow Compared to the Recorded Paperclip Shape

Pi support exists, but it is not yet a deep integration.

What exists:

- `provider/model` parsing
- `--provider` / `--model` spawn translation
- `--session` resume argument
- Pi JSONL stream parsing
- Pi session discovery

What is still missing relative to the recorded Paperclip comparison:

- `pi --list-models` support
- explicit session-file ownership and session-path metadata
- unknown-session fallback to fresh session creation
- optional instructions-file layering
- explicit runtime-managed skill installation model

Not all of these should necessarily be ported, but they are still genuine depth
gaps.

### Gap 5: Agent Observability Is Generic, Not Yet Agent-Native

`cats-runtime` can already persist and surface generic `artifacts`, `summary`,
and runtime `services`, but the UI and session views do not yet expose richer
agent-native state very well.

Still missing:

- stronger dashboard surfacing for runtime services or preview URLs
- clearer session views for agent-managed state
- a more expressive typed event taxonomy than the current
  `StreamEvent + raw payload` fallback

This is called out in the current work-package follow-ups.

### Gap 6: Shared Local Tool Runtime Is Broader Now, But Still Not Fully Mature

The shared tool loop is no longer just the first five-tool slice. It now covers:

- `list_files`
- `read_file`
- `write_file`
- `edit_file`
- `apply_patch`
- `grep`
- `glob`
- `run_shell`
- opt-in extended `delete_file` / `rename_file` / `copy_file`

What is still absent or still thin:

- stronger alias-safe path handling for mutations beyond the current
  workspace-relative guards
- more atomic multi-file mutation and rollback semantics
- broader tool families for search/navigation/materialization
- more mature safety and capability partitioning beyond the current profile and
  permission checks

This matters because API/local backends depend on runtime-hosted tools for
parity with richer agent environments.

### Gap 7: Explicit Logical Session Reuse Is Still Asymmetric

The shared `sessionKey` model is in place, but explicit reuse remains stronger
for `api/local/agent` than for `cli`.

Current behavior:

- `api`, `local`, and `agent` can reuse by `sessionKey`
- CLI sessions still rely on explicit resume flows rather than the same reuse
  semantics

Impact:

- the shared continuity contract is not yet equally strong across all backend
  families

## Broader Platform Deltas If the Target Expands Beyond Today's Runtime Scope

The following gaps come from Claude's comparison and are useful, but they
should be interpreted carefully.

They are real deltas versus a broader Paperclip-style autonomous company
platform. They are not automatically defects in today's `cats-runtime`
execution boundary.

### 1. Persistent Structured Storage

Paperclip's recorded design uses a structured database-backed persistence
layer. `cats-runtime` currently relies on file-backed history and session
metadata rather than a relational state model.

If product direction expands toward autonomous multi-run workflows, this
becomes a major enabling gap because it underpins:

- scheduler state
- durable task ownership
- auditability
- budget aggregation
- richer coordination

### 2. Heartbeat / Scheduler and Event-Driven Wakeup

Paperclip includes a stronger notion of autonomous wakeup and scheduled work.
`cats-runtime` is still fundamentally request/response:

- external caller creates or resumes a session
- external caller sends the next turn

There is no built-in runtime heartbeat, timer-based wakeup, or mention-driven
agent nudge model.

For today's runtime boundary this is intentional. For an autonomous agent
platform it would be a real capability gap.

### 3. Durable Agent Task-State Continuity

`cats-runtime` has session state and provider state, but not a first-class
task-level continuity model such as:

- durable work items
- atomic checkout/lease semantics
- cross-wakeup task memory

That matters only if the target becomes persistent autonomous agent work rather
than interactive runtime sessions.

### 4. Cost Tracking and Budget Enforcement

`cats-runtime` records token usage at the session layer, but it does not yet
implement:

- spend aggregation
- hard or soft budget limits
- atomic budget enforcement

This is not critical for the current session runtime, but it becomes critical
once agents can run autonomously or at scale.

### 5. Structured Audit and Governance

Paperclip's platform model appears to go further on:

- audit log depth
- approvals/governance primitives
- versioned operational changes

`cats-runtime` does not currently provide a structured audit/governance
substrate of that kind.

Again, this is mostly a platform-level rather than a runtime-core gap.

### 6. Workspace Runtime Service Provisioning

`cats-runtime` has workspace modes and isolated workspaces, but it does not yet
have a first-class concept of provisioning per-workspace runtime services such
as:

- temporary databases
- project-local support services
- execution-scoped helper infrastructure

This is a plausible future runtime capability, but it is not yet part of the
current foundation.

### 7. Skill / Context Injection Beyond Fixed Tools

`cats-runtime` currently exposes a small fixed local tool set and passes
session-level instructions/context, but it does not yet have a general
runtime-managed skill injection system comparable to the richer Paperclip-style
model discussed in the comparison notes.

This matters if the runtime is expected to teach or attach domain-specific
capabilities dynamically.

### 8. Multi-Tenant Company Scope

Paperclip's platform model appears to center tenant/company scoping much more
deeply than `cats-runtime`.

`cats-runtime` currently lacks a first-class tenant/company root for:

- budget isolation
- audit isolation
- policy isolation
- data partitioning

This is clearly outside the current project scope, but it is still a real
platform delta.

## Deliberately Out of Scope for Today's Runtime, But Relevant If Direction Changes

The following Paperclip-adjacent concerns should not be treated as missing
runtime support unless project direction changes:

- company/workflow semantics
- scheduler ownership
- run-store database design
- budget approval orchestration
- heartbeat as a runtime primitive

The earlier research note was explicit that these should not be imported
wholesale into `cats-runtime`.

## Priority Order

There are really two different priority orders depending on what "catch up with
Paperclip" means.

### Priority Order for Today's cats-runtime Scope

If the goal is to close the highest-value lower-layer gaps first, the most
defensible order is:

1. Provider health/probe/model discovery control plane
2. Agent cancel/close/delete semantics with real remote cleanup
3. Pi session-depth improvements and generic adapter-environment validation
4. Richer agent observability and model/service surfacing
5. Shared local tool runtime expansion

### Priority Order If the Goal Shifts Toward an Autonomous Agent Platform

If the real target is not just a session runtime, but something closer to a
Paperclip-style autonomous platform, the first three enabling gaps become:

1. Persistent structured storage
2. Heartbeat/scheduler plus durable agent-state continuity
3. Cost tracking and budget enforcement

Only after those land does it make sense to layer on:

- audit/governance
- event-driven wakeup
- richer skill/context injection
- tenant/company isolation

## Bottom Line

The main gap versus Paperclip is no longer architectural shape. That part is
largely in place.

For the current `cats-runtime` scope, the remaining gap is operational
maturity:

- readiness and probing
- remote lifecycle cleanup
- adapter breadth
- Pi depth
- richer observability
- broader runtime-hosted tool support

If the target expands into an autonomous company runtime, then the deeper
platform deltas also matter:

- structured storage
- scheduling and wakeup
- durable task continuity
- budgets and governance
- tenant-aware isolation

That distinction is the important boundary to preserve when comparing the two
projects.

---

*Created: 2026-03-19*
*Author: Codex*
