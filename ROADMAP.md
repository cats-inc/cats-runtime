# Roadmap

> Long-term project planning and milestones.
>
> This roadmap treats runtime-managed transcript compaction, recurring wakeup
> scheduling plus runtime-wide wakeup diagnostics aggregates, and runtime skill
> execution delivery as shipped baseline slices.

## Optimizations

### OPT-1: WSL Discovery Policy and Visibility

**Priority**: P1
**Status**: In Progress

#### Problem

`CursorNativeSessionService` and `KiroNativeSessionService` scan CLI sessions inside WSL by spawning `wsl -d Ubuntu bash -lc "python3 -c 'import base64; exec(...)'"`. This triggers the entire WSL VM to start (if stopped), which in turn causes systemd to auto-start all enabled services (e.g. `openclaw-gateway`), consuming 1GB+ RAM. On low-memory machines (8GB), this makes it difficult to run other VM-based features (e.g. Claude Desktop Cowork) concurrently.

#### Current Flow

1. `cats-runtime` polls for Cursor/Kiro sessions
2. For WSL sessions, it spawns `wsl -d Ubuntu bash -lc "python3 ..."` (see `src/backends/cli/runtime/runtime.ts:170-176`)
3. Python script reads SQLite databases inside WSL to extract session data
4. WSL Ubuntu starts up, systemd boots all enabled services, RAM usage spikes

#### Phase 1 Direction

Introduce an explicit WSL discovery policy for Windows/WSL-backed providers, and
surface its current behavior in the dashboard.

- Add `CATS_RUNTIME_WSL_DISCOVERY_POLICY` to control whether background
  Cursor/Kiro discovery may start WSL
- Start with three policies:
  - `always`: preserve the current behavior
  - `if_running`: scan only when the configured distro is already running
  - `manual_only`: never start WSL from background discovery
- Record discovery state so the UI can show whether scans are active, skipped,
  disabled, or failing
- Expose discovery status through a dedicated runtime endpoint for dashboard use
- Add a global dashboard indicator that shows both the configured policy and the
  current WSL discovery state

Current implementation status:

- Implemented `CATS_RUNTIME_WSL_DISCOVERY_POLICY`
- Implemented `GET /discovery/status`
- Implemented dashboard header visibility for WSL discovery state
- Deferred manual discovery overrides such as `startIfNeeded`

#### Deferred Optimization

Direct Windows-side SQLite reads via `\\wsl$\Ubuntu\...` (or
`\\wsl.localhost\Ubuntu\...`) remain an optional follow-up optimization, not the
first response.

This path should only be revisited if policy-based skipping is insufficient and
there is still a measurable need to reduce scan latency or remove the embedded
Python readers.

#### Rationale

- The primary pain is unintended WSL activation during background polling, not
  Python itself
