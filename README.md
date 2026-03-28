# cats-runtime

> Unified runtime for subscription CLIs, API backends, and local-model backends.

## Overview

`cats-runtime` is the stable execution boundary for upper-layer products such as
`cats` and `crew-chat-poc`. It now embeds the CLI runtime directly instead
of proxying to a second local sidecar service.

Current capabilities:

- session lifecycle management for CLI-backed runtimes
- session lifecycle management for API-backed Claude, Codex, and Gemini families plus local Ollama
- additive `cancel` / `reset` lifecycle primitives plus stronger remote-agent close/delete cleanup
- worktree-backed session isolation with deterministic prepare/recreate/cleanup semantics and explicit discard/merge/preserve reset/delete policies
- streamed turns over SSE or NDJSON
- additive runtime-owned `content_block` projections on streamed turn routes
  for host transcript rendering
- machine-readable session/run inspection payloads over `/sessions`, `/sessions/{id}/history`, and `/sessions/{id}/observe`
- runtime-owned maintenance metadata for reset boundaries, compaction readiness, pending memory-flush hooks, additive `pre_flush` seams, persisted maintenance trigger requests, and delete cleanup summaries
- public external-only compaction-preparation coordination over `POST /sessions/{id}/compact`
- a lightweight browser/preview substrate with runtime-owned browser sessions/pages, a pluggable driver seam, and manual browser-page preview registration
- provider-agnostic `progress` events across Junie, Pi, Goose, Copilot, and API/local transports
- runtime-hosted local tools for API/local sessions (`list_files`, `read_file`, `write_file`, `grep`, `run_shell`)
- external session discovery for supported local tools
- file-based provider topology with separated `routing` / `backends` sections
- dashboard-side provider instance selection for session creation
- embedded multi-agent playground sample at `/playground`
- runtime-owned MCP facade over `POST /mcp` and the `cats-runtime-mcp` stdio binary for orchestrator-style agents
- curated MCP mutation tools for `create_session`, `send_message`, `fork_session`, `init_workspace`, and `commit_changes`
- runtime-managed skills with session-level requested/resolved/applied metadata plus a family-aware internal skill library
- additive workspace/skill hydration metadata that distinguishes runtime cwd from the authoritative workspace source
- explicit `skills: null` clearing for create/message/fork session flows
- backend-aware skill delivery modes (`filesystem`, `instructions`, `none`)
- shared skill re-entry for create/resume/fork so persisted skills are re-derived per target/backend instead of reusing stale delivery artifacts
- strict `default` instance aliasing and host-path validation for file-backed providers
- provider-specific helpers such as Kiro model inspection
- runtime-owned usage metering, incident surfacing, and additive execution guardrails for warn / block / cooldown flows
- shared CLI compatibility probing with `light` / `live` validation, degraded profile selection, stale-cache-aware summaries, machine-readable reprobe metadata, and replay-friendly evidence capture across first-party CLI provider families
- runtime-owned provider event capability truth on `/providers/config`, so
  hosts can inspect normalized text/tool/progress/block posture without
  hard-coding provider behavior

## Current Status

- [x] Bootstrap the subproject
- [x] Embed the CLI runtime into `cats-runtime`
- [x] Remove the external HTTP hop
- [x] Port the runtime dashboard into `cats-runtime`
- [x] Port the CLI runtime test surface into `cats-runtime`
- [x] Migrate `crew-chat-poc` to call `cats-runtime`
- [x] Add file-based provider instances for multi-environment CLI accounts
- [x] Resolve accepted review follow-ups for provider-instance hardening
- [x] Add `backends/api` for pay-as-you-go API keys and Ollama
- [x] Land runtime-managed skills v0 session and delivery contract
- [x] Freeze the first runtime-owned internal skill library taxonomy and metadata contract
- [x] Stabilize workspace hydration and runtime skill re-entry across create/resume/fork
- [x] Add worktree-backed session isolation and cleanup discipline across create/resume/reset/delete/fork
- [x] Add first-slice runtime usage metering, rate-limit/quota incident surfacing, and provider-agnostic progress contracts
- [x] Add the first provider compatibility/evidence engine slice for CLI-backed providers
- [x] Add provider-agnostic run-inspector/session-discipline contracts across CLI, API, and agent backends
- [x] Add session maintenance hooks and cleanup discipline for long-running lifecycle boundaries
- [x] Add the first browser/preview substrate with manual driver validation and normalized `browser_page` surfaces
- [x] Add a usable runtime-owned MCP facade with stdio transport and curated mutation tools without replacing direct HTTP APIs
- [x] Add LAN peer discovery, diagnostics, trust-gated execution routing, and caller-owned peer turn relay for PLAN-017 v0
- [x] Publish host-facing provider event capability truth on `/providers/config`
      for provider selection and future rendering contracts
