# Progress

> Implementation status for the embedded `cats-runtime` delivery track.

## Current Status

| Component | Status | Description |
|-----------|--------|-------------|
| Core | Completed | Embedded CLI runtime, shared session contracts, discovery, worker pool, runtime-owned shared/isolated/worktree workspace lifecycle helpers, first-slice runtime-owned usage/incident/guardrail contracts, additive session-maintenance/reset-boundary hooks, and persisted maintenance trigger metadata are in-repo |
| API Backends | In Progress | `src/backends/api` now runs Claude, Codex/OpenAI, Gemini, and Ollama with runtime-managed sessions, provider-native continuation/caching optimizations, additive incident hints plus provider-agnostic `progress` events, a shared local tool loop with patch/file/search/shell support, and runtime-owned health/diagnostics summaries; deeper live probes and broader tool/model discovery remain |
| Agent Backend | In Progress | `src/backends/agent` now exists with shared session/bootstrap/output contracts, OpenClaw Gateway as the first adapter, an Agent SDK bridge as the second validation target, and first-slice remote cleanup hooks for close/cancel/delete/reset semantics |
| HTTP API | Completed | Health, sessions, delivery audit/export/repo routes, messages, history, observe, wakeups, provider management, session branch-lineage inspection, metering/guardrail diagnostics, additive run-inspector/session-discipline contracts, machine-readable session-maintenance/delete-cleanup payloads, worktree-backed session lifecycle cleanup semantics including `preserve`, and the runtime MCP facade over HTTP plus stdio are served directly from `cats-runtime` |
| Runtime Skills | Completed | `skills/` is now a runtime-owned execution catalog and family-aware internal library with validation, session-level requested/resolved/applied metadata, richer slug/family/capability metadata, explicit `skills: null` clearing, backend-aware delivery modes, inspection-level applied-skill reporting, a standalone versioned filterable/paged/sortable `GET /skills/catalog` read surface plus matching `list_runtime_skills` MCP read tool, a dedicated `npm run verify:skills` gate, first-slice Codex/Pi verification, and shared re-entry hydration across create/resume/fork/provider-switch |
| Wakeup Substrate | Completed | Runtime-owned scheduled wakeup requests now support create/list/cancel/trigger, restart-safe persistence, bounded timer processing, coalescing, and additive session/history wakeup metadata without introducing full scheduler semantics |
| Provider Compatibility | In Progress | Shared CLI compatibility probing now classifies `ready` / `degraded` / `unsupported_version` / `unrecognized_protocol` / `probe_failed`, validates `light` vs `live` runtime-flag probes across expanded CLI family profiles, captures redacted replay-friendly evidence bundles, tracks stale cache/reprobe metadata, exposes runtime-owned install/prerequisite/PATH/npm-prefix/auth/version/remediation hints for CLI targets, and supports target-scoped `provider` / `backend` / `instance` / `defaultOnly` filtering over `/diagnostics/providers` plus the matching MCP seam |
| Dashboard | Completed | The embedded dashboard UI is served from `GET /` and now surfaces runtime/provider health from runtime-owned diagnostics contracts |
| Workspace Substrate | Completed | `audit-workspace`, `init-workspace`, and `update-workspace` now return explicit preview/apply contracts, machine-readable action plans/diff stats, approval-friendly payloads, and `*.bootstrap` review-copy behavior without owning product policy |
| Delivery Primitives | Completed | Runtime-owned delivery audit, artifact publish/export, repo status, commit, push, and normalized preview-surface metadata are now available over both HTTP routes and local tools |
| Browser Preview Substrate | Completed | Runtime-owned browser driver/session/page contracts, `browser_page` preview surfaces, manual driver validation, restart-safe browser state persistence, additive `/browser/*` routes, session/history/observe inspection integration, aggregate browser summary/cleanup seams, and reset/delete cleanup for runtime-bound browser sessions now exist without depending on sibling browser projects |
| Tests | Completed | Vitest covers provider, discovery, pool, HTTP, delivery, server bootstrap, API/local tool-loop behavior, and first-slice metering/guardrail/progress normalization |
| Docs | In Progress | Core docs now cover startup/diagnostics, provider compatibility/evidence flows, model catalog, session branching, worktree-backed session isolation and cleanup, workspace substrate, runtime hydration/re-entry metadata, delivery primitives, the browser preview substrate, runtime-managed skills plus the internal skill-library taxonomy/metadata contract, the scheduled wakeup substrate, first-slice metering/progress contracts, additive session inspection/run-state/maintenance payloads including persisted maintenance requests, and the runtime MCP facade over HTTP plus stdio; later PLAN-003/PLAN-005 follow-on items still need ongoing updates |
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

