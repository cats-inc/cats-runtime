# Setup Guide

> Environment setup and run instructions for `cats-runtime`.

## Prerequisites

- Node.js 22+
- Installed local CLIs for the providers you want to use (`claude`, `codex`,
  `gemini`, `cursor-agent`, `kiro-cli`, `opencode`, etc.)

## Quick Start (npx)

```bash
npx cats-runtime
```

If no `providers.yaml` exists, the runtime starts in **bootstrap mode** and
opens a provider setup page at `http://127.0.0.1:3110/`. The setup page scans
your machine for installed AI CLI tools and lets you select which to enable.
Clicking "Apply" writes a minimal `providers.yaml` and the runtime transitions
to normal mode in the same process.

## Installation (Source)

```powershell
cd cats-runtime
copy .env.example .env
npm install
npm test
```

For a package-style local run:

```powershell
npm run build
node dist/index.js
```

The package is now structured for executable npm distribution:

- `npm install -g cats-runtime` then `cats-runtime`
- `npx cats-runtime` once the package is published

Advanced operators can skip bootstrap by providing a valid config upfront:

```powershell
copy config\providers.yaml.example config\providers.yaml
# Edit providers.yaml to enable only the providers you need
cats-runtime
```

Supported startup flags:

- `--bootstrap` — force bootstrap/setup mode even with a valid config
- `--startup-mode <standalone|app-managed>`
- `--managed-by <host-name>`
- `--ready-output <plain|json|silent>`
- `--host <bind-host>`
- `--port <bind-port>`
- `--config <providers-config-path>`

## Bootstrap Mode

The runtime enters bootstrap mode when:

- No valid `providers.yaml` exists at the resolved config path
- The config file exists but cannot be parsed
- The config is valid but contains no usable provider targets
- The operator passes `--bootstrap`

In bootstrap mode:

- `GET /` serves the provider setup page
- Session and execution routes return `409 Conflict`
- `GET /health` reports `status: degraded` with `bootstrapRequired: true`
- `GET /dashboard` and `GET /playground` remain accessible

The bootstrap flow:

1. Open `http://127.0.0.1:3110/` (or the configured host/port)
2. Click "Auto Scan" or "Manual Scan" to detect installed providers
3. Check the providers you want to enable
4. Click "Apply" to generate `providers.yaml` and exit bootstrap mode
   If the generated config cannot be reloaded, setup stays in bootstrap mode
   and the UI/API reports the reload error instead of partially enabling normal routes

Setup artifacts are persisted under `<dataDir>/setup/`:

- `setup-state.json` — bootstrap workflow state
- `provider-scan.json` — latest scan results
- `provider-manual-scan.json` — latest manual scan results

### Discovery Posture

WSL discovery defaults to `if_running` — bootstrap auto-scan will not start
WSL distributions that are not already running. Docker discovery also defaults
to `if_running`. Use the "Manual Scan" button to trigger a full scan regardless
of discovery policy.

### LAN Peer Discovery and Execution Routing

LAN peer support is default-off and intentionally bounded to the execution-only
ADR-019 slice:

- discovery/registry state is separate from trust/auth
- the caller runtime keeps ownership of the host-visible session, history,
  observe state, and stream state
- peers may execute a bounded turn, but they do not become owners of the
  caller-visible `/sessions` lifecycle

Minimal peer env example:

```powershell
CATS_RUNTIME_PEERS_ENABLED=true
CATS_RUNTIME_PEER_ID=desk-a
CATS_RUNTIME_PEER_NAME=desk-a
CATS_RUNTIME_PEER_SHARED_SECRET=lan-secret
CATS_RUNTIME_PEER_TRUSTED_IDS=desk-b
CATS_RUNTIME_PEER_STATIC_PEERS=[{"peerId":"desk-b","displayName":"desk-b","advertisedUrl":"http://10.0.0.9:3110","providers":["codex"]}]
```

Relevant runtime-owned peer routes:

- `GET /peers`
- `GET /peers/{peerId}`
- `GET /diagnostics/peers`
- `POST /peer/executions`

`POST /peer/executions` is runtime-to-runtime only. It uses the peer shared
secret, not the normal host-facing `CATS_RUNTIME_API_KEY`.

Current auth/trust model:

- host-facing `CATS_RUNTIME_API_KEY` and peer-facing
  `CATS_RUNTIME_PEER_SHARED_SECRET` are separate
