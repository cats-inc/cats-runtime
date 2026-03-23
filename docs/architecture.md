# System Architecture

> Current architecture for the embedded `cats-runtime` service.

## Overview

`cats-runtime` now runs as a single service. The CLI runtime that previously
lived behind the `agent-fleet` HTTP boundary has been ported into this repo and
organized under `src/backends/cli`, while API-key and local-model execution now
live under `src/backends/api`, and external agent runtimes such as OpenClaw now
live under `src/backends/agent`.

Provider execution topology now comes from `config/providers.yaml` when present.
That file maps each provider to one or more named instances, and each instance
maps to an execution environment such as `native` or a specific WSL distro.
File-backed providers still discover sessions from the host process, so their
discovery paths are resolved as host filesystem paths rather than
environment-relative guest paths.

The architectural split is:

- `core`: shared runtime config and stable types
- `core/workspace`: runtime-owned shared/isolated/worktree workspace lifecycle helpers
- `startup`: process-level startup mode, readiness, and lifecycle helpers
- `backends`: execution implementations for CLI, API/local, and agent targets
- `core/browser`: runtime-owned browser/session/page contracts plus preview helpers
- `backends/browser`: pluggable browser driver implementations
- `core/wakeup`: runtime-owned scheduled wakeup substrate and persistence
- `http`: inbound transport and route wiring

Runtime-managed skills now sit at the shared runtime layer rather than inside
product shells or ad-hoc prompt helpers. The runtime:

- validates execution-ready family-organized `skills/**/SKILL.md` packages
- resolves requested runtime skill ids into session-owned metadata
- chooses a backend-aware delivery mode (`filesystem`, `instructions`, `none`)
- persists requested/resolved/applied skill state into session inspection and
  history surfaces

## Architecture Diagram

```text
┌──────────────────────┐
│   cats / crew-chat   │
└──────────┬───────────┘
           │ stable HTTP contract
           ▼
┌───────────────────────────────────────────┐
│               cats-runtime                │
│  http routes + auth + streaming          │
│  core contracts + config + tools         │
│  backends/cli session pool + discovery   │
│  backends/api transport + tool loop      │
│  backends/agent adapter runtime          │
└──────────┬────────────────────────────────┘
           │ subprocess / local files / remote APIs / local APIs / agent gateways
           ▼
┌───────────────────────────────────────────┐
│ Claude / OpenAI / Gemini / Ollama APIs   │
│ Claude / Codex / Gemini / Kiro / Cursor  │
│ Auggie / OpenCode local runtimes         │
│ OpenClaw / Agent SDK bridge runtimes     │
└───────────────────────────────────────────┘
```

## Internal Layout

```text
src/
  startup.ts
  core/
    config.ts
    models/
    browser/
    providerActiveConfig.ts
    provider-install/
    skills/
      orchestration/
      work/
      chat/
      code/
    dotenv.ts
    providerCatalog.ts
    progress.ts
    runtime/
    workspace/
    tools/
    types.ts
    usage/
    wakeup/
  backends/
    browser/
    agent/
      adapters/
      runtime/
      types.ts
    api/
      runtime/
      transports/
    cli/
      auggie/
      cursor/
      discovery/
      kiro/
      opencode/
      pool/
      providers/
      runtime/
  http/
    app.ts
    auth.ts
    routes/
    streaming.ts
  mcp/
```

## Components

### `src/http`

- Exposes the public `cats-runtime` HTTP API
- Serves the embedded dashboard UI from `/`
- Serves the embedded multi-agent playground sample from `/playground`
- Applies optional bearer auth
- Streams turn output as SSE or NDJSON
- Applies additive metering observation and execution guardrail preflight on
  streamed message turns
- Exposes startup/readiness metadata at `GET /health`
- Exposes aggregate runtime + provider health at `GET /diagnostics/health`
- Exposes runtime/host diagnostics at `GET /diagnostics/runtime`
- Exposes provider availability plus CLI compatibility diagnostics at
  `GET /diagnostics/providers`
- Exposes runtime-owned browser session/page routes with pluggable driver
  metadata and normalized `browser_page` preview surfaces
- Exposes runtime-owned delivery execution routes such as delivery audit,
  artifact publication, repo status, commit, and push without embedding
  product-level delivery governance policy
- Exposes runtime-owned scheduled wakeup routes without pretending the runtime
  already owns full product workflow or heartbeat scheduling
- Exposes the additive MCP facade over `POST /mcp` plus the `cats-runtime-mcp` stdio binary

