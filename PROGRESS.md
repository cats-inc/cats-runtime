# Progress

> Implementation status for the embedded `cats-runtime` delivery track.

## Current Status

| Component | Status | Description |
|-----------|--------|-------------|
| Core | Completed | Embedded CLI runtime, shared session contracts, discovery, worker pool, runtime-owned shared/isolated/worktree workspace lifecycle helpers, first-slice runtime-owned usage/incident/guardrail contracts, additive session-maintenance/reset-boundary hooks, and persisted maintenance trigger metadata are in-repo |
| API Backends | In Progress | `src/backends/api` now runs Claude, Codex/OpenAI, Gemini, and Ollama with runtime-managed sessions, provider-native continuation/caching optimizations, additive incident hints plus provider-agnostic `progress` events, a shared local tool loop with patch/file/search/shell support plus `inspect_path` / `create_directory` navigation-materialization helpers, additive session-inspection tool-policy summaries for API/local sessions, additive provider-level tooling summaries on `/providers/config`, `/providers/{provider}/tools`, and `/diagnostics/providers` including bounded tooling observability truth, runtime-owned health/diagnostics summaries including transport-native live auth/model probes for API/local targets, auth-ready dynamic remote model-catalog discovery for OpenAI/Anthropic/Gemini plus local Ollama discovery, bounded remote discovery timeout/abort handling for those HTTP-backed model probes, and the additive execution-strategy family expansion beyond compatibility fallback (`simple_tool_call`, bounded `react`, bounded `plan_execute`, bounded `pdca`, bounded `reflexion`, and bounded `tree_of_thoughts` for runtime-hosted loops); richer remote tool discovery and later strategy families remain |
| Agent Backend | In Progress | `src/backends/agent` now exists with shared session/bootstrap/output contracts, OpenClaw Gateway as the first adapter, an Agent SDK bridge as the second validation target, first-slice remote cleanup hooks for close/cancel/delete/reset semantics, live OpenClaw gateway `health` probes wired into runtime diagnostics through the shared agent backend manager, OpenClaw `models.list`-backed dynamic provider catalog loading using canonical `provider/model` refs, additive agent-target inspection read models (`agentRuntime`) on `/providers/config`, `/providers/{provider}/tools`, and `/diagnostics/providers` describing adapter family, transport/probe shape, auth surface, continuity mode, and runtime-visible capabilities, and additive agent `config.liveProbe` / check details for OpenClaw gateway health snapshots plus Agent SDK provider-registry and configured-model visibility |
| Bootstrap / Setup | In Progress | Standalone bootstrap mode, generated `providers.yaml`, persisted setup-state/manual-scan artifacts, provider-first setup routes, bounded concurrent provider scan orchestration, a shared `GET /setup-state` read model with repair/next-action metadata plus actionable `repair.actions`, ready-to-apply provider lists, remediation previews, and the latest setup-report snapshot including a concise report headline plus bounded highlights, and a redacted setup diagnostic report service across persisted `/diagnostics/setup-report` artifacts plus additive operator-facing `summary.headline` / `summary.highlights` fields and a non-server `--diagnose-setup` CLI entry path that now prints a concise stderr summary while keeping stdout JSON machine-readable are in-repo; shared UI follow-through and broader repair flows remain |
| HTTP API | Completed | Health, sessions, delivery audit/export/repo routes, messages, history, observe, wakeups, provider management, session branch-lineage inspection, metering/guardrail diagnostics, additive run-inspector/session-discipline contracts, machine-readable session-maintenance/delete-cleanup payloads, worktree-backed session lifecycle cleanup semantics including `preserve`, runtime maintenance snapshots under `/diagnostics/runtime`, and the runtime MCP facade over HTTP plus stdio are served directly from `cats-runtime` |
| Runtime Skills | Completed | `skills/` is now a runtime-owned execution catalog and family-aware internal library with validation, session-level requested/resolved/applied metadata, richer slug/family/capability metadata, explicit `skills: null` clearing, backend-aware delivery modes, prompt/instruction execution injection across prompt-driven CLI plus Pi/API/agent targets, inspection-level applied-skill reporting, a standalone versioned filterable/paged/sortable `GET /skills/catalog` read surface plus matching `list_runtime_skills` MCP read tool, a dedicated `npm run verify:skills` gate, shared re-entry hydration across create/resume/fork/provider-switch, and shared discovery/content-fingerprint catalog cache hardening |
| Wakeup Substrate | Completed | Runtime-owned scheduled wakeup requests now support create/list/cancel/trigger, restart-safe persistence, bounded timer processing, coalescing, UTC cron-like recurring schedules with automatic re-arming, and additive session/history wakeup metadata without turning the runtime into a full workflow scheduler |
| Provider Compatibility | In Progress | Shared CLI compatibility probing now classifies `ready` / `degraded` / `unsupported_version` / `unrecognized_protocol` / `probe_failed`, validates `light` vs `live` runtime-flag probes across expanded CLI family profiles, captures redacted replay-friendly evidence bundles, tracks stale cache/reprobe metadata, exposes runtime-owned install/prerequisite/PATH/npm-prefix/auth/version/remediation hints for CLI targets, supports target-scoped `provider` / `backend` / `instance` / `defaultOnly` filtering over `/diagnostics/providers` plus the matching MCP seam, and now adds additive transport-native live auth/model probes, provider-level tooling summaries with bounded observability metadata, dynamic remote/API/local model-catalog checks for readiness, bounded timeout/abort classification for HTTP-backed live probes, and structured agent liveProbe/readiness checks instead of config-only agent probe summaries |
| Dashboard | Completed | The embedded dashboard UI is served from `GET /` and now surfaces runtime/provider health from runtime-owned diagnostics contracts |
| Workspace Substrate | Completed | `audit-workspace`, `init-workspace`, and `update-workspace` now return explicit preview/apply contracts, machine-readable action plans/diff stats, approval-friendly payloads, and `*.bootstrap` review-copy behavior without owning product policy |
| Delivery Primitives | Completed | Runtime-owned delivery audit, artifact publish/export, repo status, commit, push, and normalized preview-surface metadata are now available over both HTTP routes and local tools |
| Management Adapters | Completed | Runtime-owned management adapters for non-session control-plane tools (GitHub CLI review, Zeabur CLI deployment) with 8 actions across 2 domains, product-neutral authorization, bounded long-poll for review checks, `RuntimePreviewSurface` reuse for deployment URLs, dedicated HTTP/MCP/local-tool surfaces, adapter diagnostics, and `config/management.yaml` configuration |
| Browser Preview Substrate | Completed | Runtime-owned browser driver/session/page contracts, `browser_page` preview surfaces, manual driver validation, restart-safe browser state persistence, additive `/browser/*` routes, session/history/observe inspection integration, aggregate browser summary/cleanup seams, background closed-session maintenance, and reset/delete cleanup for runtime-bound browser sessions now exist without depending on sibling browser projects |
| Peer Discovery & Routing | Completed | PLAN-017 v0 now includes bounded peer registry/discovery diagnostics, dedicated `POST /peer/executions`, additive `routing` on `POST /sessions/{id}/messages`, trust-gated runtime-to-runtime execution, shared-secret overlap windows for peer auth rotation, bounded auth-failure throttling plus inbound admission control on peer-only routes, additive peer-route guardrail summaries plus bounded peer diagnostics snapshots for those guardrails including replay-protection state, bounded nonce/timestamp replay resistance for peer execution auth, additive per-peer quota overrides for auth-failure/inbound/replay ceilings, additive network-posture diagnostics for TLS vs trusted-LAN plaintext peer endpoints, and caller-owned observe/stream relay semantics without changing existing `cats` contracts |
| Tests | Completed | Vitest covers provider, discovery, peer registry/routing/trust/auth, peer execution relay, pool, HTTP, delivery, server bootstrap, API/local tool-loop behavior, and first-slice metering/guardrail/progress normalization |
| Docs | In Progress | Core docs now cover startup/diagnostics, provider compatibility/evidence flows, model catalog, session branching, worktree-backed session isolation and cleanup, workspace substrate, runtime hydration/re-entry metadata, delivery primitives, the browser preview substrate, runtime-managed skills plus the internal skill-library taxonomy/metadata contract, the scheduled wakeup substrate, first-slice metering/progress contracts, additive session inspection/run-state/maintenance payloads including sanitized persisted maintenance requests plus generic maintenance follow-through outcomes, bounded maintenance request/follow-through history, additive `maintenance.flush` read-model state, the runtime MCP facade over HTTP plus stdio, and PLAN-017 LAN peer discovery/execution routing v0 including peer network-posture diagnostics; browser-driver follow-through and remaining PLAN-003 or PLAN-005 follow-on items still need ongoing updates |
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

