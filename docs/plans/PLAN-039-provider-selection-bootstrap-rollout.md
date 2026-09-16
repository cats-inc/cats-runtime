# PLAN-039: Provider Selection Bootstrap Rollout

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In progress; implementation authorized 2026-09-16 |
| **Owner** | User |
| **Implementation ownership** | cats-runtime core contract; cats-platform host integration |
| **Assigned to** | Unassigned |
| **Reviewer** | User |
| **Last updated** | 2026-09-16 |

## Related Design

- [SPEC-030](../specs/SPEC-030-provider-selection-before-bootstrap-probes.md)
  defines behavior and acceptance cases.
- [ADR-039](../decisions/039-use-selected-provider-config-as-the-resource-boundary.md)
  accepts selection as the resource boundary and amends part of ADR-021.

The user approved the design and proposed defaults on 2026-09-16. The checklist
records delivery progress and outstanding validation. This is the shared delivery track for
Runtime, Platform, and Desktop; avoid a second plan with competing contracts.

## Overview and Sequence

Establish the runtime-owned selection contract, enforce it across provider work,
then connect the three setup surfaces. Verify resource scope in isolated roots
and ship matched Runtime/Platform contracts. WSL/Docker UX redesign is outside
this first delivery; existing configured variants must still obey scope.

| Phase | Owner | Depends on | Exit condition |
|-------|-------|------------|----------------|
| 0. Resolve contract choices | Runtime + Platform | Design discussion | Shared lifecycle and API contract recorded |
| 1. Selection and config activation | Runtime | 0 | Selection can be saved without probing |
| 2. Provider work boundary | Runtime | 1 | No provider work outside active targets |
| 3. Standalone setup | Runtime | 1, 2 | Selection-first standalone flow works |
| 4. Platform integration | Platform | 1, 2 | Connected runtime controls setup and selectors |
| 5. Desktop integration | Platform/Desktop | 4 | Host inventory and helpers obey selection |
| 6. Integrated acceptance | Both repositories | 3, 4, 5 | Three personas and native OS matrix verified |

Phases 3 and 4 may be implemented independently after the shared contract is
stable. Intermediate changes are not a completed rollout.

## Implemented API Contract

The following contract is implemented in both repositories. Setup authentication
and first-run accessibility follow existing policy.

| Surface | Responsibility |
|---------|-------------------------|
| `GET /setup-state` | Return static catalog, config state, effective selected targets, revision, and scoped observations/progress; polling performs no probes |
| `PUT /setup-selection` | Validate and save desired targets with `expectedRevision`; preserve retained config; return activated selection/revision without waiting for detection |
| `POST /setup-scan` | Start a bounded asynchronous scan of the selection or an explicit subset; return `202`; results and progress are associated with a revision |
| `GET /providers/config` | Project configured execution targets with the same revision for normal consumers; no separate selection authority |
| `POST /setup-selection/reload` | Validate hand edits and activate through the same revision/admission boundary |
| `POST /setup-operations`, `DELETE /setup-operations/:id` | Hold exact target admission during host helpers; UUID receipts support retry/release |

Selection entries identify `(provider, backend, instance)`. Retained entries may
refer to existing config; new entries supply any required validated configuration
or use runtime-owned templates. A simple editor must preserve targets it cannot
edit. Catalog/config responses follow existing secret-redaction rules.

Use an opaque revision that changes with the accepted configuration, not just
target names or a coarse file timestamp. Missing config has a distinct revision
token. Recheck disk changes before replacing a file so a stale editor cannot
overwrite hand edits. The precise encoding is an implementation choice.

Reject stale writes and busy-target removal with a conflict response. Reject
invalid or unselected scan targets explicitly, before scheduling any work.
An omitted scan filter means the selected set; `manual`/`force` changes freshness,
not scope. A saved empty selection yields an empty scan; a missing/invalid
selection reports setup/repair required, with no provider work.

Runtime validates persisted intent without requiring installation, login, or a
reachable endpoint. Readiness remains an observation; it cannot rewrite scope.

## Implementation Phases

### Phase 0: Resolve the contract and establish evidence

