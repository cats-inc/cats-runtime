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
  "summary": "Runtime is ready to accept requests.",
  "timestamp": "2026-03-11T12:34:56.000Z",
  "version": "<package-version>",
  "contract": {
    "startup": 1,
    "diagnostics": 1,
    "supportedModes": ["standalone", "app-managed"],
    "readinessPath": "/health",
    "lifecycleEvents": [
      "runtime.ready",
      "runtime.startup_error",
      "runtime.stopping",
      "runtime.stopped"
    ],
    "shutdownSignals": ["SIGINT", "SIGTERM"],
    "shutdownReasons": ["sigint", "sigterm", "stdin_closed"],
    "endpoints": {
      "health": "/health",
      "runtime": "/diagnostics/runtime",
      "providers": "/diagnostics/providers",
      "summary": "/diagnostics/health"
    }
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
  },
  "shutdown": {
    "signals": ["SIGINT", "SIGTERM"],
    "reasons": ["sigint", "sigterm", "stdin_closed"],
    "stdinCloseEnabled": false
  }
}
```

`readiness.ready` is the authoritative startup result for both standalone and
app-managed modes. Hosts should not infer readiness from process creation
alone. `startup.phase` is one of `starting`, `ready`, `stopping`, or `stopped`.
`status` is `ok`, `degraded`, or `unavailable` and reflects the current
runtime phase truthfully, while `shutdown.stdinCloseEnabled` tells packaged or
host-managed callers whether closing child stdin is part of the supported
shutdown contract.

Compatibility note: older consumers may have treated top-level `/health`
`status` as effectively always `ok` once the process existed. That is no longer
safe. `status` is now phase-aware (`starting` / `stopping` => `degraded`;
`stopped` => `unavailable`). Use `readiness.ready` as the authoritative
machine-readable readiness bit, and use `startup.phase` when the caller needs
lifecycle-aware supervision or UI state.

### Runtime Diagnostics

```text
GET /diagnostics/health
GET /diagnostics/runtime
GET /diagnostics/providers
```

`GET /diagnostics/health` is the machine-readable aggregate for packaged hosts,
desktop shells, and the embedded dashboard. It combines:

- runtime readiness and startup/shutdown contract metadata
- a light provider-health summary over each provider's default target, suitable
  for polling and compatibility-aware setup UX
- per-provider default target highlights so hosts do not need to stitch
  `/health` and `/diagnostics/providers` together themselves
- aggregate status semantics where partial provider outages are reported as
  `degraded`; `unavailable` is reserved for runtime outages or cases where
  every default provider target is unavailable

`GET /diagnostics/health?force=1` refreshes cached CLI compatibility assessments
for default targets before recomputing the aggregate summary. `true` and
`refresh` are accepted aliases for `1`.

`GET /diagnostics/runtime` returns the frozen startup contract that hosts should
integrate against:

- startup contract version
- diagnostics contract version
- supported startup modes
- authoritative readiness path
- lifecycle event names
- supported shutdown signals/reasons
- listener and local-state path resolution, including the compatibility
  evidence directory
- full `metering` state:
  - `summary`: aggregate status/counts
  - `usage`: totals plus `byProviderInstance` / `bySession`
  - `incidents`: recent incident evidence plus active provider-instance guardrails
  - `guardrails`: configured thresholds/cooldowns plus currently active outcomes

`GET /diagnostics/providers` returns the runtime-owned provider availability
surface for hosts and dashboards. The response includes:

- the active probe mode (`light` or `live`)
- optional forced-refresh semantics for cached CLI compatibility assessments
- aggregate summary status and counts
- per-target `availability.status` (`ok`, `degraded`, `unavailable`)
- per-target CLI `setup` summaries with machine-readable:
  - install metadata (`installerId`, method, platform, command, docs/hints)
  - install prerequisites (`bash`, `curl`, `node`, `npm`) for the target
    execution environment
  - command resolution status (`ready`, `missing_install`, `missing_path`,
    `misconfigured_command`, `probe_failed`)
  - shell PATH persistence status for runtime-owned `.local/bin` /
    `.npm-global/bin` layouts
  - npm prefix status for npm-global providers when the runtime has an expected
    baseline
  - auth status (`not_required`, `missing`, `unknown`)
  - version status (`ready`, `unsupported`, `unknown`)
  - additive `remediation` steps that hosts can surface directly
- per-target CLI `compatibility` summaries with:
  `classification`, `status`, `summary`, `checkedAt`, selected `profile`,
  version/runtime `fingerprint`, additive `warnings`, and optional `evidence`
  artifact metadata
- lightweight config/command/path checks
- sanitized env-variable presence metadata
- target-level diagnostics details for CLI, API/local, and agent backends

`GET /diagnostics/providers?probe=live` enables live probes where the current
runtime backend supports them. Today that is primarily useful for selected
agent-backed targets; API/local targets still report light diagnostics only.
`force=1|true|refresh` can be combined with either probe mode to bypass the CLI
compatibility cache after a provider install or upgrade.

`GET /diagnostics/health` now also includes a compact top-level `metering`
summary so hosts can poll one route for both provider readiness and
execution-guardrail state.

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
POST   /sessions/{id}/cancel
POST   /sessions/{id}/reset
POST   /sessions/{id}/resume
POST   /sessions/{id}/fork
DELETE /sessions/{id}
GET    /sessions/{id}/history
GET    /sessions/{id}/observe
GET    /sessions/{id}/stream
```

