# SPEC-022: Stdio MCP Proxy to the Primary Runtime

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

`cats-runtime` already exposes an HTTP MCP surface at `POST /mcp` and a
standalone stdio executable via `cats-runtime-mcp`. Today those two surfaces do
not share one authoritative runtime core unless callers use the HTTP route on
the main runtime process.

This spec defines a corrective direction: stdio MCP should remain available for
stdio-only hosts such as MCP Studio, but it should proxy to the primary running
runtime instead of creating a second independent runtime context against the
same persisted world.

The goal is to preserve stdio compatibility while making the main `cats-runtime`
process the single owner of live sessions, workers, diagnostics, and runtime
state.

## Goals

- keep stdio MCP compatibility for hosts that cannot connect over HTTP
- make the main `cats-runtime` process the single authoritative runtime state
  owner
- eliminate duplicate in-memory runtime cores for the normal "main runtime +
  stdio MCP host" topology
- keep MCP tool behavior aligned with the existing `POST /mcp` contract
- preserve a path to later CLI UX convergence such as `cats-runtime mcp`

## Non-Goals

- removing the HTTP `POST /mcp` surface
- auto-starting the primary runtime in the first slice
- redesigning MCP tool schemas or the MCP protocol surface itself
- solving every future remote/distributed MCP transport scenario
- forcing an immediate command rename from `cats-runtime-mcp` to
  `cats-runtime mcp`

## User Stories

- As an MCP Studio user, I want to keep launching a local stdio MCP command so
  I can attach to `cats-runtime` without requiring HTTP support in the host.
- As an operator, I want stdio MCP and dashboard/session diagnostics to agree
  on the same live runtime state.
- As a runtime maintainer, I want one authoritative runtime owner so I do not
  debug state drift between an HTTP runtime and a second stdio-created runtime.
- As a future CLI designer, I want transport entrypoints to be separable from
  runtime-state ownership so command-shape changes do not require architecture
  rework.

## Requirements

### Functional Requirements

1. `cats-runtime-mcp` shall support stdio MCP hosts without constructing a
   competing runtime core for normal MCP-serving mode.
2. The stdio MCP entrypoint shall forward MCP JSON-RPC requests to an existing
   primary runtime `POST /mcp` endpoint.
3. The first proxy slice shall preserve the existing MCP JSON-RPC method set
   and tool shapes already exposed by `POST /mcp`.
4. The proxy shall be able to resolve its target runtime MCP URL from:
   - an explicit proxy URL override
   - or the existing local runtime host/port configuration
5. The proxy shall forward bearer auth when the primary runtime requires
   `CATS_RUNTIME_API_KEY`.
6. The proxy shall fail with machine-readable MCP-compatible errors when the
   primary runtime cannot be reached or returns an invalid MCP response.
7. The proxy shall not call `createRuntimeServer(...)` for normal stdio MCP
   request serving.
8. The proxy shall not start runtime discovery, worker pools, wakeups, browser
   maintenance, or other runtime lifecycle loops.
9. The proxy may retain lightweight local utility exits such as `--help`.
10. If setup-oriented or diagnostic utility flags remain on the stdio binary,
    their behavior shall be explicitly documented as local utility behavior,
    not shared-runtime MCP serving.
11. The first slice shall keep `cats-runtime-mcp` as a supported stdio command
    for backward compatibility.
12. The implementation shall leave room for a later `cats-runtime mcp`
    subcommand without changing the proxy/runtime ownership model.
13. The primary runtime shall remain the authoritative owner of:
    - session lifecycle
    - runtime diagnostics
    - provider diagnostics
    - worker/session pools
    - maintenance loops
    - persisted runtime state writes that derive from those live operations
14. The stdio proxy shall not silently downgrade to a local independent runtime
    when the primary runtime is unavailable.
15. Proxy behavior shall be explicit about which runtime it targets so
    operators can reason about failures and shared-state boundaries.