- [x] Resolve SPEC-030's open choices: explicit empty selection, busy-target
  removal, and first-editor backend coverage. Proposed defaults are empty idle
  allowed, removal rejected until idle, and scope enforced for every backend.
- [x] Agree the API shapes above across Runtime and Platform, including revision
  conflicts, scoped job progress, and host installer activity during deselection.
- [x] Inventory all provider work entry points, including timers, persisted jobs,
  direct execution, startup priming, and host helpers; assign a scope gate to each.
- [ ] Record a baseline in isolated fixtures: basic service-ready time, selected
  status-ready time, provider reads/processes/requests, jobs, and memory. Separate
  cold and warm runs; source inspection alone is not performance evidence.

**Deliverable:** Shared contract and a testable inventory of provider work.

### Phase 1: Authoritative selection and safe activation

- [x] Represent missing, invalid, valid-empty, and valid-selected configuration
  distinctly. Remove implicit all-provider defaults from these bootstrap paths.
- [x] Expose static native CLI/local/agent choices without inspecting provider
  installations or endpoints; retain existing advanced/API/WSL/Docker targets.
- [x] Implement selection writes and effective read models. Preserve retained
  commands/options/credential references, unrelated config, and valid routing;
  reject invalid routing references with repair detail before writing.
- [x] Validate the whole candidate and expected revision before atomic replacement.
  Disk write failure keeps the current file and effective selection unchanged.
- [x] Coordinate activation with admission: prevent new work on removed targets,
  reject removal of active operations until completion, cancel removed
  background tasks, and publish the effective revision consistently.
- [x] Use the same activation path for explicit YAML reload. Report rejected
  external edits and the still-active revision; cold start with invalid YAML
  starts repair with no effective targets. Never substitute the example/defaults.
- [x] Surface worker activation failures as degraded selected-target status and
  reconcile deterministically; never report success with a silently broader scope.

**Deliverable:** Selection persists before any provider probe, with predictable
write conflicts and reload behavior.

### Phase 2: Enforce scope throughout Runtime

- [x] Make bootstrap scans iterate selected targets rather than known families.
  Support local and agent observations without requiring a CLI scan success.
- [x] Gate diagnostics/priming, model discovery, session discovery/import,
  watchers, quota refresh, compatibility/evolution work, and service warmups.
  Static history reads must not trigger discovery of an unselected provider.
- [x] Revalidate selection for new/resumed execution and queued/retried work;
  routing and cached session metadata cannot bypass current admission.
- [x] Key observations and in-flight jobs by target and revision, coalesce
  duplicate refreshes, bound concurrency, and discard outdated results.
- [x] Reconcile added/retained/removed workers on activation. Stop removed
  watchers and timers without deleting user history or uninstalling providers.
- [x] Keep routine detection passive and polling read-only. Preserve manual
  triggers for expensive/live work and avoid exact-version execution gates.
- [x] Decouple basic service readiness from provider work; expose progress so
  one slow selected provider does not block another usable selected provider.

**Deliverable:** Instrumented tests demonstrate zero provider-specific work
outside selection, including during reload and stale job completion.

### Phase 3: Standalone Runtime setup

- [x] Show static choices first; save selection before requesting status refresh.
  Do not auto-select installed providers or disable selection of missing ones.
- [x] Reuse the editor for existing configs and preserve advanced target options.
  Distinguish selection changes from observations and installation/authentication.
- [x] Display missing/invalid/empty states, conflicts, and per-target progress;
  selected but unavailable providers retain remediation actions.
- [x] Generate the public setup page through the existing UI build and replace
  all standalone calls to the superseded setup-apply contract.

**Deliverable:** Fresh and existing standalone roots work without copying the
complete example or performing an unscoped initial scan.

### Phase 4: Local Platform and ordinary provider selectors

- [x] Update runtime client types, setup summaries, proxy routes, and auth policy
  for the shared contract. Platform reads its connected runtime's selection.
- [x] Save setup/settings selection before scanning; never derive intent from
  whichever providers happen to be detected as available.
- [x] Bound Chat/Code/Work/model choices and routing to compatible selected
  targets. Keep unavailable selected targets visible in remediation surfaces.
