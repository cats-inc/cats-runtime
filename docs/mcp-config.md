# MCP Configuration Guide

> Runtime-owned MCP facade notes for `cats-runtime`.

## Overview

`cats-runtime` now exposes the MCP facade over both HTTP JSON-RPC and stdio:

```text
POST /mcp
node dist/bin/mcp.js
```

`POST /mcp` is the authoritative MCP execution surface because it runs inside
the primary `cats-runtime` process. `node dist/bin/mcp.js` remains as a
repo-local helper for stdio-only hosts, but it now acts as a thin
stdio-to-HTTP proxy to that existing `POST /mcp` route instead of creating a
second runtime core.

This MCP facade is additive. It does not replace the direct runtime HTTP API
used by `cats`, the dashboard, or the playground.

## Current Stance

- direct runtime APIs remain the primary product boundary
- MCP is for orchestrator-style agents and tool hosts
- runtime still owns session mutation, tool delivery, session inspection,
  workspace substrate, and delivery behavior
- product-owned approvals, operator actions, and conversation state remain
  outside this facade

## Supported JSON-RPC Methods

The current MCP slice supports:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `notifications/initialized`

## Curated Tool Set

Current tools:

- `runtime_summary`
- `list_sessions`
- `provider_diagnostics`
- `observe_session`
- `list_runtime_skills`
- `create_session`
- `send_message`
- `close_session`
- `reset_session`
- `fork_session`
- `delete_session`
- `cleanup_session_workspace`
- `compact_session`
- `report_session_maintenance_follow_through`
- `report_compaction_follow_through`
- `list_browser_drivers`
- `list_browser_sessions`
- `browser_summary`
- `create_browser_session`
- `create_browser_page`
- `navigate_browser_page`
- `close_browser_page`
- `close_browser_session`
- `cleanup_browser_sessions`
- `list_workspace_substrate_profiles`
- `audit_workspace`
- `init_workspace`
- `update_workspace`
- `audit_delivery_target`
- `commit_changes`

This remains additive and runtime-owned. Direct product APIs stay primary, but
the MCP tool plane now covers the minimum mutation surface needed for
multi-step orchestration.

`provider_diagnostics` is the curated MCP wrapper over
`GET /diagnostics/providers`. It returns the same provider readiness,
compatibility, setup, and remediation payload, while accepting additive
`probe: "light" | "live"`, `provider`, `backend`, `instance`, `defaultOnly`,
and `forceRefresh: true` inputs. This keeps the MCP seam aligned with the
runtime-owned filtered diagnostics route instead of forcing hosts to fetch the
full provider catalog and narrow it themselves.

`list_runtime_skills` is the curated MCP wrapper over the same versioned
filterable/paged runtime-owned skill catalog exposed by `GET /skills/catalog`,
including the additive `contract.version`, `query.filters`, optional
`query.sort`, and `pagination` payloads. The MCP wrapper also accepts `sortBy`,
`sortDirection`, `offset`, and `limit`.

`close_session` is the curated MCP wrapper over `POST /sessions/{id}/close`. It
preserves the direct runtime close contract, including optional additive
`maintenance` metadata, while returning the same normalized session snapshot
shape as the HTTP lifecycle route.

`reset_session` is the curated MCP wrapper over `POST /sessions/{id}/reset`.
It preserves the direct runtime reset contract, including optional
`requireAcknowledgedHooks`, `worktreeCleanupPolicy`, additive `maintenance`
metadata, and retained cleanup responses when worktree cleanup cannot finish
safely.

`delete_session` is the curated MCP wrapper over `DELETE /sessions/{id}`. It
preserves the direct runtime delete contract, including optional
`requireAcknowledgedHooks`, `worktreeCleanupPolicy`, additive `maintenance`
metadata, and retained cleanup responses when terminal cleanup cannot finish
safely.

`cleanup_session_workspace` is the curated MCP wrapper over
`POST /sessions/{id}/workspace/cleanup`. It gives orchestrators the same
bounded retained-worktree cleanup retry seam as the direct HTTP API, including
optional `requireAcknowledgedHooks`, `worktreeCleanupPolicy`, additive
`maintenance` metadata, and the updated session/maintenance snapshot after the
retry. Like the direct route, it does not auto-replay reset/delete
follow-through; it only retries workspace cleanup and refreshes persisted
workspace hydration/skill delivery state.

When `reset_session` or `delete_session` returns `status: "retained"` because
worktree cleanup could not finish safely, the MCP payload now also includes
`retryCleanupPath` so orchestrators can hand off directly to
`cleanup_session_workspace` without rebuilding the retry route path.

`compact_session` is the curated MCP wrapper over `POST /sessions/{id}/compact`.
It preserves the same runtime-owned compaction contract, including additive
maintenance trigger metadata, the compatibility `acknowledgeHooks` shorthand,
and machine-readable readiness states such as `pending_hooks`,
`ready_for_external_compaction`, `deferred`, `not_ready`, or `compacted`.

`report_session_maintenance_follow_through` is the generic MCP wrapper over
`POST /sessions/{id}/maintenance/follow-through`. It lets orchestrators report
`acknowledged`, `retry_requested`, or `completed` outcomes for validated
`reset`, `delete`, `cleanup_workspace`, or `compact` maintenance phases without
leaving the MCP tool plane.