- inbound peer execution checks the bearer secret, the caller peer id, and an
  HMAC signature over the raw JSON request body
- use a strong random peer shared secret, preferably at least 32 characters
- trust is directional and configured per runtime with
  `CATS_RUNTIME_PEER_TRUSTED_IDS` / `CATS_RUNTIME_PEER_REJECTED_IDS`
- one-way traffic is supported, but not from one-sided config alone:
  for `A -> B`, runtime `A` must trust `B` for routing and runtime `B` must
  trust `A` for inbound execution
- current v0 auth is bearer-secret based; if you run outside a tightly trusted
  LAN, put the runtime behind TLS
- current v0 includes HMAC body signing, but it still does not include
  nonce/timestamp replay protection or per-peer credentials

Current topology boundary:

- yes, the current slice can operate as a small LAN mesh with multiple peers
  discovering and routing directly to one another
- no, it is not a full cluster/gossip mesh: there is no transitive trust,
  no automatic enrollment, no transparent failover, and no remote session /
  workspace / browser / wakeup ownership transfer

## Startup Contract

`cats-runtime` now freezes one startup contract for both supported process
modes:

- `standalone`: direct operator-managed startup
- `app-managed`: child-process startup supervised by a host such as `cats`

Contract version `1` is exposed through `GET /health` and
`GET /diagnostics/runtime`.

Readiness rules:

- process creation is not readiness
- `GET /health` is the authoritative readiness endpoint
- `readiness.phase` and `startup.phase` move through `starting`, `ready`,
  `stopping`, and `stopped`
- `CATS_RUNTIME_PORT=0` is valid when a host wants the OS to assign an
  ephemeral local port; the actual bound port is returned in `runtime.ready`
  and `GET /health`

Shutdown rules:

- in `app-managed` mode, prefer closing child stdin for the most portable stop
  path
- `SIGINT` and `SIGTERM` are also handled when the platform supports them
- app-managed JSON lifecycle output includes `runtime.ready`,
  `runtime.startup_error`, `runtime.stopping`, and `runtime.stopped`

Diagnostics rules:

- `GET /diagnostics/runtime` exposes startup contract, path resolution, and
  runtime listener metadata, including the compatibility evidence directory
- `GET /diagnostics/providers` exposes runtime-owned provider availability
  checks plus cached CLI compatibility summaries for host UX and setup flows
- CLI targets now also expose a machine-readable `setup` block describing the
  resolved install metadata, command state (`missing_install`, `missing_path`,
  `misconfigured_command`, etc.), install prerequisites, shell PATH
  persistence, npm prefix drift, auth state, version state, and additive
  remediation steps
- `GET /diagnostics/providers?probe=live` enables live probes where the current
  backend supports them
- `force=1|true|refresh` refreshes cached CLI compatibility assessments so
  install/upgrade flows can re-probe immediately

## Environment Variables

Keep `.env` for runtime-wide values and secrets:

- `CATS_RUNTIME_HOST=127.0.0.1`
- `CATS_RUNTIME_PORT=3110`
- `CATS_RUNTIME_API_KEY=`
- `CATS_RUNTIME_DATA_DIR=...`
- `CATS_RUNTIME_SESSION_BASE_DIR=...`
- `CATS_RUNTIME_CONFIG_PATH=config/providers.yaml`
- `CATS_RUNTIME_MAX_SESSIONS=10`
- `CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS=5000`
- `CATS_RUNTIME_WSL_DISCOVERY_POLICY=if_running`
- `CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS=15000`
- `CATS_RUNTIME_SPAWN_RETRIES=1`
- `CATS_RUNTIME_SPAWN_TIMEOUT_MS=30000`
- `CATS_RUNTIME_PEERS_ENABLED=false`
- `CATS_RUNTIME_PEER_ID=`
- `CATS_RUNTIME_PEER_NAME=`
- `CATS_RUNTIME_PEER_ADVERTISE_URL=`
- `CATS_RUNTIME_PEER_ADVERTISE_HOST=`
- `CATS_RUNTIME_PEER_ADVERTISE_PORT=`
- `CATS_RUNTIME_PEER_STALE_TTL_MS=30000`
- `CATS_RUNTIME_PEER_PRUNE_INTERVAL_MS=10000`
- `CATS_RUNTIME_PEER_ADVERTISE_INTERVAL_MS=15000`
- `CATS_RUNTIME_PEER_MAX_TARGETS=16`
- `CATS_RUNTIME_PEER_REQUEST_TIMEOUT_MS=120000`
- `CATS_RUNTIME_PEER_ALLOW_HEURISTIC_ROUTING=false`
- `CATS_RUNTIME_PEER_SHARED_SECRET=`
- `CATS_RUNTIME_PEER_TRUSTED_IDS=`
- `CATS_RUNTIME_PEER_REJECTED_IDS=`
- `CATS_RUNTIME_PEER_STATIC_PEERS=`
- `AUGGIE_MAX_TURNS=50`
- `PWSH_PATH=...`
- `OPENCLAW_URL=ws://127.0.0.1:8787/ws`
- `OPENCLAW_TOKEN=`
- `AGENT_SDK_URL=http://127.0.0.1:8082`
- `AGENT_SDK_TOKEN=`