- [x] Reconcile provider caches by revision. Diagnostics-only and stale fallback
  data cannot restore deselected targets; unavailable runtime connectivity must
  not present cached choices as current execution authorization.
- [x] Verify separate runtime roots and remote connections; a local YAML or
  Desktop helper catalog cannot override the connected runtime's selection.

**Deliverable:** Local Platform setup and normal use consume one runtime source
of intent, including after changes and reconnects.

### Phase 5: Packaged Desktop bootstrap and repair

- [x] Persist the first-run choice through Runtime before inventory, scans, or
  provider helpers. Reopening setup loads that choice rather than resetting it.
- [x] Filter inventory probes, installer checks/actions, and provider-only
  prerequisites by selected target. Deduplicate shared prerequisites and keep
  general app prerequisites independent of provider availability.
- [x] Coordinate host helper activity with runtime admission and config changes.
  A queued helper must revalidate before launch; running helpers count as active
  provider operations for removal conflicts. Do not rely on a stale UI snapshot.
- [x] Rescan only selected targets after install/repair; keep helper catalog
  metadata available for adding providers without running helper checks.
- [x] Remove the bootstrap assumption that at least one CLI must be ready;
  support Ollama-only, OpenClaw-only, and explicit empty idle state.
- [x] Preserve user-authored configs across packaging/upgrades; never seed active
  selection from the full example or expand it when new helpers are bundled.

**Deliverable:** Desktop has the same scope semantics on Windows, macOS, and
Linux, with platform-specific installation mechanics remaining host-owned.

### Phase 6: Integrated acceptance and coordinated delivery

- [ ] Verify the scenario matrix below for standalone Runtime, local Platform,
  and packaged Desktop. Record Windows/macOS/Linux evidence separately.
- [ ] Compare isolated cold/warm measurements with Phase 0; adding unselected
  installed providers must not add provider-specific work. Report elapsed-time
  results with fixture and platform context, without inventing an unmeasured SLA.
- [ ] Run affected tests and required builds/checks in both repositories; verify
  packaged assets contain the matching runtime contract and generated setup UI.
- [x] Update API/setup/deployment docs and amend ADR-021/SPEC-017 plus Platform's
  ADR-046/SPEC-093 at acceptance/implementation, with accurate delivery status.
- [ ] Coordinate removal of old callers/routes and package dependency updates.
  Report incompatible external runtimes explicitly; do not silently fall back
  to an unscoped scan or keep an unused compatibility alias.

**Deliverable:** One tested workflow across the three personas and native OSes.
This plan does not itself publish packages or initiate a release.

## Files and Existing Test Seams

Paths below are repository-relative implementation starting points; the entry
point inventory in Phase 0 determines the complete affected set.

| Repository | Area | Existing seams |
|------------|------|----------------|
| Runtime | Config and catalog | `src/backends/cli/config.ts`, `src/core/configInspection.ts`, `src/core/providerCatalog.ts` |
| Runtime | Bootstrap contract | `src/core/bootstrap/BootstrapService.ts`, `SetupReadModelService.ts`, `src/http/routes/setup.ts`, `bootstrapGuard.ts`, `providers.ts` |
| Runtime | Startup and observations | `src/server.ts`, `src/http/routes/diagnostics.ts`, `discovery.ts`, quota/model/evolution services |
| Runtime | Standalone UI | `src/http/ui/pages/provider-setup.html`, generated `public/provider-setup.html` |
| Runtime | Verification | Bootstrap/config/catalog service tests; `tests/bootstrap.test.ts`, `provider-setup-page.test.ts`, `runtime-diagnostics.test.ts`, `runtime-server.test.ts` |
| Platform | Runtime contract | `src/runtime/client.ts`, `setup.ts`, `src/app/server/runtimeSurfaceProxy.ts`, `authGatePolicy.ts` |
| Platform | Provider choices | `src/server/routes/providers.ts`, provider-registry/model selector consumers and tests |
| Platform | Desktop setup | `desktop/host/main.ts`, `cliInventoryProbe.ts`, `bootstrapPage.ts`, `readiness.ts`, `setupBridge.ts`, `setupAudit.ts` |
| Platform | Verification | Runtime setup/client tests; Desktop inventory, bootstrap, readiness, and setup-bridge tests |

