# cats-runtime

> Unified runtime for subscription CLIs, API backends, and local-model backends.

## Overview

`cats-runtime` is the stable execution boundary for upper-layer products such as
`cats-platform` and `crew-chat-poc`. It now embeds the CLI runtime directly instead
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
- runtime-owned MCP facade with authoritative execution on `POST /mcp` plus the published `cats-runtime mcp` stdio proxy entrypoint and a repo-local equivalent at `node build/runtime/bin/mcp.js`
- curated MCP mutation tools for `create_session`, `send_message`, `fork_session`, `init_workspace`, and `commit_changes`
- runtime-managed skills with session-level requested/resolved/applied metadata plus a family-aware internal skill library
- additive workspace/skill hydration metadata that distinguishes runtime cwd from the authoritative workspace source
- explicit `skills: null` clearing for create/message/fork session flows
- backend-aware skill delivery modes (`filesystem`, `instructions`, `none`)
- shared skill re-entry for create/resume/fork so persisted skills are re-derived per target/backend instead of reusing stale delivery artifacts
- strict `default` instance aliasing and host-path validation for file-backed providers
- provider-specific helpers such as Kiro model inspection plus Kilo/OpenCode
  native-session discovery
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

MCP usage:

- use `POST /mcp` when the host can speak HTTP JSON-RPC directly
- use `cats-runtime mcp` as the package-facing stdio MCP entrypoint
- use `node build/runtime/bin/mcp.js` only as the repo-local equivalent for
  stdio-only MCP hosts such as MCP Studio
- the stdio MCP helper now proxies to an already-running primary
  `cats-runtime` and does not start a second independent runtime core
- set `CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS` to override the stdio proxy timeout
  when a stdio-only host needs a different upstream request window
- run `cats-runtime mcp --inspect-proxy` when you want a local JSON preflight
  of the current proxy target, auth posture, timeout, and `ping` reachability
- `node build/runtime/bin/mcp.js --inspect-proxy` remains the repo-local
  equivalent of that same preflight helper

Workspace substrate helper:

- use `node build/runtime/bin/workspaceSubstrate.js` or the wrapper scripts under
  `scripts/` when you need a repo-owned CLI helper for `audit-workspace`,
  `init-workspace`, or `update-workspace`
- the helper prints JSON to stdout and uses the same conservative
  create/update/review-copy semantics as the runtime-owned workspace substrate
- example preview:
  `node build/runtime/bin/workspaceSubstrate.js --operation audit --workspace-path . --profile standard --agent codex`
- example apply:
  `node build/runtime/bin/workspaceSubstrate.js --operation update --workspace-path . --profile a2a-enabled --agent codex --apply --actor-role boss_cat`

## Package-Ready Startup

`cats-runtime` is now shaped for repo-local executable package verification, and
is intended to publish as an executable npm package once the first registry
release is ready:

- `npm install -g cats-runtime` then `cats-runtime`
- `npm install -g cats-runtime` then `cats-runtime mcp` for stdio MCP hosts
- `npx cats-runtime` once the package is published

The first public package name is frozen to the unscoped package
`cats-runtime`, and prerelease validation should use the `next` dist-tag rather
than `latest`.

For local packaged-flow verification before publish, use the platform helper
scripts:

- Linux: `./scripts/linux/pack-install.sh`
- macOS: `./scripts/macos/pack-install.sh`
- Windows: `.\scripts\windows\Pack-Install.ps1`

Each helper supports interactive install/delete prompts plus explicit
`--pack-only`, `--install`, `--clean`, and `--skip-build` modes.

The repo also includes a non-publishing GitHub Actions preflight workflow at
`../.github/workflows/cats-runtime-release-preflight.yml` that runs
`npm run release:check` without attempting a registry publish.

The repo also now carries a manual publish workflow at
`../.github/workflows/cats-runtime-npm-publish.yml` with OIDC
`id-token: write` permission and `next` / `latest` dist-tag selection, but that
workflow is still only a repo-owned skeleton until the exact npm trusted
publisher is configured against the matching GitHub repository and workflow
filename.

The executable package starts the same runtime entrypoint as `npm start` and
supports either bootstrap-first startup with no preexisting `providers.yaml`,
or a preseeded valid config / equivalent environment overrides.

Published package contents now also include the runtime-owned `skills/`
library so validated skill packages ship with the executable boundary instead
of only existing in the source checkout.

Supported process startup modes:

- `standalone` for direct local runs
- `app-managed` for child-process supervision by hosts such as `cats-platform`

The executable entry also supports:

- `--startup-mode <standalone|app-managed>`
- `--managed-by <host-name>`
- `--ready-output <plain|json|silent>`
- `--host <bind-host>`
- `--port <bind-port>`

For direct packaged-style local verification before publish:

```powershell
npm run build
node build/runtime/index.js
```

For an app-managed local start, prefer machine-readable readiness output:

```powershell
node build/runtime/index.js --startup-mode app-managed --managed-by cats --ready-output json
```

For graceful local shutdown, a supervising host may either send `SIGINT` /
`SIGTERM` or close the child process stdin stream.

`GET /health` now includes runtime startup metadata so supervising hosts can
confirm mode, PID, readiness state, and bound address over the public HTTP
boundary.

Runtime state defaults under the user's home directory:

- registry metadata: `~/.cats/runtime/data`
- session workspaces and transcripts: `~/.cats/runtime/sessions`
- provider topology config: `~/.cats/runtime/config/providers.yaml`
- management adapter config: `~/.cats/runtime/config/management.yaml`
- curated model catalog input: `~/.cats/runtime/config/curated-model-catalogs.yaml`

Override the runtime storage root with `CATS_RUNTIME_DIR` when needed.

## Curated CLI Catalogs

`cats-runtime` now accepts a human-curated CLI model catalog at:

- `~/.cats/runtime/config/curated-model-catalogs.yaml`
- repo example: `config/curated-model-catalogs.yaml.example`

Current runtime behavior:

- Claude, Codex, Gemini, and Cursor can all consume curated YAML on the CLI
  static-fallback path
- Claude, Codex, Gemini, and Cursor advanced catalogs also consume the same
  curated input
- for those advanced catalogs, the curated `models[]` or flattened
  `providers[]` entry list is authoritative for entry filtering and ordering
- dynamic discovery or config-backed catalogs still take precedence when those
  sources are available; the curated file is the runtime-owned static fallback
  seam, not a replacement for verified live discovery

Current stabilization status:

- Claude, Codex, and Gemini curated CLI support now has model-layer and
  route-layer regression coverage on both `/providers/{provider}/models` and
  `/providers/{provider}/models/advanced`
- Cursor curated support remains available, but grouped `providers[]`
  behavior is still the more likely place for future follow-up changes

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
- `config/curated-model-catalogs.yaml.example` - human-curated CLI model catalog input example consumed by the current Claude/Codex/Gemini/Cursor importer slices
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
