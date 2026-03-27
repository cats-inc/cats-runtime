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
- `--diagnose-setup` — generate a setup diagnostic report and exit without starting the HTTP server
- `--list-setup-diagnostic-reports` — list retained setup diagnostic reports and exit without starting the HTTP server
- `--read-setup-diagnostic-report <artifactId>` — re-read one retained setup diagnostic report and exit
- `--setup-report-limit <count>` — cap retained setup report listing output
- `--probe-provider-evolution` — run a manual provider-evolution probe and exit without starting the HTTP server
- `--probe-provider <provider>` — required with `--probe-provider-evolution`
- `--probe-instance <instance>` — optional instance override for the selected provider
- `--probe-profile <manual_smoke|manual_text>` — optional probe profile override
- `--probe-model <model>` — optional model override for the probe run
- `--refresh-setup-scan` — refresh the shared setup scan before generating the setup diagnostic report
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

When you need a shareable operator/debug snapshot after startup, the runtime
now also supports a setup diagnostic report:

```text
POST /diagnostics/setup-report
GET  /diagnostics/setup-report
GET  /diagnostics/setup-report/latest
GET  /diagnostics/setup-report/:artifactId
```

`POST /diagnostics/setup-report` writes a redacted JSON artifact under
`<dataDir>/diagnostics/` and returns both the generated `report` payload and
the local `artifactPath`. Pass `{"refreshScan": true}` or `?refresh=1` when
you want the runtime to refresh the shared setup scan before generating the
report.

When the HTTP server itself cannot start, you can generate the same artifact
from the runtime entrypoint:

```powershell
node dist/index.js --diagnose-setup
node dist/index.js --diagnose-setup --refresh-setup-scan
node dist/index.js --list-setup-diagnostic-reports --setup-report-limit 5
node dist/index.js --read-setup-diagnostic-report setup-report-20260327T010203000Z
```

The CLI path writes the same redacted artifact under `<dataDir>/diagnostics/`
and prints a concise operator summary to stderr plus the machine-readable JSON
payload to stdout with `status`, `artifactPath`, and `report`. Use this path
when port conflicts or other startup failures make the running HTTP action
unavailable.

The same manual CLI seam can now inspect retained setup-report history without
starting the HTTP server:

- `--list-setup-diagnostic-reports` prints newest-first retained report
  summaries to stdout JSON and a concise operator summary to stderr
- `--read-setup-diagnostic-report <artifactId>` re-reads one retained report by
  id and prints the full stored report JSON to stdout
- `--setup-report-limit <count>` narrows the retained listing when operators
  only want the latest few snapshots

When you want to inspect provider event drift manually without opening any
public HTTP surface, use the provider-evolution probe entrypoint:

```powershell
node dist/index.js --probe-provider-evolution --probe-provider codex
node dist/index.js --probe-provider-evolution --probe-provider claude --probe-profile manual_text
node dist/index.js --probe-provider-evolution --probe-provider claude --probe-instance agent/sdk
node dist/index.js --probe-provider-evolution --probe-provider goose --probe-model anthropic/claude-sonnet-4
node dist/index.js --probe-provider-evolution --probe-provider codex --probe-reference release_notes=https://docs.example.com/releases/codex-cli-1-2-3 --probe-reference changelog=https://docs.example.com/changelog/codex-cli
node dist/index.js --list-provider-evolution-artifacts --probe-provider codex --probe-limit 5
node dist/index.js --list-provider-evolution-artifacts --probe-provider claude --probe-instance agent/sdk
node dist/index.js --list-provider-evolution-artifacts --probe-provider claude --probe-parser agent_sdk_http_v1 --probe-transport agent
node dist/index.js --list-provider-evolution-artifacts --probe-provider codex --probe-classification regression
node dist/index.js --read-provider-evolution-artifact artifact-id --probe-provider codex
node dist/index.js --review-provider-evolution-artifact artifact-id --probe-provider codex --probe-classification regression --probe-review-summary "Manual review flagged a regression." --probe-highlight "Removed event types: tool_result" --probe-reference issue=https://docs.example.com/issues/codex-cli-regression
```