## Verification Strategy

Use temporary `CATS_RUNTIME_DIR` roots, fake adapters, and instrumented filesystem,
process, and endpoint boundaries. Automated tests must not scan the developer's
real providers, change their config, or make paid/live provider calls.

| Scenario | Required result |
|----------|-----------------|
| Missing/invalid/explicitly empty config | Distinct states; no provider work; static catalog remains accessible |
| Two selected, every other CLI installed | Only selected targets are checked at startup and on auto/manual refresh |
| New manifest/helper/example or installed CLI | Selection and provider-work count do not grow |
| Missing CLI/offline endpoint | Selection persists and remediation is scoped |
| Ollama-only/OpenClaw-only | No CLI prerequisite gate or unrelated inventory |
| Same family, different backends/instances | Only the exact selected targets authorize work |
| Repeated polling/duplicate scans | Passive reads and coalesced bounded jobs |
| Unknown/unselected target or force flag | Explicit rejection; no bypass or outside-scope side effect |
| Deselect with late results/queued jobs | Workers stop; stale results cannot restore options or start execution |
| Concurrent edits/write failure/invalid reload | No lost valid edits, partial config, or fallback to all providers |
| Remove target with active execution/helper | Conflict until the operation finishes; accepted scope remains intact |
| Retained custom settings and routing | Valid settings survive; broken references fail before save |
| Separate roots/remote runtime/reconnect | Each client follows its connected runtime's current effective selection |

Extend existing behavioral tests for these boundaries. Run targeted suites while
iterating, then the repositories' required checks at integration. Runtime UI
changes require `npm run build:ui`; packaged acceptance must test built artifacts,
not infer success from source inspection. Unavailable native OS runs remain
explicitly unverified, never counted as passing.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| A timer or helper bypasses selection | Phase 0 entry-point inventory plus instrumented outside-scope assertions |
| Selection races execution or a host installer | Coordinate admission, active-operation tracking, and activation |
| Minimal generation loses advanced config | Validate complete candidates and preserve retained/uneditable targets |
| Old responses restore removed targets | Carry revisions through caches, jobs, and host projections |
| Mismatched Runtime/Platform rollout | Contract tests and matched package updates; explicit incompatibility status |

## Progress Log

| Date | Update |
|------|--------|
| 2026-09-16 | Drafted shared Runtime/Platform/Desktop delivery plan from source inspection and SPEC-030; no implementation or performance measurements completed. |
| 2026-09-16 | User authorized the defaults. Selection API/UI, revision-aware Runtime lifecycle, Platform caches/qualified selectors, and Desktop inventory/helper admission are implemented. Full regression/build validation is underway; native packaged OS acceptance and elapsed-time baselines remain unverified. |
| 2026-09-16 | Follow-up Runtime `/setup` UX trial separates draft intent, applied selection, and observations. A single `Apply` button has an adjacent `Detect after applying` checkbox; it defaults on for first setup and off for an already configured Runtime. `Detect Again` refreshes results later. Missing installs retain selection and show repair instructions; non-CLI connections stay explicitly unverified. First-run skip and clearing all targets save idle scope. `Go to Dashboard` names the completion destination. Pending user acceptance. Automated and browser tests are deferred at the user's request; only UI assets are built for local use. |
| 2026-09-16 | Refined in-flight feedback after user testing: a blue progress banner and button/row spinners cover saving through detection, with no premature success banner. Locked checkboxes retain their selected appearance, including the master checkbox state. Awaiting user validation; no automated or browser tests run. |
| 2026-09-16 | Grouped provider actions in one footer below the list. Applied choices show secondary `Detect Again` beside primary `Go to Dashboard`; pending edits show `Apply` and its detection checkbox in the same area. Standalone detection retains both button positions, with a spinner and temporarily disabled Dashboard link. UI trial remains pending user acceptance; automated/browser tests and service startup are deferred at the user's request. |
| 2026-09-16 | User completed local Runtime UX testing and authorized automated validation and PR delivery. Review found and fixed cross-editor revision races: changed selections replace stale drafts, and interrupted scans load current choices without a false completion banner. Added built-page script interaction tests and API save/read/reload observation coverage. |
| 2026-09-16 | Runtime `npm run release:check` passed on Windows: 33 runtime skill packages verified, 217 test files / 2,181 cases passed, 2 files / 10 cases skipped by existing conditions, and package dry-run passed. Final cross-review found no blockers. |

