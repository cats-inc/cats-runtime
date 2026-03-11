# Progress

> Implementation status for the embedded `cats-runtime` delivery track.

## Current Status

| Component | Status | Description |
|-----------|--------|-------------|
| Core | Completed | Embedded CLI runtime, session registry, discovery, and worker pool are in-repo |
| HTTP API | Completed | Health, sessions, messages, history, observe, and provider management routes are served directly from `cats-runtime` |
| Dashboard | Completed | The embedded dashboard UI is served from `GET /` |
| Tests | Completed | Vitest covers provider, discovery, pool, HTTP, and server bootstrap behavior |
| Docs | Completed | README, API, architecture, testing, and agent guidance match the single-service model |

**Legend**: Not Started | In Progress | Completed | Blocked

## Work Packages

### WP-1: Embed CLI Runtime

**Status**: Completed  
**Assigned**: Codex  
**Priority**: P0

#### Tasks

| Task | Status | Notes |
|------|--------|-------|
| Bootstrap `cats-runtime` subproject | [x] | Generated from `../project-bootstrap` |
| Define runtime boundary | [x] | Stable `core + backends/* + http` layering in place |
| Port CLI runtime into `cats-runtime` | [x] | Providers, discovery, pool, native services, and dashboard moved in-repo |
| Port and expand tests | [x] | Vitest runs the copied runtime/provider/HTTP suites plus server coverage |
| Migrate first consumer | [x] | `crew-chat-poc` now targets `cats-runtime` only |

#### Acceptance Criteria

- [x] `cats-runtime` runs as a single service without a second `agent-fleet` process
- [x] `cats-runtime` owns streamed turn output end to end
- [x] Native provider management and Kiro model discovery are available directly from `cats-runtime`
- [x] `crew-chat-poc` consumes `cats-runtime`

## Completion Notes

### WP-1: Embed CLI Runtime

**Updated**: 2026-03-11

#### Key Decisions

- Keep the long-term layout as `core + backends/* + http`
- Port `agent-fleet` runtime logic into `src/backends/cli` without modifying the source project
- Treat historical adapter docs as superseded ADRs, not active implementation guidance

#### Remaining Items

- [ ] Add `src/backends/api` for API-key and Ollama-backed execution paths

---

*Last updated: 2026-03-11*