`report_compaction_follow_through` remains the narrower MCP shortcut over
`POST /sessions/{id}/compact/follow-through` for compaction-only flows that do
not need to pass `action` and `phase` explicitly.

`POST /mcp` uses the same runtime auth policy as the direct HTTP API. If
`cats-runtime` is configured with an API key, MCP clients must send the same
Bearer token. `node dist/bin/mcp.js` forwards that same bearer token to the
primary runtime when `CATS_RUNTIME_API_KEY` is set.

## HTTP Usage

When `CATS_RUNTIME_API_KEY` is enabled, send the same bearer auth used by the
rest of the runtime API:

```text
Authorization: Bearer <cats-runtime-api-key>
```

Example `initialize` request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

Example `tools/list` request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

Example `tools/call` request:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "observe_session",
    "arguments": {
      "sessionId": "session-123"
    }
  }
}
```

Example `tools/call` response shape:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Observation snapshot for session session-123."
      }
    ],
    "structuredContent": {
      "session": {
        "id": "session-123"
      },
      "observePath": "/sessions/session-123/observe"
    }
  }
}
```

`structuredContent` is the machine-readable contract. `content[].text` is only
the short human summary.

## Stdio Usage

Repo-local entrypoint:

```text
node dist/bin/mcp.js
```

Operational notes:

- `node dist/bin/mcp.js` is a repo-local helper, not a published npm `bin`
- start the primary `cats-runtime` first; the stdio MCP helper does not
  auto-start it
- prefer direct `POST /mcp` when the host supports HTTP MCP
- use the helper only when the host is stdio-only
- if the proxy cannot reach the primary runtime, stdio clients receive an MCP
  error instead of silently falling back to a second local runtime
- the proxy now applies a conservative upstream timeout by default and returns
  a dedicated `upstream_timeout` MCP error when the primary runtime does not
  answer in time
- `node dist/bin/mcp.js --inspect-proxy` is a local utility exit that resolves
  the current proxy target, runs a `ping` preflight against the primary
  runtime, emits JSON to stdout, and exits without starting the stdio MCP
  server

Proxy target resolution order:

1. `CATS_RUNTIME_MCP_PROXY_URL`
2. derived local URL from `CATS_RUNTIME_HOST` / `CATS_RUNTIME_PORT`

Notes:

- when deriving the local URL, `0.0.0.0` / `::` normalize to `127.0.0.1`
- `CATS_RUNTIME_API_KEY` is forwarded as `Authorization: Bearer <token>`
- `CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS` overrides the proxy timeout in
  milliseconds; default is `1800000` (30 minutes)

Example host config:

```json
{
  "mcpServers": {
    "cats-runtime": {
      "command": "node",
      "args": ["./dist/bin/mcp.js"],
      "cwd": "cats-runtime",
      "env": {
        "CATS_RUNTIME_MCP_PROXY_URL": "http://127.0.0.1:3110/mcp"
      }
    }
  }
}
```

## Tool Intent Alignment

`cats` now resolves product-owned `mcpProfile` intent into a direct
orchestrator plan/dispatch contract, while `cats-runtime` exposes the actual
tool surface here. The first shared tool names are:

- `runtime_summary`
- `list_sessions`
- `provider_diagnostics`
- `observe_session`
- `list_runtime_skills`
- `create_session`
- `send_message`
- `close_session`
- `reset_session`
- `fork_session`
- `delete_session`
- `cleanup_session_workspace`
- `compact_session`
- `report_session_maintenance_follow_through`
- `report_compaction_follow_through`
- `list_browser_drivers`
- `list_browser_sessions`
- `browser_summary`
- `create_browser_session`
- `create_browser_page`
- `navigate_browser_page`
- `close_browser_page`
- `close_browser_session`
- `cleanup_browser_sessions`
- `list_workspace_substrate_profiles`
- `audit_workspace`
- `init_workspace`
- `update_workspace`
- `audit_delivery_target`
- `commit_changes`

`list_sessions.arguments.status` accepts the same runtime session states exposed
by the direct API: `initializing`, `ready`, `busy`, `closed`,
`closing`. Invalid values return MCP `-32602`.

`create_session.arguments.workspaceIsolation` and
`fork_session.arguments.workspaceIsolation` accept the same isolation modes as
the direct runtime API: `shared`, `isolated`, and `worktree`.

The browser MCP tools are additive wrappers over the same runtime-owned
`/browser/*` substrate. `list_browser_sessions` now accepts the same
`status=ready|closed` filter as direct HTTP, `browser_summary` exposes the
aggregate read model for hosts, and `cleanup_browser_sessions` provides the
same explicit cleanup seam as `POST /browser/sessions/cleanup` for both closed
browser sessions and idle retained ready sessions whose known pages are already
closed. They do not require a separate browser service and do not introduce a
dependency on other monorepo browser projects.

This keeps the product/runtime ownership split explicit:

- `cats` chooses tool intent
- `cats-runtime` exposes runtime-owned tool delivery and read models

## Boundary Notes

- the dashboard and playground continue to use direct runtime APIs
- workspace and delivery tools remain preview-first by default unless callers
  explicitly request apply semantics already supported by the runtime
- MCP must not become a back door around product-owned approval or governance
  state

## References

- [api.md](./api.md)
- [architecture.md](./architecture.md)
- [cats ADR-008](../../cats-platform/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md)

---

*Last updated: 2026-03-24*
