# Roadmap

> Long-term project planning and milestones.

## Optimizations

### OPT-1: WSL Session Scanning - Avoid Spawning WSL VM

**Priority**: P1
**Status**: Not Started

#### Problem

`CursorNativeSessionService` and `KiroNativeSessionService` scan CLI sessions inside WSL by spawning `wsl -d Ubuntu bash -lc "python3 -c 'import base64; exec(...)'"`. This triggers the entire WSL VM to start (if stopped), which in turn causes systemd to auto-start all enabled services (e.g. `openclaw-gateway`), consuming 1GB+ RAM. On low-memory machines (8GB), this makes it difficult to run other VM-based features (e.g. Claude Desktop Cowork) concurrently.

#### Current Flow

1. `cats-runtime` polls for Cursor/Kiro sessions
2. For WSL sessions, it spawns `wsl -d Ubuntu bash -lc "python3 ..."` (see `src/backends/cli/runtime/runtime.ts:170-176`)
3. Python script reads SQLite databases inside WSL to extract session data
4. WSL Ubuntu starts up, systemd boots all enabled services, RAM usage spikes

#### Proposed Solution

Read WSL files directly from Windows via `\\wsl$\Ubuntu\...` (or `\\wsl.localhost\Ubuntu\...`) instead of spawning a Python process inside WSL.

- Use Node.js `better-sqlite3` (or similar) to read Cursor/Kiro SQLite databases directly from `\\wsl$\Ubuntu\home\<user>\.config\...`
- Eliminate the embedded Python scripts in `CursorNativeSessionService.ts` and `KiroNativeSessionService.ts`
- Fall back to the current WSL spawn approach only if `\\wsl$\` is not accessible

#### Caveats

- `\\wsl$\` is only accessible when WSL is already Running; if WSL is Stopped, accessing this path will also trigger WSL to start
- Consider a "skip if WSL is stopped" option to avoid unintended WSL activation during scans

#### Affected Files

- `src/backends/cli/runtime/runtime.ts`
- `src/backends/cli/cursor/CursorNativeSessionService.ts`
- `src/backends/cli/kiro/KiroNativeSessionService.ts`

---

*Last updated: 2026-03-13*