- [ ] Deepen provider health probes beyond the current readiness summary/light checks, especially for API/local transports and Ollama model discovery
- [ ] Harden shared local tool runtime safety beyond the current symlink/junction/hardlink alias guards, especially more atomic multi-file mutation behavior
- [ ] Expand the shared local tool runtime beyond the current filesystem/shell set into richer navigation/materialization helpers
- [ ] Refine capability partitioning and policy surfacing beyond the current `standard` / `extended` / `read_only` tool-profile split
- [ ] Split Docker discovery snapshot creation out of `createDiscoveryStatusPayload()` so `GET /discovery/status` can reuse the live WSL snapshot without recomputing an unused WSL status store

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
| Add shared local tool runtime for API/local sessions | [x] | `list_files`, `read_file`, `write_file`, `edit_file`, `apply_patch`, `grep`, `glob`, and `run_shell` are enforced centrally, with extended `delete_file` / `rename_file` / `copy_file` support behind the opt-in profile |
| Cover API/local behavior with automated tests | [x] | Transport, tool runtime, and end-to-end HTTP flows are under Vitest |
| Add provider health probes and dashboard health surfacing | [x] | First slice now exposes `/diagnostics/health`, richer `/health`/`/diagnostics/runtime` contracts, and dashboard header health polling; deeper transport-native live probes remain |
| Add provider-specific caching/continuation optimizations | [x] | OpenAI `previous_response_id`, Anthropic prompt caching, and Gemini context caching are in place |
| Stabilize provider model catalog/discovery contract | [x] | `GET /providers/{provider}/models` now documents and tests cache, fallback, error-code, and Ollama running-model semantics |
| Normalize first provider-agnostic API/local progress events | [x] | API/local sessions now emit additive `progress` events for continuation/cache lifecycle and Ollama warm-state hints |

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
| Validate the contract with a second target such as an Agent SDK adapter | [x] | `agent_sdk_bridge` now validates the same contract against an external Agent SDK gateway |
| Cover agent backend flows with automated tests | [x] | Config, route, OpenClaw, and Agent SDK bridge integration behavior are covered by Vitest |
| Land the first Pi session-depth/runtime-validation slice on the CLI track | [x] | Pi now resumes via discovered session-file paths, validates resume-path ownership/runtime reachability, retries stale `unknown session` turns once fresh, and supports per-instance `instructions_file` layering |

#### Next Steps

- [ ] Expand dashboard surfacing for agent-specific services/artifacts beyond the current generic session views
- [ ] Add stronger provider probe/model-list coverage where agent runtimes expose it
- [ ] Add `pi --list-models` helper/parsing and hand it off to the future provider model-catalog work
- [ ] Deepen Pi-native transcript/history surfacing so resumed/fallback Pi sessions do not rely on generic JSONL heuristics alone

### WP-5: Session Fork, Context Transplant, and Lineage Primitives

**Status**: Completed  
**Assigned**: Codex  
**Priority**: P1

#### Goal

Freeze the runtime-side branching primitive that later room/workflow layers can
build on, without moving branch policy into `cats-runtime`.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Stabilize `POST /sessions/{id}/fork` | [x] | Runtime now returns machine-readable branch mode resolution, target, capability truth, and fallback metadata |
| Formalize context transplant request/response contract | [x] | Branch responses now summarize whether transplant content was requested, defaulted, or merged |
| Add lineage inspection / observability | [x] | `GET /sessions/{id}/lineage` exposes ancestors, children, and descendants |
| Surface capability truth and fallback semantics | [x] | Session payloads now include `branching.capabilities`; explicit native-fork failures return the same branch contract alongside the error |
| Cover the branching contract with automated tests | [x] | Vitest covers native fork success, auto fallback, explicit failure, and lineage inspection |
| Update runtime docs/specs/progress | [x] | `api.md`, `architecture.md`, `AGENT-GUIDE.md`, `SPEC-011`, and `PROGRESS.md` now reflect the delivered slice |

#### Verification

- [x] `npm run build`
- [x] `npx vitest run tests/session-branching.test.ts --pool=threads --poolOptions.threads.singleThread`

### WP-6: Workspace Substrate Tools

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Land runtime-owned workspace substrate primitives that can initialize, audit,
preview, and conservatively apply collaboration substrate files without
embedding product approval policy into `cats-runtime`.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add runtime-owned `init-workspace`, `audit-workspace`, and `update-workspace` substrate operations | [x] | `WorkspaceSubstrateService` now owns deterministic planning/apply behavior |
| Return explicit preview/apply contract and apply decision metadata | [x] | Results include `contract.mode`, `applyRequested`, `applyDecision`, and `readOnly` |
| Return machine-readable action plan and diff metadata | [x] | Actions include `outputPath`, `mergeStrategy`, hashes, unified diff text, and `diffStats` |
| Return approval-friendly payloads without product policy | [x] | Results include `plan.applyPayload` plus `approval` metadata for hosts/skills |
| Keep `audit-workspace` strictly read-only | [x] | `apply: true` now yields preview with `read_only_operation` and no writes |
| Use conservative review-copy behavior for conflicts | [x] | Conflicting files produce `write_sidecar` steps targeting `*.bootstrap` paths |
| Cover substrate behavior with automated tests | [x] | `tests/workspace-substrate.test.ts` and `src/core/tools/LocalToolRuntime.test.ts` cover the contract |