- [ ] Continue broadening provider health probes beyond the current transport-native API/local auth/model checks, provider-level tooling summaries plus bounded observability truth, agent-target `agentRuntime` inspection metadata, and structured OpenClaw/Agent SDK liveProbe semantics, especially richer remote tool discovery and stronger live semantic validation for later targets
- [ ] Continue hardening shared local tool runtime mutation safety beyond the current bounded `apply_patch` rollback, staged atomic `write_file` / `edit_file` replacement, symlink/junction/hardlink alias guards, preserved file modes on staged replacements, and failed-create empty parent-directory cleanup, especially broader metadata restoration
- [ ] Continue broadening the shared local tool runtime beyond the current filesystem/shell/navigation/materialization set plus proposed-file diff and bounded batch-read inspection, especially richer planning helpers
- [ ] Continue refining capability partitioning and policy surfacing beyond the current profile summary/read-model slice, per-tool capability/access metadata, and `standard` / `extended` / `read_only` split

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
| Add shared local tool runtime for API/local sessions | [x] | `list_files`, `inspect_path`, `read_file`, `read_files`, `write_file`, `create_directory`, `edit_file`, `apply_patch`, `grep`, `glob`, and `run_shell` are enforced centrally, with extended `delete_file` / `rename_file` / `copy_file` support behind the opt-in profile |
| Cover API/local behavior with automated tests | [x] | Transport, tool runtime, and end-to-end HTTP flows are under Vitest |
| Add provider health probes and dashboard health surfacing | [x] | The runtime now exposes `/diagnostics/health`, richer `/health`/`/diagnostics/runtime` contracts, dashboard header health polling, bounded transport-native live auth/model probes for API/local targets, and additive HTTP semantic classifications such as auth/rate-limit/upstream warnings; broader tool/agent semantics still remain |
| Add provider-specific caching/continuation optimizations | [x] | OpenAI `previous_response_id`, Anthropic prompt caching, and Gemini context caching are in place |
| Stabilize provider model catalog/discovery contract | [x] | `GET /providers/{provider}/models` now documents and tests cache, fallback, error-code, Ollama running-model semantics, auth-ready OpenAI/Anthropic/Gemini remote listing before config/static fallback, honest auth-skip warnings when dynamic API listing cannot run yet, and bounded timeout/abort degradation for HTTP-backed remote discovery |
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
| Build OpenClaw as the first `src/backends/agent` adapter | [x] | `AgentBackendManager` and `openclaw_gateway` adapter now create, stream, resume, reuse, and persist agent-backed sessions; diagnostics now reuse the same manager/runtime options for live gateway health probes, expose additive OpenClaw gateway health-snapshot details under `config.liveProbe`, and provider model catalog reads now use gateway `models.list` with canonical `provider/model` refs |
| Validate the contract with a second target such as an Agent SDK adapter | [x] | `agent_sdk_bridge` now validates the same contract against an external Agent SDK gateway |
| Cover agent backend flows with automated tests | [x] | Config, route, OpenClaw, and Agent SDK bridge integration behavior are covered by Vitest |
| Land the first Pi session-depth/runtime-validation slice on the CLI track | [x] | Pi now resumes via discovered session-file paths, validates resume-path ownership/runtime reachability, retries stale `unknown session` turns once fresh, supports per-instance `instructions_file` layering, and loads dynamic provider catalogs through `pi --list-models` |

