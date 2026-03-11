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
npm install
npm test
```

## Environment Variables

Key variables in `.env`:

- `CATS_RUNTIME_HOST=127.0.0.1`
- `CATS_RUNTIME_PORT=3110`
- `CATS_RUNTIME_API_KEY=`
- `CATS_RUNTIME_DATA_DIR=...`
- `CATS_RUNTIME_SESSION_BASE_DIR=...`
- `CATS_RUNTIME_MAX_SESSIONS=10`
- `CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS=5000`
- `AUGGIE_PATH=auggie`
- `COPILOT_PATH=copilot`
- `CURSOR_RUNTIME=wsl`
- `KIRO_RUNTIME_DISTRO=Ubuntu`
- `CLAUDE_RUNNER=auto`
- `CLAUDE_PROJECTS_DIR=...`
- `CODEX_SESSIONS_DIR=...`
- `OPENCODE_SERVER_PORT=4097`

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

---

*Last updated: 2026-03-11*