Legacy provider-specific env vars still work, but new installs should prefer
`config/providers.yaml`.

Peer-specific notes:

- `CATS_RUNTIME_PEER_TRUSTED_IDS` and `CATS_RUNTIME_PEER_REJECTED_IDS` accept
  either comma-separated values or a JSON array
- `CATS_RUNTIME_PEER_STATIC_PEERS` accepts a JSON array of bounded peer seeds
- `CATS_RUNTIME_PEER_ALLOW_HEURISTIC_ROUTING` only enables additive opt-in
  routing heuristics; existing callers still stay local by default
- the current peer auth model uses one configured shared secret per runtime;
  full-mesh deployments usually standardize the same peer secret across all
  participating nodes, then constrain actual connectivity with peer-id trust
  lists
- replay resistance, auth failure rate limiting, secret rotation, per-peer
  credentials, and stronger mutual auth are later hardening work, not part of
  PLAN-017 v0
- advertise values should point at a host/port reachable by other LAN runtimes

## Provider Instances (`config/providers.yaml`)

`config/providers.yaml` defines provider topology:

- `environments`: named execution environments such as `native` or a WSL distro
- `routing.providers.<name>.default_target`: default backend and instance for that provider family
- `backends.cli.providers.<name>.instances.<id>`: command, runner, runtime, and provider-local storage
- `backends.api.providers.<name>.instances.<id>`: API-key backed instances where the provider family
  stays product-facing (`claude`, `codex`, `gemini`) and `transport` names the vendor API
- `backends.local.providers.<name>.instances.<id>`: local-model runtimes such as Ollama without
  mixing them into CLI instance maps
- `backends.agent.providers.<name>.instances.<id>`: external agent runtimes such as OpenClaw that
  own more of the run/session lifecycle than CLI or completion APIs

`backends.local` is intentionally a public config/routing distinction, even
though today's implementation still runs local HTTP model targets through
`src/backends/api`. In other words:

- `local` means "local-model semantics" in provider topology and UI
- `src/backends/api` is currently the shared execution machinery for both
  remote completion APIs and local HTTP model runtimes
- there is no separate `src/backends/local` yet because Ollama does not
  currently need a second runtime manager

Minimal example:

```yaml
version: 1
environments:
  native:
    kind: native
  ubuntu:
    kind: wsl
    distro: Ubuntu
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: native
    claude:
      default_target:
        backend: api
        instance: sonnet
    cursor:
      default_target:
        backend: cli
        instance: ubuntu
    ollama:
      default_target:
        backend: local
        instance: local
    openclaw:
      default_target:
        backend: agent
        instance: gateway
backends:
  cli:
    providers:
      codex:
        instances:
          native:
            environment: native
            command: codex
            runner: auto
            sessions_dir: ~/.codex/sessions
      cursor:
        instances:
          ubuntu:
            environment: ubuntu
            command: cursor-agent
            runner: auto
            chats_dir: ~/.cursor/chats
          native:
            environment: native
            command: cursor-agent
            runner: auto
            chats_dir: ~/.cursor/chats
  api:
    providers:
      claude:
        default_instance: sonnet
        transport: anthropic
        api_key_env: ANTHROPIC_API_KEY
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
  local:
    providers:
      ollama:
        instances:
          local:
            transport: ollama
            base_url: http://127.0.0.1:11434
            model: qwen2.5-coder:7b
  agent:
    providers:
      openclaw:
        default_instance: gateway
        transport: openclaw_gateway
        url_env: OPENCLAW_URL
        auth_token_env: OPENCLAW_TOKEN
        client_id: cats-runtime
        instances:
          gateway:
            model: openclaw-coder
      claude:
        default_instance: sdk
        transport: agent_sdk_bridge
        base_url_env: AGENT_SDK_URL
        auth_token_env: AGENT_SDK_TOKEN
        instances:
          sdk:
            model: claude-sonnet-4-20250514
```

