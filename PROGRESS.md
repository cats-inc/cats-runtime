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
| Follow-ups | In Progress | Accepted post-review findings for provider-instance rollout are tracked in `docs/plans/PLAN-002-provider-instance-review-followups.md` |

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

### WP-2: Provider Instance Review Follow-ups

**Status**: In Progress  
**Assigned**: Codex  
**Priority**: P1

#### Goal

Capture and resolve the accepted findings from post-commit review of the
provider-instance rollout so the current architecture is hardened before new
environment types or providers are added.

#### Accepted Findings

| Finding | Status | Notes |
|---------|--------|-------|
| Duplicate discovered sessions when same-provider instances share a watch dir | [ ] | Track as a correctness bug; fix in discovery bootstrap |
| Discovery bootstrap uses fragile non-null assertions for optional resolvers | [ ] | Tighten bootstrap code so tests and helper reuse are safer |
| YAML `wsl` definitions do not require `distro` | [ ] | Fail during config load instead of at runtime |
| Dashboard create modal briefly renders stale provider-instance data | [ ] | Treat as UI polish with low technical risk |
| Static provider ordering mismatches runtime ordering | [ ] | Remove reorder flash in the modal |
| `config.ts` remains switch-heavy and repetitive | [ ] Deferred | Record as technical debt, not required for immediate bugfix |
| Legacy top-level runtime fields remain slightly misleading | [ ] Deferred | Keep for compatibility in the short term |
| `ProviderInstanceConfig` is growing into a bag of optionals | [ ] Deferred | Revisit with a scoped type-shape cleanup |

#### Tracking

- Active plan: `docs/plans/PLAN-002-provider-instance-review-followups.md`

---

*Last updated: 2026-03-16*