#### Deferred Boundaries

- [ ] No dedicated HTTP route surface yet; the first slice ships as runtime-owned service/tool primitives only
- [ ] No product-level approval UX, orchestration policy, or follow-on delegation logic in runtime
- [ ] No full `project-bootstrap` preset/flavor system; only collaboration substrate files are generated

### WP-7: Executable Delivery and Preview Primitives

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Land runtime-owned delivery primitives for artifact-only and repo-backed flows
without moving delivery-governance policy into `cats-runtime`.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add delivery-target audit primitive | [x] | `POST /delivery/audit` and `audit-delivery-target` return capability truth, blocked reasons, and capability gaps |
| Add artifact publication/export primitive | [x] | `POST /delivery/artifacts/publish` and `publish-artifacts` export local artifacts, write a manifest, and preserve reference-only artifacts when needed |
| Add repo status inspection primitive | [x] | `POST /delivery/repo/status` and `inspect-repo-status` return normalized Git metadata and repo-backed capability state |
| Add commit creation primitive | [x] | `POST /delivery/repo/commit` and `create-commit` support preview/apply plus approval-aware commit execution; `repo.stageAll` is explicit opt-in |
| Add branch push primitive | [x] | `POST /delivery/repo/push` and `push-branch` support preview/apply plus approval-aware push execution |
| Normalize preview-capable surface metadata | [x] | Delivery results now include `previewSurfaces` derived from session/request artifacts and services |
| Cover blocked/degraded/artifact-only/repo-backed behavior with tests | [x] | `tests/runtime-delivery.test.ts` and `src/core/tools/LocalToolRuntime.test.ts` cover the first slice |
| Update runtime docs/specs/progress | [x] | `api.md`, `architecture.md`, `AGENT-GUIDE.md`, `SPEC-009`, and `PROGRESS.md` now reflect the delivered slice |

#### Deferred Boundaries

- [ ] No PR/check automation yet; that remains a later integration seam
- [ ] No preview/deploy host integration yet; runtime currently reports normalized preview metadata only
- [ ] No forge-vendor-specific auth/policy logic in runtime

#### Verification

- [x] `npm run build`
- [x] `npx vitest run tests/runtime-server.test.ts tests/runtime-delivery.test.ts src/core/tools/LocalToolRuntime.test.ts --pool=threads --poolOptions.threads.singleThread`

### WP-8: Usage Metering, Incidents, Guardrails, and Provider-Agnostic Progress

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Land the first runtime-owned execution telemetry slice so hosts and dashboards
can consume one additive contract for usage, incidents, guardrails, and
provider-agnostic progress without moving budget policy into `cats-runtime`.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Define shared runtime usage, incident, guardrail, and progress contracts | [x] | `src/core/types.ts` now exposes `RuntimeUsageRecord`, `RuntimeRateLimitIncident`, `RuntimeGuardrailResult`, and normalized progress kinds/status |
| Add runtime-owned metering service and incident helpers | [x] | `src/core/usage` now records usage, derives incidents, and maintains active cooldown/block state |
| Add additive metering config surface | [x] | `CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_WARN`, `CATS_RUNTIME_GUARDRAIL_SESSION_TOTAL_TOKENS_BLOCK`, and `CATS_RUNTIME_RATE_LIMIT_COOLDOWN_MS` are parsed centrally |
| Enforce warn / block / cooldown preflight behavior on message execution | [x] | `POST /sessions/{id}/messages` now emits warning progress events or returns `guardrail_blocked` / `guardrail_cooldown` responses before turn execution |
| Surface metering state over diagnostics routes | [x] | `GET /diagnostics/runtime` returns the full metering snapshot and `GET /diagnostics/health` exposes a polling-friendly metering summary |
| Normalize provider-agnostic progress across multiple CLI providers | [x] | Junie, Pi, Goose, and Copilot now emit `type: "progress"` events with shared runtime metadata |
| Extend API/local incident and progress surfacing onto the same contract | [x] | API/local transports now emit additive incident hints and normalized progress events for continuation/cache/warm-state flows |
| Cover metering, incidents, guardrails, and progress with automated tests | [x] | Route, server, parser/provider, API integration, and direct metering-service tests cover the delivered slice |

#### Deferred Boundaries

- [ ] No product budget policy, approval override flow, or war-room orchestration in runtime
- [ ] No provider compatibility profile selection as part of this slice
- [ ] No attempt to fabricate exact costs where providers only expose partial or derived usage

#### Verification

