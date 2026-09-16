# PLAN-039: Provider Selection Bootstrap Rollout

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft; implementation has not started |
| **Owner** | User |
| **Implementation ownership** | cats-runtime core contract; cats-platform host integration |
| **Assigned to** | Unassigned |
| **Reviewer** | User |
| **Last updated** | 2026-09-16 |

## Related Design

- [SPEC-030](../specs/SPEC-030-provider-selection-before-bootstrap-probes.md)
  defines behavior and acceptance cases.
- [ADR-039](../decisions/039-use-selected-provider-config-as-the-resource-boundary.md)
  proposes selection as the resource boundary and amends part of ADR-021.

This plan is drafted alongside the proposed design. Its checklist records future
work, not approval or delivered behavior. It is the shared delivery track for
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

## Proposed API Contract

These are proposed changes, not descriptions of the current API. Keep setup
authentication and first-run accessibility consistent with existing policy.

| Surface | Proposed responsibility |
|---------|-------------------------|
| `GET /setup-state` | Return static catalog, config state, effective selected targets, revision, and scoped observations/progress; polling performs no probes |
| `PUT /setup-selection` | Validate and save desired targets with `expectedRevision`; preserve retained config; return activated selection/revision without waiting for detection |
| `POST /setup-scan` | Start a bounded asynchronous scan of the selection or an explicit subset; return `202`; results and progress are associated with a revision |
| `GET /providers/config` | Project configured execution targets with the same revision for normal consumers; no separate selection authority |
| `POST /setup-apply` | Replace the existing scan-result/minimal-config writer with the selection operation and remove the old route in the coordinated consumer update |

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

- [ ] Resolve SPEC-030's open choices: explicit empty selection, busy-target
  removal, and first-editor backend coverage. Proposed defaults are empty idle
  allowed, removal rejected until idle, and scope enforced for every backend.
- [ ] Agree the API shapes above across Runtime and Platform, including revision
  conflicts, scoped job progress, and host installer activity during deselection.
- [ ] Inventory all provider work entry points, including timers, persisted jobs,
  direct execution, startup priming, and host helpers; assign a scope gate to each.
- [ ] Record a baseline in isolated fixtures: basic service-ready time, selected
  status-ready time, provider reads/processes/requests, jobs, and memory. Separate
  cold and warm runs; source inspection alone is not performance evidence.

**Deliverable:** Shared contract and a testable inventory of provider work.

### Phase 1: Authoritative selection and safe activation

- [ ] Represent missing, invalid, valid-empty, and valid-selected configuration
  distinctly. Remove implicit all-provider defaults from these bootstrap paths.
- [ ] Expose a static catalog for CLI/local/API/agent targets without inspecting
  provider installations or contacting endpoints.
- [ ] Implement selection writes and effective read models. Preserve retained
  commands/options/credential references, unrelated config, and valid routing;
  reject invalid routing references with repair detail before writing.
- [ ] Validate the whole candidate and expected revision before atomic replacement.
  Disk write failure keeps the current file and effective selection unchanged.
- [ ] Coordinate activation with admission: prevent new work on removed targets,
  reject removal of active operations under the proposed policy, cancel removed
  background tasks, and publish the effective revision consistently.
- [ ] Use the same activation path for explicit YAML reload. Report rejected
  external edits and the still-active revision; cold start with invalid YAML
  starts repair with no effective targets. Never substitute the example/defaults.
- [ ] Surface worker activation failures as degraded selected-target status and
  reconcile deterministically; never report success with a silently broader scope.

**Deliverable:** Selection persists before any provider probe, with predictable
write conflicts and reload behavior.

### Phase 2: Enforce scope throughout Runtime

- [ ] Make bootstrap scans iterate selected targets rather than known families.
  Support local and agent observations without requiring a CLI scan success.
- [ ] Gate diagnostics/priming, model discovery, session discovery/import,
  watchers, quota refresh, compatibility/evolution work, and service warmups.
  Static history reads must not trigger discovery of an unselected provider.
- [ ] Revalidate selection for new/resumed execution and queued/retried work;
  routing and cached session metadata cannot bypass current admission.
- [ ] Key observations and in-flight jobs by target and revision, coalesce
  duplicate refreshes, bound concurrency, and discard outdated results.
- [ ] Reconcile added/retained/removed workers on activation. Stop removed
  watchers and timers without deleting user history or uninstalling providers.
- [ ] Keep routine detection passive and polling read-only. Preserve manual
  triggers for expensive/live work and avoid exact-version execution gates.
- [ ] Decouple basic service readiness from provider work; expose progress so
  one slow selected provider does not block another usable selected provider.

**Deliverable:** Instrumented tests demonstrate zero provider-specific work
outside selection, including during reload and stale job completion.

### Phase 3: Standalone Runtime setup

- [ ] Show static choices first; save selection before requesting status refresh.
  Do not auto-select installed providers or disable selection of missing ones.
- [ ] Reuse the editor for existing configs and preserve advanced target options.
  Distinguish selection changes from observations and installation/authentication.
- [ ] Display missing/invalid/empty states, conflicts, and per-target progress;
  selected but unavailable providers retain remediation actions.
- [ ] Generate the public setup page through the existing UI build and replace
  all standalone calls to the superseded setup-apply contract.

**Deliverable:** Fresh and existing standalone roots work without copying the
complete example or performing an unscoped initial scan.

### Phase 4: Local Platform and ordinary provider selectors

- [ ] Update runtime client types, setup summaries, proxy routes, and auth policy
  for the shared contract. Platform reads its connected runtime's selection.
- [ ] Save setup/settings selection before scanning; never derive intent from
  whichever providers happen to be detected as available.
- [ ] Bound Chat/Code/Work/model choices and routing to compatible selected
  targets. Keep unavailable selected targets visible in remediation surfaces.
- [ ] Reconcile provider caches by revision. Diagnostics-only and stale fallback
  data cannot restore deselected targets; unavailable runtime connectivity must
  not present cached choices as current execution authorization.
- [ ] Verify separate runtime roots and remote connections; a local YAML or
  Desktop helper catalog cannot override the connected runtime's selection.

**Deliverable:** Local Platform setup and normal use consume one runtime source
of intent, including after changes and reconnects.

### Phase 5: Packaged Desktop bootstrap and repair

- [ ] Persist the first-run choice through Runtime before inventory, scans, or
  provider helpers. Reopening setup loads that choice rather than resetting it.
- [ ] Filter inventory probes, installer checks/actions, and provider-only
  prerequisites by selected target. Deduplicate shared prerequisites and keep
  general app prerequisites independent of provider availability.
- [ ] Coordinate host helper activity with runtime admission and config changes.
  A queued helper must revalidate before launch; running helpers count as active
  provider operations for removal conflicts. Do not rely on a stale UI snapshot.
- [ ] Rescan only selected targets after install/repair; keep helper catalog
  metadata available for adding providers without running helper checks.
- [ ] Remove the bootstrap assumption that at least one CLI must be ready;
  support Ollama-only, OpenClaw-only, and the proposed explicit empty idle state.
- [ ] Preserve user-authored configs across packaging/upgrades; never seed active
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
- [ ] Update API/setup/deployment docs and amend ADR-021/SPEC-017 plus Platform's
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
| Remove target with active execution/helper | Conflict under proposed policy; accepted scope remains intact |
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

---

*Created: 2026-09-16*