The probe path is intentionally manual-first and currently supports the
highest-value CLI families first: `codex`, `copilot`, `pi`, `goose`,
`gemini`, and `claude`. It now also supports the first agent-backed targets
through the same retained-artifact flow when the selected provider resolves to
an `agent/<instance>` target such as `claude` on `agent/sdk`.

Each probe writes a machine-readable artifact under
`<dataDir>/compatibility/provider-evolution/` and prints a concise stderr
summary plus stdout JSON with:

- the local `artifactPath`
- the captured evidence bundle
- a derived capability snapshot
- optional `reviewContext.references[]` for manually attached release-note,
  changelog, issue, or announcement URLs
- baseline compare output against the latest matching prior artifact, when one exists

The same manual-first CLI flow can now inspect retained probe history without
opening any public HTTP surface:

- `--list-provider-evolution-artifacts` prints a concise stderr summary and
  machine-readable stdout JSON with newest-first retained artifact summaries
- `--read-provider-evolution-artifact <artifactId>` re-reads one retained
  artifact and prints the full stored artifact JSON to stdout
- `--review-provider-evolution-artifact <artifactId>` updates one retained
  artifact's review metadata in place and prints the updated artifact JSON to
  stdout
- `--probe-provider`, `--probe-instance`, `--probe-parser`,
  `--probe-transport`, and `--probe-profile` can scope the retained-artifact
  listing, and `--probe-limit <count>` caps list output
- `--probe-classification <classification>` can be repeated during list/read
  flows to focus triage on artifacts whose review already includes
  `baseline`, `stable`, `upgrade`, `regression`, `schema_change`, or
  `semantic_drift_suspected`
- the same `--probe-classification`, `--probe-review-summary <text>`,
  `--probe-highlight <text>`, and `--probe-reference <kind=url>` flags can be
  used with `--review-provider-evolution-artifact` to write back manual review
  decisions without rerunning a probe or opening a public write route
- `--probe-reference <kind=url>` can be repeated during probe generation to
  attach manual release-note or changelog context without mixing that material
  into the runtime-owned evidence bundle

The current agent-backed slice stays manual-first and transport-neutral:

- it reuses the same capability snapshot / baseline-compare artifact contract
  as CLI probes
- it does not add a new public HTTP route
- the first delivered adapter instrumentation is on Agent SDK bridge and
  OpenClaw gateway, which now record ignored, unknown, schema-failure, and
  raw-passthrough transport frames alongside normalized shared runtime events
  such as `text`, `tool_use`, `tool_result`, `raw`, and `result`

`GET /diagnostics/setup-report` lists the retained reports newest-first with
their `artifactId`, `artifactPath`, `generatedAt`, and bounded summary fields.
Use `?limit=<n>` when you only want the latest few retained snapshots.

`GET /diagnostics/setup-report/:artifactId` re-reads a specific retained report
by `artifactId` so operators can compare an older setup snapshot with the
current latest report without digging through the data directory manually.

`GET /setup-state` now also exposes a shared runtime-owned repair read model for
post-bootstrap follow-through:

- `repair.status` / `repair.nextAction` tell operators whether the next step is
  to run a manual scan, apply ready providers, or review remediation
- `repair.providersReadyToApply` surfaces the ready provider ids/families that
  can be passed directly to `POST /setup-apply`
- `repair.providersNeedingAttention` now includes bounded remediation previews
  for providers that still need repair
- `repair.actions` provides ordered runtime-owned follow-up actions using the
  existing `/setup-scan`, `/setup-apply`, and `/diagnostics/setup-report` routes
- `diagnostics.latestReport` points at the latest persisted setup report summary
  when one already exists under `<dataDir>/diagnostics/`

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

The read-only peer routes now also surface additive network-posture diagnostics:

- whether peer shared-secret auth is configured
- whether the local advertised endpoint is TLS, trusted-LAN plaintext, or unresolved
- whether discovered peers are TLS-fronted, trusted-LAN plaintext, externally exposed plaintext, or missing stable advertised endpoints

`POST /peer/executions` is runtime-to-runtime only. It uses the peer shared
secret, not the normal host-facing `CATS_RUNTIME_API_KEY`.

