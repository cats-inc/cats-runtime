# ADR-028: Proxy Stdio MCP to the Primary Runtime HTTP Surface

> Keep stdio MCP host compatibility without running a second independent
> `cats-runtime` core against the same persisted state.

## Status

Proposed

## Date

2026-03-29

## Context

`cats-runtime` currently exposes MCP in two ways:

- HTTP JSON-RPC on `POST /mcp`
- a standalone stdio entrypoint via `cats-runtime-mcp`

The HTTP route runs inside the main `cats-runtime` process and therefore shares
the same runtime context as dashboard, health, sessions, provider diagnostics,
and other runtime-owned surfaces.

The standalone stdio entrypoint currently does not proxy to that running
runtime. Instead, it creates its own `createRuntimeServer(...)` instance and
serves MCP requests from a second process-local runtime context.

That split is acceptable only when the stdio entrypoint is treated as a
completely separate runtime. It becomes risky when operators or tools try to
use both the main HTTP runtime and the stdio MCP entrypoint against the same
data/session directories at the same time:

- each process owns a separate in-memory `SessionRegistry`, worker pool,
  backend managers, and maintenance services
- persisted session state is shared on disk but live worker/session ownership
  is not
- sessions reloaded from disk are treated as `closed`, so one process does not
  truthfully understand another process's live execution state
- concurrent writes to the same persisted runtime files become last-writer-wins
  rather than coordinated shared-state behavior

At the same time, stdio MCP remains valuable because some tools, including MCP
Studio-style hosts, expect to launch a local stdio MCP server command rather
than connecting to an HTTP MCP endpoint.

The project therefore needs an explicit answer for how stdio MCP should relate
to the primary runtime process.

## Decision

`cats-runtime-mcp` should evolve from an independent stdio-served runtime into a
thin stdio-to-HTTP proxy for an already-running primary `cats-runtime`
instance.

This decision includes:

1. The primary runtime process remains the authoritative owner of runtime
   context, session state, worker/session lifecycle, diagnostics, and
   maintenance loops.
2. The stdio MCP entrypoint remains available for stdio-only MCP hosts, but it
   should forward MCP JSON-RPC traffic to the primary runtime's `POST /mcp`
   surface instead of constructing a second local runtime core.
3. The proxy should target a configurable runtime MCP URL, with a sensible
   local default derived from existing runtime host/port configuration.
4. The proxy should forward runtime API auth when required rather than
   reimplementing MCP tool execution locally.
5. The first proxy slice should fail clearly when the primary runtime is not
   reachable. Auto-starting the runtime is deferred.
6. Compatibility for stdio host tooling is more important in the first slice
   than collapsing the command shape. The `cats-runtime-mcp` executable may
   remain as the public stdio entrypoint initially.
7. Converging the CLI UX to `cats-runtime mcp` is a follow-on ergonomics choice,
   not a prerequisite for the proxy architecture.
8. Local utility exits such as help text and narrowly scoped diagnostic
   bootstrap commands may remain local if they do not create a competing
   runtime execution context.

## Consequences

### Positive

- `POST /mcp` and stdio MCP will operate against one authoritative runtime
  state owner instead of two competing cores.
- MCP Studio-style hosts can keep using stdio without forcing the runtime to
  duplicate session/worker ownership.
- MCP behavior stays aligned with the main runtime by construction because the
  stdio layer becomes a transport shim rather than a second implementation.
- The project can later collapse `cats-runtime-mcp` into `cats-runtime mcp`
  without changing the underlying shared-state strategy.

### Negative

- stdio MCP will depend on a separately running primary runtime process.
- Operators must understand that `cats-runtime-mcp` is no longer a standalone
  full runtime server in normal MCP-serving mode.
- Failure handling, auth forwarding, and runtime endpoint discovery must become
  explicit in the stdio transport layer.

### Neutral

- This decision does not remove the HTTP `POST /mcp` route.
- This decision does not require auto-starting the runtime in the first slice.
- This decision does not force an immediate rename from `cats-runtime-mcp` to
  `cats-runtime mcp`.

## Alternatives Considered

### Alternative 1: Keep `cats-runtime-mcp` as a fully independent runtime

- **Pros**: simplest implementation continuity; stdio entrypoint can run
  without a primary runtime process.
- **Cons**: duplicates runtime core ownership and risks state divergence when
  both processes touch the same persisted runtime world.
- **Why rejected**: it is a poor fit for operators who reasonably expect MCP,
  dashboard, and runtime sessions to describe one shared runtime.

### Alternative 2: Remove stdio MCP and support HTTP MCP only

- **Pros**: one runtime process, one MCP surface, no stdio proxy logic.
- **Cons**: breaks stdio-only MCP hosts such as MCP Studio-style tools.
- **Why rejected**: stdio compatibility remains a real product requirement.

### Alternative 3: Keep stdio direct, but add file locks/shared persistence

- **Pros**: preserves standalone stdio runtime behavior while reducing some
  persistence collisions.
- **Cons**: does not solve the more important issue that live runtime/session
  ownership is still process-local and invisible across cores.
- **Why rejected**: it treats the symptom at the persistence layer rather than
  restoring one authoritative runtime owner.

### Alternative 4: Make `cats-runtime-mcp` auto-start and supervise the primary runtime

- **Pros**: one command could satisfy stdio hosts even when the runtime is not
  already running.
- **Cons**: startup ownership, lifecycle, and discovery rules become more
  complex; risk of accidental hidden background runtime creation.
- **Why rejected**: useful follow-on possibility, but too much lifecycle policy
  for the first corrective slice.

## References

- [PLAN-015](../plans/PLAN-015-mcp-mutation-tools-and-stdio-facade.md)
- [ADR-009](./009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup.md)
- [SPEC-022](../specs/SPEC-022-stdio-mcp-proxy-to-primary-runtime.md)
- [PLAN-022](../plans/PLAN-022-stdio-mcp-proxy-to-primary-runtime.md)

---

*Proposed: 2026-03-29*
*Decision makers: user + Codex*