This lets one provider expose multiple independently logged-in environments,
such as several WSL distros on one Windows host or dedicated Docker-backed
instances for providers that run inside containers.

For remote API providers, shared settings belong at the provider level. Put
`transport`, `api_key_env`, shared headers, and common limits once under
`backends.api.providers.<name>`, then let each instance override only what
actually differs, usually `model`. That avoids copying the same API key across
`claude.sonnet`, `gemini.flash`, and similar instance variants.

Agent backends follow the same pattern. Put shared gateway/auth settings such as
`transport`, `url_env`, `auth_token_env`, and `client_id` at the provider
level, then keep each instance block focused on the fields that actually vary,
usually `model`.

That means one provider family can expose multiple backend targets at once. For
example, `claude` can keep its default target on `cli/native`, still offer
`api/sonnet` under `backends.api.providers.claude`, and additionally expose an
external `agent/sdk` target through `backends.agent.providers.claude`.

Currently supported agent transports are:

- `openclaw_gateway`: WebSocket-backed OpenClaw execution
- `agent_sdk_bridge`: HTTP/SSE bridge to an external Agent SDK service such as
  `genai-gateway-agent`

Path semantics matter:

- File-backed providers (`claude`, `codex`, `copilot`, `gemini`, `auggie`, `pi`) use
  host-side discovery paths. `projects_dir` / `sessions_dir` must point to a
  path that the `cats-runtime` host process can read directly.
- On Windows, if one of those file-backed providers is configured as
  `runtime: wsl`, Linux-style paths such as `~/.codex/sessions` or
  `/home/user/.codex/sessions` are accepted. `cats-runtime` translates them to
  host-readable `\\wsl$\...` paths automatically for discovery. Explicit UNC
  paths still work when you want to pin an exact WSL location.
- Docker-backed file providers are different: host-side file discovery is
  currently skipped for `runtime: docker`, so `sessions_dir` may remain the
  container-local path that the CLI itself uses. The tradeoff is that routes
  which inspect provider-owned files from the host may return no sessions until
  Docker-backed file discovery is implemented.
- Pi can additionally define `instructions_file` on an instance. When present,
  `cats-runtime` passes that file through Pi's `--append-system-prompt` flag and
  rewrites/materializes the file path for WSL or Docker runtimes when needed.
- Cursor `chats_dir` and Kiro `db_path` are different: they are consumed by
  runtime-aware native services inside the selected runtime, so `~/.cursor/chats`
  and `~/.local/share/kiro-cli/data.sqlite3` remain valid for WSL-backed
  Cursor/Kiro instances.

The embedded dashboard reads `GET /providers/config` and uses it to populate the
provider-instance selector in the create-session modal. Providers configured in
`backends.cli`, `backends.api`, `backends.local`, or `backends.agent` all
appear there.

For CLI instances, `compatibility` remains `null` until the runtime has probed
or executed that target. Once primed, the cached summary includes the
classification, selected profile, version/runtime fingerprint, warnings, and
optional evidence artifact metadata surfaced by the shared compatibility engine.
Even before a probe runs, CLI instances expose static `install` metadata so
dashboards or packaged hosts can render install/auth/PATH guidance without
maintaining a second provider matrix. That metadata now includes copied
runtime-owned prerequisite, PATH-persistence, and npm-prefix knowledge, so
removing `environment-bootstrap/` does not break runtime setup diagnostics.
When the runtime can inspect provider-owned local config directly, the same
route may also expose additive `activeConfig` metadata. The first slice reads
Goose's local config file and reports the inferred upstream provider/model so
dashboards or playground samples can start from the runtime-owned default
selection instead of a hardcoded guess.

## Running the Project

### Manual start

```powershell
npm run dev
```

Then open `http://127.0.0.1:3110/` for the embedded dashboard, or call the HTTP
API directly. For the embedded multi-agent sample, open
`http://127.0.0.1:3110/playground`.

### Built executable start

```powershell
npm run build
node dist/index.js
```

This is the same entrypoint that the npm `bin` command uses for package-style
execution.

### App-managed local start

For host-supervised local startup, run the same binary in app-managed mode:

```powershell
node dist/index.js --startup-mode app-managed --managed-by cats --ready-output json
```