### `src/mcp`

- Owns the runtime MCP facade implementation
- Maps JSON-RPC methods such as `initialize`, `ping`, `tools/list`, and
  `tools/call` onto runtime-owned services and read models
- Reuses existing session inspection, session mutation, workspace substrate,
  and delivery primitives instead of inventing a second execution stack
- Supports both HTTP JSON-RPC and Content-Length framed stdio transport
- Keeps MCP additive so direct HTTP routes remain the primary product boundary

### `src/startup.ts`

- Parses executable startup flags such as `--startup-mode` and `--ready-output`
- Resolves runtime startup state from CLI and environment inputs
- Formats machine-readable readiness, startup-failure, and shutdown lifecycle
  output for local supervisors
- Carries the frozen startup contract version, readiness path, and lifecycle
  phase state shared by HTTP and process outputs
- Keeps standalone and app-managed process startup on one shared binary path

### `src/backends/cli`

- Manages subprocess-backed sessions
- Tracks session registry, workspace modes, and persisted workspace-isolation metadata
- Resolves `(provider, instance)` into concrete command/runtime settings
- Discovers external native/file-backed sessions from supported tools per provider instance
- Encapsulates provider-specific spawn, resume, fork, and permission logic
- Normalizes provider-native mid-turn updates onto shared `progress` events for
  Junie, Pi, Goose, and Copilot
- Applies policy-aware WSL discovery for Cursor/Kiro and exposes discovery
  status for the dashboard
- Validates and resolves file-backed provider paths on the host before starting
  scanners or file watchers

### `src/backends/api`

- Manages runtime-owned logical sessions for API-key and local-model providers
- Resolves configured remote targets and transport settings per provider instance
- Runs provider-native function/tool calling through a shared local tool runtime
- Keeps resume/fork/history source of truth in runtime-managed transcripts
- Persists provider-native continuation metadata such as OpenAI response IDs,
  Anthropic prompt-caching hints, and Gemini cached-content state as
  optimizations under the runtime-owned logical session
- Emits normalized `progress` events plus additive incident hints for
  provider-native cache, continuation, rate-limit/quota, and local-model
  warm-state hints so upper layers do not need to consume provider-specific raw
  payloads
- Applies additive `payload_template` request hints for provider-native options
  such as OpenAI background/body flags or Ollama `keep_alive` warm-state hints
- Also hosts the current execution machinery for `local` targets such as
  Ollama. `local` remains a distinct backend kind in config/routing/public
  payloads because its product semantics differ from pay-as-you-go remote APIs,
  but it does not currently justify a separate `src/backends/local` runtime
  manager

### `src/backends/agent`

- Manages external agent runtimes that own more of the run/session lifecycle
- Resolves configured `backends.agent` targets and adapter settings
- Dispatches through `AgentAdapter` implementations instead of completion/tool
  transports
- Persists provider-managed session continuity state beside runtime-visible
  history, artifacts, and invocation metadata
- Routes close/cancel/delete/reset through adapter-aware remote cleanup hooks
  instead of only dropping local runtime handles

### `src/backends/browser`

- Hosts pluggable browser drivers behind one runtime-owned contract
- Keeps the first slice dependency-light and runtime-local
- Starts with a `manual` driver that validates browser session/page lifecycle
  and preview-surface registration without launching a managed browser process

### `src/core/browser`

- Defines runtime-owned browser session/page lifecycle helpers
- Defines browser-page preview-surface normalization aligned with existing
  service/artifact preview contracts
- Keeps browser-driver integration replaceable so future Playwright/CDP or
  BrowserOS-style adapters can plug in without rewriting the public HTTP
  contract

### `src/core/tools`

- Defines the shared local tool set exposed to API/local sessions
- Enforces workspace boundaries and permission policy centrally
- Rejects symbolic-link/junction alias paths and hardlinked mutation targets
  for mutating tool flows so workspace safety stays backend-neutral
- Executes file listing, file read/write, grep, and shell commands
- Exposes policy-neutral workspace substrate operations (`audit-workspace`,
  `init-workspace`, `update-workspace`) as shared headless/local-tool
  primitives
- Returns explicit workspace substrate `contract`, `actions`, `plan`, and
  `approval` payloads so hosts can preview/apply deterministically without
  embedding product policy in the runtime
- Exposes runtime-owned delivery tools (`audit-delivery-target`,
  `publish-artifacts`, `inspect-repo-status`, `create-commit`, `push-branch`)
  for runtime-managed skills with the same machine-readable contract as the
  HTTP layer