#### Next Steps

- [ ] Expand dashboard surfacing for agent-specific services/artifacts beyond the current generic session views
- [ ] Add richer remote tool discovery beyond the current provider-tooling observability slice and stronger later-target semantic probes beyond the current OpenClaw gateway health/model checks and Agent SDK bridge provider-registry/model visibility coverage

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
- [ ] No comprehensive semantic live health probes for every target type yet; API/local transports now use transport-native auth/model probe requests, but later agent/tool-specific semantics still remain
- [ ] No full transactional rollback for shared local-tool writes/edits yet; `apply_patch` now restores bounded file content/presence on failure, while `write_file` / `edit_file` preserve existing file modes and clean empty parent dirs after failed new-file writes, but broader metadata restoration still remains

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
| Harden catalog cache invalidation and shared discovery traversal | [x] | Per-root skill catalog caching now reuses one discovered entry enumeration path and invalidates from entry content fingerprints instead of truncated mtimes |
| Support delivery modes `filesystem`, `instructions`, and `none` | [x] | Codex isolated sessions prefer filesystem delivery, prompt-driven CLI plus Pi/API/agent targets can consume instruction delivery, and unsupported targets stay explicit with `none` |
| Inject runtime skill delivery into live execution paths | [x] | Prompt-driven CLI providers now compile resolved skill instructions into the live turn prompt, while API/agent backends compose the same session/turn instruction layering without rescanning the catalog |
| Verify CLI-first targets | [x] | Codex filesystem delivery, Pi instruction-file delivery, and prompt-driven instruction injection are covered by automated tests |
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
| Surface runtime-wide wakeup diagnostics aggregates | [x] | `GET /diagnostics/runtime` now exposes the full wakeup snapshot and `GET /diagnostics/health` exposes a polling-friendly wakeup summary |
| Cover service and route behavior with tests | [x] | Vitest now covers coalescing, restart-safe replay, bounded timer ticks, and HTTP contract behavior |

