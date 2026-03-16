# Setup Guide

> Environment setup and run instructions for `cats-runtime`.

## Prerequisites

- Node.js 22+
- Installed local CLIs for the providers you want to use (`claude`, `codex`,
  `gemini`, `cursor-agent`, `kiro-cli`, `opencode`, etc.)

## Installation

```powershell
cd cats-runtime
copy .env.example .env
copy config\providers.yaml.example config\providers.yaml
npm install
npm test
```

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
- `CATS_RUNTIME_WSL_DISCOVERY_POLICY=always`
- `CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS=15000`
- `CATS_RUNTIME_SPAWN_RETRIES=1`
- `CATS_RUNTIME_SPAWN_TIMEOUT_MS=30000`
- `AUGGIE_MAX_TURNS=50`
- `PWSH_PATH=...`

Legacy provider-specific env vars still work, but new installs should prefer
`config/providers.yaml`.

## Provider Instances (`config/providers.yaml`)

`config/providers.yaml` defines provider topology:

- `environments`: named execution environments such as `native` or a WSL distro
- `routing.providers.<name>.default_target`: default backend and instance for that provider family
- `backends.cli.providers.<name>.instances.<id>`: command, runner, runtime, and provider-local storage
- `backends.api.providers.<name>.instances.<id>`: API-key backed instances where the provider family
  stays product-facing (`claude`, `codex`, `gemini`) and `transport` names the vendor API
- `backends.local.providers.<name>.instances.<id>`: local-model runtimes such as Ollama without
  mixing them into CLI instance maps

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
        instances:
          sonnet:
            transport: anthropic
            api_key_env: ANTHROPIC_API_KEY
            model: claude-sonnet-4-20250514
  local:
    providers:
      ollama:
        instances:
          local:
            transport: ollama
            base_url: http://127.0.0.1:11434
            model: qwen3:latest
```

This lets one provider expose multiple independently logged-in environments,
such as several WSL distros on one Windows host. Docker is not wired yet, but
the environment/instance model is intended to extend in that direction.

Path semantics matter:

- File-backed providers (`claude`, `codex`, `copilot`, `gemini`, `auggie`) use
  host-side discovery paths. `projects_dir` / `sessions_dir` must point to a
  path that the `cats-runtime` host process can read directly.
- On Windows, if one of those file-backed providers is configured as
  `runtime: wsl`, do not use guest-relative Linux paths such as
  `~/.codex/sessions` or `/home/user/.codex/sessions`. Use a host-accessible
  path such as `\\wsl$\Ubuntu\home\user\.codex\sessions` instead.
- Cursor `chats_dir` and Kiro `db_path` are different: they are consumed by
  runtime-aware native services inside the selected runtime, so `~/.cursor/chats`
  and `~/.local/share/kiro-cli/data.sqlite3` remain valid for WSL-backed
  Cursor/Kiro instances.

The embedded dashboard reads `GET /providers/config` and uses it to populate the
provider-instance selector in the create-session modal. Providers configured in
`backends.cli`, `backends.api`, or `backends.local` all appear there.

## Running the Project

### Manual start

```powershell
npm run dev
```

Then open `http://127.0.0.1:3110/` for the embedded dashboard, or call the HTTP
API directly.

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
and so on.

---

*Last updated: 2026-03-16*