In that mode:

- stdout emits single-line JSON lifecycle events when the runtime changes state
- `GET /health` remains the authoritative readiness endpoint
- `GET /diagnostics/runtime` and `GET /diagnostics/providers` give hosts a
  machine-readable integration surface beyond raw stdout parsing
- the process stays a separate HTTP service rather than being source-imported
  into the host app
- graceful shutdown may be triggered by `SIGINT`, `SIGTERM`, or by closing the
  child stdin stream from the host process

By default, runtime metadata persists under `~/.cats-runtime/data` and runtime
session workspaces/transcripts persist under `~/.cats-runtime/sessions`. Override
either path with `CATS_RUNTIME_DATA_DIR` or `CATS_RUNTIME_SESSION_BASE_DIR` if
you need to relocate local state.

### Restart helper

```powershell
.\scripts\windows\Restart-Server.ps1
```

### Stop only

```powershell
.\scripts\windows\Restart-Server.ps1 -Stop
```

### Linux restart helper

```bash
./scripts/linux/restart-server.sh
```

### macOS restart helper

```bash
./scripts/macos/restart-server.sh
```

## Windows auto-start

Install startup shortcut:

```powershell
.\scripts\windows\Setup-AutoStart.ps1 -Install
```

Verify setup:

```powershell
.\scripts\windows\Setup-AutoStart.ps1 -Verify
```

Remove setup:

```powershell
.\scripts\windows\Setup-AutoStart.ps1 -Remove
```

## Linux auto-start

Install systemd user service:

```bash
./scripts/linux/setup-autostart.sh --install
```

Verify setup:

```bash
./scripts/linux/setup-autostart.sh --verify
```

Remove setup:

```bash
./scripts/linux/setup-autostart.sh --remove
```

## macOS auto-start

Install launchd agent:

```bash
./scripts/macos/setup-autostart.sh --install
```

Verify setup:

```bash
./scripts/macos/setup-autostart.sh --verify
```

Remove setup:

```bash
./scripts/macos/setup-autostart.sh --remove
```

## Verify Installation

```powershell
npm run build
npm test
Invoke-WebRequest http://127.0.0.1:3110/health -UseBasicParsing
```

The health payload includes startup metadata:

```json
{
  "service": "cats-runtime",
  "status": "ok",
  "version": "<package-version>",
  "startup": {
    "mode": "standalone",
    "readySignal": "http",
    "ready": true
  }
}
```

For host-side setup or Settings surfaces, use:

- `GET /diagnostics/runtime` to verify runtime contract, port binding, and
  resolved state paths, including where compatibility evidence bundles are
  written
- `GET /diagnostics/providers?force=1` to decide whether a provider is
  immediately usable, needs user action, is running in a degraded profile, or
  failed to probe after an install/update
- `GET /providers/config` to read the runtime-owned static `install` metadata
  for each configured CLI target before or between probes, plus any additive
  runtime-owned `activeConfig` hints such as Goose's detected local
  provider/model selection

To inspect the publish payload locally without using the global npm cache:

```powershell
$env:npm_config_cache = "$PWD/.npm-cache"
npm pack --dry-run
Remove-Item -Recurse -Force .npm-cache
```

## Common Issues

### Port 3110 already in use

Use:

```powershell
.\scripts\windows\Restart-Server.ps1 -Stop
```

Then restart, or change `CATS_RUNTIME_PORT` in `.env`.

### Native provider discovery logs errors

`cats-runtime` can discover native sessions from local CLIs. If a provider is not
installed or not executable in the current environment, that provider's discovery
scan may log an error. Fix the provider path or disable discovery with:

```powershell
CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS=0
```

On Windows, WSL-backed Cursor/Kiro discovery can also be made more conservative:

```powershell
CATS_RUNTIME_WSL_DISCOVERY_POLICY=if_running
```

Available values:

- `always`: background discovery may start WSL if needed
- `if_running`: scan only when the configured WSL distro is already running
- `manual_only`: do not run background WSL discovery for Cursor/Kiro

If you define multiple WSL-backed provider instances, `GET /discovery/status`
will report them separately as `cursor@ubuntu`, `cursor@debian`, `kiro@ubuntu`,
and so on. The same endpoint also reports Docker discovery policy/status for
Docker-backed native discovery targets. When peer discovery is enabled, the
same route also exposes an additive `lan` block describing peer discovery
status, registry counts, and discovery adapters.

---

*Last updated: 2026-03-25*