#### Deferred Boundaries

- [ ] No richer retry/backoff policy or non-UTC scheduling semantics yet beyond the delivered cron recurrence slice
- [ ] No provider/bootstrap wake targets for sessions that do not exist yet
- [ ] No product workflow/approval semantics in runtime

#### Verification

- [x] `npm run build`
- [x] `npx vitest run src/core/wakeup/RuntimeWakeupService.test.ts src/http/wakeupRoutes.test.ts src/http/runtimeSkills.test.ts src/http/piManagement.test.ts tests/runtime-server.test.ts --pool=threads --poolOptions.threads.singleThread`
- [x] `npm test`

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

- [ ] No product workflow queue yet beyond the runtime-owned wakeup scheduling/coalescing layer
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
| Add runtime-owned session maintenance contract | [x] | `inspection.maintenance` now exposes compaction readiness, pending hook groups, reset boundaries, cleanup guidance, lifecycle markers, additive `flush` read-model state, and the last accepted maintenance trigger request |
| Track close/reset/delete lifecycle markers in runtime state | [x] | `RuntimeSessionManager` now records machine-readable lifecycle boundaries instead of leaving close/reset semantics implicit |
| Clear stale run/progress state on hard reset | [x] | Reset now drops current/last run snapshots, progress, recent events, and stale hydration metadata before the next lifecycle begins |
| Add machine-readable delete cleanup summary | [x] | Delete responses now expose normalized cleanup booleans plus terminal lifecycle metadata for `completed` vs `retained` deletes |
| Expose public compaction-preparation route without moving product compaction policy into runtime | [x] | `POST /sessions/{id}/compact` now returns machine-readable readiness/hook state plus persisted maintenance trigger metadata, and runtime-managed transcripts compact in place when the session is locally ownable |
| Add persisted maintenance follow-through envelope | [x] | `POST /sessions/{id}/maintenance/follow-through` plus matching MCP tooling now let hosts acknowledge, retry, and report completion for `pre_reset`, `pre_compaction`, and `pre_flush`; reset/delete/workspace-cleanup can also opt into `requireAcknowledgedHooks`, `POST /sessions/{id}/compact/follow-through` remains as the compaction shortcut, and bounded request/follow-through history now preserves action-scoped hook state across later lifecycle actions |
| Add runtime-owned compaction for managed transcripts | [x] | Runtime-managed JSONL transcripts now repair malformed lines, archive the repaired baseline, compact aggressively toward the threshold, and persist `lastCompaction` metadata plus `compaction_summary` history entries |
| Leave additive Team 4/product memory-flush seam without implementing the pipeline | [x] | Runtime now advertises pending `memory_flush` hooks before reset/compaction, accepts additive maintenance trigger payloads, and keeps durable-memory exports product-owned |
| Cover maintenance and lifecycle-boundary behavior with tests | [x] | Vitest now covers session-maintenance derivation, close/reset lifecycle markers, history reset boundaries, and delete cleanup payloads |

#### Deferred Boundaries

