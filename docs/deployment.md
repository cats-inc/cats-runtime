# Deployment Guide

> Deployment and startup guidance for `cats-runtime` in standalone and
> app-managed local modes.

## Catalog resources and local patches

Builds validate the authored schema-2 catalog and its generated digest. npm packages
and Desktop sidecars include the same factory YAML, generated JSON, frozen schema-1
migration mappings, read-only `./catalogs` export and catalog CLI. Desktop bundle
layout retains these split modules and their dependencies alongside the main bundle.

Keep local overrides under the selected Runtime profile/config path across upgrades.
Do not seed or overwrite them with factory contents. Writable Runtime startup and
explicit catalog reload upgrade recognized schema-1 files once using the shipped
converter, complete validation, backup and atomic apply. `automaticSchema1Upgrade`
advertises this capability; `GET /providers/catalogs` reports upgrade state and
Setup & Repair provides details and retry. Read-only hosts never migrate.
Unknown mappings or failed writes preserve the old file and show a configuration
error, retaining a compatible accepted snapshot when one exists.
Supported data changes need no rebuild;
see [soft patches](provider-catalog-soft-patches.md). A new package must implement
the capability before this workflow is supported. Publication remains a separate step.

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Development | `http://127.0.0.1:3110` | Local development with source checkout |
| Built local | `http://127.0.0.1:3110` | Production-style local run from built assets |
| npm package (`@cats-inc/cats-runtime`, published) | `http://127.0.0.1:3110` by default | Executable package run via the `cats-runtime` command / `npx @cats-inc/cats-runtime` |
| App-managed local | Host-assigned | Started and supervised by a local product app such as `cats` |

## Deployment Modes

### 1. Source checkout

```powershell
copy .env.example .env
npm install
npm run dev
```

If no valid `providers.yaml` exists, the runtime enters bootstrap mode and
shows static provider choices on the setup page. Save the desired targets before
provider scans begin. The default active path is
`~/.cats/runtime/config/providers.yaml`; `CATS_RUNTIME_DIR` chooses the Runtime
root. A valid empty configuration starts in idle mode. The bundled example is
reference material and must not be copied into every new root automatically.

Deploy selection-aware Runtime and Platform/Desktop revisions together (see
[PLAN-039](./plans/PLAN-039-provider-selection-bootstrap-rollout.md)). The replaced
setup apply route is removed; an old external Runtime cannot satisfy the new
selection contract. Desktop packaging builds its sibling Runtime checkout, so
release automation must select the matching Runtime revision explicitly.

### 2. Built standalone run

```powershell
npm run build
node build/runtime/index.js
```

### 3. Executable npm package

The published package is `@cats-inc/cats-runtime`; its executable is
`cats-runtime`. The unscoped package name is not this repository's release target.

For local packaged-flow verification before publish, use the platform helper
scripts:

```powershell
.\scripts\windows\Pack-Install.ps1
```

or the equivalent Linux/macOS helpers under `scripts/linux/` and
`scripts/macos/`.

Follow the [Runtime release SOP](release-guide.md) for version preparation,
independent release scope and publication. A branch push runs CI; it does not
publish npm or require any other Cats product to release.

The [release preflight](../.github/workflows/release-preflight.yml) runs
`npm run release:check` without publishing. The manual
[npm publish workflow](../.github/workflows/npm-publish.yml) runs the same full
release gate before publishing with the configured npm trusted publisher.
Update `package.json` and the root package-lock version together, integrate the
latest remote main, then dispatch the chosen release commit:

```sh
gh workflow run npm-publish.yml --repo cats-inc/cats-runtime --ref main -f dist_tag=latest
```

Confirm the workflow and registry version before reporting publication complete.
Only when a selected cats-one release needs a new dependency minimum, publish
that dependency first, then update the launcher's range and registry lockfile.
Already published compatible dependencies need no repeat release. Desktop can
bundle Runtime source without a Runtime npm release.

Install or launch the public package with:

```powershell
npm install -g @cats-inc/cats-runtime
cats-runtime
```

or:

```powershell
npx @cats-inc/cats-runtime
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
- `--no-open` (keep the manual `o` shortcut, suppress initial browser launch)
- `--host <bind-host>`
- `--port <bind-port>`

The packaged stdio MCP entrypoint is `cats-runtime mcp`. For repo-local
workspaces, `node build/runtime/bin/mcp.js` remains the equivalent helper. Both
proxy to the primary runtime rather than starting a second runtime core.

### Interactive terminal

Standalone plain-output CLI sessions with interactive stdin/stdout open the
default browser once the listener is ready. Bootstrap opens `/setup`; configured
Runtime opens `/`. The address uses the actual listening port, with loopback
substituted for wildcard hosts (including IPv6).

The terminal shows `o` to open, `q` to stop and Ctrl+C to stop. Both stop keys use
the existing Runtime cleanup routine and restore terminal input. `--no-open`
skips only the initial launch. A missing browser/opener leaves the service running
and prints the URL for manual use. No browser credentials are put into the URL.

On Windows the hidden PowerShell browser launcher must remain non-detached:
detached PowerShell can exit successfully without executing the open command.
The helper waits for launcher completion, not for the browser to close.

App-managed/Desktop, watch supervisors, CI, non-TTY, JSON/silent lifecycle output,
help, MCP/ACP and diagnostic commands do not open browsers or consume shortcut
keys. `cats-one` uses an app-managed Runtime with private stdin, opens only
Platform, and ends Runtime stdin after Platform has completed cleanup. A reused
Runtime is outside that launcher's ownership.

See [SPEC-002](../../cats-one/docs/specs/SPEC-002-interactive-cli-startup.md) for the
shared npm-entrypoint contract.

### 4. App-managed local startup

`cats-runtime` may also be started by a local supervisor such as `cats` or
an Electron host. In that mode:

- the host process owns process supervision
- readiness should be checked over the runtime HTTP boundary
- the runtime remains a separate process, not an in-process product import
- `cats-runtime` is the supported package entrypoint; root-module imports and
  `build/runtime/bin/*` helpers remain internal/dev-oriented surfaces
- `cats-runtime mcp` is the supported package-facing stdio MCP proxy entrypoint
- `node build/runtime/bin/mcp.js` is the repo-local equivalent, not a second
  standalone runtime server; start the primary `cats-runtime` first when using
  stdio-only MCP hosts
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

*Last updated: 2026-09-23*
