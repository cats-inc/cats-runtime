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
  "version": "<package-version>",
  "startup": {
    "mode": "standalone",
    "readySignal": "http",
    "ready": true,
    "pid": 12345,
    "startedAt": "2026-03-19T12:34:00.000Z",
    "address": {
      "host": "127.0.0.1",
      "port": 3110,
      "healthUrl": "http://127.0.0.1:3110/health"
    }
  }
}
```

`startup.ready` reflects whether the runtime server has completed bind/startup.
For host-supervised local runs, callers should still treat `GET /health` as the
authoritative readiness check rather than inferring success from process launch
alone.

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

Extended create example:

```json
{
  "provider": "openclaw",
  "instance": "agent/gateway",
  "cwd": "/workspace/repo",
  "sessionKey": "task-123",
  "reusePolicy": "prefer_existing",
  "instructions": "Focus on architecture risks first.",
  "context": {
    "source": "interactive",
    "taskId": "task-123",
    "workspace": {
      "cwd": "/workspace/repo",
      "repoRef": "main"
    }
  },
  "outputDir": "/workspace/out"
}
```

Extended message example:

```json
{
  "message": "Draft the implementation plan.",
  "instructions": "Prefer concise bullet points.",
  "context": {
    "reason": "follow_up",
    "labels": ["planning"]
  },
  "outputDir": "/workspace/out"
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

`POST /sessions` also accepts these optional fields:

- `sessionKey`: caller-visible logical session identity for explicit reuse
- `reusePolicy`: one of `create_new`, `prefer_existing`, or `require_existing`
- `instructions`: session bootstrap instructions persisted by the runtime
- `context`: structured invocation metadata such as task/workspace hints
- `outputDir`: output hint for reports, documents, or generated artifacts

When `reusePolicy` is `prefer_existing` or `require_existing`, the runtime will
try to attach to an existing session with the same provider target and
`sessionKey`. Today explicit `sessionKey` reuse is supported for `api`, `local`,
and `agent` sessions. Matching `cli` sessions still use the existing
`/sessions/{id}/resume` flow.

`POST /sessions/{id}/messages` accepts optional `instructions`, `context`, and
`outputDir` fields. These are persisted onto the logical session so later
history/resume flows can observe the same bootstrap metadata.

`POST /sessions` accepts an optional `instance` field. When omitted, or when the
caller explicitly sends `"default"`, `cats-runtime` uses the provider family's
configured default target from `routing.providers.<name>.default_target`.

When a provider has multiple backend kinds configured, callers can target a
specific instance with `instance: "<backend>/<instance>"`, for example
`"api/main"` or `"local/local"`.

`GET /sessions` accepts `?instance=<instance-id>` to filter registry results.
`?instance=default` matches each provider's configured default instance.

For API-backed and local-model sessions, streamed message output may include
`tool_use`, `tool_result`, and `progress` events in addition to `init`, `text`,
`result`, and `error`.

`progress` is the first provider-agnostic mid-turn status contract for
API/local transports. It is intended for upper layers that should not need to
inspect provider-specific raw payloads just to surface runtime status. Example:

```json
{
  "type": "progress",
  "providerSessionId": "resp_2",
  "text": "Reused OpenAI previous_response_id continuation.",
  "metadata": {
    "kind": "provider_cache",
    "status": "reused",
    "provider": "codex",
    "backend": "api",
    "instance": "main",
    "transport": "openai",
    "strategy": "previous_response_id",
    "previousResponseId": "resp_1"
  }
}
```

Current normalized progress kinds:

- `provider_cache`: provider-native continuation or cache lifecycle such as
  OpenAI `previous_response_id` reuse/fallback or Gemini cached-content
  create/reuse/fallback
- `model_state`: local-model lifecycle hints such as Ollama `keep_alive`
  requests

Provider payload templates remain transport-specific, but the current additive
keys that `cats-runtime` recognizes are:

- Gemini cache TTL override: `cachedContentTtl`, `cached_content_ttl`,
  `contextCacheTtl`, or `context_cache_ttl`
- Ollama warm-up hint: `keep_alive` or `keepAlive`

For agent-backed sessions, streamed output may also surface normalized metadata
such as:

- `providerSessionId`
- `summary`
- `artifacts`
- `services`
- `providerState`

`GET /sessions/{id}/history` returns:

```json
{
  "messages": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ],
  "sessionKey": "task-123",
  "outputDir": "/workspace/out",
  "artifacts": [
    {
      "id": "artifact-1",
      "path": "/workspace/out/report.md",
      "label": "Draft report"
    }
  ],
  "context": {
    "source": "interactive",
    "taskId": "task-123"
  }
}
```

### Runtime Inspection

```text
GET /pool/status
GET /discovery/status
GET /providers/config
GET /providers/{provider}/models
GET /browse?path=...
GET /kiro/models
```

`GET /kiro/models` also accepts `?instance=<instance-id>` and returns the
resolved `instance` alongside the runtime metadata.

`GET /providers/config` returns the configured provider topology for dashboards
or other clients that need to offer provider-instance selection. Each instance
entry includes its backend kind (`cli`, `api`, `local`, or `agent`) plus any
transport or runtime metadata that applies to that backend.

`GET /providers/{provider}/models` is the runtime-owned per-provider model
catalog route. It accepts optional `?instance=<instance-id>` and returns a
structured catalog:

```json
{
  "provider": "ollama",
  "backend": "local",
  "instance": "local",
  "defaultModel": "qwen2.5-coder:7b",
  "source": "dynamic",
  "cache": {
    "servedFromCache": false,
    "cachedAt": "2026-03-19T12:00:00.000Z",
    "ttlSec": 60
  },
  "models": [
    {
      "id": "qwen2.5-coder:7b",
      "label": "qwen2.5-coder:7b",
      "default": true,
      "status": "running"
    }
  ],
  "warnings": []
}
```

Catalog semantics:

- `source: dynamic` means runtime discovery succeeded for the resolved target.
- `source: config` means runtime discovery was unavailable or failed and the
  result fell back to configured target metadata.
- `source: static` means the runtime used a curated compatibility table.
- `cache` is present only for `dynamic` results. Config/static fallbacks return
  `cache: null`.
- `warnings` stays empty on clean discovery, and becomes additive when the
  runtime had to degrade gracefully. For example, dynamic discovery may still
  return `source: dynamic` with warnings if a secondary probe such as Ollama's
  running-model check fails, while a full discovery failure falls back to
  `config` or `static` with a warning instead of returning an empty success.
- `models[].status` is additive runtime metadata. Current values are:
  `running` for models that the runtime knows are already warm/loaded,
  `available` for dynamically discovered but not currently warm models, and
  `configured` when the runtime injected the configured default into the result
  because discovery did not report it.

Error semantics:

- Unknown providers or invalid instance/target selectors return HTTP `400`.
- Resolution failures include a stable `code` field:
  `provider_not_configured`, `multiple_targets_configured`, `unknown_target`,
  `ambiguous_instance`, or `unknown_instance`.
- Unexpected runtime failures still return HTTP `500`.

The first slice supports:

- dynamic discovery for `ollama`
- dynamic discovery for `agent_sdk_bridge` targets whose adapter exposes
  `listModels()`
- static compatibility for `kiro`
- config or curated static fallback for the remaining configured providers

`GET /pool/status` returns aggregated runtime status for all active backend
managers, including `cli`, `api`, and `agent`.

`GET /discovery/status` returns background discovery policy/status metadata for
runtime-backed discovery families. It currently reports:

- `wsl`: WSL discovery policy/status for Cursor and Kiro
- `docker`: Docker discovery policy/status for Docker-backed native discovery targets

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
- `GET /health` now exposes startup metadata so local supervisors can confirm
  mode, PID, and bound address over the HTTP boundary
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
  file providers may use Linux-style paths such as `~/.codex/sessions`; the
  runtime translates them to host-readable `\\wsl$\Distro\...` paths
  automatically
- API-key and Ollama execution now live under `src/backends/api` without
  requiring a second inbound service
- External agent runtimes such as OpenClaw now live under
  `src/backends/agent` while preserving the same session API
- Runtime-managed session history now carries reusable bootstrap/output fields
  such as `sessionKey`, `instructions`, `context`, `outputDir`, and surfaced
  `artifacts`

---

*Last updated: 2026-03-21*