## Implementation Evidence and Remaining Acceptance

- Desktop's shared provider manager is specified in Platform ADR-116/SPEC-116/
  PLAN-107. Runtime now supports revision-checked, identified scans with progress,
  opt-in Ollama/OpenClaw connection observations and narrow safe endpoint edits.
  Apply still saves valid empty or unavailable intent without requiring probes.
  Passive checks retain prior endpoint evidence. Native installation eligibility
  resolves environment overrides before deciding whether Ollama is local.
  Focused bootstrap/connection coverage passed (66 tests), plus TypeScript
  checking. HTTP contracts passed (26 tests) and existing standalone save/detect
  interactions passed (7 tests), using isolated state.

- The accepted Runtime Setup UX preserves per-target detection history across
  selection edits and restart, displays original detection times, marks changed
  configurations for detection, and excludes deselected history from active
  counts. Automated validation now covers retained history, partial scans,
  changed configuration, late-result rejection, repair/diagnostic coverage,
  HTTP response consistency, and save/detect/failure interactions. The user's
  earlier test deferral ended after local acceptance. `npm run release:check`
  passed on Windows, including builds, skill verification, the complete test
  suite (217 files / 2,181 cases passed; 10 cases skipped), and package dry-run.
  A focused MCP/Git case initially timed out, then passed both an isolated
  rerun and the complete suite without changing its timeout or assertions.
  No real developer service was started or restarted for this pass.

- Built-page Chromium checks on Windows passed for standalone Runtime selection,
  Platform's connected-Runtime proxy, and the Desktop bootstrap page. OpenClaw-only
  and explicit empty saves work; separate Runtime roots remain independent.
  The browser recorded no page errors. Test services used temporary roots and
  memory stores, with no user-state writes or live provider execution.
- Full local regression runs were followed by focused rechecks of every failure:
  legacy test fixtures now declare their selected targets. Slow complete-build
  tests have a 180-second budget; package cleanup assertions remain unchanged.
  Required CI and native packaged acceptance are separate delivery gates.
- Platform Relay defaults derive from the current Runtime selection. Fan-out
  revalidates exact targets before creating dispatches; empty/offline selection
  cannot create a thread with a permanently empty roster.
- Runtime entry points are gated at configuration/catalog resolution and current
  revision: bootstrap, diagnostics, models, quota, session create/resume/messages,
  native/WSL discovery, watchers, compatibility, and native service lifecycle.
- Model/diagnostic/helper work that cannot be cancelled retains an operation
  receipt until completion. Removed background jobs/caches reject stale results.
- Automatic and manual agent session enumeration retain the same receipt through
  all adapter work; regression checks reject deselection until enumeration ends.
- Desktop pauses helper admission and drains active helpers before managed
  Runtime retry/restart, shutdown, and update handoff. Its supervisor does not
  automatically restart a crashed Runtime.
- Instrumented fake-CLI scans assert zero, one, or N assessment calls for zero,
  one, or N selected targets on both routine and explicit refresh. The installed
  support catalog does not change those counts. This is work-count evidence,
  not a measured end-to-end latency or memory comparison with the old flow.
- Runtime and Platform share this plan; Platform
  [ADR-115](../../../cats-platform/docs/decisions/115-bound-bootstrap-and-provider-choices-by-runtime-selection.md)
  records host ownership. Old setup apply/MCP callers are removed together.
- Desktop packaging builds the sibling Runtime checkout; release automation must
  pin the matching Runtime revision. No package publication is part of this task.
- Windows/macOS/Linux helper scope is tested with platform fixtures. Physical
  macOS/Linux installer runs and native provider installation are not performed
  in this Windows development session. Full packaged acceptance remains open.

---

*Created: 2026-09-16*
