# System Architecture

> Current architecture for the embedded `cats-runtime` service.

## Overview

`cats-runtime` now runs as a single service. The CLI runtime that previously
lived behind the `agent-fleet` HTTP boundary has been ported into this repo and
organized under `src/backends/cli`, while API-key and local-model execution now
live under `src/backends/api`.

Provider execution topology now comes from `config/providers.yaml` when present.
That file maps each provider to one or more named instances, and each instance
maps to an execution environment such as `native` or a specific WSL distro.
File-backed providers still discover sessions from the host process, so their
discovery paths are resolved as host filesystem paths rather than
environment-relative guest paths.

The architectural split is:

- `core`: shared runtime config and stable types
- `backends`: execution implementations for CLI, API, and local-model targets
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
└──────────┬────────────────────────────────┘
           │ subprocess / local files / remote APIs / local APIs
           ▼
┌───────────────────────────────────────────┐
│ Claude / OpenAI / Gemini / Ollama APIs   │
│ Claude / Codex / Gemini / Kiro / Cursor  │
│ Auggie / OpenCode local runtimes         │
└───────────────────────────────────────────┘
```

## Internal Layout

```text
src/
  core/
    config.ts
    dotenv.ts
    providerCatalog.ts
    runtime/
    tools/
    types.ts
  backends/
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

### `src/core/tools`

- Defines the shared local tool set exposed to API/local sessions
- Enforces workspace boundaries and permission policy centrally
- Executes file listing, file read/write, grep, and shell commands
- Normalizes tool activity into stream events and transcript records

### `src/core`

- Loads runtime-wide configuration
- Defines stable exported runtime types
- Keeps shared utilities out of provider modules

## Data Flow

1. A caller sends a request to `cats-runtime`
2. `src/http` authenticates and routes the request
3. `RuntimeSessionManager` resolves the configured backend target for the chosen provider instance
4. CLI targets flow into `WorkerPool`; API/local targets flow into `ApiBackendManager`
5. API/local turns may enter the shared local tool loop in `src/core/tools`
6. Stream events are returned directly to the caller

For WSL-backed Cursor/Kiro discovery:

1. Background discovery enumerates configured Cursor/Kiro provider instances
2. Background discovery checks the configured WSL discovery policy
3. `always` scans directly, `if_running` only scans already-running distros, and
   `manual_only` disables background WSL scans
4. The runtime records discovery state per `provider@instance` for dashboard
   polling via `GET /discovery/status`

For file-backed providers:

1. The runtime resolves instance-specific discovery paths on the host
2. On Windows, WSL-backed file providers must use host-accessible paths such as
   `\\wsl$\Distro\...`
3. Ambiguous guest-relative paths are rejected during bootstrap instead of
   falling through to watcher/scanner failures later

## Design Rules

- Upper layers should depend on `cats-runtime`, not on provider-specific CLIs
- Historical `agent-fleet` references should stay confined to ADRs and migration notes
- Inbound transport code should stay in `src/http`, not in backend modules
- New API-key or Ollama integrations should land under `src/backends/api`
- Shared filesystem and shell tools should stay in `src/core/tools`, not inside one backend
- Keep `.env` focused on runtime-wide values; provider topology belongs in
  `config/providers.yaml`

## Key Decisions

- [001: Use an HTTP adapter around agent-fleet first](./decisions/001-agent-fleet-http-adapter.md)
- [002: Embed the CLI runtime into cats-runtime](./decisions/002-embed-cli-runtime.md)
- [003: Move provider execution topology into file-based provider instances](./decisions/003-provider-instance-config.md)
- [004: Resolve file-backed provider paths on the host](./decisions/004-file-backed-paths-are-host-resolved.md)
- [005: Introduce a backend-neutral runtime facade for CLI and API backends](./decisions/005-backend-neutral-runtime-and-api-backend.md)

---

*Last updated: 2026-03-16*
