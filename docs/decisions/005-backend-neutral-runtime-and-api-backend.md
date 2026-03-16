# ADR 005: Introduce a Backend-Neutral Runtime Facade for CLI and API Backends

## Status

Accepted

## Date

2026-03-16

## Context

`cats-runtime` currently serves one public HTTP contract, but its internal
execution path is tightly coupled to the embedded CLI runtime:

- `AppContext` is typed in terms of `CliRuntimeConfig` and `WorkerPool`
- HTTP routes directly call `ctx.pool.spawn()`, `ctx.pool.get()`, and
  `ctx.pool.kill()`
- shared session and stream contracts still live under `src/backends/cli`
- raw stream events are modeled as Claude-shaped payloads

That coupling was acceptable while `cats-runtime` only hosted subprocess-backed
providers. It becomes a blocker for the next phase:

- pay-as-you-go API providers such as Anthropic, OpenAI, and Gemini
- Ollama as a local HTTP model runtime
- a shared local tool runtime that should not belong only to one backend

Without a backend-neutral seam, adding API providers would either explode route
special cases or duplicate the current lifecycle model outside the HTTP layer.

## Decision

`cats-runtime` will keep one public HTTP contract while introducing a
backend-neutral runtime facade internally.

This decision includes:

1. Shared session, stream, permission, and execution-handle contracts move into
   `src/core`.
2. HTTP routes depend on a `RuntimeSessionManager` / runtime facade rather than
   directly on `WorkerPool`.
3. `WorkerPool` remains the CLI execution engine, but becomes a CLI-specific
   implementation detail behind the facade.
4. Runtime-managed transcripts are the source of truth for API and Ollama
   resume/fork semantics. Provider-native continuation state is treated as an
   optimization, not required state.
5. Backend selection remains instance-level in `providers.yaml`, not
   request-level.
6. Ollama is modeled as its own provider, not as an alias of `openai`.
7. Shared local workspace tools belong in `src/core/tools`, not inside
   `src/backends/api`.
8. Transport work starts fetch-first, with an explicit escape hatch to vendor
   SDKs when multipart uploads, auth complexity, or streaming maintenance cost
   justify the switch.

## Rationale

- preserves the stable public HTTP API for upstream callers
- localizes backend-specific execution logic behind one seam
- avoids route-level branching on "CLI session" vs "API session"
- makes local tool policy reusable across all future backends
- keeps Ollama's health, model catalog, and lifecycle distinct from OpenAI
  compatibility concerns

## Consequences

### Positive

- future API and local-model providers have a defined integration point
- route internals can evolve without breaking the external contract
- shared contracts stop depending on CLI-only modules
- transcript, tool, and permission policy can become runtime-wide concerns

### Negative

- Phase 1 requires broad but shallow refactors across `src/core`, `src/http`,
  and `src/backends/cli`
- the runtime facade initially adds another abstraction layer over `WorkerPool`
- some temporary duplication may exist until API backends fully land

### Neutral

- CLI discovery remains where it is for now; API-only providers simply opt into
  an explicit no-discovery path

## Alternatives Considered

### Alternative 1: Keep Routes Directly Bound to `WorkerPool`

- **Pros**: lowest short-term code churn
- **Cons**: API/Ollama support would require route-level branching and
  duplicated lifecycle logic
- **Why rejected**: it pushes backend complexity into the HTTP layer and makes
  future maintenance worse

### Alternative 2: Build a Separate API Runtime Service

- **Pros**: hard separation between subprocess and API execution
- **Cons**: reintroduces the extra process boundary that ADR 002 removed
- **Why rejected**: the long-term direction is one runtime boundary with
  multiple internal backends, not another service split

## References

- [ADR 002: Embed the CLI runtime into `cats-runtime`](./002-embed-cli-runtime.md)
- [ADR 003: Move provider execution topology into file-based provider instances](./003-provider-instance-config.md)
- [PLAN-003: API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama](../plans/PLAN-003-api-backend.md)

---

*Decision made: 2026-03-16*
*Decision makers: Codex + user direction*
