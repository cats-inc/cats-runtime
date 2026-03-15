# cats-runtime

> Unified runtime for subscription CLIs today, API backends later.

## Overview

`cats-runtime` is the stable execution boundary for upper-layer products such as
`cats-inc` and `crew-chat-poc`. It now embeds the CLI runtime directly instead
of proxying to a second local sidecar service.

Current capabilities:

- session lifecycle management for CLI-backed runtimes
- streamed turns over SSE or NDJSON
- external session discovery for supported local tools
- file-based provider instance config for native and multi-WSL execution
- dashboard-side provider instance selection for session creation
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
- [ ] Add `backends/api` for pay-as-you-go API keys and Ollama

## Design Rules

- Public callers should depend on `cats-runtime`, not provider-specific CLIs
- `src/core` holds runtime-wide contracts and config
- `src/backends/cli` holds the embedded CLI runtime implementation
- `src/http` exposes the inbound HTTP contract
- Future API-native providers should land under `src/backends/api`

## Quick Start

```powershell
cd cats-runtime
copy .env.example .env
copy config\providers.yaml.example config\providers.yaml
npm install
npm run dev
```

Default URL: `http://127.0.0.1:3110`

Runtime state defaults under the user's home directory:

- registry metadata: `~/.cats-runtime/data`
- session workspaces and transcripts: `~/.cats-runtime/sessions`

## Key Files

- `src/index.ts` - process entrypoint and shutdown wiring
- `src/server.ts` - single-service runtime bootstrap
- `src/http/app.ts` - route registration and auth middleware
- `src/backends/cli/` - embedded CLI runtime modules
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