### Wakeups

```text
GET  /wakeups
GET  /wakeups/{id}
POST /wakeups
POST /wakeups/{id}/cancel
POST /wakeups/{id}/trigger
```

Create example:

```json
{
  "reason": "wake boss cat for reopened chat",
  "target": {
    "kind": "session",
    "sessionId": "session-123"
  },
  "scheduleAt": "2026-03-23T12:00:00.000Z",
  "coalesceKey": "chat:room-123:boss",
  "metadata": {
    "chatId": "room-123",
    "participantId": "boss-cat"
  }
}
```

First-slice wakeups are intentionally lightweight:

- `target.kind` currently supports only `session`
- the runtime stores requests durably and replays due scheduled wakeups after restart
- explicit `(target.sessionId, coalesceKey)` matches coalesce into one scheduled request
- exact unkeyed duplicates are rejected with `409`
- `POST /wakeups/{id}/trigger` may return a terminal `failed` request with
  `lastExecution.error` when the wake attempt could not resume or attach the
  target session

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

Skill-enabled create example:

```json
{
  "provider": "codex",
  "workspaceMode": "isolated",
  "skills": {
    "profileId": "boss_web_room",
    "requestedSkills": ["companion", "repo-maintainer"],
    "context": {
      "catId": "cat-1",
      "roomMode": "direct_cat_chat",
      "transport": "web"
    }
  }
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

`GET /sessions` now returns a compact session read model that includes:

- persisted branch observability (`lineage` / `transplant`)
- additive runtime `inspection` state for current/last run, wake reason,
  metering, recent events, and action affordances

Branch capability truth is still skipped by default for list responses. Callers
can opt in with `?branching=full`. Detail surfaces such as
`GET /sessions/{id}`, `GET /sessions/{id}/lineage`, and successful
`POST /sessions/{id}/fork` responses still include full capability truth.
Other `branching` query values are ignored.

When runtime-managed skills are requested, session payloads also include a
`skills` block with:

- `requestedSkills`: explicit runtime skill ids requested by the caller
- `resolvedSkills`: validated runtime catalog entries with source/fingerprint
  metadata
- `delivery`: the runtime-selected delivery contract
  (`filesystem`, `instructions`, or `none`) plus downgrade/unsupported warnings
- `appliedSkillIds`: the subset the runtime actually attached to the session

Example shape:

```json
{
  "skills": {
    "requestedSkills": ["companion"],
    "resolvedSkills": [
      {
        "id": "companion",
        "title": "Companion",
        "description": "Core companion behavior...",
        "status": "resolved",
        "source": "runtime_catalog",
        "sourcePath": "/repo/cats-runtime/skills/companion",
        "entryFile": "/repo/cats-runtime/skills/companion/SKILL.md",
        "fingerprint": "sha256..."
      }
    ],
    "delivery": {
      "provider": "codex",
      "backend": "cli",
      "preferredMode": "filesystem",
      "mode": "filesystem",
      "status": "applied"
    },
    "appliedSkillIds": ["companion"]
  }
}
```

Session payloads now also include an additive runtime-owned `inspection` block
intended for host/dashboard run inspectors:

```json
{
  "inspection": {
    "state": "idle",
    "attached": true,
    "busy": false,
    "wake": {
      "source": "assignment",
      "reason": "follow up",
      "taskId": "task-123"
    },
    "lastRun": {
      "status": "succeeded",
      "inputPreview": "Summarize the latest draft.",
      "providerSessionId": "resp_2"
    },
    "progress": {
      "eventType": "result",
      "updatedAt": "2026-03-23T12:00:00.000Z"
    },
    "recentEvents": [
      {
        "eventType": "progress",
        "kind": "guardrail",
        "status": "warned",
        "text": "Session crossed the configured token warning threshold."
      }
    ],
    "metering": {
      "preflight": {
        "outcome": "allowed",
        "scope": "session",
        "metric": "total_tokens",
        "action": "warn"
      },
      "activeGuardrails": [],
      "recentIncidents": []
    },
    "artifacts": [],
    "services": [],
    "previewSurfaces": [],
    "actions": {
      "canClose": true,
      "canCancel": false,
      "canReset": true,
      "canRetry": true
    }
  }
}
```

`inspection.state` is runtime-owned and can differ from the persisted session
status when the runtime is actively canceling or closing a run. The block is
additive: existing session fields remain stable.

`POST /sessions` also accepts these optional fields:

- `sessionKey`: caller-visible logical session identity for explicit reuse
- `reusePolicy`: one of `create_new`, `prefer_existing`, or `require_existing`
- `instructions`: session bootstrap instructions persisted by the runtime
- `skills`: runtime-managed skill manifest with explicit `requestedSkills`
- `context`: structured invocation metadata such as task/workspace hints
- `outputDir`: output hint for reports, documents, or generated artifacts

When `reusePolicy` is `prefer_existing` or `require_existing`, the runtime will
try to attach to an existing session with the same provider target and
`sessionKey`. Today explicit `sessionKey` reuse is supported for `api`, `local`,
and `agent` sessions. Matching `cli` sessions still use the existing
`/sessions/{id}/resume` flow.

`POST /sessions/{id}/messages` accepts optional `instructions`, `skills`,
`context`, and `outputDir` fields. These are persisted onto the logical session
so later history/resume flows can observe the same bootstrap metadata.

`skills: null` explicitly clears the persisted runtime skill state for
`POST /sessions`, `POST /sessions/{id}/messages`, and
`POST /sessions/{id}/fork`.

An empty `skills.requestedSkills: []` payload is treated as a backward-compatible
no-op, the same as omitting `skills`.

`POST /sessions`, `POST /sessions/{id}/messages`, and `POST /sessions/{id}/fork`
return `400` for malformed skill payloads or unknown/invalid runtime skill
packages. When `skills.strict` is true and the target cannot honor the requested
delivery contract, the runtime returns `409`.

When a session has wakeup activity, session, history, and observe payloads also
include an additive `wakeup` block:

- `pending`: whether at least one scheduled/triggering wakeup still exists
- `pendingRequestCount`: number of open wakeups targeting this session
- `nextScheduledAt`: earliest pending scheduled timestamp, when present
- `lastRequest`: latest wake request metadata, including `status`,
  `coalescedCount`, and `lastExecution`

Before execution begins, the runtime now evaluates additive execution
guardrails:

- session token warning threshold
- session token hard block threshold
- provider-instance cooldown/block state derived from recent incidents

When a warning threshold is crossed, the stream starts with a normalized
`progress` event carrying `metadata.kind: "guardrail"` and the machine-readable
`metadata.guardrail` payload. When execution is blocked before the turn starts,
`POST /sessions/{id}/messages` returns:

- `403` with `code: "guardrail_blocked"` for hard blocks
- `429` with `code: "guardrail_cooldown"` for active cooldowns

Example cooldown response:

```json
{
  "error": "Execution cooled down because claude/main hit rate_limited.",
  "code": "guardrail_cooldown",
  "guardrail": {
    "outcome": "cooldown",
    "scope": "provider_instance",
    "metric": "rate_limit_incidents",
    "action": "cooldown",
    "provider": "claude",
    "instance": "main",
    "backend": "api",
    "observedAt": "2026-03-23T12:00:00.000Z",
    "cooldownUntil": "2026-03-23T12:01:00.000Z",
    "reason": "Execution cooled down because claude/main hit rate_limited."
  }
}
```

`POST /sessions/{id}/fork` accepts optional branching fields:

- `mode`: `auto`, `native_fork`, or `context_transplant`
- `provider` / `instance`: child provider target override
- `model`, `cwd`, `workspaceMode`, `permissionMode`, `allowedTools`
- `instructions`, `skills`, `context`, `outputDir`
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

Streamed message output may include `tool_use`, `tool_result`, and `progress`
events in addition to `init`, `text`, `result`, and `error`.

`progress` is now the runtime-owned provider-agnostic mid-turn status contract
across CLI and API/local transports. It is intended for upper layers that
should not need to inspect provider-specific raw payloads just to surface
runtime status. Example:

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

Shared progress metadata fields:

- `metadata.kind`: stable runtime progress category
- `metadata.status`: additive lifecycle/status hint
- `metadata.source`: `runtime` or `provider`
- `metadata.provider` / `metadata.backend` / `metadata.instance`: resolved target identity
- `metadata.native`: optional provider-native detail
- `metadata.incident`: optional machine-readable incident payload
- `metadata.guardrail`: optional machine-readable guardrail outcome

Current normalized progress kinds:

- `status`: generic session/status checkpoints
- `plan`: planning/milestone checkpoints
- `reasoning`: provider-reported reasoning or thinking updates
- `tool`: tool execution lifecycle
- `command`: command execution lifecycle
- `files`: file edit/read milestone
- `provider_cache`: provider-native continuation or cache lifecycle such as
  OpenAI `previous_response_id` reuse/fallback or Gemini cached-content
  create/reuse/fallback
- `model_state`: local-model lifecycle hints such as Ollama `keep_alive`
  requests
- `guardrail`: runtime-owned warning/block/cooldown checkpoints
- `session`: provider session lifecycle checkpoints

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
  },
  "inspection": {
    "state": "idle",
    "lastRun": {
      "status": "succeeded"
    }
  },
  "skills": {
    "requestedSkills": ["companion"],
    "appliedSkillIds": ["companion"],
    "delivery": {
      "mode": "instructions",
      "status": "applied"
    }
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

`GET /sessions/{id}/observe` returns a machine-readable run-inspection snapshot
without requiring a live stream connection. When wakeups exist for the session,
the same additive `wakeup` block returned by `GET /sessions/{id}` and
`GET /sessions/{id}/history` is also included:

```json
{
  "session": {
    "id": "session-123",
    "providerName": "claude",
    "wakeup": {
      "pending": true,
      "pendingRequestCount": 1,
      "nextScheduledAt": "2026-03-23T12:05:00.000Z"
    },
    "inspection": {
      "state": "running"
    }
  },
  "historyPath": "/sessions/session-123/history",
  "observePath": "/sessions/session-123/observe",
  "stream": {
    "path": "/sessions/session-123/stream",
    "available": true
  }
}
```

`POST /sessions/{id}/cancel` is additive and attempts to stop the current run
without deleting the logical session. `POST /sessions/{id}/reset` clears
provider resume/session state so the next `resume` starts from a fresh backend
attachment while keeping the runtime-owned session record and history. Reset
also clears any scheduled wakeups targeting that session so stale wake requests
do not survive after provider resume state is discarded.

`DELETE /sessions/{id}` also clears any persisted wakeups targeting that
session before the runtime unregisters it.

`GET /providers/config` returns the configured provider topology for dashboards
or other clients that need to offer provider-instance selection. Each instance
entry includes its backend kind (`cli`, `api`, `local`, or `agent`) plus any
transport or runtime metadata that applies to that backend.

For CLI backends, instance entries also expose runtime-owned `install` metadata
even before a probe has run. The `install` object includes:

- resolved execution platform (`windows`, `macos`, `linux`)
- provider family / binary name
- install prerequisites for the target runtime
- installer metadata (`installerId`, method, command, docs URL, restart hints)
- auth expectations (`requiredAfterInstall`, suggested env vars, interactive hint)
- PATH hints plus shell-persistence expectations for the target execution
  environment
- npm-global package / prefix hints where that provider family uses npm delivery

These install/setup fields are owned directly by `cats-runtime`; hosts do not
need `environment-bootstrap` present at runtime to read or act on them.

CLI entries also expose cached `compatibility` metadata once that target has
been primed by diagnostics or execution. When present, the compatibility object
mirrors the diagnostics summary view:

- `classification` and `status`
- `summary` and `checkedAt`
- selected compatibility `profile`
- version/runtime `fingerprint`
- additive `warnings`
- optional `evidence` artifact metadata for degraded or failed probes

Targets that have not been probed yet, plus non-CLI backends, return
`compatibility: null`. Non-CLI backends also return `install: null`.

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

*Last updated: 2026-03-23*