- [x] `npm run build`
- [x] `npx vitest run src/core/usage/RuntimeMeteringService.test.ts src/http/messagesRoute.test.ts tests/api-backend.test.ts tests/runtime-server.test.ts src/backends/cli/junie/parser.test.ts src/backends/cli/pi/parser.test.ts src/backends/cli/goose/parser.test.ts src/backends/cli/providers/copilot.test.ts src/backends/cli/providers/junie.test.ts --pool=threads --poolOptions.threads.singleThread`
 
### WP-8: Runtime Health, Startup, Diagnostics, and Tool Safety Hardening

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Make `cats-runtime` easier for packaged hosts and direct operators to supervise
by freezing readiness/startup/shutdown contracts, exposing aggregate
machine-readable diagnostics, surfacing runtime/provider health in the embedded
dashboard, and hardening shared local-tool filesystem safety without adding new
product policy.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Freeze startup/readiness/shutdown contract metadata | [x] | `/health` and `/diagnostics/runtime` now expose shared lifecycle, shutdown-signal, shutdown-reason, and diagnostics endpoint metadata |
| Add machine-readable aggregate diagnostics | [x] | `GET /diagnostics/health` now combines runtime readiness, startup/shutdown metadata, and default-target provider health summary |
| Surface runtime/provider health in the embedded dashboard | [x] | Dashboard header now polls runtime-owned diagnostics instead of only static CLI/discovery metadata |
| Harden local tool runtime path/alias safety | [x] | Shared path-safety helpers now reject symlink/junction alias paths and hardlinked mutation targets for tool operations and patch hunks |
| Cover child-process startup/shutdown and safety regressions | [x] | Vitest now covers startup error exit behavior, shutdown lifecycle events, dashboard injection, and alias-safety regressions |

#### Deferred Boundaries

- [ ] No full packaged onboarding or provider installation wizard in runtime
- [ ] No broad live health probes for every API/local transport yet; the first slice is still mostly light checks plus adapter-supported live probes
- [ ] No atomic multi-file rollback for shared local-tool writes or patch application yet

### WP-9: Runtime-Managed Skills v0

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Turn repo-local `skills/` packages into a real session/runtime contract with
runtime-owned validation, resolution, delivery, and observability, without
turning `cats-runtime` into a general plugin platform.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add implementation plan for runtime-managed skills v0 | [x] | `docs/plans/PLAN-008-runtime-managed-skills-v0.md` records phases, targets, and watchpoints |
| Replace the hard-coded skill catalog with runtime discovery/validation | [x] | `src/core/skills/catalog.ts` now validates family-organized `skills/**/SKILL.md` frontmatter and instruction bodies |
| Freeze session-level requested/resolved/applied skill state | [x] | Session payloads now persist requested refs, resolved skill metadata, delivery state, warnings, and applied ids |
| Freeze the internal skill-library taxonomy and metadata contract | [x] | `listRuntimeSkillCatalog()` now reports stable family/slug/role/package metadata for Team 6 and future product mappings |
| Add a standalone runtime-owned skill catalog route | [x] | `GET /skills/catalog` now exposes the runtime library read seam for hosts without direct internal module imports, supports lightweight metadata/tag filters plus additive `sortBy` / `sortDirection` and `offset` / `limit`, and returns `contract.version`, echoed `query.filters`, optional `query.sort`, and machine-readable `pagination` |
| Add a dedicated runtime skill verification command | [x] | `npm run verify:skills` now executes the runtime catalog validator as an explicit maintenance/release gate |
| Support delivery modes `filesystem`, `instructions`, and `none` | [x] | Codex isolated sessions use filesystem delivery, Pi/API/agent use instructions, unsupported targets stay explicit with `none` |
| Verify CLI-first targets | [x] | Codex filesystem delivery and Pi instruction-file delivery are both covered by automated tests |
| Surface runtime skill state in inspection/history routes | [x] | `GET /sessions`, `GET /sessions/{id}`, `GET /sessions/{id}/observe`, and `GET /sessions/{id}/history` now expose runtime skill metadata and applied-skill inspection state |
| Return explicit errors for malformed/unknown skills | [x] | Session create/message/fork flows now reject malformed payloads and invalid skill packages with client-safe errors |
| Add reference skills and update docs | [x] | Runtime-owned orchestration/work/chat/code packages now provide the first internal skill library slice with authoring docs and compatibility tests |

#### Deferred Boundaries

- [ ] No richer projection contract yet beyond the current versioned standalone filterable/paged/sortable `GET /skills/catalog` runtime read
- [ ] No richer publish workflow yet beyond `npm run verify:skills` running the existing catalog validator
- [ ] No runtime-owned `skillProfile` mapping layer yet; product capability/profile resolution stays outside `cats-runtime`
- [ ] No repo-native skill merge or conflict-resolution system yet beyond safe fallback from Codex filesystem delivery to instructions
- [ ] No general multi-package slug-collision strategy beyond Codex filesystem fallback to instruction delivery when family groups reuse the same slug

#### Verification