### Non-Functional Requirements

- **State integrity**: stdio MCP must not create a second live runtime owner in
  the standard topology.
- **Compatibility**: existing stdio MCP hosts should continue to work with
  minimal or no configuration changes.
- **Observability**: proxy failures should clearly indicate whether the problem
  is runtime reachability, auth, framing, or invalid upstream MCP payloads.
- **Replaceability**: the command shape (`cats-runtime-mcp` vs
  `cats-runtime mcp`) should remain separable from the proxy architecture.
- **Minimalism**: the first slice should be a thin transport proxy, not a new
  orchestration layer.

## Design Overview

### Intended Runtime Ownership

```text
HTTP client / dashboard / product host
                  |
                  v
             cats-runtime
                  |
                  +--> direct HTTP API
                  +--> POST /mcp
                  +--> authoritative runtime state

stdio-only MCP host
                  |
                  v
          cats-runtime-mcp
                  |
                  v
          HTTP proxy to POST /mcp
```

### Proxy Shape

The stdio transport remains responsible for:

- Content-Length framing
- stdin/stdout MCP transport behavior
- request/response ordering
- local help/utility exit behavior

The proxy layer becomes responsible for:

- target runtime URL resolution
- HTTP request forwarding
- auth forwarding
- upstream timeout/error classification
- basic response validation

The primary runtime remains responsible for:

- actual MCP method/tool execution
- session and runtime state ownership
- provider/model/diagnostic truth
- lifecycle and maintenance loops

### Suggested Resolution Order

The first slice should support this target resolution order:

1. `CATS_RUNTIME_MCP_PROXY_URL`
2. derived local URL from runtime host/port config, e.g.
   `http://127.0.0.1:${CATS_RUNTIME_PORT || 3110}/mcp`

Exact naming may still evolve, but the proxy target must be explicit and
documented.

## Dependencies

- existing HTTP MCP route in `cats-runtime`
- existing stdio framing/parser loop
- runtime HTTP auth convention when `CATS_RUNTIME_API_KEY` is enabled
- existing MCP tool contract stability from the current `POST /mcp` surface

## Open Questions

- [x] `--diagnose-setup` remains a documented local utility exit on
      `cats-runtime-mcp`; normal MCP serving mode is proxy-only.
- [x] The proxy now supports configurable upstream timeout values through
      `CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS`, with a conservative default request
      window for long-running MCP tool calls.
- [ ] Should future `cats-runtime mcp` CLI convergence happen in the same
      follow-up slice or later?
- [ ] Should the proxy ever offer opt-in auto-start for the primary runtime, or
      should lifecycle ownership remain out of scope permanently?

## Implementation Notes

- `cats-runtime-mcp` now uses `src/mcp/proxy.ts` to resolve
  `CATS_RUNTIME_MCP_PROXY_URL` first, then derive
  `http://<CATS_RUNTIME_HOST|127.0.0.1>:<CATS_RUNTIME_PORT|3110>/mcp`
- `CATS_RUNTIME_API_KEY` is forwarded as bearer auth to the primary runtime
- `CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS` now overrides the proxy request timeout;
  default proxy timeout is `1800000` ms (30 minutes)
- normal stdio MCP serving no longer calls `createRuntimeServer(...)`
- stdio framing remains local in `src/mcp/stdio.ts`; only JSON-RPC execution is proxied

## References

- [ADR-028](../decisions/028-proxy-stdio-mcp-to-the-primary-runtime-http-surface.md)
- [PLAN-022](../plans/PLAN-022-stdio-mcp-proxy-to-primary-runtime.md)
- [PLAN-015](../plans/PLAN-015-mcp-mutation-tools-and-stdio-facade.md)
- [MCP Configuration Guide](../mcp-config.md)

---

*Created: 2026-03-29*
*Author: Codex*
*Related Plan: [PLAN-022](../plans/PLAN-022-stdio-mcp-proxy-to-primary-runtime.md)*