- Normalizes tool activity into stream events and transcript records

### `src/core/runtime`

- Hosts backend-neutral runtime primitives that are not owned by any one
  provider backend
- Resolves session branch mode/capability truth centrally so `native_fork`,
  `context_transplant`, and fallback semantics do not live as ad-hoc route
  conditionals
- Keeps session branching helpers policy-neutral while exposing lineage,
  context-transplant metadata, and machine-readable branch result payloads
- Owns deterministic workspace substrate planning/apply logic independently of
  product shells or skills
- Tracks runtime-owned per-session execution/read-model state such as current
  run, last run, wake reason, recent normalized events, and lifecycle state so
  session/history/observe routes can expose a provider-agnostic run inspector
  contract
- Adds runtime-owned maintenance metadata for reset boundaries, compaction
  readiness, pending pre-reset/pre-compaction memory-flush hooks, and
  machine-readable cleanup guidance without implementing the product memory
  pipeline itself
- Exposes `POST /sessions/{id}/compact` as an external-only coordination seam
  that records compaction trigger intent and readiness but does not execute the
  compaction step inside runtime
- Persists the last accepted maintenance trigger request on the logical session
  so Team 4 style flush/compaction payloads can survive past the immediate
  reset/delete response without making runtime the memory owner
- Enriches current/last-run inspection with per-run preview surfaces derived
  from agent services and artifacts so hosts can render the output of one run
  without diffing whole-session state
- Normalizes history provenance metadata and Pi-native transcript parsing so
  provider-owned session files can still feed the same runtime-owned history
  route contract
- Keeps `audit-workspace` read-only even when callers request apply, and uses
  `*.bootstrap` review copies instead of blind overwrite for conflicting files
- Owns delivery audit/export/repo primitives and normalized preview-surface
  metadata so artifact-only and repo-backed flows can share one execution seam
- Keeps delivery execution approval-aware (`preview` vs `apply`) without moving
  delivery-governance policy into the runtime
- Requires explicit delivery-side opt-in before `create-commit` stages workspace
  changes; apply otherwise uses the existing Git index only
- Does not own product-level approval UX, workspace orchestration policy, or
  post-apply delegation behavior
- Provides the minimal "ensure this known session is awake" helper reused by the
  scheduled wakeup substrate

### `src/core/workspace`

- Owns the runtime-side workspace execution layer used by session lifecycle
  routes
- Prepares shared, isolated, and worktree-backed runtime cwd state without
  moving product orchestration policy into runtime
- Uses deterministic worktree ids and paths rooted under the runtime session
  base dir so resume/reset/delete can recreate or clean up the same worktree
- Supports explicit worktree cleanup policies (`discard`, `merge`, or
  `preserve`) and returns retained/completed cleanup summaries instead of
  assuming cleanup always succeeds
- Keeps retained worktree sessions pointed at the still-live worktree path so
  later observe/reset/delete flows stay consistent when cleanup is intentionally
  preserved or cannot finish safely
- Provides a conservative snapshot-copy helper for non-shared fork flows

### `src/core/wakeup`

- Owns the runtime-managed scheduled wakeup request store
- Persists wake requests across runtime restart
- Runs a bounded in-process timer loop for due wakeups
- Coalesces explicitly keyed duplicates and rejects exact unkeyed duplicates
- Keeps wakeup observability additive by surfacing request state alongside
  existing session/history inspection rather than inventing transcript messages

### `src/core/skills`

- Discovers runtime-owned skill packages from `skills/`
- Validates `SKILL.md` frontmatter and instruction bodies before runtime use
- Derives stable library metadata (`family`, `slug`, `role`, `packageKind`,
  `capabilityTags`, `deliveryHints`) for runtime-owned packages
- Resolves session-level requested skill ids into runtime-visible metadata
- Exposes `listRuntimeSkillCatalog()` as the runtime-internal contract Team 6
  can consume without coupling to execution/materialization internals
- Supports explicit clearing of persisted skill state on create/message/fork
- Chooses adapter-aware delivery modes per provider/backend
- Materializes filesystem or instruction-file resources where the target needs
  runtime-owned artifacts (for example Codex isolated workspaces or Pi prompt
  files)
- Rebuilds backend-specific delivery artifacts from persisted requested skills
  during resume/fork/provider switch so runtime-owned skill re-entry does not
  depend on stale materialization state
- Keeps unsupported delivery explicit instead of silently pretending a backend
  consumed the skill package

