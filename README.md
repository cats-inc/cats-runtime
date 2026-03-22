# cats-runtime

> Unified runtime for subscription CLIs, API backends, and local-model backends.

## Overview

`cats-runtime` is the stable execution boundary for upper-layer products such as
`cats-inc` and `crew-chat-poc`. It now embeds the CLI runtime directly instead
of proxying to a second local sidecar service.

Current capabilities:

- session lifecycle management for CLI-backed runtimes
- session lifecycle management for API-backed Claude, Codex, and Gemini families plus local Ollama
- streamed turns over SSE or NDJSON
- runtime-hosted local tools for API/local sessions (`list_files`, `read_file`, `write_file`, `grep`, `run_shell`)
- external session discovery for supported local tools
- file-based provider topology with separated `routing` / `backends` sections
- dashboard-side provider instance selection for session creation
- runtime-managed skills with session-level requested/resolved/applied metadata
- backend-aware skill delivery modes (`filesystem`, `instructions`, `none`)
- strict `default` instance aliasing and host-path validation for file-backed providers
- provider-specific helpers such as Kiro model inspection

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
copy config\providers.yaml.example config\providers.yaml
npm install
npm run dev
```

Default URL: `http://127.0.0.1:3110`

## Package-Ready Startup

`cats-runtime` is now shaped to publish as an executable npm package:

- `npm install -g cats-runtime` then `cats-runtime`
- `npx cats-runtime` once the package is published

The executable package starts the same runtime entrypoint as `npm start` and
still expects `.env` plus `config/providers.yaml` or equivalent environment
overrides.

Supported process startup modes:

- `standalone` for direct local runs
- `app-managed` for child-process supervision by hosts such as `cats-inc`

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
node dist/index.js --startup-mode app-managed --managed-by cats-inc --ready-output json
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
- `src/backends/cli/` - embedded CLI runtime modules
- `src/backends/api/` - API-key and local-model runtime modules
- `config/providers.yaml.example` - file-based provider instance topology
- `docs/api.md` - public HTTP surface
- `docs/architecture.md` - internal layout and data flow

## Documentation

See [docs/](./docs/) for detailed documentation:

- [Setup Guide](./docs/setup-guide.md)
- [Architecture](./docs/architecture.md)
- [API](./docs/api.md)
- [Contributing](./CONTRIBUTING.md)

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
