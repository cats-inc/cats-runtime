# API Specification

> Public HTTP surface for the embedded `cats-runtime` service.

## Overview

`cats-runtime` serves the runtime contract directly. Requests no longer hop
through a second local `agent-fleet` HTTP service.

## Base URL

```text
Development: http://127.0.0.1:3110
```

## Authentication

Inbound auth is optional. When `CATS_RUNTIME_API_KEY` is set, clients must send:

```bash
Authorization: Bearer <cats-runtime-api-key>
```

`GET /sessions/{id}/stream` also accepts `?token=<api-key>` for EventSource use
cases where custom headers are awkward.

## Core Endpoints

### Health

```text
GET /health
```

Example response:

```json
{
  "service": "cats-runtime",
  "status": "ok",
  "timestamp": "2026-03-11T12:34:56.000Z",
  "version": "0.1.0"
}
```

### Sessions

```text
GET    /sessions
POST   /sessions
GET    /sessions/{id}
POST   /sessions/{id}/messages
POST   /sessions/{id}/close
POST   /sessions/{id}/resume
POST   /sessions/{id}/fork
DELETE /sessions/{id}
GET    /sessions/{id}/history
GET    /sessions/{id}/stream
```

Minimal create example:

```json
{
  "provider": "claude",
  "cwd": "C:/repo",
  "model": "claude-opus-4-6",
  "permissionMode": "skip"
}
```

Message example:

```json
{
  "message": "Summarize the current task."
}
```

`POST /sessions/{id}/messages` supports:

- `Accept: text/event-stream`
- `Accept: application/x-ndjson`

### Runtime Inspection

```text
GET /pool/status
GET /browse?path=...
GET /kiro/models
```

### Native Session Discovery

```text
GET  /auggie/sessions
POST /auggie/sessions/discover
GET  /codex/sessions
POST /codex/sessions/discover
GET  /cursor/sessions
POST /cursor/sessions/discover
GET  /kiro/sessions
POST /kiro/sessions/discover
GET  /opencode/sessions
POST /opencode/sessions/discover
```

## Error Responses

Errors use this format:

```json
{
  "error": "Human-readable message"
}
```

## Notes

- The public contract is served directly by `cats-runtime`
- Provider-specific capabilities still differ; not every provider supports
  resume, fork, or permission enforcement in the same way
- Future API-key and Ollama support will be added under `backends/api` without
  requiring a new inbound service

---

*Last updated: 2026-03-11*