### `src/core/hydration`

- Owns the shared session hydration seam used by create/resume/fork/message
  paths
- Distinguishes runtime cwd from the authoritative workspace source when an
  isolated sandbox is only a temporary execution surface
- Records runtime-owned `workspace.isolationMode` so hosts can distinguish
  shared, isolated, and worktree-backed execution surfaces machine-readably
- Reuses read-only workspace substrate audit output for additive hydration
  metadata without auto-applying substrate changes
- Re-derives runtime-managed skill delivery per target/backend so session state
  persists requested skills rather than stale provider-specific artifacts

### `src/core/usage`

- Hosts the runtime-owned metering subsystem for usage normalization, incident
  detection, and guardrail aggregation
- Normalizes additive usage facts such as tokens, estimated cost, latency, and
  source-confidence without requiring provider-specific callers
- Derives machine-readable incidents for rate-limit, quota, and concurrency
  failures from API and CLI surfaces
- Maintains the first execution guardrail slice for warn / block / cooldown
  behavior without embedding product budget policy
- Produces diagnostics-friendly aggregates for `GET /diagnostics/runtime` and
  `GET /diagnostics/health`

### `src/core`

- Loads runtime-wide configuration
- Hosts shared provider-target and provider-model catalog services
- Hosts the runtime-owned provider install/check metadata plus shared command
  lookup / package-check runner seam, including copied prerequisite, shell PATH
  persistence, and npm-prefix logic with no runtime dependency on
  `environment-bootstrap`
- Hosts the runtime-managed skill catalog/delivery contract
- Hosts the shared provider compatibility/evidence engine used by setup,
  diagnostics, and CLI execution priming, including `light` vs `live`
  runtime-flag probes, stale-cache-aware summaries, and replay-friendly
  evidence bundles
- Defines stable exported runtime types
- Keeps shared utilities out of provider modules
- Owns the shared `progress` event helper and metering/guardrail type contracts
- Carries the shared turn/bootstrap/output contract used across CLI, API/local,
  and agent sessions
- Owns the provider-model fallback ordering and cache semantics
  (`dynamic -> config -> static`), including additive model-status metadata such
  as `running` or `configured` when the runtime can infer warm-state or config
  injection details

## Data Flow

1. A caller sends a request to `cats-runtime`
2. `src/http` authenticates and routes the request
3. `RuntimeSessionManager` resolves the configured backend target for the chosen provider instance
4. `src/core/workspace` prepares the runtime execution surface for the chosen
   isolation mode (`shared`, `isolated`, or `worktree`)
5. `src/core/hydration` resolves workspace provenance and skill re-entry state
   for the target backend
6. `src/core/skills` validates requested runtime skill ids and resolves a
   delivery contract for the target backend
7. CLI targets flow into `WorkerPool`; API/local targets flow into `ApiBackendManager`; agent targets flow into `AgentBackendManager`
8. Provider model-catalog reads resolve through the shared provider target and
   model catalog services in `src/core`, including runtime-owned active-config
   hints when a provider family exposes a readable local default selection
9. CLI setup, diagnostics, and execution priming resolve through the shared
   compatibility service in `src/core/compatibility`, which consumes the
   runtime-owned metadata in `src/core/provider-install`, classifies targets,
   selects degraded profiles, validates runtime flags through `light` and
   optional `live` probes, evaluates prerequisite / PATH-persistence /
   npm-prefix setup state, tracks cache staleness for reprobe flows, and
   writes evidence bundles for non-ready results
10. API/local turns may enter the shared local tool loop in `src/core/tools`,
   including workspace substrate preview/apply operations
11. Agent turns use the shared `TurnInput` contract plus provider-managed session continuity where available
12. Stream events pass through runtime-owned metering observation so usage,
    incidents, and active guardrails are updated before the caller receives the
    final event stream
13. Startup/readiness state is exposed over `GET /health`, while
   `GET /diagnostics/health`, `GET /diagnostics/runtime`, and
   `GET /diagnostics/providers` expose the runtime-owned host integration
   surface
14. `POST /mcp` reuses those same runtime-owned services as an additive
    orchestrator/tool surface
15. Optional machine-readable process output emits startup and shutdown
   lifecycle events for app-managed local hosts
16. Session branch inspection is available over session payload `branching`
    metadata plus `GET /sessions/{id}/lineage`
17. Delivery actions resolve through `RuntimeDeliveryService`, which inspects
    repo state, exports artifacts, normalizes preview surfaces, and executes
    Git mutations behind a stable machine-readable contract
