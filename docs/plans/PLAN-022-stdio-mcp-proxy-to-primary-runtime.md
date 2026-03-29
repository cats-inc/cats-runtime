# PLAN-022: Stdio MCP Proxy to the Primary Runtime

> Replace the standalone stdio MCP runtime core with a thin stdio-to-HTTP
> proxy over the primary runtime's existing `POST /mcp` surface.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Spec

- [SPEC-022](../specs/SPEC-022-stdio-mcp-proxy-to-primary-runtime.md)
- [ADR-028](../decisions/028-proxy-stdio-mcp-to-the-primary-runtime-http-surface.md)

## Overview

Keep stdio MCP compatibility for stdio-only hosts such as MCP Studio, but stop
using `cats-runtime-mcp` as a second independent runtime core. Instead, make
the stdio entrypoint a transport shim that forwards MCP JSON-RPC requests to
the primary runtime's existing HTTP MCP route.

The first slice should preserve command compatibility and existing MCP tool
contracts while reducing state divergence risk between the main runtime and
stdio clients.

## Implementation Phases

### Phase 1: Freeze the Proxy Contract

- [x] Define proxy target resolution rules and environment/config knobs
- [x] Decide which `cats-runtime-mcp` CLI flags remain local utility exits
- [x] Freeze first-slice error semantics for upstream unavailable/auth/invalid response cases

**Deliverables**: A locked transport contract for stdio proxy behavior without
reopening MCP tool schemas.

### Phase 2: Implement Thin Stdio-to-HTTP Forwarding

- [x] Add a small MCP proxy client layer that forwards JSON-RPC requests to `POST /mcp`
- [x] Update `src/bin/mcp.ts` to use proxy mode instead of creating a local runtime core
- [x] Preserve stdio framing/parser behavior while removing normal-path local runtime ownership
- [x] Keep help text and any approved local utility exits explicit and documented

**Deliverables**: `cats-runtime-mcp` serves stdio MCP by forwarding to the
primary runtime instead of instantiating a competing runtime context.

### Phase 3: Verification and Documentation

- [x] Add unit coverage for target URL resolution, auth forwarding, and upstream error mapping
- [x] Add integration coverage for stdio-to-HTTP MCP forwarding against a real runtime app
- [x] Update docs to explain when to use `cats-runtime`, `POST /mcp`, and `cats-runtime-mcp`
- [x] Record operational guidance for MCP Studio and other stdio-only hosts

**Deliverables**: Tested proxy behavior, updated operator docs, and clear
transport/runtime ownership guidance.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `cats-runtime/src/bin/mcp.ts` | Modify | Replace local runtime ownership with proxy/client startup |
| `cats-runtime/src/mcp/stdio.ts` | Modify | Reuse stdio framing while delegating request handling to proxy logic |
| `cats-runtime/src/mcp/server.ts` | Leave | Keep primary in-process MCP execution owner behind `POST /mcp` |
| `cats-runtime/src/http/routes/mcp.ts` | Leave / Verify | Keep HTTP MCP route as the authoritative execution seam |
| `cats-runtime/src/mcp/proxy.ts` | Create | Resolve target URL, auth, forwarding, and response validation |
| `cats-runtime/src/mcp/proxy.test.ts` | Create | Cover target resolution and upstream error mapping |
| `cats-runtime/src/mcp/stdio.test.ts` | Modify | Verify stdio framing still works through proxy execution |
| `cats-runtime/src/http/mcpRoutes.test.ts` | Modify | Lock route behavior the proxy relies on |
| `cats-runtime/docs/mcp-config.md` | Modify | Document stdio proxy usage and runtime reachability requirements |
| `cats-runtime/docs/api.md` | Modify | Clarify that HTTP `/mcp` is the authoritative runtime-owned MCP surface |
| `cats-runtime/README.md` | Modify | Clarify usage of `cats-runtime` vs `cats-runtime-mcp` |
| `cats-runtime/PROGRESS.md` | Modify | Track proxy follow-through once implementation starts |

## Technical Decisions

- Reuse the current HTTP `POST /mcp` route as the single execution owner for
  MCP tool requests rather than duplicating tool execution inside the stdio
  binary.
- Keep the first slice transport-thin: no runtime auto-start and no fallback to
  a second independent local runtime core.
- Preserve `cats-runtime-mcp` command compatibility initially; CLI convergence
  to `cats-runtime mcp` is a separate ergonomics follow-up.

## Testing Strategy

- **Unit Tests**: target resolution, auth header injection, timeout/error
  classification, upstream response validation.
- **Integration Tests**: stdio proxy request forwarding to a running runtime
  app, including `initialize`, `tools/list`, and representative `tools/call`
  flows.
- **Manual Testing**:
  - start `cats-runtime`
  - attach a stdio MCP host through `cats-runtime-mcp`
  - confirm MCP tools observe the same runtime/session truth as direct HTTP reads
  - verify clear failure when the primary runtime is stopped

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Proxy and HTTP route drift in subtle ways | High | Keep proxy transport-thin and treat `POST /mcp` as the only execution owner |
| Stdio host errors become opaque when upstream runtime is down | High | Add explicit upstream-unreachable and auth-failure classifications with clear operator messaging |
| CLI utility flags on `cats-runtime-mcp` blur the new mental model | Medium | Freeze and document which flags remain local-only and keep normal MCP serving path proxy-only |
| Operators expect `cats-runtime-mcp` to auto-start the runtime | Medium | Make first-slice failure messaging explicit; defer auto-start policy |
| Future CLI convergence gets blocked by today's command compatibility choice | Low | Keep proxy implementation separate from command-shape decisions |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-29 | Plan created from user direction after validating that the current stdio entrypoint creates a second independent runtime core |
| 2026-03-29 | Completed first implementation slice: `cats-runtime-mcp` now proxies stdio MCP JSON-RPC to the primary runtime `POST /mcp` surface, with unit/integration coverage and updated operator docs |

---

*Created: 2026-03-29*
*Author: Codex*