- [x] `npm run build`
- [x] `npx vitest run src/core/skills/catalog.test.ts src/http/messagesRoute.test.ts src/http/runtimeSkills.test.ts src/backends/cli/providers/pi.test.ts src/backends/cli/providers/codex.test.ts src/backends/cli/pool/SessionRegistry.test.ts src/http/piManagement.test.ts --pool=threads --poolOptions.threads.singleThread`

### WP-10: Provider Compatibility and Evidence Engine

**Status**: In Progress
**Assigned**: Codex
**Priority**: P0

#### Goal

Make CLI-backed providers more resilient to provider/CLI drift by adding a
shared compatibility engine that can fingerprint targets, select compatible
runtime profiles, expose machine-readable readiness/degradation, and capture
replay-friendly evidence when probes fail or behavior is unknown.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Write implementation plan for the first compatibility slice | [x] | `docs/plans/PLAN-008-provider-compatibility-and-evidence-engine.md` records scope, phases, and validation targets |
| Add shared compatibility engine under `src/core/compatibility` | [x] | Runtime now caches probe results, classifies compatibility, and exposes cached summaries across routes and execution |
| Reuse compatibility assessment across setup, diagnostics, and execution | [x] | Session create/resume/fork paths prime CLI targets before spawn; diagnostics and provider config read from the same cache |
| Add first-wave provider-family knowledge and degraded profile selection | [x] | Claude, Codex, Gemini, and Copilot now have curated probe/profile metadata; other CLI families fall back to runtime-default profiles with explicit degradation |
| Port runtime-owned install/check metadata from bootstrap knowledge | [x] | `src/core/provider-install` now owns copied provider install/check logic, platform-specific commands, prerequisite metadata, PATH/npm-prefix hints, auth hints, and shared command/package/shell checks without a runtime dependency on `environment-bootstrap` |
| Surface machine-readable remediation over diagnostics/provider config | [x] | `/diagnostics/providers` now includes CLI `setup` summaries for missing install/PATH/prerequisite/npm-prefix/auth/version cases, supports target-scoped `provider` / `backend` / `instance` / `defaultOnly` filters with echoed query metadata, and `/providers/config` exposes static `install` metadata for configured CLI targets |
| Capture replay-friendly evidence for mismatches and unknown behavior | [x] | Non-ready CLI assessments write redacted JSON evidence bundles under the runtime data dir and expose artifact metadata over diagnostics surfaces |
| Update tests and docs for compatibility contracts | [x] | Vitest, API docs, setup docs, architecture notes, README, and this progress tracker now describe the first slice |

#### Deferred Boundaries

- [ ] No LLM-dependent compatibility hot path; evidence capture remains lightweight probe/output logging only
- [ ] No provider-family-specific profiles yet for every CLI adapter; several providers still use the generic degraded fallback
- [ ] No attempt to fold usage metering or progress-event expansion into this slice

#### Verification

- [x] `npm run build`
- [x] `npx vitest run tests/runtime-diagnostics.test.ts tests/runtime-startup.test.ts tests/runtime-server.test.ts tests/api-backend.test.ts tests/agent-backend.test.ts src/core/compatibility/ProviderCompatibilityService.test.ts src/backends/cli/providers/claude.test.ts src/backends/cli/providers/codex.test.ts src/backends/cli/providers/gemini.test.ts src/backends/cli/providers/copilot.test.ts --pool=threads --poolOptions.threads.singleThread`

### WP-11: Scheduled Wakeup Substrate

**Status**: Completed
**Assigned**: Codex
**Priority**: P1

#### Goal

Land a lightweight runtime-owned scheduled wakeup substrate that upper-layer
products can build on without turning `cats-runtime` into a full heartbeat
scheduler or workflow engine.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Define the scheduled wakeup substrate direction | [x] | `docs/specs/SPEC-012-scheduled-wakeup-substrate.md` freezes scope and first-slice non-goals |
| Add runtime-owned wakeup service under `src/core/wakeup` | [x] | `RuntimeWakeupService` now owns persistence, coalescing, and bounded due-request processing |
| Add runtime-owned wakeup HTTP routes | [x] | `GET /wakeups`, `POST /wakeups`, `POST /wakeups/{id}/cancel`, and `POST /wakeups/{id}/trigger` are now public |
| Make wakeups restart-safe | [x] | Wakeup requests persist under the runtime data dir and are reloaded on server restart |
| Reuse existing session wake/resume flow | [x] | Triggered wakeups delegate to runtime session ensure-awake logic rather than inventing a second lifecycle |
| Surface additive wakeup metadata in session/history inspection | [x] | `GET /sessions`, `GET /sessions/{id}`, and `GET /sessions/{id}/history` now expose session-target wakeup state when present |
| Cover service and route behavior with tests | [x] | Vitest now covers coalescing, restart-safe replay, bounded timer ticks, and HTTP contract behavior |

#### Deferred Boundaries