- `\\wsl$\` is not a complete fix because it can still activate WSL when the
  distro is stopped
- A policy-first design is lower-risk than introducing new native SQLite
  dependencies and cross-platform filesystem edge cases

#### Affected Files

- `src/backends/cli/config.ts`
- `src/server.ts`
- `src/http/app.ts`
- `src/http/routes/health.ts` or a new discovery status route
- `public/index.html`
- `src/backends/cli/runtime/runtime.ts`
- `src/backends/cli/cursor/CursorNativeSessionService.ts`
- `src/backends/cli/kiro/KiroNativeSessionService.ts`
- `docs/specs/SPEC-001-wsl-discovery-policy.md`
- `docs/plans/PLAN-001-wsl-discovery-policy.md`

---

### OPT-2: Provider-Agnostic Progress Events

**Priority**: P2
**Status**: Completed

#### Problem

`crew-chat-poc` currently receives live progress updates only from Junie. The
current bridge works by mapping Junie session events into `raw` runtime events
with Junie-specific metadata, which is enough for immediate UX recovery but not
the right long-term contract for the runtime.

Other CLI backends may also expose useful mid-turn state such as:

- reasoning / planning status
- active tool execution
- command execution progress
- file editing milestones
- long-running task checkpoints

Without a provider-agnostic progress event, each upper-layer product must learn
provider-specific `raw` payloads or continue showing a generic "thinking"
spinner even when structured progress is available.

#### Direction

Introduce a first-class runtime progress event that providers can emit without
leaking backend-specific wire formats to consumers.

- Add a dedicated streamed event type for progress/status updates
- Define a minimal shared schema:
  - short human-readable message
  - stable progress kind/category
  - optional provider-native metadata
  - optional provider session id
- Keep provider-specific parsing inside `src/backends/cli/*`
- Normalize Junie onto the new event type first, then extend the same contract
  to other providers that can surface meaningful progress
- Update upper-layer consumers such as `crew-chat-poc` to react to the generic
  progress event instead of Junie-only metadata checks

#### Current Implementation Status

- Landed a shared runtime `progress` event helper in `src/core/progress.ts`
- Normalized Junie onto `type: "progress"` instead of runtime `raw` passthrough
- Extended the same contract to Pi, Goose, Copilot, Codex, Cursor, Claude, and Gemini CLI integrations;
  Codex now emits additive plan/reasoning/command/files/session/model-state
  checkpoints instead of silently dropping those JSON-RPC notifications; Copilot
  now preserves multiple tool requests plus structured tool completion, Cursor
  now promotes provider `thinking` plus assistant tool/reasoning blocks onto the
  same shared runtime contract, Claude now lifts tool-use, tool-result, and
  reasoning blocks into shared progress plus normalized tool events, Gemini now
  preserves multipart assistant tool blocks instead of flattening them into
  plain text, and Junie can promote structured session-poll tool lifecycle hints
  into `tool_use` / `tool_result` when upstream exposes them
- Kept provider-native details additive under `metadata.native`
- Reused the same event contract for API/local cache and warm-state hints
- Added additive metering/guardrail metadata so progress and execution
  guardrails can share one runtime-owned contract surface without moving
  product budget policy into the runtime

#### Deferred Follow-up

- If Team 5 needs live tool progress over the MCP facade, add a dedicated
  notification/streaming slice on top of the current MCP tool plane instead of
  forcing orchestrators to wait for buffered `send_message` results.
- Keep that follow-up additive:
  - preserve the current request/response `tools/call` contract
  - stream provider-agnostic runtime `progress` events rather than
    provider-native payloads
  - reuse the existing runtime `progress` schema from `src/core/progress.ts`
    and `src/core/types.ts`
  - avoid turning MCP into a separate execution stack from the direct
    session/message runtime APIs

#### Initial Candidate Providers

- `junie`
- `pi`
- `goose`
- `copilot`
- `codex`
- `cursor`
- `claude`
- `gemini`

#### Affected Files

- `src/core/types.ts`
- `src/backends/cli/providers/types.ts`
- `src/backends/cli/junie/*`
- `src/backends/cli/pi/*`
- `src/backends/cli/goose/*`
- `src/backends/cli/providers/copilot.ts`
- `src/core/progress.ts`
- downstream consumers such as `crew-chat-poc`

---

### OPT-3: Runtime-Owned Browser Driver Hardening and Recovery

**Priority**: P1
**Status**: In Progress

#### Problem

`cats-runtime` now has the first browser/preview substrate slice:

- runtime-owned browser sessions and pages
- a pluggable browser driver seam
- normalized `browser_page` preview surfaces
- a `manual` driver that validates the contract without launching a real
  browser

That is enough to freeze the substrate, but not enough for production-grade
browser-backed preview and test workflows. The current gaps are:

- only one real opt-in Playwright driver exists so far; richer CDP/browser-service
  drivers and broader retained-session policy remain absent
- reset/delete cleanup and explicit closed-session pruning exist, and
  background closed-session expiry now runs under runtime maintenance, but
  there is still no richer retained-session GC policy
- browser state already contributes additive session/history/observe inspection
  previews, and the runtime now exposes an explicit aggregate summary plus
  restart-safe persisted state, but richer driver-level recovery and retained
  browser-session policy are still absent

Without a second slice, the browser subsystem remains structurally correct but
operationally shallow.

#### Direction

Deepen the runtime-owned browser subsystem without coupling it to any monorepo
  sibling browser project or turning it into a full BrowserOS product.

- Add at least one real driver behind the existing `RuntimeBrowserDriver`
  interface
  - likely candidates: Playwright/CDP or a replaceable external browser service
  - keep the public route and preview-surface contract stable
- Add browser-session persistence and restart-safe recovery where it materially
  improves long-lived preview workflows
- Add runtime-owned cleanup discipline for stale/closed browser sessions and
  pages
- Broaden the already-landed inspection hooks into any additional host-facing
  aggregate/read-model surfaces that should expose browser-backed preview state
- Keep browser capabilities machine-readable so hosts can distinguish:
  - manual registration only
  - preview-only driver
  - richer automated browser control

#### Current Implementation Status

- The manual-driver browser substrate and normalized `browser_page` preview
  surfaces are landed
- An opt-in Playwright-backed driver now exists behind the same
  `RuntimeBrowserDriver` contract, configured entirely through runtime env vars
- Browser session/page state now persists under the runtime data dir and can be
  reloaded on restart for the current runtime-owned browser contract
- Drivers now advertise whether their sessions are restart-persistent, and the
  runtime automatically downgrades restored sessions from non-persistent drivers
  such as Playwright to `closed` after restart instead of pretending the remote
  browser process survived
- Browser sessions already surface through session, history, and observe
  inspection payloads, and reset/delete cleanup clears browser sessions bound
  to the affected runtime session
- `GET /browser/summary`, `POST /browser/sessions/cleanup`, matching MCP
  tools, and runtime background maintenance now provide a host-facing
  aggregate read/maintenance seam for closed browser-session cleanup; explicit
  cleanup now also supports idle retained `ready` sessions once their known
  page set is fully closed
- Richer retained-session/browser recovery policy plus additional real drivers
  beyond Playwright remain deferred

#### Why This Is Required

- A manual-only driver is not sufficient for deploy-preview-test workflows.
- Persisted browser state is required so long-running preview sessions do not
  disappear on routine runtime restarts.
- Browser pages need the same lifecycle discipline already applied to sessions,
  wakeups, and delivery surfaces.
- Future Cats Code preview canvases need a more complete runtime substrate
  before UI work can safely depend on it.

#### Affected Areas

- `src/core/browser/*`
- `src/backends/browser/*`
- `src/http/routes/browser.ts`
- `src/http/app.ts`
- additive session inspection/read-model surfaces where browser summary is
  eventually exposed
- `docs/api.md`
- `docs/architecture.md`
- `docs/decisions/011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md`

---

### OPT-4: Worktree Cleanup Discipline and Recovery

**Priority**: P1
**Status**: In Progress

#### Problem

`cats-runtime` now supports `workspaceIsolation: "worktree"` across session
create/resume/reset/delete/fork, but the current cleanup discipline still
depends on explicit lifecycle actions only.

Current gaps:

- abandoned worktrees are now swept in the background if a host crashes or a
  session is never explicitly reset/deleted, and TTL-expired preserved
  worktrees can now be auto-cleaned, but the GC policy is still conservative
  and does not yet cover every retained-worktree shape
- retained worktree sessions now surface TTL-style expiry diagnostics plus
  background auto-clean results, but preserved/orphaned worktrees still need a
  broader retained-worktree GC policy
- `worktreeCleanupPolicy: "merge"` intentionally stops and returns
  `status: "retained"` when the source repo is already dirty, because runtime
  does not yet own conflict-resolution policy
- reset/delete can now hand operators retained cleanup metadata plus a bounded
  retry route, and retained resets/deletes now auto-complete once cleanup
  succeeds, but the background policy still only auto-cleans conservative
  preserved cases
- worktree prepare/merge/discard still runs inline with the HTTP lifecycle; the
  runtime no longer blocks the event loop with sync I/O, but it still lacks a
  queued/background execution envelope, backpressure, and concurrency guards
  for expensive git/worktree operations

#### Direction

Extend the first-slice worktree execution layer with stronger recovery and
cleanup discipline while keeping product approval/policy above runtime.

- Add a runtime-owned abandoned-worktree sweeper for sessions that no longer
  exist or have already reached terminal lifecycle states
- Extend that sweeper into a retained-worktree GC policy so intentionally
  preserved worktrees can be expired, surfaced, or cleaned up deterministically
  instead of accumulating forever
- Add more explicit retained-cleanup diagnostics so hosts can distinguish
  "source repo dirty", "detach failed", and "merge apply failed" without
  scraping generic error text
- Extend the bounded retained-cleanup recovery primitive with richer operator
  diagnostics and follow-through guidance instead of forcing hosts to infer
  next steps from generic lifecycle payloads
- Move expensive worktree lifecycle operations behind runtime-owned operation
  scheduling so session routes can hand off prepare/cleanup work without tying
  end-user latency directly to git execution time
- Keep merge behavior conservative: runtime may assist with safe re-apply, but
  product/host layers still own conflict policy and operator approval

#### Current Implementation Status

- Deterministic worktree prepare/recreate is landed
- `discard` and `merge` cleanup policies are landed for reset/delete
- retained cleanup metadata plus `POST /sessions/{id}/workspace/cleanup` are
  surfaced over session/session-lifecycle routes, the MCP tool plane, and
  session maintenance state
- retained worktree-backed `reset`/`delete` responses now also expose
  `retryCleanupPath` so hosts can jump straight to the bounded retry seam
- `inspection.maintenance.cleanup` now preserves that same retry path when a
  closed worktree session is actually ready for bounded cleanup retry
- orphaned worktrees are now swept in the background, and retained worktree
  sessions surface TTL-style expiry diagnostics plus background auto-clean
  results through runtime maintenance
- retained reset/delete cleanup now auto-settles the rest of the lifecycle
  once bounded cleanup succeeds, and the background sweeper auto-cleans
  expired preserved retained worktrees conservatively
- broader retained-worktree GC policy and queued/background worktree
  scheduling still remain deferred

#### Affected Files

- `src/core/workspace/*`
- `src/core/runtime/sessionMaintenance.ts`
- `src/backends/cli/pool/SessionRegistry.ts`
- `src/http/routes/sessions.ts`
- `docs/api.md`
- `docs/architecture.md`

---

### OPT-5: Workspace Sync and Lifecycle Flush Follow-through

**Priority**: P1
**Status**: In Progress

#### Problem

The current worktree/fork slice intentionally uses conservative copy semantics
for non-shared child workspaces and exposes additive `pre_reset`,
`pre_compaction`, and `pre_flush` hooks without implementing the follow-through
pipeline.

Current gaps:

- fork-time workspace copying is a one-shot snapshot, not a generalized sync or
  reconciliation protocol
- retained workspace/worktree cleanup can advertise `pre_flush`, and runtime
  now exposes an additive lifecycle-flush read model, but it still does not
  coordinate durable memory/export execution before cleanup proceeds
- runtime-managed transcripts now compact in place through
  `POST /sessions/{id}/compact`, but provider-owned/external sessions still
  rely on the coordination seam and runtime still does not execute the hook
  or external compaction worker itself
- Team 3's future memory pipeline seam exists in contracts only; runtime still
  lacks the hook execution/retry envelope around lifecycle flush boundaries
- non-shared fork copy still clones the whole workspace opportunistically in
  the request path; runtime now records snapshot counts/bytes, large-copy
  warnings, and additive one-shot snapshot planning metadata, but still does
  not have bounded snapshot execution, resumable sync, or progress reporting

#### Direction

Deepen the lifecycle seam so products can rely on workspace-backed sessions for
longer-running workflows without teaching runtime product-specific memory
schemas.

- Add a stronger runtime-owned workspace sync primitive for fork/reset flows
  where snapshot copy is no longer sufficient
- Extend the existing follow-through/gating seam around `pre_reset`,
  `pre_compaction`, and `pre_flush` into richer lifecycle-flush orchestration
  so products can plug in export pipelines without patching session routes
  directly
- Add bounded snapshot/sync orchestration for large workspaces so fork/reset
  flows can avoid unstructured full-tree copies when the workspace is too large
  or needs resumable/progressive sync behavior
- Keep hook payloads schema-light and additive so Team 3 can attach memory
  flush/retrieval later without baking `cats` product models into runtime

#### Current Implementation Status

- hydration now records authoritative source workspace vs runtime cwd
- non-shared child forks can copy a workspace snapshot once at fork time
- non-shared fork snapshot metadata now records copied file/byte counts plus
  additive `large_*` warning codes when the snapshot is large
- session maintenance now advertises additive `pre_flush` alongside the
  existing memory-flush hook groups
- runtime-managed transcripts now repair/archive older JSONL history and record
  `lastCompaction` metadata when the public compaction seam can execute safely
- the same compaction preparation/readiness contract now surfaces through MCP
  via `compact_session`, alongside the existing follow-through tools
- maintenance trigger payload snapshots are now truncated/redacted/size-capped
  before persistence, with additive status/warning metadata surfaced through
  session inspection
- maintenance hooks now have a persisted follow-through envelope over HTTP and
  MCP so hosts can acknowledge, retry, and report completion for
  `pre_reset`, `pre_compaction`, and `pre_flush` through
  `inspection.maintenance.lastFollowThrough`
- maintenance request/follow-through state now also keeps bounded action-scoped
  history so later lifecycle actions do not overwrite previously acknowledged
  reset/delete/cleanup/compaction hook outcomes
- reset/delete/workspace cleanup now support opt-in
  `requireAcknowledgedHooks` gating so destructive lifecycle routes can refuse
  to proceed while their action-scoped hooks are still pending
- generalized workspace sync, resumable large-workspace planning, and broader
  hook execution plumbing remain deferred

#### Affected Files

- `src/core/workspace/*`
- `src/core/hydration/*`
- `src/core/runtime/sessionMaintenance.ts`
- `src/http/routes/sessions.ts`
- future Team 3 lifecycle-hook integrations
- `docs/specs/SPEC-011-session-fork-and-context-transplant-primitives.md`

---
### OPT-6: Runtime Skill Catalog Cache and Discovery Hardening

**Priority**: P2
**Status**: In Progress

#### Problem

`cats-runtime` now has a family-aware runtime skill library, persisted
skill-state re-entry compatibility, and a per-root catalog cache. The final
small cache/discovery hardening gaps were:

- the current watch-key builder duplicates the same two-level discovery shape
  used by runtime skill entry discovery, so future nesting/layout changes would
  require touching both code paths
- the cache invalidation key uses truncated `mtimeMs`, which is acceptable for
  normal skill-package edits but can miss ultra-fast same-second rewrites on
  low-resolution filesystems

These are not correctness blockers for the current skill library rollout, but
they are worth cleaning up before the library grows further.

#### Direction

Harden runtime skill discovery/cache maintenance without changing the public
skill execution contract.

- Collapse watch-key generation and catalog discovery onto one shared
  enumeration path so future library layout changes do not duplicate traversal
  rules
- Keep this follow-up internal to `cats-runtime`; do not change the public
  requested/resolved/applied skill contract just to service cache maintenance

#### Current Implementation Status

- family-aware skill resolution is landed
- persisted-session re-entry is backward compatible with missing `slug`
- persisted session-state rebuild intentionally drops historical
  `version`/`fingerprint` pinning on re-entry
- per-root catalog cache with file-content invalidation heuristics is landed
- shared discovery/cache enumeration is now landed through one entry-source
  traversal path
- per-root cache invalidation now keys from entry content fingerprints instead
  of truncated mtimes

#### Affected Files

- `src/core/skills/catalog.ts`
- `src/core/skills/catalog.test.ts`
- `docs/specs/SPEC-005-runtime-managed-skills-v0.md`
- `docs/specs/SPEC-013-internal-skill-library-and-role-taxonomy.md`

---
### OPT-7: Internal Skill Library Publishing and Catalog Follow-through

**Priority**: P1
**Status**: In Progress

#### Problem

`cats-runtime` now has the first real internal skill-library slice:

- family-organized `skills/**/SKILL.md` packages
- runtime-owned `family` / `slug` / `role` / `packageKind` / capability metadata
- `resolvedSkills[].library` in session state
- `listRuntimeSkillCatalog()` as the runtime-internal consume seam
- `agency-agents/` as an authoring-only reference submodule

That freezes the content taxonomy, but the follow-through is still incomplete.

Current gaps:

- the standalone runtime-owned catalog read surface now exists at
  `GET /skills/catalog`, and it now supports lightweight metadata/tag filters,
  additive `sortBy` / `sortDirection`, and a versioned host-facing read
  contract with additive `offset` / `limit` pagination, but there is still no
  richer projection surface beyond that minimal seam
- the runtime catalog contract is stable enough for Team 6, and
  `npm run verify:skills` now provides a dedicated verification gate, but there
  is still no richer publish pipeline beyond running the existing catalog
  validator as a command
- `agency-agents/` is present only as reference material; there is no explicit
  authoring sync/review process for comparing external inspiration against the
  runtime-owned library without accidentally creating runtime coupling
- runtime-managed skills still resolve only explicit leaf ids; bundle
  composition and richer library grouping remain outside the contract even
  though the first taxonomy is now broad enough to need them
- recursive skill-library discovery still assumes a checked-in, well-formed
  tree; there is no explicit cycle/depth hardening yet if the catalog root ever
  grows beyond today's repo-owned `skills/` layout

#### Direction

Deepen the runtime-owned library surface without collapsing it into the
execution/materialization engine.

- Keep the standalone runtime-owned versioned filterable catalog read surface
  minimal and stable so upper layers can consume the library without importing
  `src/core/skills/catalog.ts`
- Keep the new `npm run verify:skills` gate aligned with shipped runtime-owned
  skill packages, then grow it into a stricter publish/lint workflow as needed
- Add an explicit authoring workflow for `agency-agents/` reference usage
  that keeps the boundary clear:
  - reference-only comparison
  - no runtime import path
  - no automatic shadow sync into `skills/`
- Add bundle/composition metadata once Team 6 is ready to consume grouped role
  packages without pushing product-specific profile logic into runtime
- Harden recursive catalog discovery before treating the library root as
  anything broader than versioned runtime-owned content
- Keep requested skill ids stable while improving library discovery,
  observability, and publish discipline

#### Current Implementation Status

- `GET /skills/catalog` now exposes a standalone runtime-owned catalog route
  backed by `listRuntimeSkillCatalog()`, with lightweight filtering across
  stable library metadata, tags, and delivery hints plus `contract.version: 1`,
  machine-readable `query.filters` echoing, explicit additive
  `sortBy` / `sortDirection`, and additive `offset` / `limit` pagination
  metadata
- the same runtime-owned catalog read seam is now also reachable from the
  curated MCP tool plane via `list_runtime_skills`
- `src/http/routes/skills.ts` and `src/http/app.ts` now publish that read seam
  without forcing hosts to import internal runtime modules directly
- runtime-managed instruction delivery now reaches prompt-driven CLI providers
  plus Pi/API/agent execution paths instead of stopping at catalog resolution
- `npm run verify:skills` now provides a dedicated runtime-owned verification
  command for shipped skill packages
- richer publish/lint discipline, reference-authoring workflow,
  bundle/composition metadata, and recursive discovery hardening remain
  deferred

#### Why This Is Required

- Team 6 should not be forced to depend forever on internal module imports for
  skill-library reads.
- The richer library metadata is now part of the runtime contract and needs
  stronger verification than the original minimal v0 validator.
- A reference submodule without a documented authoring workflow will drift into
  either neglect or accidental dependency.
- The current taxonomy is broad enough that bundle/composition follow-through
  will eventually be required for practical skill selection.

#### Affected Areas

- `src/core/skills/*`
- `src/bin/verifySkills.ts`
- `src/http/routes/skills.ts`
- `src/http/app.ts`
- `package.json`
- `skills/*`
- `skills/README.md`
- `.gitmodules`
- `agency-agents/`
- `docs/api.md`
- `docs/architecture.md`
- `docs/AGENT-GUIDE.md`
- `docs/testing.md`
- `docs/specs/SPEC-013-internal-skill-library-and-role-taxonomy.md`
- `docs/specs/SPEC-005-runtime-managed-skills-v0.md`
- `docs/decisions/018-separate-skill-library-content-from-runtime-execution-engine.md`

---

### OPT-8: Advanced Provider Model Catalog Migration Cleanup

**Priority**: P1
**Status**: Planned

#### Problem

`PLAN-018` Phase 1-6 intentionally shipped the advanced provider-model catalog,
structured session selection, and runtime-owned resolution pipeline as an
additive migration slice.

That rollout is deliberately compatibility-first because `cats-runtime` must
upgrade before `cats` product follow-up lands. As a result, several contract
tightening and cleanup steps are intentionally deferred.

#### Current Implementation Status

- `GET /providers/:provider/models` remains the stable v1 compatibility surface
- `GET /providers/:provider/models/advanced` exists as the additive advanced
  catalog surface
- session create/read contracts now support additive `modelSelection` and
  `modelResolution`
- top-level session `model` remains available as the resolved compatibility
  snapshot
- legacy session create payloads that only send `model` remain accepted
- backend support is staged honestly rather than pretending universal advanced
  control parity

#### Deferred Cleanup Scope

Blocked on coordinated `cats` changes:

- do not remove or redefine top-level session `model` yet
- do not remove or downgrade v1 `GET /providers/:provider/models` yet
- do not make structured selection the mandatory write contract yet
- do not add a public per-message structured override contract yet
- do not perform the `cats`-coordinated cleanup/tightening phase yet
- do not fake universal advanced-controls parity across all backends

#### Direction

Once `cats` follow-up work is shipped and dual-read/dual-write migration is no
longer needed, revisit the public contract in a coordinated cleanup slice.

- review whether top-level session `model` can become explicitly
  compatibility-only or later be removed in a breaking phase
- review whether v1 `GET /providers/:provider/models` should remain as a long
  tail fallback or be formally deprecated
- tighten write contracts only after `cats` reliably sends structured
  selection
- evaluate whether request-scoped public advanced overrides should be added
  after product/API consumers are ready
- keep backend support truthful; expand support only where runtime can map
  controls honestly

#### Affected Areas

- `src/core/models/*`
- `src/core/types.ts`
- `src/http/routes/providers.ts`
- `src/http/routes/sessions.ts`
- relevant backend execution adapters under `src/backends/*`
- `docs/plans/PLAN-018-advanced-provider-model-catalog-and-selection-schema.md`
- coordinated `cats` product follow-up work

---

### OPT-9: LAN Peer Execution Routing Follow-through

**Priority**: P1
**Status**: Completed

#### Problem

`cats-runtime` needed to finish PLAN-017 after the safe parallel discovery
slice landed, while preserving ADR-019's execution-only boundary and existing
`cats` compatibility.

- The first delivery had only Phase 1-3: discovery, registry, and diagnostics.
- The remaining work needed a dedicated peer execution contract, trust/auth
  separation, and caller-owned relay behavior instead of peer-owned sessions.

#### Direction

Ship the rest of PLAN-017 only through additive, compatibility-preserving
changes that keep ADR-019's execution-only boundary intact.

- Add a dedicated peer execution contract instead of tunneling ownership
  through peer `/sessions` routes
- Keep caller runtime ownership of host-visible sessions, observe state, and
  lifecycle
- Treat trust/auth as a separate workstream from discovery
- Preserve existing `cats` compatibility until product-side follow-up is ready

#### Landed

- bounded peer identity, capability, load, and trust-summary models
- default-off peer registry and discovery-controller substrate
- additive LAN visibility on `GET /discovery/status`
- read-only peer surfaces:
  - `GET /peers`
  - `GET /peers/:peerId`
  - `GET /diagnostics/peers`
- additive peer guardrail read models:
  - `GET /peers` returns lightweight auth-throttle/inbound-capacity summaries
  - `GET /peers/:peerId` returns per-peer inbound execution status plus replay counters
  - `GET /diagnostics/peers` returns bounded auth-throttle, inbound-capacity, and replay details
- additive peer summaries on runtime/health diagnostics
- `POST /peer/executions` as the dedicated peer-only execution seam
- additive `routing` support on `POST /sessions/:id/messages`
- caller-owned peer-routed observe and stream relay semantics
- trust-gated runtime-to-runtime auth for peer-only execution routes
- two-runtime integration coverage for peer routing and failure paths

#### Still Blocked For Later Work

These items remain intentionally out of scope even after PLAN-017 v0:

- full remote session ownership
- remote workspace mutation or sync semantics
- remote browser ownership
- wakeup ownership transfer
- transparent failover / hidden ownership transfer

#### Coordinated Product Follow-up Still Blocked

PLAN-017 v0 itself is complete. The remaining items below are not unfinished
Phase 4-6 work; they are separate later follow-up that stays blocked on
coordinated `cats` changes or a new design slice:

- default automatic peer routing for legacy clients
- session-level peer routing defaults on `POST /sessions`
- any breaking stream-envelope or wire-format change that removes or renames
  current SSE / NDJSON shapes
- any contract change that stops existing `cats` request bodies from remaining
  valid during migration
- stronger peer auth such as per-peer credentials or replay protection
- stricter network posture assumptions such as required TLS for non-trusted LAN
  deployments

#### Security Hardening Follow-up

`POST /peer/executions` now has shared-secret bearer auth plus request-body
HMAC signing. The next hardening slice also landed bounded auth failure
rate-limiting per caller key and bounded inbound execution admission control so
one caller cannot occupy unlimited peer capacity. The next slice also landed
bounded nonce/timestamp replay resistance for peer execution requests. The
following work is still intentionally deferred:

- additive per-peer quota overrides for auth-failure throttling, inbound
  execution concurrency, and replay nonce ceilings are now available for
  trusted peer ids via `CATS_RUNTIME_PEER_LIMIT_OVERRIDES`
- read-only peer routes and runtime diagnostics now classify local/remote peer
  endpoints as TLS, trusted-LAN plaintext, externally exposed plaintext, or
  unresolved so operators can confirm network posture before wider rollout
- optional enforcement of a TLS-fronted posture for any deployment outside a
  tightly trusted LAN remains deferred

#### Runtime Dashboard / Operator Follow-up

The runtime-owned dashboard should add clearer peer operator visibility on top
of the shipped peer diagnostics/read surfaces:

- show current connected / discoverable peers directly in the dashboard without
  requiring manual `/peers` or `/diagnostics/peers` inspection
- show inbound peer activity such as "peer connected" / "被連入" style status
  or recent inbound peer execution visibility
- keep this additive and diagnostics-oriented only; do not imply remote session
  ownership transfer or hidden peer failover

#### Constraints

- Keep `cats` working unchanged against upgraded `cats-runtime`
- Keep changes additive for existing host-facing contracts
- Preserve current `/health`, `/sessions`, `/sessions/:id/messages`,
  `/sessions/:id/observe`, and `/sessions/:id/stream` behavior during rollout
- Keep discovery, registry, routing, and trust separable in implementation

#### References

- `docs/plans/PLAN-017-lan-peer-discovery-and-execution-routing-v0.md`
- `docs/specs/SPEC-016-lan-peer-discovery-and-execution-routing-v0.md`
- `docs/decisions/019-scope-first-lan-peer-sharing-to-execution-only.md`

---
### OPT-10: Runtime Strategy Family Expansion Follow-through

**Priority**: P1
**Status**: In Progress

#### Problem

`PLAN-020` landed the first runtime-owned execution-strategy substrate slice:

- additive request fields for `requestedStrategy`, `acceptanceCriteria`,
  `strategyContext`, and `correlation`
- additive session/observe metadata for `effectiveStrategy` and strategy-local
  state
- a compatibility-owned `simple_tool_call` fallback path
- the first real runtime-hosted loop via `react`

The next follow-through slices are now partially landed. The runtime now owns a
bounded `plan_execute` loop with runtime-local plan/execute/evaluate phase
events, plus a real `pdca` loop with runtime-local plan/do/check/act phase
events, a bounded `reflexion` loop with runtime-owned critique/revision passes,
reflection-local state, and additive reflection events persisted onto the
runtime session, and a bounded `tree_of_thoughts` loop with runtime-owned
branch sampling, pruning, selection, and strategy-local branch state. Later
families remain deferred.

That substrate is still intentionally incomplete. `cats` can now bridge
product-owned defaults such as Chat -> `react`, Work -> `pdca`, and Code ->
`reflexion`, and the runtime now owns `simple_tool_call`, `react`,
`plan_execute`, `pdca`, `reflexion`, and `tree_of_thoughts`.

Unsupported strategy requests must still remain honest: preserve additive
request metadata, resolve through the registry, and degrade to
`simple_tool_call` rather than pretending later-family semantics such as `deps`
already exist.

#### Current Implementation Status

- runtime-owned strategy registry and resolution order are landed
- no-hint callers remain compatible through `simple_tool_call`
- explicit `react` requests execute through the new bounded runtime-owned loop
- explicit `plan_execute` requests now execute through a bounded runtime-owned
  plan/execute/evaluate loop with additive phase events and strategy-local
  plan-progress state
- explicit `pdca` requests now execute through a real runtime-owned phase loop
  with additive plan/do/check/act events and strategy-local state
- explicit `reflexion` requests now execute through a bounded runtime-owned
  critique/revision loop with additive reflection events and strategy-local
  state
- explicit `tree_of_thoughts` requests now execute through a bounded
  runtime-owned branch/evaluate/prune/select loop with additive branch events
  and strategy-local branch state
- unsupported hints such as `deps` remain visible in request metadata but
  compatibility-fallback to `simple_tool_call`
- runtime session state owns strategy-local summaries; product task records stay
  outside the runtime boundary
- `GET /diagnostics/runtime`, `GET /diagnostics/health`, and
  `GET /providers/config` now expose a runtime-owned strategy catalog/summary
  so hosts can inspect which strategy families are actually implemented versus
  compatibility-fallback only
- those diagnostics now also expose additive per-family `requestSupport` and
  machine-readable `contextSchema` metadata so hosts can see which
  `acceptanceCriteria` / `strategyContext` inputs the runtime actually uses
  and what bounded numeric keys/default sources each family understands

#### Follow-through Direction

- add the next real runtime-owned strategy families behind the existing
  registry and execution seam
- prioritize strategies that upper-layer products already point at through
  product-owned defaults, continuing with other deferred families after the
  landed `plan_execute` and `tree_of_thoughts` slices
- keep the rollout additive for existing session/message callers and stream or
  observe consumers
- keep no-hint compatibility behavior intact while new families land
- continue rejecting any design that would make `cats-runtime` import
  `CoreTaskRecord` or own product task graph, approval, or cross-product
  routing semantics

#### Deferred Scope

- do not fake later families such as `deps` by smuggling product task-planning
  logic into prompt overlays
- do not move product defaults into runtime-owned policy; `cats` remains
  responsible for default selection
- do not widen the follow-through into a full strategy-family explosion such as
  `deps` and every other family all at once
- do not replace compatibility fallback until supported families are truly
  runtime-hosted

#### Affected Areas

- `src/core/runtime/strategies/*`
- `src/backends/api/runtime/strategies/*`
- `src/http/routes/sessions.ts`
- `src/http/routes/messages.ts`
- additive stream and observe surfaces that already expose strategy metadata
- `docs/plans/PLAN-020-pluggable-execution-strategy-substrate.md`
- coordinated `cats` bridge follow-up for product-owned defaults

#### References

- `docs/decisions/024-own-pluggable-execution-strategies-as-runtime-session-local-substrate.md`
- `docs/specs/SPEC-020-pluggable-execution-strategy-substrate.md`
- `docs/plans/PLAN-020-pluggable-execution-strategy-substrate.md`

---
### OPT-11: Bootstrap Scan Latency and Setup Read Responsiveness

**Priority**: P2
**Status**: In Progress

#### Problem

Standalone bootstrap now works without a pre-seeded `providers.yaml`, but the
provider scan path was still doing provider compatibility probes strictly
serially.

That makes first-run setup and later manual repair scans slower than necessary,
especially when multiple providers are present and each probe has its own
runtime/setup checks.

The runtime should improve this operator-facing latency without changing the
shape of setup-state or scan artifacts and without turning bootstrap into a
different orchestration subsystem from the shared compatibility surface.

#### Current Implementation Status

- bootstrap mode, setup-state persistence, latest-scan/manual-scan snapshots,
  and generated `providers.yaml` are landed
- `BootstrapService.scan()` now probes providers with bounded concurrency while
  preserving stable provider ordering in persisted/read-model scan results
- direct service tests now cover out-of-order completion plus concurrency caps
- bootstrap integration coverage keeps the existing `/setup-state` and
  `/setup-scan` contract intact while avoiding unnecessary slow-path probes in
  the verification suite

#### Follow-through Direction

- keep bootstrap scan results deterministic and additive for existing setup
  read surfaces
- continue improving setup/operator responsiveness through shared runtime-owned
  bootstrap services rather than page-local logic
- land the remaining shared UI/manual repair follow-through from `PLAN-019`
  separately from this scan-orchestration slice

#### Deferred Scope

- do not change the persisted `provider-scan.json` / `provider-manual-scan.json`
  shape in this optimization slice
- do not move compatibility semantics out of the shared provider
  compatibility service
- do not couple scan orchestration to `cats` product setup or wizard behavior

#### Affected Areas

- `src/core/bootstrap/*`
- `tests/bootstrap.test.ts`
- `docs/specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md`
- `docs/plans/PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md`

#### References

- `docs/specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md`
- `docs/decisions/021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it.md`
- `docs/plans/PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md`

---
### OPT-12: Setup Diagnostic Report Follow-through

**Priority**: P2
**Status**: In Progress

#### Problem

`cats-runtime` now has lightweight setup/bootstrap services and provider
diagnostics, but operators still needed to stitch together setup-state,
provider scans, config inspection, and path facts manually when preparing a
shareable setup/debug snapshot.

That gap is especially visible during bootstrap/repair work, where the runtime
needs one bounded operator-facing artifact that is distinct from compatibility
evidence bundles and does not force hosts to invent their own report format.

#### Current Implementation Status

- shared `SetupDiagnosticService` now writes redacted JSON reports under
  `<dataDir>/diagnostics/`
- `POST /diagnostics/setup-report` generates a fresh operator-facing report and
  can optionally refresh the shared setup scan first
- `GET /diagnostics/setup-report` now lists retained reports newest-first and
  `GET /diagnostics/setup-report/:artifactId` re-reads a specific retained
  artifact by id
- `GET /diagnostics/setup-report/latest` returns the latest persisted report
- setup reports now include additive operator-facing `summary.headline` and
  bounded `summary.highlights` fields so HTTP and CLI consumers can surface a
  concise status without re-deriving it client-side
- `cats-runtime --diagnose-setup` now generates the same report without starting
  the normal HTTP server, so port conflicts or other startup failures still
  leave a redacted operator-facing artifact; the entry path now also prints a
  concise stderr summary while preserving stdout JSON for automation
- `GET /setup-state` now exposes a shared repair read model with preferred-scan,
  next-action, actionable repair actions, ready-to-apply provider lists,
  remediation previews, and latest-setup-report summary metadata including a
  concise headline plus bounded highlights instead of forcing later
  dashboard/setup follow-through to
  reconstruct that state
  client-side
- reports now aggregate runtime path facts, config inspection, discovery
  posture, bootstrap setup snapshots, configured target counts, git presence,
  and compatibility-evidence directory references without copying raw evidence
- first-slice retention keeps only a bounded number of recent report artifacts

#### Follow-through Direction

- decide whether later host/CLI entry points should also emit a concise
  human-readable summary alongside the JSON artifact
- extend the report only through shared bootstrap/setup services rather than
  creating a second standalone setup detection stack
- keep broad repair flows additive and runtime-owned rather than scattering
  setup heuristics across dashboard/setup page scripts

#### Deferred Scope

- do not collapse setup reports and compatibility evidence into one artifact
- do not claim artifact signing or attestation in the first slice
- do not force a CLI/non-server entry path into the same change that lands the
  shared service and HTTP route

#### Affected Areas

- `src/core/diagnostics/*`
- `src/http/routes/setupDiagnostics.ts`
- `docs/specs/SPEC-015-runtime-setup-diagnostic-report.md`
- `docs/decisions/020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence.md`

#### References

- `docs/specs/SPEC-015-runtime-setup-diagnostic-report.md`
- `docs/decisions/020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence.md`
- `docs/specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md`

---
### OPT-13: Provider Evolution Evidence and Capability Probe Follow-through

**Priority**: P1
**Status**: In Progress

#### Problem

`cats-runtime` can already fingerprint install/auth/version/model-catalog
readiness, but it still needs a runtime-owned way to inspect upstream provider
event drift before adapters break silently.

`PLAN-021` exists to close that gap without turning the runtime into an
always-on self-adapting parser system.

#### Current Implementation Status

- the first eight `PLAN-021` slices are landed
- `src/core/compatibility/providerEvolution.ts` now owns a transport-neutral
  evidence collector and bundle shape
- high-value CLI adapters now have optional instrumentation for:
  - `normalized`
  - `ignored`
  - `unknown`
  - `schema_failure`
  - `raw_passthrough`
- the first rollout covers:
  - `codex`
  - `copilot`
  - `pi`
  - `goose`
  - `gemini`
  - `claude`
- `cats-runtime --probe-provider-evolution --probe-provider <provider>` now
  runs a bounded manual-first probe without starting the HTTP server
- probe artifacts now include:
  - the collected evidence bundle
  - a derived capability snapshot
  - baseline compare output against the latest matching prior artifact
  - persisted review classifications, summary text, and bounded highlights
- the runtime now has internal latest/list/read-by-id probe-artifact summaries
  for manual/operator follow-through
- the CLI/manual-first flow can now also:
  - list retained provider-evolution artifacts newest-first
  - re-read a retained artifact by id without starting the HTTP server
  - filter retained artifacts by parser id and transport for narrower
    operator review
- the shared manual probe flow now also supports the first agent-backed targets
  via `--probe-instance agent/<instance>`
- Agent SDK bridge probes now preserve normalized `tool_result` output while
  recording dropped/unknown/schema-failure/raw-passthrough bridge frames for
  evidence review
- OpenClaw gateway probes now record ignored gateway lifecycle frames,
  malformed websocket payloads, schema-failure event shapes, and unknown
  gateway streams through the same evidence collector without changing the
  runtime-visible `text` / `raw` / `result` contract
- `GET /diagnostics/providers` now exposes additive
  `providerEvolution.latestArtifact` summaries, reusing the retained artifact
  read model to surface capability snapshot, compare counts, review
  classification, and relative artifact path for each matching provider target
- `/providers/config` instance entries now reuse the same retained artifact
  read model, so host/provider-selection flows can fetch provider topology and
  latest provider-evolution summary in one call
- normal runtime execution remains unchanged when evidence collection is not
  enabled

#### Follow-through Direction

- extend the manual probe flow beyond the first CLI-heavy providers when the
  collector shape proves stable, including broader agent/A2A adapter coverage
- keep provider-specific parsing inside adapters while reusing the shared
  collector across future agent/A2A transports
- refine semantic-drift heuristics and attach external release-note context
  separately from runtime evidence when later follow-through needs it

#### Deferred Scope

- do not add always-on background probing on user machines
- do not auto-modify parsers based on collected evidence
- do not force CLI-only assumptions into the shared collector
- do not add a dedicated host-facing probe route or dashboard workflow until
  the manual-first CLI/internal flow proves stable

#### Affected Areas

- `src/core/compatibility/*`
- `src/backends/cli/providers/*`
- `src/backends/cli/goose/parser.ts`
- `src/backends/cli/pi/parser.ts`
- `src/backends/agent/*`

#### References

- `docs/specs/SPEC-021-provider-evolution-evidence-and-capability-probes.md`
- `docs/plans/PLAN-021-provider-evolution-evidence-and-capability-probes.md`
- `docs/decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md`
- `docs/decisions/026-model-a2a-as-an-agent-backend-adapter.md`

---
*Last updated: 2026-03-27*
