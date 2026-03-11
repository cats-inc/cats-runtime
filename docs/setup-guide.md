# Setup Guide

> Environment setup and run instructions for `cats-runtime`.

## Prerequisites

- Node.js 22+
- `agent-fleet` running on `http://localhost:3100` for phase 1

## Installation

```powershell
cd cats-runtime
copy .env.example .env
npm install
npm run build
```

## Environment Variables

Key variables in `.env`:

- `CATS_RUNTIME_HOST=127.0.0.1`
- `CATS_RUNTIME_PORT=3110`
- `CATS_RUNTIME_API_KEY=`
- `AGENT_FLEET_BASE_URL=http://localhost:3100`
- `AGENT_FLEET_API_KEY=`

## Running the Project

### Manual start

```powershell
node dist/index.js
```

### Restart helper

```powershell
.\scripts\windows\Restart-Server.ps1
```

### Stop only

```powershell
.\scripts\windows\Restart-Server.ps1 -Stop
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

## Verify Installation

```powershell
node ..\agent-fleet\node_modules\typescript\bin\tsc -p tsconfig.json --typeRoots ..\agent-fleet\node_modules\@types
node --test --test-isolation=none tests\runtime-server.test.js
Invoke-WebRequest http://127.0.0.1:3110/health -UseBasicParsing
```

## Common Issues

### Port 3110 already in use

Use:

```powershell
.\scripts\windows\Restart-Server.ps1 -Stop
```

Then restart, or change `CATS_RUNTIME_PORT` in `.env`.

### Health is `degraded`

`cats-runtime` is up, but phase 1 still depends on `agent-fleet`. Check
`AGENT_FLEET_BASE_URL` and confirm `agent-fleet` is running.

---

*Last updated: 2026-03-11*
