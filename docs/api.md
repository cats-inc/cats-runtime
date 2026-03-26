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

Peer-to-peer execution uses a separate auth boundary. `POST /peer/executions`
does not use `CATS_RUNTIME_API_KEY`; runtime peers authenticate with:

```bash
Authorization: Bearer <cats-runtime-peer-shared-secret>
x-cats-peer-id: <caller-peer-id>
x-cats-peer-timestamp: <unix-ms>
x-cats-peer-nonce: <uuid-or-random-token>
x-cats-peer-signature: sha256=<hmac-of-raw-json-body>
```

Peer auth/trust notes:

- `CATS_RUNTIME_API_KEY` is for host-to-runtime calls and is not consulted by
  `/peer/executions`
- `CATS_RUNTIME_PEER_SHARED_SECRET` is the current runtime-to-runtime auth
  credential used for outbound calls and the primary inbound credential
- `CATS_RUNTIME_PEER_SHARED_SECRETS` can add overlap-window inbound secrets so
  mesh-wide secret rotation does not require one coordinated cutover
- use a strong random secret, preferably at least 32 characters
- trust is directional via each runtime's `trustedPeerIds` / `rejectedPeerIds`
- the current `/peer/executions` request body is HMAC-signed with
  `x-cats-peer-signature`, which now binds the raw JSON body plus
  `x-cats-peer-timestamp` and `x-cats-peer-nonce`; the wire format is strictly
  `sha256=<64-lowercase-hex>`
- one-way traffic is supported, but it still needs configuration on both sides:
  the caller must trust the callee for routing, and the callee must trust the
  caller for inbound execution
- for small LAN mesh deployments, the practical bootstrap today is usually one
  shared secret reused across participating peers plus explicit peer-id trust
  policy on each node
- the runtime now supports additive overlap windows for inbound peer auth: keep
  the new primary secret in `CATS_RUNTIME_PEER_SHARED_SECRET` and list older
  still-accepted secrets in `CATS_RUNTIME_PEER_SHARED_SECRETS`
- v0 now includes bounded nonce/timestamp replay resistance on
  `POST /peer/executions`, but it still does not add per-peer credentials;
  operators should treat this as a trusted-LAN or externally TLS-protected
  transport

## Core Endpoints

### Dashboard

```text
GET /
GET /playground
POST /mcp
stdio: cats-runtime-mcp
```

`GET /` returns the embedded `cats-runtime` dashboard HTML.

`GET /playground` returns the embedded multi-agent playground HTML. The page
hosts a browser-side orchestration sample that talks directly to the existing
same-origin runtime APIs. When inbound auth is enabled, the page itself remains
public, but the user must enter a bearer token in the playground UI before it
can call protected routes such as `GET /providers/{provider}/models` or session
mutation endpoints.

`POST /mcp` exposes the runtime-owned MCP facade over HTTP JSON-RPC.
`cats-runtime-mcp` exposes the same tool plane over stdio for external MCP
hosts. This slice is additive: direct runtime APIs remain the primary app
boundary, while MCP is the curated tool surface for orchestrator-style agents.

Supported JSON-RPC methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `notifications/initialized`

Current curated tools:

- `runtime_summary`
- `list_sessions`
- `provider_diagnostics`
- `observe_session`
- `list_runtime_skills`
- `create_session`
- `send_message`
- `fork_session`
- `close_session`
- `reset_session`
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
- `close_browser_session`
- `cleanup_browser_sessions`
- `audit_workspace`
- `init_workspace`
- `audit_delivery_target`
- `commit_changes`
- `audit_review_target`
- `open_pull_request`
- `inspect_pull_request`
- `wait_review_checks`
- `audit_deployment_target`
- `create_deployment`
- `inspect_deployment`
- `read_deployment_logs`

`list_runtime_skills` reuses the same runtime-owned skill catalog contract as
`GET /skills/catalog`, including lightweight filtering across stable metadata,
tags, delivery hints, additive `sortBy` / `sortDirection`, and additive
`offset` / `limit` pagination.

`provider_diagnostics` reuses the same runtime-owned readiness/remediation
contract as `GET /diagnostics/providers`, including additive `probe` (`light`
or `live`), `provider` / `backend` / `instance` / `defaultOnly` target
filters, and `forceRefresh` semantics for cached compatibility assessments.

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

Successful tool calls return short human `content` plus machine-readable
`structuredContent`. Session and delivery mutations route into the same runtime
contracts already exposed over direct HTTP. `init_workspace` remains preview by
default unless callers explicitly request `apply: true`.

For stdio hosts, start:

```text
cats-runtime-mcp
```

or for an unpackaged local build:

```text
node dist/bin/mcp.js
```

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
    "bootstrapRequired": false,
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

`startup.bootstrapRequired` indicates whether the runtime is in bootstrap mode.
When `true`, the runtime needs provider setup before normal operation. Session
and execution routes return `409` with `{"error": "runtime_bootstrap_required"}`
until bootstrap completes.

### Bootstrap Mode

The runtime enters bootstrap mode when:

- No valid `providers.yaml` exists at the resolved config path
- The config file exists but cannot be parsed
- The config is valid but contains no usable provider targets
- The operator passes `--bootstrap` on the command line

In bootstrap mode:

- `GET /` serves the provider setup page instead of the dashboard
- `GET /setup` always serves the provider setup page regardless of mode
- `GET /dashboard` always serves the dashboard regardless of mode
- `GET /playground` remains available
- Session, message, and execution routes return `409 Conflict`

### Provider Setup

```text
GET  /setup-state
POST /setup-scan
POST /setup-apply
```

`GET /setup-state` returns the current setup state, latest scan
snapshot, provider universe (known provider families), and latest manual scan
snapshot. Response shape:

- `bootstrapRequired` — whether the runtime is in bootstrap mode
- `state` — setup workflow state (`status`, `lastScanAt`, `lastManualScanAt`, `appliedAt`, `appliedConfigPath`, `error`)
- `scan` — latest scan snapshot (auto or manual), or `null` if no scan has been run
  - `scannedAt`, `scanType`, `providerCount`, `availableCount` — summary fields
  - `providers` — full `ProviderScanEntry[]` with per-provider `commandStatus`, `commandPath`, `version`, `authStatus`, `available`, `install`, and `remediation` details
- `manualScan` — latest explicit manual scan snapshot (`BootstrapScanResult` with full provider detail), or `null` if no manual scan has been run
- `universe` — known provider families with `provider`, `familyLabel`, and `binaryName`
- `repair` — shared runtime-owned repair summary for dashboard/provider-setup follow-through
  - `status` — `ready`, `scan_required`, or `attention_required`
  - `preferredScan` — which persisted snapshot currently drives repair guidance (`scan`, `manualScan`, or `none`)
  - `providersReadyToApply` — compact list of currently ready provider ids/families that can be passed directly to `POST /setup-apply`
  - `providersNeedingAttention` — compact list of provider ids/families that still need repair, including bounded `remediationPreview`
  - `nextAction` — operator-facing runtime action metadata such as `run_manual_scan`, `apply_config`, or `review_remediation`
  - `actions` — ordered runtime-owned follow-up actions using the existing setup/diagnostics routes, including ready-to-send request bodies where the runtime can supply them honestly
- `diagnostics.latestReport` — latest persisted setup diagnostic report summary when a setup report artifact already exists
    - includes `artifactId`, `artifactPath`, `generatedAt`, summary `status`, `issueCounts`, and a short `headline`

Both `scan.providers` and `manualScan` expose the full persisted scan data so
that UI consumers (dashboard, provider-setup) can render provider status without
forcing a fresh scan on page load.

`/setup-*` API routes go through global bearer auth.  When
`CATS_RUNTIME_API_KEY` is set, callers must provide a valid token even during
bootstrap.  The dashboard, playground, and provider-setup page each expose
their own API key input and do not persist the key across pages.

`POST /setup-scan` triggers a provider scan. Pass `{"manual": true}`
in the body for an explicit manual scan. Returns scan results with per-provider
readiness, version, auth status, and remediation hints.

`POST /setup-apply` accepts `{"providers": ["claude", "codex", ...]}`
and writes a minimal `providers.yaml` with only the selected providers. On
success the runtime exits bootstrap mode in-process and session routes become
available. If config reload fails after writing the file, the route returns
`500`, bootstrap mode stays active, and normal session routes remain blocked.

Setup artifacts are persisted under `<dataDir>/setup/`:

- `setup-state.json` — resumable setup workflow state
- `provider-scan.json` — latest scan results
- `provider-manual-scan.json` — latest explicit manual scan results

### Setup Diagnostic Report

```text
POST /diagnostics/setup-report
GET  /diagnostics/setup-report/latest
```

These routes expose the first runtime-owned setup diagnostic report slice. They
are additive operator/debug surfaces and do not replace compatibility evidence
bundles or bootstrap scan snapshots.

`POST /diagnostics/setup-report` writes a redacted JSON report under
`<dataDir>/diagnostics/` and returns:

- `status: "generated"`
- `artifactPath` — absolute path to the persisted report on the local machine
- `report` — the same redacted JSON payload that was written to disk
  - `report.summary.headline` — concise operator-facing status text
  - `report.summary.highlights` — top warning/error messages, bounded for quick review

Request options:

- body: `{"refreshScan": true}` or query `?refresh=1`
  - when set, the runtime first triggers an explicit shared setup scan through
    the bootstrap service and then embeds the refreshed snapshot into the report

The report currently includes:

- runtime/platform facts such as Node version, platform, arch, and resolved
  runtime paths
- config inspection (`configPath`, parse status, usable target count)
- listener port status
- WSL/Docker discovery posture summary
- git availability summary
- shared bootstrap/setup state:
  - provider universe summary
  - configured provider/target counts
  - latest setup scan and latest manual scan snapshots
- references to the compatibility evidence directory and shared setup scan paths
- a normalized issue list with stable `code` plus `info` / `warning` / `error`
  severity

The persisted artifact is redacted for sharing by default:

- home-directory path segments are normalized
- secret-looking values and bearer tokens are redacted
- environment-variable values are reduced to safe summaries or omitted

`GET /diagnostics/setup-report/latest` returns the latest persisted report plus
its `artifactPath`, or `404 {"error":"setup_diagnostic_report_not_found"}`
when no setup report has been generated yet.

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
- runtime maintenance snapshots under `runtime.maintenance`, including:
  - `worktrees`: orphan-sweep results plus retained-session TTL diagnostics
  - `browser`: closed-session browser cleanup policy plus the last sweep result
- runtime-wide `wakeups` diagnostics, including:
  - `summary`: aggregate wakeup counts/status for polling and dashboards
  - `timer`: whether the due-wakeup loop is active plus bounded processing limits
  - `retention`: retained terminal-history limits
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
- per-target `availability.attentionCodes` for machine-readable degraded/failure
  routing
  - these are route-level diagnostics codes across the full target health view,
    so they may include setup/runtime checks beyond the compatibility engine
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
  version/runtime `fingerprint`, additive `warnings`, machine-readable
  `attentionCodes`, probe metadata (`mode`, `supportsLive`, `liveValidated`),
  cache metadata (`stale`, `ttlMs`, `ageMs`, `freshUntil`), and optional
  `evidence` artifact metadata
- per-target `reprobe` metadata describing whether `force=1` and `probe=live`
  are supported for that target
- provider-owned `config.activeConfig` metadata when the runtime can inspect a
  local provider config directly; the first slice reports Goose
  `~/.config/goose/config.yaml` state (`detected`, `partial`, `missing`,
  `invalid`) plus the inferred provider/model pair
- lightweight config/command/path checks
- sanitized env-variable presence metadata
- additive `config.tooling` summaries describing whether the target uses
  runtime-managed local tools, provider-native CLI tools, or provider-managed
  agent tooling; API/local targets include the default runtime tool profile
  before any per-session permission narrowing
- additive `config.agentRuntime` inspection metadata for agent targets,
  including adapter family, probe/model-discovery transport shape, bounded auth
  surface, provider-managed continuity, and runtime-visible capability flags
- additive `config.modelCatalog` summaries (`source`, `defaultModel`,
  `modelCount`, cache metadata when applicable, and warnings)
- additive `config.liveProbe` request/semantic metadata for API/local and
  agent targets; API/local targets include the semantic probe target, redacted
  request URL, auth application summary, and request header names, while agent
  targets now expose adapter-specific bounded truth such as OpenClaw gateway
  health snapshot counts or Agent SDK provider-registry/model visibility
- target-level diagnostics details for CLI, API/local, and agent backends

Agent targets now also include an additive `agent_runtime_contract` check. It
does not replace live health probes; it summarizes the static/runtime-owned
semantic contract that the current adapter exposes so dashboards and operators
can distinguish gateway-vs-bridge behavior even before a session is running.

`GET /diagnostics/providers?probe=live` enables live probes where the current
runtime backend supports them. For CLI targets this now validates the runtime
execution flags that `cats-runtime` actually uses when a family profile defines
a safe live probe; API/local targets with configured endpoints now also perform
bounded transport-native GET probes against provider model/catalog endpoints and
expose additive `config.liveProbe` metadata, including probe `target`,
`headerNames`, `authentication`, and additive HTTP classifications such as
`auth_required`, `auth_rejected`, `rate_limited`, `endpoint_not_found`,
`upstream_error`, and network/timeout outcomes. Agent-backed OpenClaw targets
now perform a real websocket handshake plus `health` RPC through the same
`AgentBackendManager` runtime options used for live execution instead of
reporting config-only validation, and surface additive `config.liveProbe`
snapshot fields such as advertised agent/channel/session counts. Agent SDK
bridge targets now use the same live diagnostics surface to validate
`GET /api/v1/providers` semantically, adding bounded checks for target-provider
listing plus configured-model visibility and surfacing the same provider
registry summary under `config.liveProbe`. Those same runtime-managed options
also back OpenClaw `models.list` and Agent SDK bridge provider-registry model
loading, so live diagnostics and `GET /providers/{provider}/models` can report
runtime-derived model truth instead of a config-only fallback when the remote
target exposes model discovery.
OpenAI and Anthropic probes use `GET /v1/models` against the resolved base URL,
Gemini/Google probes use `GET /v1beta/models`, and Ollama probes use
`GET /api/tags`.
Successful HTTP reachability yields `endpoint_reachable`; network/timeout
failures yield `endpoint_probe_failed`, while reachable non-2xx responses add
semantic checks such as `endpoint_auth_required`, `endpoint_auth_rejected`,
`endpoint_rate_limited`, `endpoint_not_found`, or `endpoint_upstream_error`.
HTTP-backed live probes are bounded with a 5-second timeout so stalled remote
targets degrade into diagnostics findings instead of hanging the entire route.
Live remote/agent/local diagnostics now
also try to load the runtime-owned model catalog for that target, surfacing
machine-readable checks such as `model_catalog_loaded`,
`model_catalog_warning`, `configured_model_present`,
`configured_model_missing`, or `configured_model_fallback_only` when a target
only appears usable because runtime had to inject the configured model as a
fallback.
`force=1|true|refresh` can be combined with either probe mode to bypass the CLI
compatibility cache after a provider install or upgrade.

`GET /diagnostics/providers` also accepts additive target filters:

- `provider`
- `backend=cli|api|local|agent`
- `instance`
- `defaultOnly=true|false`

These filters narrow the provider catalog before diagnostics run, so host tools
and orchestrators can inspect one target or one default-only subset without
re-filtering the full response client-side. The response now also includes:

- `query.hasFilters`
- `query.filters`

Invalid `backend` values or malformed boolean filters such as
`defaultOnly=maybe` return `400` with a client-safe `error` string.

`GET /diagnostics/health` now also includes a compact top-level `metering`
summary so hosts can poll one route for both provider readiness and
execution-guardrail state. It also includes a compact top-level `wakeups`
summary so hosts can inspect runtime-wide wakeup counts/status without a
separate `GET /wakeups` call.

### App-Managed Lifecycle Events

When started with `--startup-mode app-managed --ready-output json`, the runtime
emits single-line JSON lifecycle events on stdout/stderr:

- `runtime.ready`: bind succeeded; use `healthUrl` and then `GET /health`
- `runtime.startup_error`: startup failed before readiness
- `runtime.stopping`: graceful shutdown started
- `runtime.stopped`: graceful shutdown finished

For portable host-controlled shutdown, close the child stdin stream. `SIGINT`
and `SIGTERM` are also handled where the host platform delivers them reliably.

### Browser

```text
GET /browser/drivers
GET /browser/summary
GET /browser/sessions
GET /browser/sessions/{id}
POST /browser/sessions
POST /browser/sessions/cleanup
POST /browser/sessions/{id}/pages
POST /browser/sessions/{id}/close
```

These routes expose the first runtime-owned browser/preview substrate. The
first slice is intentionally lightweight:

- browser sessions/pages are runtime-owned records
- browser drivers are pluggable, but the first built-in driver is `manual`
- the `manual` driver does not launch or automate a real browser; it validates
  the contract for future Playwright/CDP/BrowserOS-style drivers
- browser session/page state now persists under the runtime data dir so browser
  inspection and cleanup routes survive process restart for the current driver
- background runtime maintenance now expires closed browser sessions on a TTL
  instead of relying only on explicit operator cleanup
- page bindings may be direct (`url`/`path`) or may bind to an existing runtime
  session `service` / `artifact`

Create browser session example:

```json
{
  "driverId": "manual",
  "runtimeSessionId": "session-123",
  "label": "Preview Browser"
}
```

Create browser page from a runtime service example:

```json
{
  "binding": {
    "kind": "session_service",
    "serviceId": "preview"
  }
}
```

Create browser page from an artifact example:

```json
{
  "binding": {
    "kind": "session_artifact",
    "artifactId": "report"
  }
}
```

Browser session responses include:

- `pages`: runtime-owned page records
- `inspection.driver`: machine-readable driver capability summary
- `inspection.previewSurfaces`: normalized `browser_page` surfaces aligned with
  existing session/delivery preview-surface contracts
- `GET /browser/summary`: aggregate session/page counts plus machine-readable
  cleanup candidates
- `POST /browser/sessions/cleanup`: explicit maintenance route for deleting
  closed browser sessions without waiting for capacity-pressure pruning

Browser maintenance state is also visible under `GET /diagnostics/runtime` as
`runtime.maintenance.browser`, so hosts can inspect the active TTL policy and
last sweep result without calling the browser routes directly.

`GET /browser/sessions` now also accepts optional `status=ready|closed`.

`GET /browser/summary` accepts the same `driverId`, `runtimeSessionId`, and
`status` filters as `GET /browser/sessions`, plus `olderThanMs` to preview
cleanup candidates. The response includes:

- `filters`: the applied browser-session filter block
- `sessions`: aggregate session counts (`total`, `ready`, `closed`)
- `pages`: aggregate page counts (`total`, `open`, `closed`)
- `attachedRuntimeSessionCount`: number of matching browser sessions still
  attached to a runtime session
- `drivers`: per-driver aggregate counts
- `cleanupCandidates`: closed-session candidates for explicit cleanup

`POST /browser/sessions/cleanup` accepts:

- `driverId`
- `runtimeSessionId`
- `olderThanMs`
- optional `status`, but only `closed` is accepted

The cleanup response is machine-readable and includes:

- `action: "cleanup_browser_sessions"`
- `filters`: resolved cleanup filters
- `matchedSessionCount` / `matchedPageCount`
- `removedSessionCount` / `removedPageCount`
- `removedSessionIds`
- `remainingSessionCount` / `remainingClosedSessionCount`

The first browser substrate is bounded. When the runtime reaches browser
session or per-session page capacity, create routes return `400` with a
machine-readable validation error instead of letting browser state grow
without limit.

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

Normalized preview surfaces now share one schema across delivery, session
inspection, and browser routes. `kind` may be `service`, `artifact`, or
`browser_page`; `source` may be one of the existing session/request/published
values or `browser_page`.

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

### Management

```text
POST /management/review/audit
POST /management/review/open-pr
POST /management/review/inspect
POST /management/review/wait-checks
POST /management/deployment/audit
POST /management/deployment/create
POST /management/deployment/inspect
POST /management/deployment/logs
POST /management/operations/:operationId/resume
GET  /management/diagnostics
```

These routes are runtime-owned management adapter actions for non-session
control-plane tools such as GitHub CLI and Zeabur CLI. They do not model
management CLIs as session providers and are architecturally distinct from
session backends and delivery primitives.

Shared response fields:

- `domain`: `review` or `deployment`
- `action`: normalized management action id
- `state`: `ready`, `blocked`, `unsupported`, `degraded`, or `completed`
- `contract`: explicit `preview` / `apply` mode plus `applyDecision`
- `authorization`: product-neutral `actorClass` / `approvalRef` metadata
- `blockedReasons`: structured blocking reasons
- `capabilityGaps`: missing adapter capabilities
- `warnings`: non-blocking advisory information
- `outputs`: action-specific structured output
- `previewSurfaces`: reuses `RuntimePreviewSurface` for deployment URLs
- `operation`: for long-running actions, includes `operationId` and `status`

Authorization on mutating actions (`open_pull_request`, `create_deployment`)
requires `actorClass` or `approvalRef`. Read-only actions never require
authorization.

`wait_review_checks` uses bounded long-poll: the client provides
`target.timeoutMs` (max 120000, default 30000). If checks complete within the
timeout, the result includes `state: 'completed'`. Otherwise, the response
includes an `operation` with `status: 'polling'` and an `operationId` for
resumption via `POST /management/operations/:operationId/resume`.

`GET /management/diagnostics` returns adapter readiness and install/auth
guidance. It is separate from `GET /diagnostics/providers` to avoid mixing
management adapters with AI provider-model diagnostics. Optional query
parameter `domain` filters by domain.

Management adapter configuration lives in `config/management.yaml`, separate
from `config/providers.yaml`.

### Skills

```text
GET /skills/catalog
```

This route exposes the standalone runtime-owned skill-library read model for
hosts that should not import internal runtime modules directly.

Optional query filters keep the host-facing read seam lightweight while still
supporting library lookups without importing runtime internals:

- `id`
- `family`
- `slug`
- `role`
- `packageKind`
- `capabilityTag`
- `productTag`
- `deliveryHint`
- `sortBy`
- `sortDirection`
- `offset`
- `limit`

Each filter accepts either repeated query params or comma-separated values. The
route applies OR semantics within the same filter and AND semantics across
different filters. `offset` must be an integer `>= 0`; `limit` must be an
integer `>= 1`.

The response shape is:

- `contract`: machine-readable catalog contract metadata
  - `version`: current catalog read contract version
  - `acceptedFilterEncodings`: currently `repeat` and `csv`
  - `filterSemantics`: `withinField: "or"` and `acrossFields: "and"`
  - `sorting`: accepted `sortBy` fields and `sortDirection` values
- `query`: machine-readable summary of the applied filters
  - `hasFilters`: whether the request applied any filter
  - `filters`: the non-empty filter arrays echoed back by the runtime
  - optional `sort`: the applied sort block when requested
- `count`: total number of discovered runtime-owned skill packages
- `pagination`: machine-readable paging metadata
  - `offset`: applied offset
  - `limit`: applied limit or `null`
  - `returned`: number of entries returned in `skills`
  - `hasMore`: whether additional matches remain after the current page
- `skills`: array of runtime catalog entries
- each skill entry includes stable read fields such as `id`, `slug`, `title`,
  `description`, `status`, `source`, `sourcePath`, `entryFile`, `fingerprint`,
  and `library`
- `library`: normalized runtime-owned metadata with `family`, `slug`, `role`,
  `packageKind`, `version`, `capabilityTags`, `productTags`,
  `deliveryHints`, and `recommendedCompanions`

Example response:

```json
{
  "contract": {
    "version": 1,
    "acceptedFilterEncodings": ["repeat", "csv"],
    "filterSemantics": {
      "withinField": "or",
      "acrossFields": "and"
    },
    "sorting": {
      "sortBy": ["id", "title", "family", "slug", "role"],
      "sortDirection": ["asc", "desc"]
    },
    "pagination": {
      "offset": {
        "minimum": 0
      },
      "limit": {
        "minimum": 1
      }
    }
  },
  "query": {
    "hasFilters": true,
    "filters": {
      "family": ["chat"],
      "slug": ["companion"]
    }
  },
  "count": 1,
  "pagination": {
    "offset": 0,
    "limit": null,
    "returned": 1,
    "hasMore": false
  },
  "skills": [
    {
      "id": "companion",
      "slug": "companion",
      "title": "Companion",
      "description": "Core companion chat behavior.",
      "status": "resolved",
      "source": "runtime_catalog",
      "sourcePath": "/repo/cats-runtime/skills/chat/companion",
      "entryFile": "/repo/cats-runtime/skills/chat/companion/SKILL.md",
      "fingerprint": "sha256...",
      "library": {
        "family": "chat",
        "slug": "companion",
        "role": "companion_core",
        "packageKind": "base",
        "version": "1.0.0",
        "capabilityTags": ["memory-continuity"],
        "productTags": ["cats"],
        "deliveryHints": ["filesystem", "instructions"],
        "recommendedCompanions": []
      }
    }
  ]
}
```

Invalid `family`, `packageKind`, or `deliveryHint` filters, plus malformed
`offset` / `limit` values, invalid `sortBy` / `sortDirection` values, or
`sortDirection` without `sortBy` return `400` with a client-safe `error`
string.
Unexpected catalog read failures return `500`.

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

Wakeups remain intentionally lightweight even after the recurring-schedule
slice:

- `target.kind` currently supports only `session`
- the runtime stores requests durably and replays due scheduled wakeups after restart
- explicit `(target.sessionId, coalesceKey)` matches coalesce into one scheduled request
- exact unkeyed duplicates are rejected with `409`
- optional `recurrence` currently supports only UTC five-field cron expressions
  (`{ "kind": "cron", "expression": "*/5 * * * *", "timezone": "UTC" }`)
- recurring wakeups may omit `scheduleAt`; the runtime computes the first due
  time from the cron expression and automatically re-arms the request after
  manual or timer-driven triggers
- `POST /wakeups/{id}/trigger` may return a terminal `failed` request with
  `lastExecution.error` when the wake attempt could not resume or attach the
  target session
- runtime-wide wakeup state is also visible under `GET /diagnostics/runtime`
  (`runtime.wakeups`) and `GET /diagnostics/health` (`wakeups`)

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
  "workspaceKind": "sandbox",
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

Worktree-backed create example:

```json
{
  "provider": "codex",
  "cwd": "C:/repo",
  "workspaceKind": "worktree",
  "workspaceAccess": "read_write"
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

Peer-routed message example:

```json
{
  "message": "Draft the implementation plan.",
  "routing": {
    "mode": "peer",
    "peerId": "lab-peer",
    "shareWorkspace": false
  }
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
For worktree-backed sessions, `workspaceKey` resolves from the authoritative
source workspace instead of the transient worktree path. API-backed and
local-model sessions also include `providerBackend`. Session payloads now also
carry a canonical `workspace` block plus additive legacy `workspaceIsolation`
metadata when the runtime is tracking a source, sandbox, or worktree-backed
workspace surface. Branch-aware session payloads now also include a
`branching` block:

Example `workspace` shape:

```json
{
  "workspace": {
    "kind": "worktree",
    "access": "read_write",
    "runtimeCwd": "C:/Users/example/.cats-runtime/sessions/worktrees/repo-deadbeef/session-123/packages/app",
    "sourceCwd": "C:/repo/packages/app",
    "worktree": {
      "id": "repo-session-123",
      "sourceRepoRoot": "C:/repo",
      "sourceHeadOid": "abc123",
      "sourceHeadRef": "main",
      "relativeCwd": "packages/app",
      "worktreePath": "C:/Users/example/.cats-runtime/sessions/worktrees/repo-deadbeef/session-123",
      "preparedAt": "2026-03-23T12:00:00.000Z"
    }
  }
}
```

Example `workspaceIsolation` shape:

```json
{
  "workspaceIsolation": {
    "mode": "worktree",
    "sourceCwd": "C:/repo",
    "worktree": {
      "id": "repo-session-123",
      "sourceRepoRoot": "C:/repo",
      "sourceHeadOid": "abc123",
      "sourceHeadRef": "main",
      "relativeCwd": "packages/app",
      "worktreePath": "C:/Users/example/.cats-runtime/sessions/worktrees/repo-deadbeef/session-123",
      "preparedAt": "2026-03-23T12:00:00.000Z"
    }
  }
}
```

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
- `requestedSkillRefs`: normalized request refs, including family/slug/version
  or fingerprint constraints when the caller supplied them
- `resolvedSkills`: validated runtime catalog entries with source/fingerprint
  metadata plus normalized library metadata (`family`, `slug`, `role`,
  `packageKind`, capability tags, and delivery hints)
- `delivery`: the runtime-selected delivery contract
  (`filesystem`, `instructions`, or `none`) plus downgrade/unsupported warnings
- `appliedSkillIds`: the subset the runtime actually attached to the session

Example shape:

```json
{
  "skills": {
    "requestedSkills": ["companion"],
    "requestedSkillRefs": [
      {
        "id": "companion",
        "slug": "companion",
        "requestedAs": "companion"
      }
    ],
    "resolvedSkills": [
      {
        "id": "companion",
        "slug": "companion",
        "title": "Companion",
        "description": "Core companion behavior...",
        "status": "resolved",
        "source": "runtime_catalog",
        "sourcePath": "/repo/cats-runtime/skills/chat/companion",
        "entryFile": "/repo/cats-runtime/skills/chat/companion/SKILL.md",
        "fingerprint": "sha256...",
        "library": {
          "family": "chat",
          "slug": "companion",
          "role": "companion_core",
          "packageKind": "base",
          "version": "1.0.0",
          "capabilityTags": ["memory-continuity", "emotional-awareness", "daily-presence"],
          "productTags": ["companion", "direct-chat"],
          "deliveryHints": ["filesystem", "instructions"],
          "recommendedCompanions": ["companion-gentle", "companion-mentor"]
        }
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

Session, history, and observe payloads now also include an additive
runtime-owned `hydration` block. This records how the runtime re-entered the
workspace/skill context for the current target:

- `workspace.runtimeCwd`: the actual cwd used for execution
- `workspace.kind`: the runtime-owned workspace surface (`source`, `sandbox`,
  or `worktree`)
- `workspace.access`: the agent/runtime access mode (`read_write` or
  `read_only`)
- `workspace.isolationMode`: legacy compatibility snapshot for callers still
  consuming the older isolation terminology
- `workspace.sourceCwd`: the authoritative source workspace when it differs
  from the runtime cwd
- `workspace.sourceOfTruth`: whether the runtime should treat the source
  workspace or the runtime cwd as the durable truth
- `workspace.substrate`: read-only workspace substrate audit summary for the
  authoritative workspace path
- `skills`: machine-readable summary of whether skill delivery was resolved from
  a new request or rehydrated from persisted session state, including the
  normalized requested refs, resolved skills, and applied ids

Example shape:

```json
{
  "hydration": {
    "trigger": "resume",
    "updatedAt": "2026-03-23T12:00:00.000Z",
    "workspace": {
      "isolationMode": "worktree",
      "runtimeCwd": "/tmp/cats-runtime/sessions/session-123",
      "sourceCwd": "/repo/project-a",
      "sourceOfTruth": "source_workspace",
      "substrate": {
        "auditPath": "/repo/project-a",
        "profile": "standard",
        "status": "partial",
        "checkedAt": "2026-03-23T12:00:00.000Z",
        "changedPaths": ["AGENTS.md"],
        "reviewCopyPaths": [],
        "findingCounts": {
          "missing": 1,
          "present": 2,
          "drifted": 0,
          "conflicting": 0
        }
      },
      "warnings": [
        "The runtime cwd is an isolated sandbox; re-entry should hydrate from the source workspace."
      ]
    },
    "skills": {
      "source": "session_state",
      "requestedSkills": ["companion"],
      "provider": "codex",
      "backend": "cli",
      "preferredMode": "filesystem",
      "mode": "filesystem",
      "status": "applied",
      "warnings": []
    }
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
    "maintenance": {
      "status": "attention",
      "compaction": {
        "status": "recommended",
        "reasonCodes": ["message_count_threshold", "session_active"],
        "messageCount": 32,
        "totalTokens": 14500
      },
      "hooks": {
        "preReset": {
          "available": true,
          "pending": [
            {
              "id": "memory_flush",
              "phase": "pre_reset",
              "status": "pending",
              "owner": "product_memory",
              "reason": "Export or flush durable memory before a hard reset clears the live session boundary."
            }
          ]
        },
        "preCompaction": {
          "available": true,
          "pending": [
            {
              "id": "memory_flush",
              "phase": "pre_compaction",
              "status": "pending",
              "owner": "product_memory",
              "reason": "Export or flush durable memory before compaction trims working context."
            }
          ]
        },
        "preFlush": {
          "available": true,
          "pending": [
            {
              "id": "memory_flush",
              "phase": "pre_flush",
              "status": "pending",
              "owner": "product_memory",
              "reason": "Export or flush durable memory before workspace cleanup or lifecycle flush runs."
            }
          ]
        }
      },
      "resetBoundary": {
        "status": "none",
        "reasonCodes": []
      },
      "cleanup": {
        "status": "recommended",
        "reasonCodes": ["provider_resume_state_retained"]
      },
      "lastRequest": {
        "action": "reset",
        "sessionId": "session-123",
        "requestedAt": "2026-03-24T00:10:00.000Z",
        "workspaceMode": "shared",
        "isolationMode": "worktree",
        "runtimeCwd": "C:/Users/example/.cats-runtime/sessions/worktrees/repo-deadbeef/session-123",
        "sourceCwd": "C:/Users/example/src/repo",
        "worktreePath": "C:/Users/example/.cats-runtime/sessions/worktrees/repo-deadbeef/session-123",
        "reason": "owner_requested_reset",
        "worktreeDisposition": "preserve",
        "hookPayloads": [
          {
            "kind": "memory_flush",
            "payload": {
              "scope": "summary"
            },
            "payloadStatus": "stored",
            "payloadBytes": 19
          }
        ]
      },
      "markers": []
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

`inspection.strategy` is also runtime-owned and additive. It reports the latest
requested/effective strategy plus strategy request metadata such as
`acceptanceCriteria`, `strategyContext`, and `correlation`. Its nested
`inspection.strategy.state` payload captures runtime-local preference,
resolution source, bounded step summaries, timeout/failure details, and
duplicate/stuck detection without writing strategy state back into product task
records.

For API/local sessions, `inspection.tools` is also additive and runtime-owned.
It surfaces the resolved shared-local-tool policy for the current session:

- `profile`: the resolved provider-instance tool profile (or `standard` fallback)
- `permissionMode`: the effective runtime permission mode
- `whitelistActive`: whether a session-level whitelist is constraining tools
- `allowedTools`: normalized whitelist entries when present
- `fullAccessTools`: tools currently callable without preview-only restrictions
- `previewOnlyTools`: tools callable only in safe preview mode (for example
  delivery/workspace operations with `apply: false`)
- `blockedTools`: profile tools currently blocked by the effective permission
  policy
- `counts`: bounded totals for the current profile split across full-access,
  preview-only, and blocked buckets
- `capabilities`: per-tool capability metadata including the tool domain
  (`filesystem`, `search`, `shell`, `workspace`, `delivery`, `review`, or
  `deployment`), its current access bucket, whether it remains read-only
  compatible, and whether the tool is mutating by design

`inspection.maintenance` is also runtime-owned and additive. It gives hosts one
machine-readable place to read:

- whether the session is nearing compaction territory
- whether Team 4 / product-owned `memory_flush` hooks should run before reset,
  compaction, or lifecycle flush/cleanup
- whether a hard reset boundary was applied already
- whether cleanup is merely recommended or is ready to run now
- which bounded cleanup retry path to call when worktree cleanup is ready
- the most recent maintenance trigger request, including additive hook payloads,
  workspace isolation context, and requested worktree disposition
- the most recent maintenance follow-through outcome when an external host has
  acknowledged hooks, asked for a retry, or reported completion for reset,
  cleanup, delete, or compaction boundaries
- bounded maintenance request/follow-through history so action-scoped
  acknowledgements do not get lost when later lifecycle actions write their own
  follow-through records
- the latest close/reset/delete lifecycle marker

`inspection.maintenance.status` is intentionally conservative. Active sessions
can report `compaction.status: "recommended"` without escalating the overall
maintenance status to `attention`; `attention` is reserved for retained
lifecycle boundaries, cleanup that needs operator action, or compaction that is
ready to run on an inactive session.

`inspection.maintenance.lastRequest` is the runtime-owned trigger seam for
future Team 4 flush/compaction coordination. The runtime records the request
shape, but it does not interpret product-owned payloads or make product memory
decisions for the caller. The persisted snapshot is also guardrailed:

- overlong `reason` strings are truncated and flagged with
  `reasonTruncated: true`
- sensitive hook-payload keys such as `token`, `secret`, `authorization`,
  `cookie`, or `password` are redacted before persistence
- oversized/deep payloads are truncated to bounded depth/item/key limits and
  record additive `payloadStatus`, `payloadWarnings`, and `payloadBytes`
  metadata
- if the sanitized payload still exceeds the runtime byte cap, the runtime
  omits `payload` and records `payloadStatus: "omitted"` instead of storing the
  original blob verbatim

`inspection.maintenance.lastFollowThrough` is the adjacent runtime-owned
follow-through seam for maintenance hooks. It persists the latest
`acknowledged`, `retry_requested`, or `completed` outcome reported through
`POST /sessions/{id}/maintenance/follow-through` or the compaction-specific
shortcut route, using the same truncation, redaction, and size-cap guardrails
as `lastRequest`.

`inspection.maintenance.requestHistory` and
`inspection.maintenance.followThroughHistory` are bounded additive histories of
those same sanitized request/follow-through snapshots. They let hosts inspect
action-scoped lifecycle coordination without relying on a single global
`lastRequest` / `lastFollowThrough` slot.

`POST /sessions` also accepts these optional fields:

- `sessionKey`: caller-visible logical session identity for explicit reuse
- `reusePolicy`: one of `create_new`, `prefer_existing`, or `require_existing`
- `instructions`: session bootstrap instructions persisted by the runtime
- `skills`: runtime-managed skill manifest with explicit `requestedSkills`
  where each entry may be either:
  - a plain string skill id such as `"companion"`
  - a structured ref such as
    `{ "family": "work", "slug": "product-manager", "version": "2026.03" }`
- `context`: structured invocation metadata such as task/workspace hints
- `outputDir`: output hint for reports, documents, or generated artifacts
- `requestedStrategy`: runtime-owned execution strategy hint such as `react`,
  `plan_execute`, `pdca`, `reflexion`, or `tree_of_thoughts`
- `acceptanceCriteria`: additive success / done conditions for strategy loops
- `strategyContext`: structured strategy-local inputs such as recovery hints
- `correlation`: additive correlation ids / labels for upper-layer tracing
- `workspaceKind`: one of `source`, `sandbox`, or `worktree`
- `workspaceAccess`: one of `read_write` or `read_only`
- legacy compatibility fields `workspaceMode` and `workspaceIsolation`

When `reusePolicy` is `prefer_existing` or `require_existing`, the runtime will
try to attach to an existing session with the same provider target and
`sessionKey`. Today explicit `sessionKey` reuse is supported for `api`, `local`,
and `agent` sessions. Matching `cli` sessions still use the existing
`/sessions/{id}/resume` flow.

Workspace defaults now resolve as:

- no `cwd` and no explicit workspace override: `workspaceKind: "sandbox"` plus
  `workspaceAccess: "read_write"`
- `cwd` present and no explicit workspace override:
  `workspaceKind: "source"` plus `workspaceAccess: "read_write"`
- `workspaceKind: "worktree"` requires `cwd` to point at a Git-controlled
  workspace

`workspaceKind: "worktree"` tells the runtime to execute in a Git worktree
rooted under the runtime session base dir instead of using the source workspace
path directly. The runtime persists both the transient worktree path and the
authoritative source workspace so later resume/reset/delete flows can recreate
or clean up the same worktree deterministically.

The older `workspaceMode` / `workspaceIsolation` pair is still accepted during
the migration window, but new callers should prefer `workspaceKind` /
`workspaceAccess`.

`POST /sessions/{id}/messages` accepts optional `instructions`, `skills`,
`context`, `outputDir`, additive execution-strategy fields
(`requestedStrategy`, `acceptanceCriteria`, `strategyContext`, `correlation`),
and additive `routing` fields. These are persisted onto the logical session
where applicable so later history/resume flows can observe the same bootstrap
metadata.

When no strategy hint is provided, runtime-hosted API/local loops continue to
use the compatibility `simple_tool_call` path. Explicit `react`,
`plan_execute`, `pdca`, `reflexion`, and `tree_of_thoughts` requests resolve
through runtime-hosted loops. Unsupported hints such as `deps` remain additive
request metadata but compatibility-fallback to `simple_tool_call`. Strategy
resolution is additive and currently follows
explicit request, then runtime-owned remembered preference, then the
compatibility fallback. Existing callers that do not send strategy fields
remain valid.

`routing` is additive and optional. Existing request bodies remain valid and
continue to execute locally by default. Supported routing shape:

```json
{
  "routing": {
    "mode": "peer",
    "peerId": "lab-peer",
    "strategy": "explicit",
    "shareWorkspace": false
  }
}
```

Rules:

- omit `routing`, or send `{"mode":"local"}`, to preserve the current local
  execution path
- use `peerId` for explicit peer selection
- `strategy` may be `explicit`, `provider_affinity`, or `least_busy`, but
  heuristic routing is honored only when explicitly enabled on the runtime
- peer routing is only supported for runtime-owned sessions; it does not turn a
  peer into the owner of the caller-visible `/sessions` lifecycle
- peer-routed turns remain observable through `GET /sessions/{id}/observe` and
  `GET /sessions/{id}/stream` via additive runtime-owned relay metadata

For message turns, the runtime now preserves the session's previously persisted
instructions as a separate base layer for the current execution. The current
request's `instructions` field stays turn-scoped, and instruction delivery is
composed in this order:

1. resolved runtime skill instructions
2. persisted session-level instructions
3. the current turn's explicit `instructions`

Session inspection payloads now also surface additive `browserSessions` when
runtime-owned browser sessions are associated with the same runtime session.
These browser sessions contribute normalized `browser_page` entries into the
shared `inspection.previewSurfaces` list, so upper layers can keep one preview
surface contract across artifacts, services, and browser pages.

`skills: null` explicitly clears the persisted runtime skill state for
`POST /sessions`, `POST /sessions/{id}/messages`, and
`POST /sessions/{id}/fork`.

An empty `skills.requestedSkills: []` payload is treated as a backward-compatible
no-op, the same as omitting `skills`.

`POST /sessions`, `POST /sessions/{id}/messages`, and `POST /sessions/{id}/fork`
return `400` for malformed skill payloads or unknown/invalid runtime skill
packages. When `skills.strict` is true and the target cannot honor the requested
delivery contract, the runtime returns `409`.

When the selected delivery mode is `instructions`, the runtime now applies the
same layered skill/session/turn instruction contract across Pi instruction
files, API/agent backends, and prompt-driven CLI providers. Codex can still
prefer filesystem delivery when the target/runtime shape supports it.

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
- `model`, `cwd`, `workspaceKind`, `workspaceAccess`, `permissionMode`, `allowedTools`
- `instructions`, `skills`, `context`, `outputDir`
- `transplant`: curated handoff bundle for `context_transplant`
- legacy compatibility fields `workspaceMode` and `workspaceIsolation`

When the parent session is already worktree-backed, child forks default to
`workspaceKind: "worktree"` unless the caller explicitly requests a different
workspace kind such as `sandbox`.

When a non-source child fork copies a workspace snapshot, the runtime now also
records additive `hydration.metadata.workspaceSnapshot` facts such as
`copiedFileCount`, `copiedByteCount`, `skippedGitMetadata`, `status`, and
optional `warningCodes` (for example `large_file_count` or `large_byte_count`)
so hosts can tell when fork-time copying touched a large repo. The same
metadata now also includes `plan`, which freezes the current one-shot snapshot
contract machine-readably:

- `strategy: "one_shot_snapshot"`
- `boundedSyncAvailable: false`
- `readiness: "snapshot_ok" | "follow_up_required"`
- `nextAction: "none" | "prefer_shared_or_worktree"`
- `thresholds.fileWarningCount`
- `thresholds.byteWarningCount`

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
- `strategy`: runtime-owned execution-strategy lifecycle checkpoints
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

Runtime-owned strategy loops emit additive `progress` events with
`metadata.kind: "strategy"` and statuses such as `started`, `updated`,
`completed`, or `failed`. This extends the existing stream/observe/session
surfaces instead of introducing a separate task-status bus.

Provider payload templates remain transport-specific, but the current additive
keys that `cats-runtime` recognizes are:

- Gemini cache TTL override: `cachedContentTtl`, `cached_content_ttl`,
  `contextCacheTtl`, or `context_cache_ttl`
- Ollama warm-up hint: `keep_alive` or `keepAlive`

The shared local tool runtime now also exposes headless workspace substrate
operations for API/local sessions:

- `inspect_path`
- `diff_file`
- `create_directory`

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
  "transcript": {
    "ownership": "provider",
    "source": "jsonl",
    "parser": "pi_native"
  },
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
  "hydration": {
    "trigger": "resume",
    "workspace": {
      "sourceOfTruth": "source_workspace"
    }
  },
  "inspection": {
    "state": "idle",
    "lastRun": {
      "status": "succeeded",
      "previewSurfaces": []
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

`transcript` is additive machine-readable history provenance:

- `ownership`: whether the transcript source is provider-owned, runtime-owned, or absent
- `source`: `service`, `jsonl`, `json`, or `none`
- `parser`: runtime parser/service path used to build the returned message list
- `sources`: additive per-source provenance entries when the runtime merged
  multiple transcript origins (for example a Pi-native provider transcript plus
  later runtime-managed fallback JSONL)

This makes Pi-native and other provider-native history reads easier to inspect
without forcing hosts to infer transcript semantics from provider names alone.
The same session/history/observe surfaces now also carry additive
runtime-owned strategy resolution/state metadata, so hosts do not need a
separate task-status event bus just to inspect execution-strategy state.

### Runtime Inspection

```text
GET /peers
GET /peers/{peerId}
GET /diagnostics/peers
GET /pool/status
GET /discovery/status
GET /providers/config
GET /providers/{provider}/tools
GET /providers/{provider}/models
GET /skills/catalog
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
    "hydration": {
      "trigger": "resume",
      "workspace": {
        "sourceOfTruth": "source_workspace"
      }
    },
    "wakeup": {
      "pending": true,
      "pendingRequestCount": 1,
      "nextScheduledAt": "2026-03-23T12:05:00.000Z"
    },
    "inspection": {
      "state": "running",
      "currentRun": {
        "status": "running",
        "previewSurfaces": []
      }
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

The same `session.inspection.strategy` read-model is reused by
`GET /sessions/{id}`, `GET /sessions/{id}/history`, and
`GET /sessions/{id}/observe` so strategy-local state stays inspectable through
existing surfaces.

`POST /sessions/{id}/cancel` is additive and attempts to stop the current run
without deleting the logical session. `POST /sessions/{id}/reset` clears
provider resume/session state so the next `resume` starts from a fresh backend
attachment while keeping the runtime-owned session record and history. Reset
also clears hydration and scheduled wakeups targeting that session, clears
runtime-owned browser sessions targeting that runtime session, clears stale
run/progress snapshots, and records a hard-reset lifecycle boundary so stale
wake requests and stale inspector state do not survive after provider resume
state is discarded.

`POST /sessions/{id}/reset` also accepts optional body fields:

- `requireAcknowledgedHooks?: boolean`
- `worktreeCleanupPolicy`: `discard`, `merge`, or `preserve`
- `maintenance`: additive trigger metadata with:
  - `reason?: string`
  - `hookPayloads?: Array<{ kind: string; payload?: unknown }>`

For worktree-backed sessions, `discard` removes the worktree and keeps the
source workspace untouched, while `merge` attempts to copy the worktree diff
back into the authoritative source repository before detaching the worktree.
`preserve` keeps the worktree attached to the closed session intentionally and
returns `status: "retained"` so a host/operator can handle the workspace
manually. If cleanup cannot finish safely, reset also returns
`status: "retained"` with the session snapshot still present so a host can
retry or resolve the source workspace first.

When `maintenance` is provided, the runtime records that request under
`inspection.maintenance.lastRequest` and persists it on the logical session so
later `GET /sessions/{id}`, `GET /sessions/{id}/observe`, and
`GET /sessions/{id}/history` reads can explain what maintenance trigger was
requested even after the live run state has been cleared. Persisted maintenance
snapshots are sanitized first, so later reads may also include:

- `reasonTruncated?: boolean`
- `hookPayloads[].payloadStatus?: "stored" | "redacted" | "truncated" |
  "redacted_and_truncated" | "omitted"`
- `hookPayloads[].payloadWarnings?: string[]`
- `hookPayloads[].payloadBytes?: number`

`POST /sessions/{id}/close`, `POST /sessions/{id}/cancel`, and
`POST /sessions/{id}/reset` now all return the same additive session snapshot
shape used by `GET /sessions/{id}`, plus an `action` field (`close`, `cancel`,
or `reset`) so hosts can update run-inspector state without an immediate
follow-up fetch.

`POST /sessions/{id}/close` accepts the same optional `maintenance` body field
so hosts can record additive pre-maintenance trigger context even when the
operation is only a soft close.

`POST /sessions/{id}/workspace/cleanup` is a bounded retained-worktree recovery
primitive for closed worktree-backed sessions whose most recent cleanup attempt
ended with `status: "retained"`. It accepts the same optional `maintenance`
body plus:

- `requireAcknowledgedHooks?: boolean`
- `worktreeCleanupPolicy: "discard" | "merge" | "preserve"`

If `worktreeCleanupPolicy` is omitted, the runtime retries the most recent
retained policy. Responses always include:

- `action: "cleanup_workspace"`
- `status: "completed" | "retained"`
- `reasonCodes`: machine-readable cleanup result codes from the retried cleanup
- `cleanup`: flat cleanup booleans/counts (`workspaceCleaned`,
  `worktreeDetached`, `worktreeCleanupPolicy`, `worktreeMergedPaths`)
- `maintenance`: the latest persisted maintenance inspection snapshot
- `cleanupPath`: the stable retry route path so hosts do not have to rebuild it

When the retried cleanup still leaves the logical session in place, responses
also include:

- `session`: the updated session payload after the retry

Successful cleanup retries can now auto-settle both retained resets and
retained deletes. Retained delete settlement uses the same bounded cleanup seam
instead of forcing the caller to replay `DELETE /sessions/{id}` manually. Those
responses include:

- `settledLifecycle.action: "delete"`
- `settledLifecycle.status: "completed" | "retained"`
- `settledLifecycle.cleanup`
- `deleteSettlement.status: "deleted" | "retained"`
- `deleteSettlement.hadTranscript`
- `deleteSettlement.fileDeleted`
- `deleteSettlement.nativeDeleted`
- optional `deleteSettlement.reason`

Unlike replaying `reset` or `delete`, this route only retries workspace
cleanup. When cleanup changes the runtime cwd or worktree metadata, the runtime
also refreshes persisted hydration/skill delivery state so `cwd`,
`workspaceIsolation`, and `hydration.workspace` continue to agree afterward.
If the most recent retained lifecycle was a `reset`, a successful cleanup retry
also auto-settles the rest of that reset follow-through, including provider
resume/provider-state clearing, hydration clearing, wakeup clearing, and
runtime-bound browser-session cleanup. Those responses include:

- `settledLifecycle.action: "reset"`
- `settledLifecycle.status: "completed"`
- `settledLifecycle.cleanup`

When `POST /sessions/{id}/reset` or `DELETE /sessions/{id}` returns
`status: "retained"` because a worktree cleanup could not finish safely, the
response also includes `retryCleanupPath` pointing at the same bounded retry
route.

For `POST /sessions/{id}/reset`, `POST /sessions/{id}/workspace/cleanup`, and
`DELETE /sessions/{id}`, invalid `worktreeCleanupPolicy` values now return
`400` instead of silently falling back to the default cleanup behavior.

Those same destructive lifecycle routes also accept
`requireAcknowledgedHooks: true`. When the route still advertises pending hooks
for its maintenance phase and the latest action-scoped follow-through has not
been reported as `acknowledged` or `completed`, the runtime returns `409`
instead of proceeding:

- `reset -> pre_reset`
- `delete -> pre_flush`
- `cleanup_workspace -> pre_flush`

Conflict responses include:

- `action`
- `phase`
- `status: "pending_hooks"`
- `hookStatus`
- `reasonCodes`
- `maintenance`
- `session`

`POST /sessions/{id}/compact` exposes the same runtime-owned maintenance
contract as a public compaction seam. It still accepts additive hook
coordination input:

- `acknowledgeHooks?: boolean`
- `maintenance?: { reason?: string; hookPayloads?: Array<{ kind: string; payload?: unknown }> }`

`acknowledgeHooks: true` remains the compatibility shorthand for older clients.
When it is used against pending `pre_compaction` hooks, the runtime now also
persists an `inspection.maintenance.lastFollowThrough` outcome of
`"acknowledged"` so later reads do not lose that state immediately.

The runtime always returns a machine-readable coordination result:

- `status: "not_ready"` when the session has no compaction evidence yet or has
  not crossed the message/token thresholds
- `status: "deferred"` when compaction is recommended but the session is still
  active
- `status: "pending_hooks"` when the session is inactive and ready for external
  compaction, but additive `pre_compaction` hooks have not been acknowledged yet
- `status: "ready_for_external_compaction"` when the session is inactive and any
  additive `pre_compaction` hooks are either absent or explicitly acknowledged
- `status: "compacted"` when the same readiness gate passes and the runtime can
  compact its own managed transcript directly

Responses also include:

- `execution: "external_only" | "runtime"`
- `runtimeCompactionExecuted: boolean`
- `hookStatus: "none" | "pending" | "acknowledged" | "completed"`
- `reasonCodes`: machine-readable readiness reasons copied from
  `inspection.maintenance.compaction`
- optional `runtimeCompaction`: the persisted
  `inspection.maintenance.compaction.lastCompaction` record when runtime
  compaction executed
- `maintenance`: the latest runtime-owned maintenance contract snapshot
- `session`: the same additive session payload returned by `GET /sessions/{id}`

Like reset/close/delete, any provided `maintenance` request is persisted under
`inspection.maintenance.lastRequest` so later session/observe/history reads can
explain which compaction-preparation trigger was accepted most recently. The
stored maintenance snapshot uses the same truncation/redaction/size-cap
guardrails described above rather than persisting arbitrary hook payloads
verbatim.

`POST /sessions/{id}/maintenance/follow-through` is the generic bounded
follow-up seam for maintenance hooks. It accepts:

- `action: "reset" | "delete" | "cleanup_workspace" | "compact"`
- `phase: "pre_reset" | "pre_compaction" | "pre_flush"`
- `outcome: "acknowledged" | "retry_requested" | "completed"`
- `maintenance?: { reason?: string; hookPayloads?: Array<{ kind: string; payload?: unknown }> }`

The runtime validates the action/phase pair against the current maintenance
contract:

- `reset -> pre_reset`
- `delete -> pre_flush`
- `cleanup_workspace -> pre_flush`
- `compact -> pre_compaction`

When the current session does not advertise pending hooks for the requested
phase, the route returns `409` instead of pretending follow-through happened.

Successful responses always include:

- `action`
- `phase`
- `outcome`
- `maintenance`
- `session`

The returned `maintenance` snapshot now also carries additive
`maintenance.flush` state for `pre_flush` orchestration, including:

- `status: "idle" | "pending" | "acknowledged" | "retry_requested" | "completed"`
- `phase: "pre_flush"`
- `hookCount`
- `reasonCodes`
- optional `action: "delete" | "cleanup_workspace"`
- optional `lastRequestedAt`
- optional `lastFollowThrough`

The same maintenance snapshot can now also carry additive bounded
`requestHistory` / `followThroughHistory` arrays so later `reset`, `delete`,
`cleanup_workspace`, and `compact` coordination does not overwrite previously
acknowledged action-scoped hook state.

For `action: "compact"`, responses also include:

- `status`
- `hookStatus`
- `reasonCodes`

`POST /sessions/{id}/compact/follow-through` remains as the bounded shortcut for
external compaction coordination. It accepts:

- `outcome: "acknowledged" | "retry_requested" | "completed"`
- `maintenance?: { reason?: string; hookPayloads?: Array<{ kind: string; payload?: unknown }> }`

The route persists the outcome under
`inspection.maintenance.lastFollowThrough`, appends it to bounded additive
history, records a machine-readable maintenance marker, and returns:

- `action: "compact"`
- `outcome`
- `status`: the current compaction readiness after applying the follow-through
- `hookStatus`
- `reasonCodes`
- `maintenance`
- `session`

`"completed"` does not rewrite runtime compaction baselines for provider-owned,
externally compacted, or externally cleaned-up transcripts by itself; it is an
explicit coordination fact, not a synthetic runtime lifecycle or
`lastCompaction` record.

When the runtime owns the transcript locally, the compaction step now repairs
malformed JSONL lines, archives the repaired pre-compaction baseline, rewrites
the managed transcript with a `compaction_summary` entry plus the retained live
tail, and persists aggregate metadata such as repaired-line count, compacted
entry count, aggressive-pass count, and the archive path.

`DELETE /sessions/{id}` also clears any persisted wakeups targeting that
session before the runtime unregisters it. Delete responses now also include
`action: "delete"` plus `sessionId` so lifecycle consumers can treat delete as
the same control family even though the session snapshot is gone afterward.
Delete responses also include:

- `cleanup`: machine-readable cleanup results (`workerDetached`,
  `browserSessionsCleared`, `managedTranscriptDeleted`,
  `providerDiscoveryCleared`, `workspaceCleaned`, `registryDropped`, etc.)
- `maintenance`: the terminal lifecycle marker for the delete attempt, with
  `status: "completed"` or `status: "retained"`

`DELETE /sessions/{id}` accepts the same optional `maintenance` body plus:

- `requireAcknowledgedHooks?: boolean`
- `worktreeCleanupPolicy: "discard" | "merge" | "preserve"`

For worktree-backed sessions, the runtime closes any attached worker first,
then either detaches the worktree and removes the session or returns
`status: "retained"` with machine-readable cleanup metadata when merge/discard
cannot be completed or when `preserve` intentionally keeps the worktree for
manual handling.

For delete responses, top-level `cleanup` is a flat alias of
`maintenance.cleanup` so transport-facing consumers can read terminal cleanup
results without having to unwrap the full lifecycle object after the session
record itself has been removed.

`GET /providers/config` returns the configured provider topology for dashboards
or other clients that need to offer provider-instance selection. Each instance
entry includes its backend kind (`cli`, `api`, `local`, or `agent`) plus any
transport or runtime metadata that applies to that backend.

Each instance entry also exposes additive `tooling` metadata:

- `source`: `runtime_local`, `provider_native`, or `provider_managed`
- `discoverable`: whether `cats-runtime` can enumerate a bounded tool policy
  for that target directly
- `sessionScopedOverrides`: whether later per-session permission settings can
  narrow the reported baseline
- `summary`: operator-facing description of who owns tool execution
- `observability`: bounded runtime truth about tool-catalog ownership plus
  whether the runtime can still observe tool-call events or runtime service
  updates for that target
- `policy`: for API/local targets only, the bounded runtime tool-profile
  inspection (`profile`, counts, and per-tool access classification) before any
  session-level permission narrowing

Agent-backed instances now also expose additive `agentRuntime` inspection
metadata. This is a bounded operator read model, not a new session contract.
The object includes:

- adapter identity (`adapter`, `family`)
- operator-facing `summary`
- resolved `endpoint`
- `transport` semantics (`kind`, `protocol`, `liveProbe`, `modelDiscovery`,
  `streaming`)
- outbound `request.headerNames`
- bounded `auth` inspection (`mechanisms`, configured credential slots)
- `continuity` truth for provider-managed session state and remote cancel support
- additive capability flags such as `probe`, `modelDiscovery`, `cancel`,
  `runtimeServices`, and `toolCallEvents`

`GET /providers/{provider}/tools` is the standalone runtime-owned tooling read
surface for one resolved target. It accepts optional `?instance=<backend/id>`
and returns the same bounded tooling summary without forcing hosts to fetch the
full provider topology:

```json
{
  "provider": "claude",
  "backend": "api",
  "instance": "sonnet",
  "target": "api/sonnet",
  "source": "runtime_local",
  "discoverable": true,
  "sessionScopedOverrides": true,
  "summary": "Runtime-managed local tools default to the 'standard' profile (28 tool(s)) before per-session permission narrowing.",
  "observability": {
    "catalog": "runtime_enumerated",
    "toolCallEvents": true,
    "runtimeServices": false
  },
  "policy": {
    "profile": "standard",
    "permissionMode": "skip",
    "whitelistActive": false,
    "counts": {
      "total": 28,
      "fullAccess": 28,
      "previewOnly": 0,
      "blocked": 0
    }
  }
}
```

For CLI and agent targets the route stays honest: it still returns `200`, but
`source` becomes `provider_native` or `provider_managed`, `discoverable` stays
`false`, and no synthetic runtime tool catalog is invented. Those targets still
include bounded `observability` truth so hosts can distinguish provider-owned
catalogs from runtime-enumerated ones and can see whether the runtime can
observe remote tool-call events or runtime service updates.

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
- machine-readable `attentionCodes`
- these compatibility codes are scoped to the compatibility engine summary and
  may therefore be narrower than `availability.attentionCodes`
- probe metadata (`mode`, `supportsLive`, `liveValidated`)
- cache metadata (`stale`, `ttlMs`, `ageMs`, `freshUntil`)
- additive `warnings`
- optional `evidence` artifact metadata for degraded or failed probes

Targets that have not been probed yet, plus non-CLI backends, return
`compatibility: null`. Non-CLI backends also return `install: null`.

Some CLI entries may also expose runtime-owned `activeConfig` metadata when the
runtime can inspect provider-local configuration directly. The first slice is
Goose-specific and returns:

- `source: "goose_config"`
- `state`: `detected`, `partial`, `missing`, or `invalid`
- `configuredPath` plus host-readable `resolvedPath`
- inferred upstream `provider` / `model` when available

This metadata is additive. It does not replace setup/compatibility diagnostics,
but it gives hosts and playgrounds a runtime-owned hint about the provider's
current local default selection without reviving a sample-only shim route.

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
  This now includes auth-ready remote API listings for OpenAI/Anthropic via
  `GET /v1/models`, Gemini/Google via `GET /v1beta/models`, local Ollama via
  `GET /api/tags` plus `GET /api/ps`, Pi CLI discovery, and agent-backed
  adapter `listModels()` hooks.
- `source: config` means runtime discovery was unavailable or failed and the
  result fell back to configured target metadata. For API targets, the runtime
  keeps this fallback when auth is not configured or when remote listing fails.
  In those cases, `warnings` now records the honest skip/failure reason instead
  of silently degrading.
- `source: static` means the runtime used a curated compatibility table.
- `cache` is present only for `dynamic` results. Config/static fallbacks return
  `cache: null`.
- `warnings` stays empty on clean discovery, and becomes additive when the
  runtime had to degrade gracefully. For example, dynamic discovery may still
  return `source: dynamic` with warnings if a secondary probe such as Ollama's
  running-model check fails, while a full discovery failure falls back to
  `config` or `static` with a warning instead of returning an empty success.
- HTTP-backed remote discovery is bounded with a 5-second timeout. Stalled
  OpenAI/Anthropic/Gemini or Ollama endpoints now degrade into warnings plus
  `config`/`static` fallback instead of hanging the request indefinitely.
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
- dynamic discovery for `pi` via the runtime-owned `pi --list-models` helper,
  normalized into canonical `provider/model` refs
- dynamic discovery for `agent_sdk_bridge` targets whose adapter exposes
  `listModels()`
- dynamic discovery for `openclaw_gateway` targets via gateway `models.list`,
  normalized into canonical `provider/model` refs
- static compatibility for `kiro`
- config or curated static fallback for the remaining configured providers

`GET /pool/status` returns aggregated runtime status for all active backend
managers, including `cli`, `api`, and `agent`.

`GET /discovery/status` returns background discovery policy/status metadata for
runtime-backed discovery families. It currently reports:

- `wsl`: WSL discovery policy/status for Cursor and Kiro
- `docker`: Docker discovery policy/status for Docker-backed native discovery targets
- `lan`: additive LAN peer discovery status, registry counts, and discovery-adapter state

### LAN Peer Discovery and Execution Routing

```text
GET  /peers
GET  /peers/{peerId}
GET  /diagnostics/peers
POST /peer/executions
```

`GET /peers` returns the bounded peer registry read model. By default it only
returns live peers. `?includeStale=true` adds stale entries. When peer
execution admission control is enabled, the response also includes an additive
`guardrails` summary with current auth-throttling, inbound-capacity totals, and
bounded replay-protection counters. It now also includes an additive `network`
summary describing the local advertised endpoint posture, whether peer
shared-secret auth is configured, and whether discovered peers are TLS,
trusted-LAN plaintext, or externally exposed plaintext endpoints.

Example response shape:

```json
{
  "count": 2,
  "query": {
    "includeStale": false
  },
  "discovery": {
    "enabled": true,
    "status": "running",
    "localPeerId": "desk-a",
    "registry": {
      "total": 2,
      "self": 1,
      "remote": 1,
      "alive": 2,
      "stale": 0,
      "trusted": 1,
      "unknown": 0,
      "rejected": 0
    }
  },
  "network": {
    "summary": "Peer endpoints are plaintext HTTP on loopback/private/LAN addresses; keep peer routing inside a tightly trusted network or add TLS.",
    "auth": {
      "sharedSecretConfigured": true,
      "sharedSecretCount": 1
    },
    "local": {
      "endpoint": "http://127.0.0.1:3110/",
      "classification": "trusted_lan_plaintext",
      "level": "attention"
    },
    "peers": {
      "total": 1,
      "tls": 0,
      "trustedLanPlaintext": 1,
      "externalPlaintext": 0,
      "unresolved": 0,
      "attention": 1,
      "warning": 0
    }
  },
  "peers": [
    {
      "identity": {
        "peerId": "desk-b",
        "displayName": "desk-b",
        "advertisedUrl": "http://10.0.0.9:3110"
      },
      "trust": {
        "state": "trusted",
        "reason": "configured_trust"
      }
    }
  ]
}
```

`GET /peers/{peerId}` returns one peer detail record. Unknown peer ids return
`404`. When peer execution admission control is enabled, the detail response
also includes additive `guardrails.inboundExecutions` plus
`guardrails.replay` state for that peer, including whether a peer-specific
quota override is active. It now also includes `network.summary` plus a
peer-specific `network.peer` posture record so operators can tell whether the
selected peer is TLS-fronted, trusted-LAN plaintext, externally exposed
plaintext, or missing a stable advertised endpoint.

`GET /diagnostics/peers` is the host-facing peer diagnostics summary. It
combines the LAN discovery snapshot, registry summary counts, the current
bounded peer list, and a bounded `guardrails` diagnostics snapshot for peer
auth throttling, inbound execution admission, and replay-protection state
without changing the semantics of `GET /health`. It now also includes a fuller
`network` snapshot with per-peer posture entries for operator diagnostics.

`POST /peer/executions` is the dedicated runtime-to-runtime execution contract.
It is not a general host route and it does not replace the existing session
ownership routes.

Request shape:

```json
{
  "caller": {
    "peerId": "desk-a",
    "sessionId": "session-123",
    "runId": "run-123",
    "traceId": "trace-123"
  },
  "target": {
    "provider": "codex",
    "backend": "api",
    "instance": "main",
    "model": "gpt-5.4"
  },
  "workspace": {
    "mode": "none"
  },
  "turn": {
    "message": "Draft the implementation plan."
  }
}
```

Route semantics:

- supports both `Accept: application/x-ndjson` and `Accept: text/event-stream`
- requires peer auth via `Authorization: Bearer <shared-secret>` plus
  `x-cats-peer-id`
- accepts additive `x-cats-peer-timestamp` and `x-cats-peer-nonce` headers and
  binds them into `x-cats-peer-signature: sha256=<hmac>`
- fails closed when peer auth/trust checks fail
- rejects stale timestamps with `401 peer_auth_stale`
- rejects replayed nonces with `409 peer_auth_replayed`
- rate-limits repeated auth failures per caller key and returns `429
  peer_auth_rate_limited` when the bounded failure window is exceeded
- applies bounded inbound admission control and returns `429
  peer_execution_rate_limited` when a caller exceeds configured peer-execution
  concurrency; rejection details now include `overrideApplied` when a
  peer-specific quota override was responsible for the tighter limit
- returns normalized streamed events, with additive `metadata.peerExecution`
  on the callee and additive `metadata.peerRouting` on the caller relay path
- stays execution-only: the callee does not become owner of the caller-visible
  session, wakeup, browser, or worktree lifecycle

Topology notes:

- the current slice supports a bounded small-LAN mesh shape where multiple
  runtimes can discover one another and route directly peer-to-peer
- there is no central coordinator requirement for direct peer execution
- trust is not transitive, discovery does not imply trust, and there is no
  gossip-based propagation of peer state
- this is not a full cluster manager: no transparent failover, no cross-node
  session ownership transfer, and no remote workspace/browser/wakeup ownership
- request-body integrity and freshness are protected with a shared-secret HMAC
  plus nonce/timestamp replay resistance, but per-peer credentials and
  stronger network transport assumptions are later follow-up, not solved by v0
- operators may also configure additive `CATS_RUNTIME_PEER_LIMIT_OVERRIDES`
  per trusted peer id for tighter auth-failure, inbound-concurrency, or replay
  nonce ceilings without changing the global defaults

Peer-routing failure events are additive. Streamed `error` events may include:

```json
{
  "type": "error",
  "text": "Peer execution failed before completion.",
  "metadata": {
    "peerRoutingFailure": {
      "code": "peer_execution_rejected",
      "message": "Peer execution failed before completion.",
      "retryable": false,
      "peerId": "desk-b",
      "status": 409
    }
  }
}
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

*Last updated: 2026-03-26*