- [ ] No recurring schedules, retry policy, or cron syntax
- [ ] No provider/bootstrap wake targets for sessions that do not exist yet
- [ ] No full runtime diagnostics aggregate for wakeup counts yet
- [ ] No product workflow/approval semantics in runtime

#### Verification

- [x] `npm run build`
- [x] `npx vitest run src/core/wakeup/RuntimeWakeupService.test.ts src/http/wakeupRoutes.test.ts src/http/runtimeSkills.test.ts src/http/piManagement.test.ts tests/runtime-server.test.ts --pool=threads --poolOptions.threads.singleThread`
- [x] `npx vitest run src/core/wakeup/RuntimeWakeupService.test.ts src/http/wakeupRoutes.test.ts src/http/runtimeSkills.test.ts src/http/piManagement.test.ts tests/runtime-server.test.ts --pool=threads --poolOptions.threads.singleThread`

### WP-12: Session Discipline and Run Inspector Contracts

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Strengthen runtime lifecycle rigor and observability so hosts can inspect what a
session is doing now, why it woke, what the last run did, and how close /
cancel / reset / delete behave across CLI, API, and agent backends.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add runtime-owned current/last-run inspection contract | [x] | Session payloads now expose `inspection.state`, `wake`, `currentRun`, `lastRun`, `progress`, `recentEvents`, action affordances, and per-run `previewSurfaces` |
| Add session-scoped metering/incident/guardrail inspection reads | [x] | `inspection.metering` now projects per-session usage, preflight guardrails, active guardrails, and recent incidents |
| Add additive `/sessions/{id}/observe` snapshot route | [x] | Hosts can fetch run-inspector state plus history/stream links without opening SSE |
| Add additive `/sessions/{id}/cancel` and `/sessions/{id}/reset` routes | [x] | Runtime now exposes explicit cancel vs reset semantics and additive lifecycle snapshots without breaking existing close/delete flows |
| Strengthen backend cleanup symmetry | [x] | Agent-backed close/cancel/delete/reset now route through adapter-aware remote cleanup; CLI/API now expose best-effort cancel semantics too |
| Extend history/session routes with the same inspection contract | [x] | `GET /sessions`, `GET /sessions/{id}`, and `GET /sessions/{id}/history` now share one additive inspection payload, plus history-level transcript provenance and Pi-native parsing |
| Cover lifecycle/inspection behavior with automated tests | [x] | Vitest covers session close/cancel/reset/observe, agent remote cleanup, history inspection, and broad route regressions |

#### Deferred Boundaries

- [ ] No scheduler/wakeup queue or duplicate-wake coalescing layer yet
- [ ] No product-owned approval UX or run-inspector rendering in `cats-runtime`
- [ ] No full provider-native log archival/export redesign yet beyond compact recent-event excerpts

#### Verification

- [x] `npm run build`
- [x] `npx vitest run src/http/sessionClose.test.ts src/http/messagesRoute.test.ts tests/agent-backend.test.ts src/http/cursorManagement.test.ts src/http/kiroManagement.test.ts src/http/opencodeManagement.test.ts src/http/auggieManagement.test.ts src/http/runtimeSkills.test.ts tests/session-branching.test.ts tests/api-backend.test.ts src/http/piManagement.test.ts tests/runtime-server.test.ts --pool=threads --poolOptions.threads.singleThread`

### WP-13: Workspace Hydration and Runtime Skill Re-entry

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Make session create/resume/fork re-enter the same workspace and runtime-skill
context reliably, especially for provider-specific skill materialization such as
Codex filesystem skills and Pi instruction files.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add implementation plan for hydration/re-entry work | [x] | `docs/plans/PLAN-011-workspace-hydration-and-runtime-skill-reentry.md` records scope, phases, and watchpoints |
| Add a shared hydration seam under `src/core/hydration` | [x] | Runtime now rebuilds skill delivery from persisted requested skills and records additive workspace/skill hydration metadata |
| Preserve authoritative workspace provenance across isolated sandboxes | [x] | Session hydration now distinguishes `runtimeCwd` from `sourceCwd` so temporary sandboxes are not mistaken for long-term workspace truth |
| Rehydrate backend-specific skill delivery on resume | [x] | Codex filesystem skills and Pi instruction files are re-materialized before resume when needed |
| Re-resolve skill delivery on fork/provider switch | [x] | Child sessions now derive fresh delivery state for the target backend instead of copying parent delivery metadata blindly |
| Surface additive hydration metadata in session/history/observe payloads | [x] | Public session-facing reads now expose `hydration.workspace` and `hydration.skills` without redesigning the routes |
| Cover hydration/re-entry behavior with tests | [x] | Vitest covers session hydration helpers, workspace provenance, persisted registry metadata, Codex provider-switch forks, and Pi resume regeneration |

#### Deferred Boundaries

