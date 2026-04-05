# Deployment Guide

> Deployment and startup guidance for `cats-runtime` in standalone and
> app-managed local modes.

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Development | `http://127.0.0.1:3110` | Local development with source checkout |
| Built local | `http://127.0.0.1:3110` | Production-style local run from built assets |
| npm package (repo-ready local path; registry publish pending) | `http://127.0.0.1:3110` by default | Executable package run via `cats-runtime` / `npx cats-runtime` once published |
| App-managed local | Host-assigned | Started and supervised by a local product app such as `cats` |

## Deployment Modes

### 1. Source checkout

```powershell
copy .env.example .env
npm install
npm run dev
```

If no valid `providers.yaml` exists, the runtime enters bootstrap mode and
lets the operator generate one from the setup page.

### 2. Built standalone run

```powershell
npm run build
node build/runtime/index.js
```

### 3. Executable npm package

The executable packaging contract is already repo-ready locally, even though
the first public npm release is still pending.

For local packaged-flow verification before publish, use the platform helper
scripts:

```powershell
.\scripts\windows\Pack-Install.ps1
```

or the equivalent Linux/macOS helpers under `scripts/linux/` and
`scripts/macos/`.

Once published, the public package flow is expected to be:

```powershell
npm install -g cats-runtime
cats-runtime
```

or:

```powershell
npx cats-runtime
```

The executable package uses the same runtime entrypoint and supports either
bootstrap-first startup with no preexisting config, or config supplied through
`.env`, the default `~/.cats/runtime/config/providers.yaml`, or explicit environment
variables.

For production packaging, treat the published binaries plus the HTTP contract
as the supported host boundary. The package root JavaScript export remains a
runtime helper for tests/dev embedding rather than a source-import contract for
product hosts.

Supported startup flags:

- `--startup-mode <standalone|app-managed>`
- `--managed-by <host-name>`
- `--ready-output <plain|json|silent>`
- `--host <bind-host>`
- `--port <bind-port>`

The companion stdio MCP helper remains `node build/runtime/bin/mcp.js` for repo-local
stdio-only hosts. It proxies to the primary runtime rather than starting a
second runtime core.

### 4. App-managed local startup

`cats-runtime` may also be started by a local supervisor such as `cats` or
an Electron host. In that mode:

- the host process owns process supervision
- readiness should be checked over the runtime HTTP boundary
- the runtime remains a separate process, not an in-process product import
- `cats-runtime` is the supported package entrypoint; root-module imports and
  `build/runtime/bin/*` helpers remain internal/dev-oriented surfaces
- `node build/runtime/bin/mcp.js` is the repo-local stdio MCP proxy helper, not a
  second standalone runtime server; start the primary `cats-runtime` first
  when using stdio-only MCP hosts
- stdio proxy target resolution uses `CATS_RUNTIME_MCP_PROXY_URL` first, then
  falls back to `CATS_RUNTIME_HOST` / `CATS_RUNTIME_PORT`

Recommended child-process invocation:

```powershell
node build/runtime/index.js --startup-mode app-managed --managed-by cats --ready-output json
```

Expected behavior:

- `app-managed` startup requires an explicit host identifier via
  `--managed-by <name>` or `CATS_RUNTIME_MANAGED_BY`; startup now fails fast
  if that metadata is missing
- stdout emits single-line JSON lifecycle events:
  `runtime.ready`, `runtime.stopping`, and `runtime.stopped`
- stderr emits a single-line JSON `runtime.startup_error` event on startup failure
- `GET /health` is the authoritative readiness endpoint after process launch
- `GET /diagnostics/runtime` exposes contract version, listener, and path
  resolution details for host integration
- `GET /diagnostics/providers` exposes runtime-owned provider availability and
  diagnostics for setup/Settings surfaces
- `SIGINT` and `SIGTERM` trigger graceful shutdown of the runtime server where
  the host platform supports them reliably
- closing the child stdin stream also triggers graceful shutdown in
  `app-managed` mode and is the most portable host-controlled stop path
- hosts may set `--port 0` / `CATS_RUNTIME_PORT=0` when they want the OS to
  assign a local ephemeral port; the actual bind result is returned by
  `runtime.ready` and `GET /health`

## Configuration

### Required runtime inputs

- Node.js 22+
- `.env` or equivalent environment variables
- either a valid `~/.cats/runtime/config/providers.yaml`, or
  bootstrap mode to generate one on first launch
- any provider-specific credentials or local CLI installs needed by the chosen
  targets

### Important environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CATS_RUNTIME_HOST` | No | Bind host, defaults to `127.0.0.1` |
| `CATS_RUNTIME_PORT` | No | Bind port, defaults to `3110` |
| `CATS_RUNTIME_API_KEY` | No | Optional bearer token for protected routes |
| `CATS_RUNTIME_DIR` | No | Primary runtime home override; defaults to `~/.cats/runtime` |

### Secrets management

- Keep `.env` local and uncommitted
- Keep API keys and auth tokens in environment variables referenced by
  `providers.yaml`
- Do not hardcode credentials into committed config files

## Operational Notes

- **Health / readiness**: `GET /health`
- **Runtime contract**: `GET /diagnostics/runtime`
- **Provider diagnostics**: `GET /diagnostics/providers`
- **Dashboard**: `GET /`
- **Logs**: stdout / stderr from the runtime process
- **Startup metadata**: `GET /health` includes contract version, phase,
  readiness metadata, `managedBy`, `pid`, `startedAt`, and bound address details
- **State paths**:
  - metadata defaults to `~/.cats/runtime/data`
  - session workspaces/transcripts default to `~/.cats/runtime/sessions`
  - provider topology config defaults to `~/.cats/runtime/config/providers.yaml`

## Verification

```powershell
npm run build
npm test
Invoke-WebRequest http://127.0.0.1:3110/health -UseBasicParsing
```

To verify publish contents locally before a real npm publish:

```powershell
$env:npm_config_cache = "$PWD/.npm-cache"
npm pack --dry-run
Remove-Item -Recurse -Force .npm-cache
```

## Troubleshooting

### Issue 1: Port already in use

**Symptoms**: startup fails because `3110` or the configured port is occupied  
**Solution**: set `CATS_RUNTIME_PORT` to an unused port, or stop the existing
process that owns the port.

### Issue 2: Package starts but providers are unavailable

**Symptoms**: health is up, but provider operations fail  
**Solution**: verify `GET /diagnostics/providers`, then check `.env`,
`~/.cats/runtime/config/providers.yaml`, and any required local CLI/API credentials for the
configured targets.

### Issue 3: Dashboard fails in packaged mode

**Symptoms**: `GET /` cannot find the embedded dashboard  
**Solution**: confirm the packaged artifact includes both `build/runtime/` and `public/`
assets. Use `npm pack --dry-run` to inspect the payload.

---

*Last updated: 2026-03-29*