- [ ] No provider-agnostic compaction worker yet beyond runtime-managed transcript repair/summary for locally owned transcripts
- [ ] No memory extraction / summarization pipeline in runtime; the hook seam is declarative only
- [ ] No product-side policy for when a host must honor `memory_flush`
- [ ] No runtime-owned hook execution yet; current lifecycle gating only validates persisted follow-through and still leaves flush/export work to upper layers

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
| Expose curated read + mutation tool slice | [x] | `runtime_summary`, `list_sessions`, `provider_diagnostics`, `observe_session`, `list_runtime_skills`, `list_browser_drivers`, `list_browser_sessions`, `browser_summary`, `create_browser_session`, `create_browser_page`, `close_browser_session`, `cleanup_browser_sessions`, `create_session`, `send_message`, `close_session`, `reset_session`, `fork_session`, `delete_session`, `cleanup_session_workspace`, `compact_session`, `report_session_maintenance_follow_through`, `report_compaction_follow_through`, `audit_workspace`, `init_workspace`, `audit_delivery_target`, and `commit_changes` now ship; `provider_diagnostics` now mirrors the same target filters as `/diagnostics/providers` |
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
- [ ] No real Playwright/CDP/BrowserOS driver yet; the first slice still validates contracts with a manual driver only
- [ ] No richer retained-session/browser-page GC policy yet beyond closed-session TTL sweeps plus explicit cleanup routes
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
| Add bounded retained cleanup retry route | [x] | `POST /sessions/{id}/workspace/cleanup` plus MCP `cleanup_session_workspace` now retry retained worktree cleanup, refresh persisted hydration/skill delivery state, and auto-settle retained reset follow-through when cleanup finally succeeds |
| Return explicit retry cleanup path for retained lifecycle responses | [x] | Retained worktree-backed `reset`/`delete` responses now include `retryCleanupPath`, and the same next-hop path propagates through MCP payloads so orchestrators can call the bounded cleanup retry seam directly |
| Surface cleanup retry path through session inspection | [x] | `inspection.maintenance.cleanup` now advertises `retryCleanupPath` when a closed worktree session is actually ready for bounded cleanup retry, so later `GET /sessions` reads preserve the same next hop |
| Sweep orphaned worktrees and surface retained TTL diagnostics | [x] | Runtime worktree maintenance now removes orphaned worktrees in the background and reports retained-session expiry candidates through `/diagnostics/runtime` |
| Auto-clean conservative retained preserved worktrees | [x] | The runtime worktree sweeper now auto-cleans TTL-expired `worktreeCleanupPolicy: "preserve"` sessions and reports auto-clean success/failure ids through `/diagnostics/runtime` |
| Auto-settle retained deletes after bounded cleanup succeeds | [x] | `POST /sessions/{id}/workspace/cleanup` now finalizes retained delete lifecycles when cleanup finally completes, and the background sweeper reuses the same settlement path for expired preserved sessions |
| Surface large fork snapshot warnings | [x] | Non-shared fork copies now record copied file/byte counts, additive large-workspace warning codes, and a bounded one-shot snapshot planning contract under hydration metadata |
| Extend MCP session lifecycle controls for recovery flows | [x] | MCP now exposes `close_session`, `reset_session`, `delete_session`, and `cleanup_session_workspace`, so orchestrators can drive close/reset/delete/retry cleanup flows without dropping back to bespoke HTTP calls |
| Leave additive pre-reset / pre-compaction / pre-flush hook seams | [x] | Session maintenance now advertises `pre_flush` alongside the existing Team 3 memory-flush seam instead of hard-coding a product memory pipeline |
| Cover lifecycle behavior with automated tests | [x] | Vitest now covers worktree preparation, merge/discard cleanup, resume re-prepare, registry persistence, and route-level worktree flows |
| Update docs/progress/plan tracking | [x] | `README.md`, `docs/api.md`, `docs/architecture.md`, `docs/plans/PLAN-014-worktree-isolation-execution-layer.md`, and `PROGRESS.md` now describe the slice |

#### Deferred Boundaries

- [ ] No broader retained-worktree GC yet beyond orphan sweeping plus conservative TTL cleanup for preserved retained sessions
- [ ] No automatic dirty-source merge resolution; `merge` intentionally retains the session/worktree when the source repo is already dirty
- [ ] No generalized two-way workspace sync beyond the current fork-time snapshot copy plus additive large-workspace planning metadata for non-shared child workspaces

#### Verification

- [x] `npm run build`
- [x] `npm test`

---

*Last updated: 2026-03-26*