- [ ] No product-owned companion schema or durable companion-box state is stored in runtime
- [ ] No automatic workspace substrate apply behavior; hydration only reuses read-only audit metadata
- [ ] No generalized workspace copy/sync engine beyond existing isolated sandbox copy semantics

#### Verification

- [x] `npm run build`
- [x] `npx vitest run src/core/hydration/sessionHydration.test.ts src/backends/cli/pool/workspace.test.ts src/backends/cli/pool/SessionRegistry.test.ts src/http/runtimeSkills.test.ts src/http/piManagement.test.ts --pool=threads --poolOptions.threads.singleThread`
- [x] `npm test` (known pre-existing failures remain in `tests/runtime-process.test.ts`, `tests/runtime-server.test.ts`, and `src/backends/cli/pool/WorkerProcess.test.ts`; targeted hydration suites passed)

### WP-14: Session Maintenance Hooks and Cleanup Discipline

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Make long-running session lifecycle boundaries more predictable by adding
runtime-owned maintenance metadata for reset/cleanup/compaction readiness
without moving memory extraction or product policy into `cats-runtime`.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add implementation plan for maintenance-hook work | [x] | `docs/plans/PLAN-012-session-maintenance-hooks-and-cleanup-discipline.md` records scope and boundaries |
| Add runtime-owned session maintenance contract | [x] | `inspection.maintenance` now exposes compaction readiness, pending hook groups, reset boundaries, cleanup guidance, lifecycle markers, and the last accepted maintenance trigger request |
| Track close/reset/delete lifecycle markers in runtime state | [x] | `RuntimeSessionManager` now records machine-readable lifecycle boundaries instead of leaving close/reset semantics implicit |
| Clear stale run/progress state on hard reset | [x] | Reset now drops current/last run snapshots, progress, recent events, and stale hydration metadata before the next lifecycle begins |
| Add machine-readable delete cleanup summary | [x] | Delete responses now expose normalized cleanup booleans plus terminal lifecycle metadata for `completed` vs `retained` deletes |
| Expose public compaction-preparation route without moving compaction into runtime | [x] | `POST /sessions/{id}/compact` now returns machine-readable readiness/hook state plus persisted maintenance trigger metadata while remaining `external_only` |
| Leave additive Team 4/product memory-flush seam without implementing the pipeline | [x] | Runtime now advertises pending `memory_flush` hooks before reset/compaction, accepts additive maintenance trigger payloads, and keeps durable-memory exports product-owned |
| Cover maintenance and lifecycle-boundary behavior with tests | [x] | Vitest now covers session-maintenance derivation, close/reset lifecycle markers, history reset boundaries, and delete cleanup payloads |

#### Deferred Boundaries

- [ ] No runtime-owned compaction engine yet; `/sessions/{id}/compact` is an external-only coordination seam
- [ ] No memory extraction / summarization pipeline in runtime; the hook seam is declarative only
- [ ] No product-side policy for when a host must honor `memory_flush`

#### Verification

- [x] `npm run build`
- [x] `npx vitest run src/core/runtime/sessionMaintenance.test.ts src/http/sessionClose.test.ts --pool=threads --poolOptions.threads.singleThread`
- [x] `npm test`

### WP-15: Runtime MCP Facade

**Status**: Completed
**Assigned**: Codex
**Priority**: P1

#### Goal

Expose a runtime-owned MCP facade for orchestrator-style agents without
replacing the direct runtime HTTP API used by product code.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add runtime-owned MCP module under `src/mcp` | [x] | JSON-RPC handling, tool registry, stdio framing, and runtime read-model helpers now live outside provider adapters |
| Add `POST /mcp` facade route | [x] | `initialize`, `ping`, `tools/list`, `tools/call`, and `notifications/initialized` are supported |
| Expose curated read + mutation tool slice | [x] | `runtime_summary`, `list_sessions`, `provider_diagnostics`, `observe_session`, `list_runtime_skills`, `list_browser_drivers`, `list_browser_sessions`, `browser_summary`, `create_browser_session`, `create_browser_page`, `close_browser_session`, `cleanup_browser_sessions`, `create_session`, `send_message`, `fork_session`, `audit_workspace`, `init_workspace`, `audit_delivery_target`, and `commit_changes` now ship; `provider_diagnostics` now mirrors the same target filters as `/diagnostics/providers` |
| Reuse existing runtime services/read models instead of inventing a second execution stack | [x] | MCP tools route into the existing session, delivery, and workspace contracts already used by HTTP routes/tools |
| Add standalone stdio MCP transport | [x] | `cats-runtime-mcp` now exposes the same tool plane over Content-Length framed stdio JSON-RPC |
| Update MCP docs and coverage | [x] | `docs/api.md`, `docs/architecture.md`, `docs/mcp-config.md`, `../../cats/docs/mcp-config.md`, `src/http/mcpRoutes.test.ts`, and `src/mcp/stdio.test.ts` now describe and verify the slice |

#### Deferred Boundaries