18. Session reset/delete lifecycle now routes worktree cleanup through the same
    runtime-owned workspace layer, returning retained cleanup metadata when the
    source repo is dirty or detachment fails
19. `POST /sessions/{id}/compact` reuses the same runtime-owned maintenance
    read model as a public compaction-preparation route, returning
    machine-readable readiness plus opaque hook payload persistence while
    leaving the actual compaction engine external
20. Stream events are returned directly to the caller

For WSL-backed Cursor/Kiro discovery:

1. Background discovery enumerates configured Cursor/Kiro provider instances
2. Background discovery checks the configured WSL discovery policy
3. `always` scans directly, `if_running` only scans already-running distros, and
   `manual_only` disables background WSL scans
4. The runtime records discovery state per `provider@instance` for dashboard
   polling via `GET /discovery/status`

For file-backed providers:

1. The runtime resolves instance-specific discovery paths on the host
2. On Windows, WSL-backed file providers may use Linux-style paths such as
   `~/.codex/sessions`; the runtime translates them to host-readable
   `\\wsl$\Distro\...` paths automatically
3. Invalid WSL paths still fail during bootstrap instead of falling through to
   watcher/scanner failures later
4. Docker-backed file providers currently skip host-side file discovery and
   keep using their container-local session paths until Docker file discovery is
   implemented

## Memory Ownership and Exports

`cats-runtime` now needs an explicit boundary between runtime evidence and
higher-level product memory.

- **Provider-native continuity** such as thread ids, OpenClaw session keys, or
  backend compaction state remains runtime/backend-owned.
- **Runtime evidence history** is the runtime's canonical record of execution
  events, tool activity, artifacts, and provider metadata.
- **Durable Cat/owner memory** is not runtime-owned by default; upstream
  products such as `cats` decide what long-lived memory to derive from
  runtime evidence.
- **Archive/RAG retrieval** should consume explicit exports or projections, not
  reach directly into provider-native transcript stores as the only source of
  truth.
- **Maintenance hooks** such as pending `memory_flush` before reset or
  compaction are runtime-owned signals only; upstream products remain
  responsible for the actual durable-memory export/write path.

This keeps agent-native transcripts useful for continuity without making them
the only durable memory surface for the Cats suite.

## Design Rules

- Upper layers should depend on `cats-runtime`, not on provider-specific CLIs
- Product hosts should supervise `cats-runtime` as a separate process and use
  the HTTP boundary for readiness rather than source-importing runtime internals
- Hosts should use runtime-owned diagnostics surfaces rather than rebuilding
  provider availability checks above the runtime
- The embedded dashboard should consume the same runtime-owned diagnostics
  contracts that packaged or host-managed supervisors poll
- Historical `agent-fleet` references should stay confined to ADRs and migration notes
- Inbound transport code should stay in `src/http`, not in backend modules
- New API-key or Ollama integrations should land under `src/backends/api`
- External agent runtimes with their own run/session/event semantics should
  land under `src/backends/agent`
- Shared filesystem, shell, and workspace-substrate tools should stay in
  `src/core/tools`, not inside one backend
- Session branching should stay an execution primitive in runtime; product
  layers own branch policy, convergence, and delegation semantics
- Hosts should consume runtime-owned `branch`/`branching` metadata rather than
  rebuilding native-fork compatibility logic above the runtime
- Delivery policy stays above runtime; hosts should consume runtime-owned
  delivery primitives and machine-readable blocked/degraded states rather than
  reimplementing Git/artifact/preview execution logic above the runtime
- Keep `.env` focused on runtime-wide values; provider topology belongs in
  `config/providers.yaml`

## Key Decisions

- [001: Use an HTTP adapter around agent-fleet first](./decisions/001-agent-fleet-http-adapter.md)
- [002: Embed the CLI runtime into cats-runtime](./decisions/002-embed-cli-runtime.md)
- [003: Move provider execution topology into file-based provider instances](./decisions/003-provider-instance-config.md)
- [004: Resolve file-backed provider paths on the host](./decisions/004-file-backed-paths-are-host-resolved.md)
- [005: Introduce a backend-neutral runtime facade for CLI and API backends](./decisions/005-backend-neutral-runtime-and-api-backend.md)
- [006: Introduce an agent backend and shared runtime contracts](./decisions/006-agent-backend-and-shared-runtime-contracts.md)

---

*Last updated: 2026-03-23*
