# Research Log: First-Run Setup Diagnostic Report

Date: 2026-03-24
Topic: Dedicated logging mechanism for first-time installation and environment debugging

## Sources

- Internal architecture review: `src/core/compatibility/ProviderCompatibilityService.ts`
- Internal startup flow: `src/index.ts`, `src/startup.ts`, `src/server.ts`
- Internal discovery: `src/backends/cli/discovery/wslDiscovery.ts`, `dockerDiscovery.ts`
- Internal config: `src/core/config.ts`, `src/backends/cli/config.ts`
- Internal diagnostics: `src/http/routes/diagnostics.ts`
- Evidence storage: `~/.cats-runtime/data/compatibility/`

## Problem Statement

When users install `cats-runtime` (npm module) or `cats` (Electron app) for
the first time, they often encounter environment issues — CLI tools not in
PATH, WSL distros not running, Docker daemon offline, wrong Node.js version,
misconfigured `providers.yaml`, port conflicts, etc.

The current diagnostics are HTTP-based (`GET /diagnostics/providers`), which
creates a catch-22: if the server fails to start, the diagnostics endpoint is
unreachable. The compatibility evidence cache (`~/.cats-runtime/data/compatibility/`)
stores signed probe artifacts but is not designed for human-readable debugging.

There is no persistent, shareable diagnostic report that captures the full
environment state at setup time.

## Current State

- **No logging library** — all output is `console.log` with prefixed
  categories (`[discovery]`, `[pool]`, `[registry]`). This is intentional
  to keep dependencies minimal.
- **ProviderCompatibilityService** performs extensive probes (version, help
  token scanning, auth status, PATH persistence, npm prefix drift) but
  results live in memory cache (5 min TTL) and HTTP responses only.
- **Startup lifecycle** emits structured events (`runtime.ready`,
  `runtime.startup_error`) but these are transient — they go to stdout/stderr
  and are lost once the process exits.
- **Evidence directory** stores probe results as signed artifacts with schema
  versioning, but the format is machine-internal, not user-facing.

## Proposed Design: Setup Diagnostic Report

A one-shot environment scan that produces a shareable, human-readable +
machine-parseable report. Not a streaming runtime log — a point-in-time
snapshot.

### Trigger Mechanisms

- **Auto on first run**: detect via absence of `~/.cats-runtime/` or a
  `setup-complete` marker file
- **Manual CLI**: `cats-runtime --diagnose` or `npx cats-runtime diagnose`
  — runs the scan without starting the HTTP server
- **Electron**: cats app setup wizard calls the same `SetupDiagnosticService`
  internally and renders results in UI
- **HTTP endpoint**: `GET /diagnostics/setup-report` for post-startup
  on-demand re-scans

### Report Content — Three Layers

**Layer 1 — Platform Snapshot (zero-dependency, always succeeds)**

- Node.js version, `process.arch`, `process.platform`
- npm version, global prefix, PATH entries
- OS version, shell environment
- Available disk space on data directory partition
- Network interfaces (LAN presence, proxy settings)

**Layer 2 — Runtime Dependency Probes**

Reuses existing `ProviderCompatibilityService` probe logic (light mode):

- Each configured CLI provider: command found? version? auth status?
- WSL: distro list, running state, path mapping accessibility
- Docker: daemon status, `docker info` summary
- git: version, global config
- Per-provider auth state (token presence, basic call test)

**Layer 3 — Configuration Validation**

- `.env` file: exists? key variables set?
- `providers.yaml`: parseable? how many instances configured?
- Port availability (bind check without starting server)
- File permissions (data dir writable? session dir creatable?)

### Output Format

```
~/.cats-runtime/data/diagnostics/
  └── setup-report-2026-03-24T14-30-00.json
```

Schema:

```jsonc
{
  "version": "1.0.0",
  "generated": "2026-03-24T14:30:00Z",
  "runtime": "cats-runtime@0.x.x",
  "platform": {
    "os": "win32",
    "arch": "x64",
    "nodeVersion": "v22.5.0",
    "npmVersion": "10.8.1",
    "shell": "bash"
  },
  "probes": [
    {
      "target": "claude-cli",
      "status": "ready",
      "version": "2.1.0",
      "auth": "authenticated",
      "latency_ms": 420,
      "notes": []
    },
    {
      "target": "wsl",
      "status": "degraded",
      "distros": [
        { "name": "Ubuntu-24.04", "running": false }
      ],
      "notes": [
        "WSL distro found but not running; discovery policy is 'if_running'"
      ]
    }
  ],
  "config": {
    "envFile": "found",
    "providersYaml": "found",
    "instanceCount": 3,
    "portAvailable": true,
    "dataDirWritable": true
  },
  "issues": [
    {
      "severity": "error",
      "code": "NODE_VERSION_LOW",
      "message": "Node.js 18 found, >=22 required"
    },
    {
      "severity": "warn",
      "code": "WSL_NOT_RUNNING",
      "message": "Ubuntu-24.04 is stopped"
    }
  ]
}
```

### Sensitive Data Redaction

Reports are designed to be shareable. Automatic redaction rules:

- API keys → `sk-...***` (show prefix only)
- File paths → replace username with `~`
- Environment variable values → show `set` / `unset`, never the value
- Auth tokens → `present` / `absent`, never the token

### Implementation Location

```
src/core/diagnostics/
  ├── SetupDiagnosticService.ts    # Orchestrator — runs three layers
  ├── platformSnapshot.ts          # Layer 1: process.*, exec('npm --version'), etc.
  ├── dependencyProbes.ts          # Layer 2: wraps ProviderCompatibilityService + WSL/Docker/git
  ├── configValidation.ts          # Layer 3: file checks, port check, parse validation
  └── reportWriter.ts              # JSON serialization + redaction filters
```

### Integration Points

- **Reuses** `ProviderCompatibilityService` probe logic — no duplication
- **Reuses** WSL/Docker detection functions (`isWslDistroRunning`,
  `isDockerContainerRunning`)
- **New** `--diagnose` CLI flag in `index.ts` — takes a separate code path
  that skips server startup entirely
- **New** `GET /diagnostics/setup-report` route for Electron/dashboard
  on-demand scanning
- **No new dependencies** — maintains zero-logging-library principle; the
  report is a one-shot JSON file, not a streaming log

### User Experience

```bash
# npm module user
npx cats-runtime diagnose
# → ✓ Platform snapshot collected
# → ✓ Probing 5 providers...
# → ✗ claude-cli: not found in PATH
# → ✓ codex: ready (v0.1.2)
# → ✓ wsl: Ubuntu-24.04 (stopped)
# → ✓ docker: daemon running
# → Report saved to ~/.cats-runtime/data/diagnostics/setup-report-2026-03-24.json
# → Share this file when reporting issues.

# Electron user
# Setup wizard runs diagnostic automatically in background
# Results rendered in UI with status indicators
# "Export diagnostic report" button saves/copies the JSON
```

### Design Decisions

- **Snapshot, not streaming log** — setup issues are diagnosed once, not
  monitored continuously. A JSON file is easier to share, parse, and attach
  to issue reports than a growing log file.
- **Three-layer separation** — Layer 1 always succeeds (pure Node.js APIs),
  Layer 2 may partially fail (CLI not installed), Layer 3 may partially fail
  (no config file). Each layer completes independently; partial reports are
  still useful.
- **Separate code path for `--diagnose`** — the diagnostic must work even
  when the server cannot start. Running it outside the server lifecycle
  ensures it captures the exact state the user is stuck on.
- **Redaction by default** — users should be able to paste the report in a
  GitHub issue without leaking secrets.

## Effort Estimate

- `platformSnapshot.ts` — small (process APIs + a few `child_process.exec`)
- `dependencyProbes.ts` — medium (wrap compatibility service, add WSL/Docker/git)
- `configValidation.ts` — small (file existence, YAML parse, port check)
- `reportWriter.ts` — small (JSON serialize + regex-based redaction)
- CLI integration (`--diagnose`) — small (one new branch in `index.ts`)
- HTTP endpoint — small (one new route)
- Total: ~3-4 days

## Action Items

- [ ] Decide whether `--diagnose` should also print a human-readable summary
      to stdout or only write the JSON file
- [ ] Determine report retention policy (keep last N reports? auto-cleanup?)
- [ ] Evaluate if Electron app needs a separate report format or can reuse
      the same JSON
- [ ] Check if `ProviderCompatibilityService` can run standalone without full
      server bootstrap (it currently takes config as constructor param)
- [ ] Draft ADR if approved for implementation

---

Logged by: Claude