Current auth/trust model:

- host-facing `CATS_RUNTIME_API_KEY` and peer-facing
  `CATS_RUNTIME_PEER_SHARED_SECRET` / `CATS_RUNTIME_PEER_SHARED_SECRETS` are
  separate
- inbound peer execution checks the bearer secret, the caller peer id, and an
  HMAC signature over the raw JSON request body plus
  `x-cats-peer-timestamp` / `x-cats-peer-nonce`, using
  `x-cats-peer-signature: sha256=<64-hex>`
- `CATS_RUNTIME_PEER_LIMIT_OVERRIDES` can tighten quotas for specific trusted
  peer ids without changing the global defaults; supported override keys are
  `maxAuthFailuresPerWindow`, `maxInboundExecutions`, and
  `maxReplayNoncesPerCaller`
- use a strong random peer shared secret, preferably at least 32 characters
- trust is directional and configured per runtime with
  `CATS_RUNTIME_PEER_TRUSTED_IDS` / `CATS_RUNTIME_PEER_REJECTED_IDS`
- one-way traffic is supported, but not from one-sided config alone:
  for `A -> B`, runtime `A` must trust `B` for routing and runtime `B` must
  trust `A` for inbound execution
- current v0 auth is bearer-secret based; if you run outside a tightly trusted
  LAN, put the runtime behind TLS
- current v0 includes HMAC body signing plus bounded nonce/timestamp replay
  protection, but it still does not include per-peer credentials
- use `/peers`, `/peers/{peerId}`, or `/diagnostics/peers` to confirm the
  runtime sees your local/remote peer endpoints as TLS-fronted versus
  trusted-LAN plaintext before enabling broader peer routing

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
  runtime listener metadata, including the compatibility evidence directory and
  the runtime-wide wakeup snapshot under `runtime.wakeups`
- `GET /diagnostics/providers` exposes runtime-owned provider availability
  checks plus cached CLI compatibility summaries for host UX and setup flows
- when a retained manual provider-evolution artifact exists for a target, the
  same diagnostics surface also exposes additive
  `providerEvolution.latestArtifact` summary data so operators can inspect the
  latest capability snapshot/review without rerunning the probe
- `GET /providers/config` now reuses the same retained artifact summary on
  matching instance entries, so provider-selection flows can fetch topology and
  the latest provider-evolution review in one call
- agent targets now also expose additive `config.agentRuntime` metadata plus an
  `agent_runtime_contract` check so operators can read gateway-vs-bridge
  transport, auth, and continuity semantics without opening a session
- `GET /diagnostics/health` includes polling-friendly wakeup aggregate counts
  under top-level `wakeups`
- CLI targets now also expose a machine-readable `setup` block describing the
  resolved install metadata, command state (`missing_install`, `missing_path`,
  `misconfigured_command`, etc.), install prerequisites, shell PATH
  persistence, npm prefix drift, auth state, version state, and additive
  remediation steps
- `GET /diagnostics/providers?probe=live` enables live probes where the current
  backend supports them; API/local targets now use transport-native model/tag
  probe requests (`/v1/models`, `/v1beta/models`, `/api/tags`) and expose
  redacted `config.liveProbe` request metadata such as the semantic target,
  applied auth mode, and request header names; Agent SDK bridge targets also
  validate provider-registry listing, configured-model visibility, and
  registry-declared streaming support before reporting a live bridge target as
  fully ready
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
- `CATS_RUNTIME_PEER_AUTH_FAILURE_WINDOW_MS=60000`
- `CATS_RUNTIME_PEER_AUTH_FAILURE_LIMIT=5`
- `CATS_RUNTIME_PEER_MAX_INBOUND_EXECUTIONS=8`
- `CATS_RUNTIME_PEER_MAX_INBOUND_EXECUTIONS_PER_PEER=2`
- `CATS_RUNTIME_PEER_REPLAY_WINDOW_MS=120000`
- `CATS_RUNTIME_PEER_REPLAY_NONCE_TTL_MS=120000`
- `CATS_RUNTIME_PEER_MAX_REPLAY_NONCES_PER_CALLER=64`
- `CATS_RUNTIME_PEER_LIMIT_OVERRIDES=[{"peerId":"desk-b","maxInboundExecutions":1,"maxAuthFailuresPerWindow":3,"maxReplayNoncesPerCaller":16}]`
- `CATS_RUNTIME_PEER_ALLOW_HEURISTIC_ROUTING=false`
- `CATS_RUNTIME_PEER_SHARED_SECRET=`
- `CATS_RUNTIME_PEER_SHARED_SECRETS=`
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
- the runtime now supports secret overlap windows: keep the current outbound
  secret in `CATS_RUNTIME_PEER_SHARED_SECRET` and list older inbound-only
  secrets in `CATS_RUNTIME_PEER_SHARED_SECRETS` during mesh-wide rotation
