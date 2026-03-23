# MCP Configuration Guide

> Runtime-owned MCP facade notes for `cats-runtime`.

## Overview

`cats-runtime` now exposes a first MCP facade slice over HTTP JSON-RPC:

```text
POST /mcp
```

This route is additive. It does not replace the direct runtime HTTP API used by
`cats`, the dashboard, or the playground.

## Current Stance

- direct runtime APIs remain the primary product boundary
- MCP is for orchestrator-style agents and tool hosts
- runtime still owns tool delivery, session inspection, workspace audit, and
  delivery audit behavior
- product-owned approvals, operator actions, and conversation state remain
  outside this facade

## Supported JSON-RPC Methods

The current MVP supports:

- `initialize`
- `tools/list`
- `tools/call`
- `notifications/initialized`

## Curated Tool Set

Current tools:

- `runtime_summary`
- `list_sessions`
- `observe_session`
- `audit_workspace`
- `audit_delivery_target`

This is intentionally a read-mostly and preview-first slice. Session mutation
tools can land later if downstream orchestrators actually need them.

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

## Tool Intent Alignment

`cats` now resolves product-owned `mcpProfile` intent into a direct
orchestrator plan/dispatch contract, while `cats-runtime` exposes the actual
tool surface here. The first shared tool names are:

- `runtime_summary`
- `list_sessions`
- `observe_session`
- `audit_workspace`
- `audit_delivery_target`

This keeps the product/runtime ownership split explicit:

- `cats` chooses tool intent
- `cats-runtime` exposes runtime-owned tool delivery and read models

## Boundary Notes

- the MCP facade is not a standalone stdio binary in this slice
- the dashboard and playground continue to use direct runtime APIs
- workspace and delivery tools remain preview-first unless later runtime routes
  explicitly accept apply semantics
- MCP must not become a back door around product-owned approval or governance
  state

## References

- [api.md](./api.md)
- [architecture.md](./architecture.md)
- [cats ADR-008](../../cats/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md)

---

*Last updated: 2026-03-23*
