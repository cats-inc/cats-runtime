# System Architecture

> Current architecture for the embedded `cats-runtime` service.

## Overview

`cats-runtime` now runs as a single service. The CLI runtime that previously
lived behind the `agent-fleet` HTTP boundary has been ported into this repo and
organized under `src/backends/cli`.

The architectural split is:

- `core`: shared runtime config and stable types
- `backends`: execution implementations (`cli` now, `api` later)
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
│  core contracts + config                 │
│  backends/cli session pool + discovery   │
└──────────┬────────────────────────────────┘
           │ subprocess / local files / local APIs
           ▼
┌───────────────────────────────────────────┐
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
    types.ts
  backends/
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
- Discovers external native sessions from supported tools
- Encapsulates provider-specific spawn, resume, fork, and permission logic

### `src/core`

- Loads runtime-wide configuration
- Defines stable exported runtime types
- Keeps shared utilities out of provider modules

## Data Flow

1. A caller sends a request to `cats-runtime`
2. `src/http` authenticates and routes the request
3. Session routes use `WorkerPool` and `SessionRegistry` inside `src/backends/cli`
4. Provider adapters spawn or resume the target CLI/runtime
5. Stream events are returned directly to the caller

## Design Rules

- Upper layers should depend on `cats-runtime`, not on provider-specific CLIs
- Historical `agent-fleet` references should stay confined to ADRs and migration notes
- New API-key or Ollama integrations should land under `src/backends/api`
- Inbound transport code should stay in `src/http`, not in backend modules

## Key Decisions

- [001: Use an HTTP adapter around agent-fleet first](./decisions/001-agent-fleet-http-adapter.md)
- [002: Embed the CLI runtime into cats-runtime](./decisions/002-embed-cli-runtime.md)

---

*Last updated: 2026-03-11*