- auth failure throttling and inbound execution admission control now exist as
  bounded hardening defaults, but replay resistance, per-peer credentials, and
  stronger mutual auth are still later follow-up work
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
Agent-backed instances now also expose additive `agentRuntime` metadata so the
selector and operator tooling can distinguish gateway-vs-bridge targets, read
their resolved endpoint/probe shape, and see whether remote cancel is supported
without learning adapter internals.

When a degraded or failed CLI compatibility assessment captured redacted
evidence under `<dataDir>/compatibility/<provider>/`, the same runtime CLI now
supports manual-first retained inspection without starting the HTTP server:

```powershell
node dist/index.js --list-compatibility-evidence --probe-provider codex --probe-limit 5
node dist/index.js --list-compatibility-evidence --probe-provider codex --probe-classification probe_failed
node dist/index.js --read-compatibility-evidence artifact-id --probe-provider codex
```

These commands reuse the runtime-owned retained artifact store and keep stdout
machine-readable while printing concise stderr summaries, similar to setup
diagnostic reports and provider-evolution artifact inspection. The same
`--probe-classification` filter used by retained provider-evolution triage can
also narrow compatibility evidence list/read flows to one or more runtime
compatibility classes such as `probe_failed` or `unsupported_version`.

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

The supported production boundary is still the executable plus HTTP contract.
The package root JavaScript export remains a runtime construction helper for
tests/dev embedding, not the recommended host integration path for product apps.

### App-managed local start

For host-supervised local startup, run the same binary in app-managed mode:

```powershell
node dist/index.js --startup-mode app-managed --managed-by cats --ready-output json
```

In that mode:

- `app-managed` startup requires an explicit host identifier via
  `--managed-by <name>` or `CATS_RUNTIME_MANAGED_BY`; startup now fails fast
  if that metadata is missing
- stdout emits single-line JSON lifecycle events when the runtime changes state
- `GET /health` remains the authoritative readiness endpoint
- `GET /diagnostics/runtime` and `GET /diagnostics/providers` give hosts a
  machine-readable integration surface beyond raw stdout parsing
- the process stays a separate HTTP service rather than being source-imported
  into the host app
- the published `cats-runtime` / `cats-runtime-mcp` binaries remain the
  supported package entrypoints; root-module imports are still treated as
  internal/dev-oriented helpers
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
  written, plus the full runtime-owned wakeup snapshot
- `GET /diagnostics/providers?force=1` to decide whether a provider is
  immediately usable, needs user action, is running in a degraded profile, or
  failed to probe after an install/update
- `GET /diagnostics/health` when a lighter host poll also needs aggregate
  wakeup counts/status without fetching `/wakeups`
- `GET /providers/config` to read the runtime-owned static `install` metadata
  for each configured CLI target before or between probes, plus any additive
  runtime-owned `activeConfig` hints such as Goose's detected local
  provider/model selection, plus bounded `tooling` summaries showing whether a
  target uses runtime-managed local tools or provider-owned tooling
- `GET /providers/{provider}/tools` when a setup or operator flow needs the
  standalone bounded tooling view for one resolved target without fetching the
  full provider topology
- `GET /providers/{provider}/models` when a setup or repair flow needs the
  runtime-owned resolved model catalog; auth-ready API targets now use remote
  vendor model listing before falling back to configured/default metadata

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
