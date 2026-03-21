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
  "contract": {
    "startup": 1,
    "readinessPath": "/health",
    "lifecycleEvents": [
      "runtime.ready",
      "runtime.startup_error",
      "runtime.stopping",
      "runtime.stopped"
    ]
  },
  "readiness": {
    "endpoint": "/health",
    "authoritative": true,
    "readySignal": "http",
    "phase": "ready",
    "ready": true
  },
  "startup": {
    "contractVersion": 1,
    "mode": "standalone",
    "phase": "ready",
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

`readiness.ready` is the authoritative startup result for both standalone and
app-managed modes. Hosts should not infer readiness from process creation
alone. `startup.phase` is one of `starting`, `ready`, `stopping`, or `stopped`.

### Runtime Diagnostics

```text
GET /diagnostics/runtime
GET /diagnostics/providers
```

`GET /diagnostics/runtime` returns the frozen startup contract that hosts should
integrate against:

- startup contract version
- supported startup modes
- authoritative readiness path
- lifecycle event names
- listener and local-state path resolution

`GET /diagnostics/providers` returns the runtime-owned provider availability
surface for hosts and dashboards. The response includes:

- per-target `availability.status` (`ok`, `degraded`, `unavailable`)
- lightweight config/command/path checks
- sanitized env-variable presence metadata
- target-level diagnostics details for CLI, API/local, and agent backends

`GET /diagnostics/providers?probe=live` enables live probes where the current
runtime backend supports them. Today that is primarily useful for selected
agent-backed targets; API/local targets still report light diagnostics only.

### App-Managed Lifecycle Events

When started with `--startup-mode app-managed --ready-output json`, the runtime
emits single-line JSON lifecycle events on stdout/stderr:

- `runtime.ready`: bind succeeded; use `healthUrl` and then `GET /health`
- `runtime.startup_error`: startup failed before readiness
- `runtime.stopping`: graceful shutdown started
- `runtime.stopped`: graceful shutdown finished

For portable host-controlled shutdown, close the child stdin stream. `SIGINT`
and `SIGTERM` are also handled where the host platform delivers them reliably.

### Delivery

```text
POST /delivery/audit
POST /delivery/artifacts/publish
POST /delivery/repo/status
POST /delivery/repo/commit
POST /delivery/repo/push
```

These routes are runtime-owned executable delivery primitives. They execute or
inspect delivery actions, but they do not decide product-level delivery policy.

Shared response fields:

- `action`: normalized delivery action id
- `state`: `ready`, `blocked`, `unsupported`, `degraded`, or `completed`
- `contract`: explicit `preview` / `apply` mode plus `applyDecision`
- `authorization` / `approval`: approval-aware apply metadata for hosts
- `capabilities`: machine-readable artifact/repo/push/preview capability truth
- `blockedReasons`: structured blocking reasons
- `capabilityGaps`: structured degraded/unsupported gaps
- `warnings`: additive warnings
- `repo`: normalized repository inspection metadata
- `artifacts`: publication/export records when relevant
- `previewSurfaces`: normalized preview-capable surface metadata

Mutating actions (`publish`, `commit`, `push`) default to preview. Send
`"apply": true` plus runtime-visible approval context such as
`"actorRole": "boss_cat"` when the host wants the runtime to perform the
mutation.

Delivery audit example:

```json
{
  "workspacePath": "C:/repo",
  "artifacts": [
    {
      "id": "report",
      "path": "artifacts/report.html",
      "mediaType": "text/html"
    }
  ],
  "services": [
    {
      "id": "preview",
      "name": "preview",
      "url": "http://127.0.0.1:4173"
    }
  ]
}
```

Commit preview example:

```json
{
  "workspacePath": "C:/repo",
  "repo": {
    "message": "feat: finalize runtime delivery contract"
  }
}
```

`create-commit` only stages files when the caller explicitly sends
`"repo": { "stageAll": true }`. Without that flag, apply uses only the
already-staged index.

Push apply example:

```json
{
  "workspacePath": "C:/repo",
  "apply": true,
  "actorRole": "boss_cat",
  "repo": {
    "remote": "origin",
    "branch": "main",
    "setUpstream": true
  }
}
```

### Sessions

```text
GET    /sessions
POST   /sessions
GET    /sessions/{id}
GET    /sessions/{id}/lineage
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

Branching example:

```json
{
  "mode": "auto",
  "provider": "gemini",
  "instructions": "Child branch should focus on verification.",
  "context": {
    "labels": ["branch", "verification"]
  },
  "transplant": {
    "summary": "Parent branch already prepared the implementation diff.",
    "labels": ["handoff"]
  }
}
```

`POST /sessions/{id}/messages` supports:

- `Accept: text/event-stream`
- `Accept: application/x-ndjson`

Session responses also include `workspaceKey`, a normalized grouping key for
workspace-aware UIs. When a provider exposes multiple configured instances,
session payloads also include `providerInstanceId`. Windows-style paths are
case-folded in `workspaceKey` while `cwd` remains the original display path.
API-backed and local-model sessions also include `providerBackend`. Branch-aware
session payloads now also include a `branching` block:

```json
{
  "branching": {
    "capabilities": {
      "nativeFork": {
        "supported": true,
        "compatible": true,
        "available": true
      },
      "contextTransplant": {
        "supported": true
      }
    },
    "lineage": {
      "rootSessionId": "session-root",
      "parentSessionId": "session-parent",
      "branchMode": "context_transplant",
      "parentProvider": "codex",
      "childProvider": "gemini",
      "createdAt": "2026-03-21T17:00:00.000Z",
      "depth": 1,
      "chain": [
        { "sessionId": "session-parent", "provider": "codex" },
        { "sessionId": "session-child", "provider": "gemini" }
      ]
    },
    "transplant": {
      "summary": "Parent branch already prepared the implementation diff.",
      "labels": ["handoff"]
    }
  }
}
```

`branching.capabilities.nativeFork` is the runtime-owned capability truth for a
same-target child branch from the current session. `available: false` means the
runtime already knows native fork cannot be honored from this parent, and
`reason` explains why when relevant.

`GET /sessions` now keeps list serialization cheap by default: it includes
persisted branch observability (`lineage` / `transplant`) but skips capability
resolution unless the caller opts in with `?branching=full`. Detail surfaces
such as `GET /sessions/{id}`, `GET /sessions/{id}/lineage`, and successful
`POST /sessions/{id}/fork` responses still include full capability truth.
Other `branching` query values are ignored.

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

`POST /sessions/{id}/fork` accepts optional branching fields:

- `mode`: `auto`, `native_fork`, or `context_transplant`
- `provider` / `instance`: child provider target override
- `model`, `cwd`, `workspaceMode`, `permissionMode`, `allowedTools`
- `instructions`, `context`, `outputDir`
- `transplant`: curated handoff bundle for `context_transplant`

`mode: "auto"` prefers `native_fork` when the child target is compatible with
the parent provider/backend/instance/workspace and the underlying provider
supports native fork semantics. Otherwise it falls back to
`context_transplant` and returns a warning describing why the fallback was
chosen.

Successful fork responses now also include a machine-readable `branch` result:

```json
{
  "branch": {
    "requestedMode": "auto",
    "resolvedMode": "context_transplant",
    "fallbackApplied": true,
    "fallbackReason": "provider override requires context_transplant",
    "target": {
      "provider": "gemini",
      "backend": "cli",
      "instance": "default"
    },
    "capabilityTruth": {
      "nativeFork": {
        "supported": true,
        "compatible": false,
        "available": false,
        "errorKind": "target_incompatible",
        "reason": "provider override requires context_transplant"
      },
      "contextTransplant": {
        "supported": true
      }
    },
    "transplant": {
      "provided": true,
      "source": "merged",
      "summaryPresent": true,
      "checkpointPresent": false,
      "transcriptExcerptCount": 0,
      "structuredBlockCount": 0,
      "artifactCount": 0,
      "labels": ["handoff"]
    }
  }
}
```

If `mode: "native_fork"` is explicitly requested and cannot be honored, the
runtime returns the usual error payload plus the same `branch` object with
`resolvedMode` omitted and `branch.error.kind` populated. Hosts can use that
branch object to surface the exact compatibility/fallback reason without
re-implementing provider logic.

Session payloads still expose the current session's machine-readable `lineage`
object at top level for compatibility:

```json
{
  "lineage": {
    "rootSessionId": "session-root",
    "parentSessionId": "session-parent",
    "branchMode": "context_transplant",
    "parentProvider": "codex",
    "childProvider": "gemini",
    "createdAt": "2026-03-21T17:00:00.000Z",
    "depth": 1,
    "chain": [
      { "sessionId": "session-parent", "provider": "codex" },
      { "sessionId": "session-child", "provider": "gemini" }
    ]
  }
}
```

For `context_transplant`, `cats-runtime` creates a fresh child session and
persists the handoff bundle as runtime-visible branch metadata plus child
bootstrap instructions. The runtime does not decide product-level branch
convergence or scheduling policy.

`GET /sessions/{id}/lineage` provides lineage inspection/observability across
the current registry:

```json
{
  "session": { "...": "serialized session payload" },
  "rootSessionId": "session-root",
  "parentSessionId": "session-parent",
  "ancestors": [
    {
      "sessionId": "session-root",
      "provider": "codex",
      "presentInRegistry": true
    }
  ],
  "children": [
    {
      "id": "session-child",
      "providerName": "gemini",
      "branchMode": "context_transplant",
      "relativeDepth": 1
    }
  ],
  "descendants": [
    {
      "id": "session-child",
      "providerName": "gemini",
      "branchMode": "context_transplant",
      "relativeDepth": 1
    },
    {
      "id": "session-grandchild",
      "providerName": "claude",
      "branchMode": "context_transplant",
      "relativeDepth": 2
    }
  ]
}
```

`ancestors` is derived from stored lineage chain metadata, so
`presentInRegistry: false` is possible when an ancestor is no longer retained
locally. `children` and `descendants` are current-registry views and therefore
only include sessions the runtime still knows about.

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

The shared local tool runtime now also exposes headless workspace substrate
operations for API/local sessions:

- `audit-workspace`
- `init-workspace`
- `update-workspace`
- `audit-delivery-target`
- `publish-artifacts`
- `inspect-repo-status`
- `create-commit`
- `push-branch`

These operations return structured JSON plans/results with:

- `contract`: explicit preview/apply mode, `applyRequested`, `applyDecision`,
  and whether the operation is read-only
- `actions`: machine-readable plan steps including `outputPath`,
  `mergeStrategy`, hashes, unified diff text, and `diffStats`
- `plan`: summary-level `changedPaths`, `pendingApprovalPaths`,
  `reviewCopyPaths`, and an approval-friendly `applyPayload` for mutable
  operations
- `approval`: runtime-owned authorization metadata for hosts or skills without
  hard-coding product approval UX
- `previewSurfaces`: normalized preview-capable service/artifact metadata for
  later host-side rendering or fallback UX

Behavioral boundaries:

- Preview is the safe default for `init-workspace` and `update-workspace`.
- Preview is also the safe default for `publish-artifacts`, `create-commit`,
  and `push-branch`.
- `create-commit` does not implicitly stage workspace changes. Hosts must opt in
  with `repo.stageAll: true` if they want the runtime to run `git add -A`
  before commit.
- Preview results may still report `plan.requiresApproval` / `approval.required`
  to describe whether a later mutable apply would need authorization. This is
  prospective approval metadata only; preview itself never writes.
- `audit-workspace` is always read-only. Sending `apply: true` returns
  `contract.applyDecision: "read_only_operation"` and writes nothing.
- `audit-delivery-target` and `inspect-repo-status` are always read-only.
- `publish-artifacts`, `create-commit`, and `push-branch` return machine-
  readable `blockedReasons` / `capabilityGaps` instead of assuming the host
  always has repo or preview support.
- Conflicting existing files are not overwritten. The plan uses
  `write_sidecar` steps and `*.bootstrap` review copies instead.
- `cats-runtime` owns execution primitives only. Product shells and Boss Cat
  flows still own approval UX, policy, and follow-on orchestration.

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

*Last updated: 2026-03-22*