- [x] Publish a runtime-owned streamed `content_block` contract for live host
      transcript rendering

## Design Rules

- Public callers should depend on `cats-runtime`, not provider-specific CLIs
- `src/core` holds runtime-wide contracts and config
- `src/backends/cli` holds the embedded CLI runtime implementation
- `src/backends/api` holds API-key and local-model runtime implementations
- `src/http` exposes the inbound HTTP contract

## Quick Start

```powershell
cd cats-runtime
copy .env.example .env
npm install
npm run dev
```

Default URL: `http://127.0.0.1:3110`

If no valid `providers.yaml` exists, the runtime starts in bootstrap mode and
lets you generate a minimal config from the setup page at `GET /`.

Embedded UIs:

- dashboard: `http://127.0.0.1:3110/`
- playground: `http://127.0.0.1:3110/playground`

## Package-Ready Startup

`cats-runtime` is now shaped to publish as an executable npm package:

- `npm install -g cats-runtime` then `cats-runtime`
- `npx cats-runtime` once the package is published

The executable package starts the same runtime entrypoint as `npm start` and
supports either bootstrap-first startup with no preexisting `providers.yaml`,
or a preseeded valid config / equivalent environment overrides.

Published package contents now also include the runtime-owned `skills/`
library so validated skill packages ship with the executable boundary instead
of only existing in the source checkout.

Supported process startup modes:

- `standalone` for direct local runs
- `app-managed` for child-process supervision by hosts such as `cats`

The executable entry also supports:

- `--startup-mode <standalone|app-managed>`
- `--managed-by <host-name>`
- `--ready-output <plain|json|silent>`
- `--host <bind-host>`
- `--port <bind-port>`
- `--config <providers-config-path>`

For packaged-style local verification before publish:

```powershell
npm run build
node dist/index.js
```

For an app-managed local start, prefer machine-readable readiness output:

```powershell
node dist/index.js --startup-mode app-managed --managed-by cats --ready-output json
```

For graceful local shutdown, a supervising host may either send `SIGINT` /
`SIGTERM` or close the child process stdin stream.

`GET /health` now includes runtime startup metadata so supervising hosts can
confirm mode, PID, readiness state, and bound address over the public HTTP
boundary.

Runtime state defaults under the user's home directory:

- registry metadata: `~/.cats-runtime/data`
- session workspaces and transcripts: `~/.cats-runtime/sessions`

## Key Files

- `src/index.ts` - process entrypoint and shutdown wiring
- `src/server.ts` - single-service runtime bootstrap
- `src/http/app.ts` - route registration and auth middleware
- `src/core/hydration/` - runtime-owned workspace/skill re-entry helpers
- `src/core/workspace/` - shared/isolated/worktree workspace prepare and cleanup helpers
- `src/core/usage/` - runtime-owned metering, incident, and guardrail helpers
- `src/backends/cli/` - embedded CLI runtime modules
- `src/backends/api/` - API-key and local-model runtime modules
- `config/providers.yaml.example` - reference topology for manual/preseeded config
- `docs/api.md` - public HTTP surface
- `docs/architecture.md` - internal layout and data flow

## Usage Metering

`cats-runtime` now adds an additive metering layer over streamed execution:

- `GET /diagnostics/runtime` exposes the full metering snapshot with usage aggregates, recent incidents, and active/configured guardrails
- `GET /diagnostics/health` includes a compact `metering` summary for host polling and dashboards
- `POST /sessions/{id}/messages` may emit a leading `progress` event with `metadata.kind: "guardrail"` or reject execution with `guardrail_blocked` / `guardrail_cooldown`

First-slice configuration lives in `.env`:

- `CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_WARN`
- `CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_BLOCK`
- `CATS_RUNTIME_RATE_LIMIT_COOLDOWN_MS`

## Documentation

See [docs/](./docs/) for detailed documentation:

- [Setup Guide](./docs/setup-guide.md)
- [Architecture](./docs/architecture.md)
- [API](./docs/api.md)
- [Contributing](./CONTRIBUTING.md)

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
