# A2A v1 Agent Backend Alignment

Date: 2026-03-27
Topic: A2A v1 alignment with the existing agent backend seam
Source: Internal architecture research based on current `cats-runtime` agent backend contracts and A2A v1 change summary
Summary: `cats-runtime` does not need a new backend family to support A2A. The existing `agent` backend seam and `AgentAdapter` contract already map naturally to A2A concepts such as send/stream, task polling, cancellation, and card inspection. The main caution is not to freeze event/evidence assumptions around CLI-style `kind` or explicit final flags, because A2A v1 moved toward wrapper-based event discrimination and stream-close completion semantics.
Relevance: This keeps the runtime backend taxonomy clean while preserving a direct path to future A2A integrations beyond OpenClaw and Agent SDK bridges.
Action Items:
- Record an ADR that places A2A under the existing `agent` backend family
- Keep future A2A adapter work aligned to `AgentAdapter` instead of inventing a new parallel abstraction
- Ensure provider-evolution evidence work stays transport-neutral enough for A2A-style streams

## Current Runtime Shape

Today the `agent` backend already exists as a first-class backend family with a small adapter seam:

- `invoke()`
- `probe()`
- `listModels()`
- `listTools()`
- `inspect()`
- `cancel()`

Current concrete adapters are:

- `openclaw`
- `agent-sdk`

That means the runtime already has the architectural slot where A2A belongs.

## Why A2A Fits the Existing Agent Backend

The existing `AgentAdapter` contract maps cleanly onto A2A v1 concepts.

### `invoke()`

A2A send and send-streaming flows naturally map to:

- `SendMessage`
- `SendStreamingMessage`

The existing `AsyncGenerator<StreamEvent>` output shape is already the right runtime-level seam for streamed A2A task updates.

### `probe()`

A2A providers are not just completion endpoints. They have task and capability surfaces that can be actively checked.

At minimum, an A2A adapter probe can cover:

- card reachability
- auth sanity
- basic task submission/polling viability

### `cancel()`

A2A has explicit task cancellation semantics. That aligns naturally with the existing adapter-level `cancel()` method.

### `inspect()`

A2A Agent Card is richer than current gateway-specific inspection payloads, but conceptually it still belongs in adapter inspection:

- identity
- supported interfaces
- protocol versions
- auth expectations
- multi-tenant behavior
- streaming/polling support

### `listModels()` and `listTools()`

These are not guaranteed to be first-class A2A concepts in the same shape as CLI or gateway adapters, but they still fit better as adapter-owned inspection/discovery concerns than as reasons to create a new backend family.

## Why A2A Should Not Become a New Backend Family

Creating a separate backend kind for A2A would likely duplicate semantics that the current `agent` backend already owns:

- remote agent execution
- provider-managed continuity
- task lifecycle beyond simple completions
- event streaming
- adapter-owned capability discovery

That would create taxonomy noise without adding useful architectural clarity.

The right mental model is:

- `cli` = local subprocess family
- `api` = completion-oriented HTTP/API family
- `agent` = remote agent/runtime family
  - `openclaw`
  - `agent-sdk`
  - `a2a`

## What A2A v1 Changes Mean for Runtime Design

A2A v1 does matter, but mainly in how the runtime should avoid overfitting its shared assumptions.

### 1. Event discrimination may be wrapper-based

The runtime cannot assume every transport exposes a flat `kind` discriminator.

### 2. Completion may be stream-close based

The runtime cannot assume every streaming transport emits an explicit final boolean or final event marker.

### 3. Part payloads can evolve independently of legacy assumptions

If the runtime later inspects A2A part payloads directly, it must allow unified part models rather than assuming older explicit part kinds.

### 4. Card structures can evolve separately from message/task payloads

Inspection and probe logic should treat capability metadata as adapter-owned, not as a one-shape-for-all runtime contract.

## Relationship to the Provider-Evolution Evidence Framework

The provider-evolution evidence framework should be able to cover A2A-backed adapters later, but it should not force A2A into CLI-specific assumptions.

That means:

- the evidence collector must stay transport-neutral
- the adapter can own A2A-specific parsing and event discrimination
- probe/baseline logic can still classify:
  - upgrades
  - regressions
  - schema change
  - semantic drift

## Recommended Decision

The runtime should explicitly record that:

- A2A is an `agent` backend adapter
- A2A should implement the existing `AgentAdapter` contract
- future A2A work should extend current adapter inspection/probe/evidence seams rather than introducing a parallel backend abstraction

## Related

- [ADR 006: Introduce an agent backend and shared runtime contracts](../decisions/006-agent-backend-and-shared-runtime-contracts.md)
- [ADR 025: Keep provider evolution detection manual-first and evidence-driven](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [2026-03-27 Provider Evolution Evidence Framework](./2026-03-27-provider-evolution-evidence-framework.md)
