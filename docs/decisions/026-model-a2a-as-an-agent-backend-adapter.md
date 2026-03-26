# ADR-026: Model A2A as an Agent Backend Adapter

Date: 2026-03-27
Status: Proposed

## Context

ADR 006 established `agent` as a first-class backend family for remote agent runtimes that do not fit cleanly into either local CLI execution or completion-oriented API backends.

Today that family already includes two concrete adapter tracks:

- OpenClaw gateway
- Agent SDK bridge

Recent planning clarified that future inter-agent protocol support may need to include A2A-based runtimes. The question is whether A2A should:

- become a new backend family, or
- land as another adapter inside the existing `agent` backend family

At the same time, the runtime already has a compact `AgentAdapter` seam with methods for:

- invocation
- probing
- model discovery
- tool discovery
- inspection
- cancellation

## Decision

`cats-runtime` will model A2A as an `agent` backend adapter, not as a new backend family.

This decision includes:

1. Future A2A integrations belong under `src/backends/agent/adapters/`.
2. A2A should implement the existing `AgentAdapter` contract as the first-class runtime seam.
3. The runtime should not introduce a parallel A2A-specific backend abstraction before a concrete mismatch with `AgentAdapter` is proven.
4. A2A-specific protocol details such as card parsing, stream framing, polling, and cancellation remain adapter-owned concerns.
5. Shared runtime contracts and evidence collectors must avoid assumptions that only hold for CLI-style or gateway-style streams.

## Rationale

The current `agent` backend already represents the right architectural category:

- remote agent execution
- provider-managed continuity and task lifecycle
- streaming task updates
- adapter-owned inspection and discovery

A2A fits those characteristics naturally.

Using the existing adapter seam preserves:

- one backend taxonomy for remote agent systems
- reuse of current runtime manager/session logic
- direct mapping to `invoke()`, `probe()`, `inspect()`, and `cancel()`

Creating another backend family would duplicate semantics without creating a clearer runtime boundary.

## Consequences

### Positive

- keeps the backend taxonomy simple
- makes future A2A work cheaper to stage incrementally
- preserves compatibility with existing agent runtime contracts
- avoids premature abstraction growth

### Negative

- `AgentAdapter` may eventually need small additive changes if a concrete A2A integration reveals missing generic concepts
- adapter authors must handle protocol-specific complexity locally rather than expecting a dedicated A2A runtime layer

### Neutral

- this decision does not require immediate A2A implementation work
- OpenClaw and Agent SDK remain the active adapters for now

## Alternatives Considered

### 1. Create a New `a2a` Backend Family

- **Pros**: protocol name is explicit in the backend taxonomy
- **Cons**: duplicates the existing remote-agent category and fragments shared contracts
- **Why rejected**: A2A fits the semantics that `agent` already owns

### 2. Defer the Decision Until Implementation Starts

- **Pros**: avoids deciding early
- **Cons**: leaves future adapter work without a clear taxonomy and encourages one-off design drift
- **Why rejected**: the current backend structure is already clear enough to record the direction now

## Notes for Future Work

Future A2A adapters must account for protocol characteristics that differ from current gateway adapters, for example:

- wrapper-based event discrimination instead of flat `kind` fields
- stream-close completion semantics rather than explicit final flags
- richer agent card metadata and interface/version advertisement

These differences should be handled inside the adapter and shared evidence/probe seams, not by creating a new backend family.

## Related

- [ADR 005: Introduce a backend-neutral runtime facade for CLI and API backends](./005-backend-neutral-runtime-and-api-backend.md)
- [ADR 006: Introduce an agent backend and shared runtime contracts](./006-agent-backend-and-shared-runtime-contracts.md)
- [ADR 025: Keep provider evolution detection manual-first and evidence-driven](./025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [2026-03-27 A2A v1 Agent Backend Alignment](../research/2026-03-27-a2a-v1-agent-backend-alignment.md)
