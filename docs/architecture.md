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
- `startup`: process-level startup mode, readiness, and lifecycle helpers
- `backends`: execution implementations for CLI, API/local, and agent targets
- `http`: inbound transport and route wiring

## Architecture Diagram

```text
┌──────────────────────┐
│ cats-inc / crew-chat │
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
    dotenv.ts
    providerCatalog.ts
    runtime/
    tools/
    types.ts
  backends/
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
```

## Components

### `src/http`

- Exposes the public `cats-runtime` HTTP API
- Serves the embedded dashboard UI from `/`
- Applies optional bearer auth
- Streams turn output as SSE or NDJSON
- Exposes startup/readiness metadata at `GET /health`
- Exposes runtime/host diagnostics at `GET /diagnostics/runtime`
- Exposes provider availability diagnostics at `GET /diagnostics/providers`

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
- Tracks session registry and workspace modes
- Resolves `(provider, instance)` into concrete command/runtime settings
- Discovers external native/file-backed sessions from supported tools per provider instance
- Encapsulates provider-specific spawn, resume, fork, and permission logic
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
- Emits a first normalized `progress` event stream for provider-native cache,
  continuation, and local-model warm-state hints so upper layers do not need to
  consume provider-specific raw payloads
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

### `src/core/tools`

- Defines the shared local tool set exposed to API/local sessions
- Enforces workspace boundaries and permission policy centrally
- Executes file listing, file read/write, grep, and shell commands
- Normalizes tool activity into stream events and transcript records

### `src/core`

- Loads runtime-wide configuration
- Hosts shared provider-target and provider-model catalog services
- Defines stable exported runtime types
- Keeps shared utilities out of provider modules
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
4. CLI targets flow into `WorkerPool`; API/local targets flow into `ApiBackendManager`; agent targets flow into `AgentBackendManager`
5. Provider model-catalog reads resolve through the shared provider target and
   model catalog services in `src/core`
6. API/local turns may enter the shared local tool loop in `src/core/tools`
7. Agent turns use the shared `TurnInput` contract plus provider-managed session continuity where available
8. Startup/readiness state is exposed over `GET /health`, while
   `GET /diagnostics/runtime` and `GET /diagnostics/providers` expose the
   runtime-owned host integration surface
9. Optional machine-readable process output emits startup and shutdown
   lifecycle events for app-managed local hosts
10. Stream events are returned directly to the caller

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
  products such as `cats-inc` decide what long-lived memory to derive from
  runtime evidence.
- **Archive/RAG retrieval** should consume explicit exports or projections, not
  reach directly into provider-native transcript stores as the only source of
  truth.

This keeps agent-native transcripts useful for continuity without making them
the only durable memory surface for the Cats suite.

## Design Rules

- Upper layers should depend on `cats-runtime`, not on provider-specific CLIs
- Product hosts should supervise `cats-runtime` as a separate process and use
  the HTTP boundary for readiness rather than source-importing runtime internals
- Hosts should use runtime-owned diagnostics surfaces rather than rebuilding
  provider availability checks above the runtime
- Historical `agent-fleet` references should stay confined to ADRs and migration notes
- Inbound transport code should stay in `src/http`, not in backend modules
- New API-key or Ollama integrations should land under `src/backends/api`
- External agent runtimes with their own run/session/event semantics should
  land under `src/backends/agent`
- Shared filesystem and shell tools should stay in `src/core/tools`, not inside one backend
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

*Last updated: 2026-03-21*
