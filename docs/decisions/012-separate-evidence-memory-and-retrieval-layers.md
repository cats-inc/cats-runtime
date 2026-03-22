# ADR 012: Separate Evidence, Durable Memory, and Retrieval Layers

## Status

Accepted

## Date

2026-03-19

## Context

`cats-runtime` already spans multiple execution families:

- `cli` backends with local session files
- `api` / `local` backends with runtime-managed transcript history
- `agent` backends such as OpenClaw that may own more of the run/session
  lifecycle and provider-native continuity state

As the Cats suite grows, a memory-boundary problem becomes unavoidable.

We need to preserve all of the following at once:

- full chat/session backup independent of any one backend
- same-Cat continuity across many sessions
- future `Cats Work` archive and RAG ingestion across all sessions
- provider-native continuity where a backend needs it for correct resume

OpenClaw is a useful benchmark because it already separates transcript history,
compaction summaries, durable memory files, optional retrieval indexing, and
hook-driven memory flushes. But `cats-runtime` is not the full product: it is a
runtime boundary serving upstream products such as `cats`.

That means `cats-runtime` must not accidentally become the canonical owner of
all long-lived Cats memory simply because it can see the active session.

## Decision

`cats-runtime` will treat memory-adjacent state as three distinct layers, with a
clear ownership boundary between runtime continuity and product memory.

1. **Evidence layer**
   - `cats-runtime` owns normalized execution evidence for the sessions it runs.
   - This includes streamed turn output, tool activity, artifacts, provider
     metadata snapshots, and runtime-visible checkpoints.
   - Evidence is the runtime's canonical historical record.

2. **Durable memory layer**
   - Cross-session Cat memory, owner preference memory, and other long-lived
     product semantics are not runtime-owned by default.
   - `cats-runtime` may emit signals, checkpoints, and exportable evidence that
     upstream products use to build durable memory.
   - Upstream products such as `cats` remain responsible for deciding what
     durable memory to keep and how to scope it.

3. **Retrieval/archive layer**
   - Search and RAG corpora are downstream projections built from product-owned
     exports and curated evidence.
   - `cats-runtime` may support export hooks or APIs, but retrieval corpora are
     not the runtime's source of truth for active sessions.

This decision also establishes the following rules:

1. Provider-native transcripts, thread ids, and agent session files are
   continuity aids, not sufficient product memory by themselves.
2. Runtime history should remain rich enough for audit, replay, and export even
   when provider-native state is also present.
3. If a backend requires provider-managed resume state, that state should be
   stored beside runtime evidence, not conflated with higher-level Cats memory.
4. `cats-runtime` may expose checkpoint or export surfaces for sleep/wake,
   close, compaction, and handoff flows, but the product decides how those
   checkpoints update durable memory.
5. Future archive or RAG integrations should consume explicit exports or
   projections rather than reaching directly into provider-native session files
   as their primary ingestion path.

## Consequences

### Positive

- Prevents provider-native transcripts from becoming the accidental canonical
  memory model.
- Keeps `cats-runtime` responsible for what it can authoritatively know:
  execution evidence and continuity metadata.
- Gives `cats` room to own Cat/owner memory and `Cats Work` archive policy.
- Makes OpenClaw-style session continuity compatible with Cats-owned transcript
  backup and later RAG.

### Negative

- Requires another explicit contract between runtime evidence and product memory
  pipelines.
- Some future APIs will need to expose checkpoint/export behavior more clearly.
- Teams must avoid duplicating the same state across runtime history and product
  memory stores without purpose.

### Neutral

- This ADR does not ban provider-native resume state.
- This ADR does not require immediate implementation of a vector store or RAG
  service.
- This ADR does not force one storage engine across runtime and product layers.

## Alternatives Considered

### Alternative 1: Treat provider-native or agent-native transcripts as the primary durable memory

- **Pros**: simpler in the short term; fewer stores to manage.
- **Cons**: ties Cats memory to backend-specific formats and weakens product
  backup guarantees.
- **Why rejected**: provider-native transcripts are valuable but insufficient as
  the only durable memory model.

### Alternative 2: Let `cats-runtime` own all long-lived memory semantics

- **Pros**: one service sees all active session events.
- **Cons**: collapses runtime continuity, product memory, and archive policy
  into one boundary.
- **Why rejected**: long-lived Cat and owner memory belongs to the product
  layer, not to the execution runtime alone.

### Alternative 3: Let archive/RAG storage double as the canonical live memory source

- **Pros**: fewer conceptual layers.
- **Cons**: retrieval corpora are asynchronous, lossy, and optimized for recall
  rather than audit or transactional correctness.
- **Why rejected**: archive memory is a downstream projection, not live truth.

## References

- [cats-runtime Architecture](../architecture.md)
- [SPEC-003: Agent Backend for External Agent Runtimes](../specs/SPEC-003-agent-backend.md)
- [ADR-006: Introduce an agent backend and shared runtime contracts](./006-agent-backend-and-shared-runtime-contracts.md)
- [cats SPEC-022: Cats Memory Layering and Ownership](../../../cats/docs/specs/SPEC-022-cats-memory-layering-and-ownership.md)
- [cats research: OpenClaw memory layering benchmark](../../../cats/docs/research/2026-03-19-openclaw-memory-layering-benchmark.md)
- [OpenClaw memory](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw compaction](https://docs.openclaw.ai/concepts/compaction)
- [OpenClaw session management deep dive](https://docs.openclaw.ai/reference/session-management-compaction)
- [OpenClaw hooks](https://docs.openclaw.ai/automation/hooks)

---

*Decision made: 2026-03-19*
*Decision makers: Codex with user direction*

