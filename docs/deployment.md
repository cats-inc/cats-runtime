# Deployment Guide

> Deployment and startup guidance for `cats-runtime` in standalone and
> app-managed local modes.

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Development | `http://127.0.0.1:3110` | Local development with source checkout |
| Built local | `http://127.0.0.1:3110` | Production-style local run from built assets |
| npm package (planned publish path) | `http://127.0.0.1:3110` by default | Executable package run via `cats-runtime` / `npx cats-runtime` |
| App-managed local | Host-assigned | Started and supervised by a local product app such as `cats-inc` |

## Deployment Modes

### 1. Source checkout

```powershell
copy .env.example .env
copy config\providers.yaml.example config\providers.yaml
npm install
npm run dev
```

### 2. Built standalone run

```powershell
npm run build
node dist/index.js
```

### 3. Executable npm package

Once published, the intended package flow is:

```powershell
npm install -g cats-runtime
cats-runtime
```

or:

```powershell
npx cats-runtime
```

The executable package uses the same runtime entrypoint and still expects
config via `.env`, `config/providers.yaml`, or explicit environment variables.

Supported startup flags:

- `--startup-mode <standalone|app-managed>`
- `--managed-by <host-name>`
- `--ready-output <plain|json|silent>`
- `--host <bind-host>`
- `--port <bind-port>`
- `--config <providers-config-path>`

### 4. App-managed local startup

`cats-runtime` may also be started by a local supervisor such as `cats-inc` or
an Electron host. In that mode:

- the host process owns process supervision
- readiness should be checked over the runtime HTTP boundary
- the runtime remains a separate process, not an in-process product import

Recommended child-process invocation:

```powershell
node dist/index.js --startup-mode app-managed --managed-by cats-inc --ready-output json
```

Expected behavior:

- stdout emits a single-line JSON `runtime.ready` event after bind succeeds
- stderr emits a single-line JSON `runtime.startup_error` event on startup failure
- `GET /health` is the authoritative readiness endpoint after process launch
- `SIGINT` and `SIGTERM` trigger graceful shutdown of the runtime server

## Configuration

### Required runtime inputs

- Node.js 22+
- `.env` or equivalent environment variables
- `config/providers.yaml` or `CATS_RUNTIME_CONFIG_PATH` pointing to an
  equivalent provider-topology file
- any provider-specific credentials or local CLI installs needed by the chosen
  targets

### Important environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CATS_RUNTIME_HOST` | No | Bind host, defaults to `127.0.0.1` |
| `CATS_RUNTIME_PORT` | No | Bind port, defaults to `3110` |
| `CATS_RUNTIME_API_KEY` | No | Optional bearer token for protected routes |
| `CATS_RUNTIME_CONFIG_PATH` | No | Override provider-topology config path |
| `CATS_RUNTIME_DATA_DIR` | No | Override runtime metadata directory |
| `CATS_RUNTIME_SESSION_BASE_DIR` | No | Override session workspace/transcript directory |

### Secrets management

- Keep `.env` local and uncommitted
- Keep API keys and auth tokens in environment variables referenced by
  `config/providers.yaml`
- Do not hardcode credentials into committed config files

## Operational Notes

- **Health / readiness**: `GET /health`
- **Dashboard**: `GET /`
- **Logs**: stdout / stderr from the runtime process
- **Startup metadata**: `GET /health` includes `startup.mode`, `managedBy`,
  `readySignal`, `ready`, `pid`, `startedAt`, and bound address details
- **State paths**:
  - metadata defaults to `~/.cats-runtime/data`
  - session workspaces/transcripts default to `~/.cats-runtime/sessions`

## Verification

```powershell
npm run build
npm test
Invoke-WebRequest http://127.0.0.1:3110/health -UseBasicParsing
```

To verify publish contents locally:

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
**Solution**: verify `.env`, `config/providers.yaml`, and any required local
CLI/API credentials for the configured targets.

### Issue 3: Dashboard fails in packaged mode

**Symptoms**: `GET /` cannot find the embedded dashboard  
**Solution**: confirm the published package includes both `dist/` and `public/`
assets. Use `npm pack --dry-run` to inspect the payload.

---

*Last updated: 2026-03-19*
