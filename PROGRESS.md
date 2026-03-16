# Progress

> Implementation status for the embedded `cats-runtime` delivery track.

## Current Status

| Component | Status | Description |
|-----------|--------|-------------|
| Core | Completed | Embedded CLI runtime, session registry, discovery, and worker pool are in-repo |
| API Backends | In Progress | `src/backends/api` now runs Claude, Codex/OpenAI, Gemini, and Ollama with runtime-managed sessions, provider-native continuation/caching optimizations, and a shared local tool loop; health probes and broader tool/model discovery remain |
| Agent Backend | In Progress | `src/backends/agent` now exists with shared session/bootstrap/output contracts, OpenClaw Gateway as the first adapter, and room for a second Agent SDK-style validation target |
| HTTP API | Completed | Health, sessions, messages, history, observe, and provider management routes are served directly from `cats-runtime` |
| Dashboard | Completed | The embedded dashboard UI is served from `GET /` |
| Tests | Completed | Vitest covers provider, discovery, pool, HTTP, server bootstrap, and API/local tool-loop behavior |
| Docs | In Progress | Core docs match the backend-neutral runtime, but PLAN-003 follow-on items still need ongoing updates as later phases land |
| Follow-ups | Completed | Accepted post-review findings for provider-instance rollout were implemented and recorded in `docs/plans/PLAN-002-provider-instance-review-followups.md` |

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

- [ ] Add provider health probes, dashboard health surfacing, and Ollama model discovery
- [ ] Expand the shared local tool runtime beyond the first shell/file/search set

### WP-2: Provider Instance Review Follow-ups

**Status**: Completed  
**Assigned**: Codex  
**Priority**: P1

#### Goal

Capture and resolve the accepted findings from post-commit review of the
provider-instance rollout so the current architecture is hardened before new
environment types or providers are added.

#### Accepted Findings

| Finding | Status | Notes |
|---------|--------|-------|
| Duplicate discovered sessions when same-provider instances share a watch dir | [x] | Discovery bootstrap now deduplicates overlapping file watchers and warns |
| Discovery bootstrap uses fragile non-null assertions for optional resolvers | [x] | Bootstrap now falls back to default services when per-instance resolvers are absent |
| YAML `wsl` definitions do not require `distro` | [x] | Explicit WSL definitions now fail during config load when `distro` is missing |
| Dashboard create modal briefly renders stale provider-instance data | [x] | Modal now waits for provider catalog refresh before opening |
| Static provider ordering mismatches runtime ordering | [x] | Static select order now matches `PROVIDER_ORDER` |
| File-backed provider paths were not explicitly modeled as host paths | [x] | Host-side path resolution is now shared across discovery, routes, and bootstrap; Windows WSL guest-relative paths fail fast |
| `config.ts` remains switch-heavy and repetitive | Deferred | Tracked as follow-on refactor work, not part of the hardening pass |
| Legacy top-level runtime fields remain slightly misleading | Deferred | Compatibility shim retained intentionally for now |
| `ProviderInstanceConfig` is growing into a bag of optionals | Deferred | Tracked for a later type-shape cleanup |
| Native-service resolver helpers are duplicated across bootstrap and HTTP helpers | Deferred | Final Claude review flagged this as cleanup work, not a correctness issue |
| Watcher bootstrap resolves some file-backed paths more than once | Deferred | Micro-optimization only; current startup behavior is deterministic |
| Route error mapping could eventually classify more config/path validation cases | Deferred | Current `UnknownProviderInstanceError -> 400` handling is sufficient for the delivered flow |

#### Tracking

- Active plan: `docs/plans/PLAN-002-provider-instance-review-followups.md`
- Verification: `npm test` (`398` tests passed)

### WP-3: API and Local Model Backend

**Status**: In Progress  
**Assigned**: Codex  
**Priority**: P0

#### Goal

Add a backend-neutral execution path under `src/backends/api` so Claude,
OpenAI, Gemini, and Ollama instances can run through API keys or local HTTP
transports while keeping the existing HTTP surface, session model, and
dashboard integration intact.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Split provider topology into `routing + backends.cli/api/local` | [x] | `providers.yaml` keeps CLI/API/local concerns separate |
| Add backend-neutral provider catalog and runtime facade | [x] | Routes resolve provider targets without assuming CLI |
| Add `src/backends/api` transport/runtime skeleton | [x] | Anthropic, OpenAI, Gemini, and Ollama transports are in-repo |
| Support API/local session create, message, close, resume, and fork | [x] | Session lifecycle is runtime-managed across CLI and API backends |
| Add shared local tool runtime for API/local sessions | [x] | `list_files`, `read_file`, `write_file`, `grep`, and `run_shell` are enforced centrally |
| Cover API/local behavior with automated tests | [x] | Transport, tool runtime, and end-to-end HTTP flows are under Vitest |
| Add provider health probes and dashboard health surfacing | [ ] | Deferred to a later PLAN-003 phase |
| Add provider-specific caching/continuation optimizations | [x] | OpenAI `previous_response_id`, Anthropic prompt caching, and Gemini context caching are in place |

#### Verification

- [x] `npm test`

### WP-4: Agent Backend and OpenClaw MVP

**Status**: In Progress  
**Assigned**: Codex  
**Priority**: P1

#### Goal

Add a first-class `agent` backend for external runtimes such as OpenClaw,
land the shared session/bootstrap/output contract needed by that backend, keep
Pi documented as a CLI-specific integration track, and validate the first
adapter end to end through the existing HTTP surface.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Compare `cats-runtime` with `paperclip` adapter/runtime structure | [x] | OpenClaw and Pi were compared directly against current backend seams |
| Write agent backend feature specification | [x] | `docs/specs/SPEC-003-agent-backend.md` defines requirements and non-goals |
| Write agent backend implementation plan | [x] | `docs/plans/PLAN-004-agent-backend.md` defines phased rollout and target files |
| Document detailed Pi integration recommendations | [x] | Research note records why Pi belongs in `src/backends/cli`, not `src/backends/agent` |
| Record `ADR-006` for agent backend and shared runtime contracts | [x] | Decision now fixes `sessionKey` semantics, provider-session fallback, and non-Git output assumptions |
| Land shared session affinity, bootstrap context, and artifact/output contract updates | [x] | `sessionKey`, `reusePolicy`, `instructions`, `context`, `outputDir`, and `artifacts` now flow through session routes, history, and registry state |
| Extend runtime types/config/provider catalog to support `backend: agent` | [x] | Config parsing, provider catalog rendering, session manager dispatch, and pool status now include `agent` |
| Build OpenClaw as the first `src/backends/agent` adapter | [x] | `AgentBackendManager` and `openclaw_gateway` adapter now create, stream, resume, reuse, and persist agent-backed sessions |
| Cover agent backend flows with automated tests | [x] | Config, route, and OpenClaw integration behavior are covered by Vitest |

#### Next Steps

- [ ] Validate the contract with a second target such as an Agent SDK adapter
- [ ] Expand dashboard surfacing for agent-specific services/artifacts beyond the current generic session views
- [ ] Add stronger provider probe/model-list coverage where agent runtimes expose it

---

*Last updated: 2026-03-17*
