# API Specification

> Public HTTP surface for the first `cats-runtime` facade.

## Overview

`cats-runtime` is a thin HTTP facade. In phase 1 it forwards supported requests to
`agent-fleet` while presenting a stable endpoint set to upstream consumers.

## Base URL

```text
Development: http://127.0.0.1:3110
```

## Authentication

Inbound auth is optional. When `CATS_RUNTIME_API_KEY` is set, clients must send:

```bash
Authorization: Bearer <cats-runtime-api-key>
```

Upstream auth to `agent-fleet` is configured separately with `AGENT_FLEET_API_KEY`.

## Endpoints

### Health

```text
GET /health
```

Returns the local runtime status plus backend reachability.

Example response:

```json
{
  "service": "cats-runtime",
  "status": "ok",
  "timestamp": "2026-03-11T12:34:56.000Z",
  "backend": {
    "kind": "agent-fleet",
    "baseUrl": "http://localhost:3100",
    "reachable": true,
    "status": "ok",
    "version": "0.1.0"
  }
}
```

### List Sessions

```text
GET /sessions
```

Passes through the query string and returns the upstream JSON payload.

### Get Session

```text
GET /sessions/{id}
```

Returns the upstream session view unchanged.

### Create Session

```text
POST /sessions
```

The request body is forwarded to `agent-fleet` unchanged.

Minimal example:

```json
{
  "provider": "claude",
  "cwd": "C:/repo",
  "model": "claude-opus-4-6",
  "permissionMode": "skip"
}
```

### Send Message

```text
POST /sessions/{id}/messages
Accept: application/x-ndjson
```

The request body is forwarded unchanged. The upstream response stream is relayed as-is.

Example request body:

```json
{
  "message": "Summarize the current task."
}
```

### Close Session

```text
POST /sessions/{id}/close
```

Returns the upstream close response unchanged.

### Kiro Models

```text
GET /kiro/models
```

Returns the current Kiro model catalog from the configured backend.

## Error Responses

Local facade errors use this format:

```json
{
  "error": "Human-readable message"
}
```

Proxy errors preserve upstream status codes when an upstream response exists.
Connectivity failures return `502`.

## Notes

- `cats-runtime` currently supports only the routes listed above
- This contract is intentionally small so upper layers do not absorb extra backend detail

---

*Last updated: 2026-03-11*
