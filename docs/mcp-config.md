# MCP Configuration Guide

> Runtime-owned MCP facade notes for `cats-runtime`.

## Overview

`cats-runtime` now exposes the MCP facade over both HTTP JSON-RPC and stdio:

```text
POST /mcp
cats-runtime-mcp
```

This route is additive. It does not replace the direct runtime HTTP API used by
`cats`, the dashboard, or the playground.

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
- `observe_session`
- `list_runtime_skills`
- `create_session`
- `send_message`
- `fork_session`
- `list_browser_drivers`
- `list_browser_sessions`
- `create_browser_session`
- `create_browser_page`
- `close_browser_session`
- `audit_workspace`
- `init_workspace`
- `audit_delivery_target`
- `commit_changes`

This remains additive and runtime-owned. Direct product APIs stay primary, but
the MCP tool plane now covers the minimum mutation surface needed for
multi-step orchestration.

`list_runtime_skills` is the curated MCP wrapper over the same filterable
runtime-owned skill catalog exposed by `GET /skills/catalog`.

`POST /mcp` uses the same runtime auth policy as the direct HTTP API. If
`cats-runtime` is configured with an API key, MCP clients must send the same
Bearer token.

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

Packaged entrypoint:

```text
cats-runtime-mcp
```

Local build entrypoint:

```text
node dist/bin/mcp.js
```

Example host config:

```json
{
  "mcpServers": {
    "cats-runtime": {
      "command": "node",
      "args": ["./dist/bin/mcp.js"],
      "cwd": "cats-runtime",
      "env": {
        "CATS_RUNTIME_CONFIG_PATH": "./config/providers.yaml"
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
- `observe_session`
- `list_runtime_skills`
- `create_session`
- `send_message`
- `fork_session`
- `list_browser_drivers`
- `list_browser_sessions`
- `create_browser_session`
- `create_browser_page`
- `close_browser_session`
- `audit_workspace`
- `init_workspace`
- `audit_delivery_target`
- `commit_changes`

`list_sessions.arguments.status` accepts the same runtime session states exposed
by the direct API: `initializing`, `ready`, `busy`, `closed`,
`closing`. Invalid values return MCP `-32602`.

`create_session.arguments.workspaceIsolation` and
`fork_session.arguments.workspaceIsolation` accept the same isolation modes as
the direct runtime API: `shared`, `isolated`, and `worktree`.

The browser MCP tools are additive wrappers over the same runtime-owned
`/browser/*` substrate. They do not require a separate browser service and do
not introduce a dependency on other monorepo browser projects.

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
- [cats ADR-008](../../cats/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md)

---

*Last updated: 2026-03-23*