- [ ] No attempt to make MCP the primary product/runtime interface

### WP-16: Browser Preview Substrate v0

**Status**: Completed
**Assigned**: Codex
**Priority**: P1

#### Goal

Land a runtime-owned browser/preview substrate with pluggable drivers and
normalized browser-page preview surfaces, without turning `cats-runtime` into a
full BrowserOS product or depending on sibling browser projects.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add browser driver/session/page contracts | [x] | `src/core/types.ts` now defines runtime-owned browser driver/session/page and `browser_page` preview-surface shapes |
| Add `src/core/browser` substrate | [x] | `RuntimeBrowserService` now manages runtime-owned browser sessions/pages, preview-surface inspection, and restart-safe persisted browser state |
| Add first pluggable browser driver | [x] | `src/backends/browser/manualDriver.ts` validates the contract without launching a managed browser |
| Add browser HTTP routes | [x] | `/browser/drivers`, `/browser/summary`, `/browser/sessions`, `/browser/sessions/{id}`, `/browser/sessions/cleanup`, `/browser/sessions/{id}/pages`, and `/browser/sessions/{id}/close` now ship |
| Align service/artifact/browser-page preview surfaces | [x] | Browser routes can bind to runtime session services/artifacts while preserving the existing preview-surface schema |
| Update docs and tests | [x] | `README.md`, `docs/api.md`, `docs/architecture.md`, `docs/AGENT-GUIDE.md`, `docs/plans/PLAN-013-*.md`, and browser tests now cover the slice |

#### Deferred Boundaries

- [ ] No real Playwright/CDP/BrowserOS driver yet; the first slice validates contracts with a manual driver only
- [ ] No automatic background expiry/GC yet; persistence currently relies on explicit cleanup routes plus capacity-pressure pruning
- [ ] No automatic background expiry/GC yet; cleanup is explicit plus capacity-pressure pruning only
- [ ] No product-side preview UI or browser takeover workflow yet

### WP-17: Worktree Isolation Execution Layer

**Status**: Completed
**Assigned**: Codex
**Priority**: P0

#### Goal

Extend the existing workspace substrate into a runtime-owned worktree execution
layer so session create/resume/reset/delete/fork can use deterministic Git
worktrees with explicit merge-or-discard cleanup, without moving product policy
into `cats-runtime`.

#### Delivered

| Task | Status | Notes |
|------|--------|-------|
| Add shared worktree lifecycle helpers under `src/core/workspace` | [x] | `prepareSessionWorkspace()` and `cleanupSessionWorkspace()` now own shared/isolated/worktree preparation plus merge-or-discard cleanup |
| Freeze additive workspace isolation metadata in runtime session contracts | [x] | Session payloads, hydration metadata, registry persistence, and workspace grouping now retain `workspaceIsolation` and `hydration.workspace.isolationMode` |
| Wire worktree preparation into create/resume/fork | [x] | `POST /sessions`, `POST /sessions/{id}/resume`, and `POST /sessions/{id}/fork` now prepare or recreate worktree-backed runtime cwd state before spawn |
| Wire worktree cleanup into reset/delete | [x] | `POST /sessions/{id}/reset` and `DELETE /sessions/{id}` now support `worktreeCleanupPolicy: "discard" | "merge" | "preserve"` plus retained cleanup responses |
| Add bounded retained cleanup retry route | [x] | `POST /sessions/{id}/workspace/cleanup` plus MCP `cleanup_session_workspace` now retry retained worktree cleanup and refresh persisted hydration/skill delivery state without replaying reset/delete side effects |
| Extend MCP session lifecycle controls for recovery flows | [x] | MCP now exposes `close_session`, `reset_session`, and `cleanup_session_workspace`, so orchestrators can drive close/reset/retry cleanup flows without dropping back to bespoke HTTP calls |
| Leave additive pre-reset / pre-compaction / pre-flush hook seams | [x] | Session maintenance now advertises `pre_flush` alongside the existing Team 3 memory-flush seam instead of hard-coding a product memory pipeline |
| Cover lifecycle behavior with automated tests | [x] | Vitest now covers worktree preparation, merge/discard cleanup, resume re-prepare, registry persistence, and route-level worktree flows |
| Update docs/progress/plan tracking | [x] | `README.md`, `docs/api.md`, `docs/architecture.md`, `docs/plans/PLAN-014-worktree-isolation-execution-layer.md`, and `PROGRESS.md` now describe the slice |

#### Deferred Boundaries

- [ ] No background garbage collector for abandoned worktrees yet; cleanup still runs at explicit reset/delete or operator-invoked retry boundaries
- [ ] No automatic dirty-source merge resolution; `merge` intentionally retains the session/worktree when the source repo is already dirty
- [ ] No generalized two-way workspace sync beyond the current fork-time snapshot copy for non-shared child workspaces

#### Verification

- [x] `npm run build`
- [x] `npm test`

---

*Last updated: 2026-03-24*
