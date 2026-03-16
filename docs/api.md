# API Specification

> Public HTTP surface for the embedded `cats-runtime` service.

## Overview

`cats-runtime` serves the runtime contract directly. Requests no longer hop
through a second local runtime service.

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

### Dashboard

```text
GET /
```

Returns the embedded `cats-runtime` dashboard HTML.

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
  "instance": "native",
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

Session responses also include `workspaceKey`, a normalized grouping key for
workspace-aware UIs. When a provider exposes multiple configured instances,
session payloads also include `providerInstanceId`. Windows-style paths are
case-folded in `workspaceKey` while `cwd` remains the original display path.
API-backed and local-model sessions also include `providerBackend`.

`POST /sessions` accepts an optional `instance` field. When omitted, or when the
caller explicitly sends `"default"`, `cats-runtime` uses the provider family's
configured default target from `routing.providers.<name>.default_target`.

When a provider has multiple backend kinds configured, callers can target a
specific instance with `instance: "<backend>/<instance>"`, for example
`"api/main"` or `"local/local"`.

`GET /sessions` accepts `?instance=<instance-id>` to filter registry results.
`?instance=default` matches each provider's configured default instance.

For API-backed and local-model sessions, streamed message output may include
`tool_use` and `tool_result` events in addition to `init`, `text`, `result`,
and `error`.

### Runtime Inspection

```text
GET /pool/status
GET /discovery/status
GET /providers/config
GET /browse?path=...
GET /kiro/models
```

`GET /kiro/models` also accepts `?instance=<instance-id>` and returns the
resolved `instance` alongside the runtime metadata.

`GET /providers/config` returns the configured provider topology for dashboards
or other clients that need to offer provider-instance selection. Each instance
entry includes its backend kind (`cli`, `api`, or `local`) plus any transport or
runtime metadata that applies to that backend.

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

The provider-native endpoints for Auggie, Cursor, Kiro, OpenCode, and Codex accept an
optional `instance` query/body field so callers can target a specific configured
provider instance. `"default"` is accepted as an alias for each provider's
configured default instance. Unknown instance IDs return `400`.

For manual WSL-backed discovery, `POST /cursor/sessions/discover` and
`POST /kiro/sessions/discover` also accept:

```json
{
  "cwd": "C:/repo",
  "instance": "ubuntu",
  "startIfNeeded": false
}
```

When `startIfNeeded` is `false`, the runtime will skip waking a stopped WSL
distro and return any sessions it can inspect without starting WSL. The default
remains `true`.

## Error Responses

Errors use this format:

```json
{
  "error": "Human-readable message"
}
```

## Notes

- The public contract is served directly by `cats-runtime`
- The dashboard at `/` is intentionally unauthenticated for local use
- Provider-specific capabilities still differ; not every provider supports
  resume, fork, or permission enforcement in the same way
- API-backed and local-model sessions currently use runtime-hosted local tools
  for filesystem search/read/write and shell execution
- `GET /discovery/status` reports the configured WSL discovery policy plus the
  current background scan state for WSL-backed Cursor/Kiro discovery; when a
  provider has multiple WSL instances, the payload keys are `provider@instance`
- File-scanned providers (`claude`, `codex`, `copilot`, `gemini`, `auggie`) now
  discover external sessions per configured provider instance as well
- File-backed provider paths are resolved on the host. On Windows, WSL-backed
  file providers must use host-accessible paths such as `\\wsl$\Distro\...`
- API-key and Ollama execution now live under `src/backends/api` without
  requiring a second inbound service

---

*Last updated: 2026-03-16*
