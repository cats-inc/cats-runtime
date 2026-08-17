# PLAN-036: Provider Upstream Drift Watch and Staleness Surfacing

> First three landing slices of the provider knowledge supply chain from ADR-034.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | user |
| **Assigned To** | Unassigned |
| **Reviewer** | Codex |

## Related Spec

No SPEC yet. This plan is anchored directly on
[ADR-034](../decisions/034-automate-light-tier-provider-drift-and-separate-observation-from-acceptance.md)
and [2026-08-17 Provider Upstream Drift Automation](../research/2026-08-17-provider-upstream-drift-automation.md),
following the PLAN-031 precedent of an ADR-anchored plan without a preceding SPEC.

Later slices (canonicalized cross-platform help baselines, accepted wire-baseline promotion,
capability-specific degradation, agent triage, the YAML knowledge registry and its packaging work,
and knowledge-pack delivery) **do** need a SPEC before implementation. This plan deliberately
stops short of them.

## Overview

Three slices, ordered so the first observable value arrives without a refactor, and so the watcher
does not create a second provider-truth table:

- **Phase 0 — Canonical release sources and coverage matrix.** Declare, per provider, its release
  sources and its honest automation coverage. The seven existing npm coordinates are consumed from
  install knowledge, not copied. Declared in TypeScript so it ships with the compiled runtime and
  needs no packaging change.
- **Phase 1 — Release watch.** Run a scheduled CI job that resolves the latest observable upstream
  state and reports it as a candidate relative to accepted evidence. Persist per-source success
  times and a scheduler heartbeat outside the product branch, and render a deterministic reviewed
  observation-snapshot candidate. No CLI installs, credentials, acceptance mutation, or user
  machines.
- **Phase 2 — Multi-dimensional staleness visibility.** Add release, surface, catalog, and wire
  freshness to runtime provenance so `setup` and `diagnostics` expose what is current, candidate,
  unverified, unavailable, stale, or outside accepted scope. The release dimension reads only the
  reviewed snapshot compiled into the runtime, never a CI artifact or issue directly. Warning-only,
  plus one concrete correction of the curated catalog data that Phase 1 exposes as stale.

The plan intentionally distinguishes three things:

- **source declaration** — where an upstream signal can be read
- **observation** — what the latest watcher or probe saw
- **reviewed observation delivery** — which versioned observation snapshot is safe to ship as
  runtime provenance without implying compatibility acceptance
- **acceptance** — what Cats maintainers have reviewed and approved for a specific capability

A newly observed upstream version is not automatically accepted provider knowledge. Phase 0 models
that separation as typed fields; the full candidate/rejected evidence store and the promotion
workflow belong to the later accepted-baseline slice.

Non-goals for this plan:

- installing upstream CLIs in CI or committing canonicalized help baselines (the L2 slice)
- the YAML knowledge registry and the migration of argv profiles, model catalogs, and advanced
  manifests into it (the consolidation slice; see the packaging constraint below)
- a candidate/rejected evidence record store or any promotion workflow
- automatically promoting any surface, catalog, or wire candidate
- changing parser logic or provider capabilities
- degrading advanced metadata solely because a CLI version differs
- automated pull requests (L4)
- knowledge-pack distribution (L5)
- changing live-probe scheduling; ADR-025 remains binding

## Implementation Phases

### Phase 0: Canonical release sources and coverage matrix

- [ ] Task 0.1: Define `ProviderReleaseSource` and `ProviderAutomationCoverage` contracts in
      TypeScript under `src/core/provider-registry/`. Coverage is declared per capability —
      `release`, `install`, `surface`, `catalog`, `wire`, `execution` — as
      `automated` | `manual` | `not_applicable`, with a reason required for anything not
      `automated`.
- [ ] Task 0.2: Model release sources as an array. Each source declares a stable id, kind
      (`npm` | `github` | `pypi` | `installer` | `http_artifact` | `manual`), ref, channel,
      platform scope, version scheme (`semver` | `numeric` | `opaque`), prerelease policy, and
      optional version URL. `manual` means no deterministic automated signal and must remain
      visible in reports.
- [ ] Task 0.3: Onboard all 16 `ProviderName` values with their actual support level, not with
      family registration treated as full execution support. `aider` is the worked example:
      `src/backends/cli/providers/aider.ts:13` throws from `buildSpawnArgs`, so it is
      install-and-detect only and its `execution` coverage is `not_applicable`. Alternate-backend
      execution and providers outside the current evolution-probe rollout must be equally explicit.
- [ ] Task 0.4: Derive npm release sources from `check.npmPackage` in
      `src/core/provider-install/knowledge.ts` rather than restating them. The seven existing
      coordinates (`codex`, `copilot`, `opencode`, `kilo`, `auggie`, `pi`, `cline`) must have
      exactly one handwritten home, with a reconciliation test proving the watcher and install
      knowledge cannot diverge.
- [ ] Task 0.5: Add an optional accepted-reference field per capability (`acceptedVersionRange` or
      `acceptedBaselineRef`, plus `verifiedAt`, `verifiedBy`, `evidenceRefs`). Observation must
      never write these. Leaving one unset is a valid, reportable state — it means "not yet
      accepted", not "current".
- [ ] Task 0.6: Add completeness tests: every `ProviderName` present, no unknown providers, unique
      source ids, valid platform/channel combinations, no placeholder refs, a reason on every
      non-`automated` coverage entry, and the install-knowledge reconciliation from Task 0.4.

**Deliverables**: One canonical release-source and coverage declaration for all 16 provider
families, shipping inside `build/runtime` with no packaging change. No network access and no
runtime behavior change yet.

### Phase 1: Scheduled upstream observation

- [ ] Task 1.1: Implement pure observation and classification types. Generated output records
      `latestObservedVersion` or artifact fingerprint separately from accepted references, with
      states `up_to_date` | `behind` | `artifact_changed` | `unknown` | `feed_error` |
      `not_automated` | `not_accepted`.
- [ ] Task 1.2: Implement npm dist-tag, GitHub release/tag, PyPI JSON, and installer-version
      resolvers with per-source timeout, channel filtering, prerelease policy, and explicit
      `feed_error` reporting.
- [ ] Task 1.3: Implement the `http_artifact` resolver. Prefer ETag and Last-Modified when stable,
      retain SHA-256 as the deterministic fallback, and classify a changed artifact without
      inventing a semantic version. Treat it as a weak signal: an artifact change means "look",
      never "upstream released".
- [ ] Task 1.4: Research and fill the non-npm sources. A provider with no resolvable source stays
      `manual`; it is never omitted and never reported as up to date.
- [ ] Task 1.5: Add advisory changelog risk tagging (`breaking`, `--`, `output-format`, `model`,
      `deprecat`, `rename`). Keyword output is triage context only and never a compatibility gate.
- [ ] Task 1.6: Separate the current run's `observedAt` from durable
      `lastSuccessfulObservationAt` per source. On `feed_error`, retain the prior success time and
      flag it once it exceeds the declared threshold; never replace it with the failure time.
- [ ] Task 1.7: Add `scripts/check-provider-releases.ts` as the thin IO shell over pure TypeScript
      logic. It emits `provider-watch-report.json`, a human-readable summary, and a deterministic
      observation-snapshot candidate. Add `npm run watch:providers` as
      `tsx scripts/check-provider-releases.ts`; the script supports `--help` and does not depend on
      a pre-existing or possibly stale `build/runtime` tree.
- [ ] Task 1.8: Reserve one pinned GitHub issue as schema-validated operational state. Its
      machine-owned block records `lastRunAt`, workflow run identity, and each source or collector's
      `lastSuccessfulObservationAt`; run-scoped workflow artifacts remain the evidence bundle. The
      workflow reads the prior block before resolution, updates only successful source timestamps,
      fails loudly on invalid state, and never treats this issue as runtime or acceptance data.
- [ ] Task 1.9: Add `.github/workflows/provider-release-watch.yml` with a daily cron and
      `workflow_dispatch`. It uploads the report, updates the operational-state issue, and opens or
      updates one separate issue per drifting, errored, stale-observation, or newly uncovered
      provider. Use a single-flight concurrency group so overlapping cron and dispatch runs cannot
      race the durable state, with workflow-token permissions limited to `contents: read` and
      `issues: write`. It does not edit declarations, reviewed snapshots, or accepted references.
- [ ] Task 1.10: Configure an independently hosted heartbeat monitor that reads the published
      `lastRunAt` and alerts when it is older than the scheduler threshold. The monitor may be a
      Claude Code cloud job, a ChatGPT web scheduled task, a Claude Cowork remote task, or an
      uptime service, but it must not depend on the same GitHub Actions cron. Until this monitor is
      active and its alert path is tested, scheduler liveness is reported as `unknown`.
- [ ] Task 1.11: Add `scripts/import-provider-observations.ts` and
      `src/core/provider-registry/reviewedObservations.ts`. The import command validates the report
      schema, report checksum, source identities, and monotonic observation times, then renders a
      deterministic TypeScript diff for human review. Add the `snapshot:providers` package script
      using `tsx`; invoke it as `npm run snapshot:providers -- --report <path>`. Require an explicit
      report path and support `--help` and `--dry-run`. Import never moves an accepted reference.
      The merged TypeScript snapshot is the sole Phase 2 runtime input; near-real-time refresh
      remains deferred to L5 knowledge-pack delivery.
- [ ] Task 1.12: Add offline fixture tests for every resolver, version scheme, channel/prerelease
      policy, classification, artifact fingerprint, durable-state transition, snapshot import,
      staleness threshold, and risk tag. Tests never call live feeds.

**Deliverables**: A daily candidate report for every provider/source combination, durable
per-source success state, an independently monitored scheduler heartbeat, and a deterministic
reviewed-snapshot import path. Automated coverage, errors, stale observations, scheduler outages,
and manual gaps are visible. Nothing observed or imported by this phase becomes compatibility
acceptance automatically.

### Phase 2: Multi-dimensional staleness visibility

- [ ] Task 2.1: Add a freshness read model with independent `release`, `surface`, `catalog`, and
      `wire` dimensions. Each reports an applicable state such as `accepted`, `candidate`,
      `outside_accepted_scope`, `unverified`, `stale_observation`, `not_automated`,
      `not_applicable`, `unknown`, or `feed_error`, plus evidence/provenance references. Release
      freshness is derived from the bundled reviewed observation snapshot, its age, and the
      capability-specific accepted release reference; it never fetches CI state at runtime.
- [ ] Task 2.2: Use `CompatibilityVersionFingerprint` only for CLI-backed dimensions whose
      accepted scope actually depends on the local CLI version. API, agent, local, and desktop
      targets must not be degraded or marked stale merely because they have no CLI fingerprint.
- [ ] Task 2.3: Treat curated catalog `version` / `lastUpdated` as catalog observation
      provenance, not as proof that release, surface, and wire contracts are accepted. Preserve
      dynamic target-specific model discovery separately because model availability may vary by
      account, region, entitlement, or rollout without a CLI release.
- [ ] Task 2.4: Extend `ProviderAdvancedCatalogSupport.provenance` with the freshness dimensions.
      This is additive to the existing shape; do not introduce a parallel provenance object.
- [ ] Task 2.5: Surface the dimensions and actionable warnings on
      `GET /diagnostics/providers`, `GET /providers/{provider}/models/advanced`,
      `GET /setup-state`, and the provider-setup page. Include the reviewed snapshot's observation
      time and bundled-at/runtime version so users can distinguish "no drift" from "snapshot too
      old to know".
- [ ] Task 2.6: Keep the runtime contract warning-only. Add an explicit regression assertion that
      exact CLI version inequality alone does not strip entries, presets, controls, defaults, or
      capability claims. Capability-specific entry-only degradation requires a later SPEC and an
      accepted catalog/advanced-evidence rule.
- [ ] Task 2.7: Correct the curated catalog data this work exposes as stale. The Claude entry in
      `config/curated-model-catalogs.yaml.example` still declares `version: 2.1.112`,
      `last_updated: 2026-04-17`, and "Opus 4.7 with 1M context". Re-observe it against a current
      CLI, record the observation scope, and update the entry with its `version` / `last_updated`
      provenance. This updates catalog observation only; it does not set an accepted pointer for
      any other dimension. Audit the remaining catalog entries for the same staleness and file
      whatever cannot be re-observed in this pass.
- [ ] Task 2.8: Update `docs/api.md` for the additive provenance payload.
- [ ] Task 2.9: Add unit and route tests for the freshness matrix, stale or absent reviewed
      snapshots, non-CLI targets, semver ranges, opaque versions, a CLI patch release with
      unchanged accepted catalog evidence, and a model catalog candidate that changes without a
      CLI release.

**Deliverables**: Users and maintainers can see which knowledge dimension is current or uncertain
without a coarse version mismatch unexpectedly removing working controls, and the one catalog entry
already known to be wrong is corrected rather than only annotated.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/provider-registry/types.ts` | Create | Release-source, coverage, accepted-reference, and observation contracts |
| `src/core/provider-registry/sources.ts` | Create | Per-provider release sources and coverage matrix; npm coordinates derived from install knowledge |
| `src/core/provider-registry/sources.test.ts` | Create | Completeness, uniqueness, scope, placeholder, and coverage-reason tests |
| `src/core/provider-install/knowledge.ts` | Modify | Expose `check.npmPackage` as the single canonical coordinate the registry derives from |
| `src/core/provider-install/knowledge.test.ts` | Modify | Guard registry/install coordinate reconciliation |
| `src/core/provider-registry/releaseObservation.ts` | Create | Pure version/fingerprint comparison, staleness threshold, risk tagging |
| `src/core/provider-registry/releaseObservation.test.ts` | Create | Offline resolver-output and classification fixtures |
| `src/core/provider-registry/reviewedObservations.ts` | Create | Reviewed, versioned runtime observation snapshot; observation only, never acceptance |
| `src/core/provider-registry/reviewedObservations.test.ts` | Create | Snapshot schema, provenance, age, and acceptance-separation tests |
| `scripts/check-provider-releases.ts` | Create | `tsx` IO shell: resolve sources and emit report, summary, and snapshot candidate |
| `scripts/import-provider-observations.ts` | Create | Validate a report and render the reviewed TypeScript snapshot diff |
| `.github/workflows/provider-release-watch.yml` | Create | Daily cron, dispatch, artifact upload, operational state, and issue reconciliation |
| `package.json` | Modify | Add `watch:providers` and `snapshot:providers` scripts using `tsx` |
| `docs/deployment.md` | Modify | Document operational-state issue, independent heartbeat monitor, ownership, and recovery |
| `src/core/models/catalogFreshness.ts` | Create | Multi-dimensional freshness read model |
| `src/core/models/catalogFreshness.test.ts` | Create | Freshness, scope, backend, and non-degradation matrix |
| `src/core/models/providerAdvancedCatalog.ts` | Modify | Extend existing provenance with freshness dimensions |
| `src/core/models/providerAdvancedKnowledge.ts` | Modify | Populate warning-only capability-specific provenance |
| `src/http/routes/diagnostics.ts` | Modify | Report freshness and warnings on provider diagnostics |
| `src/http/routes/setup.ts` | Modify | Report freshness on setup state |
| `src/http/ui/pages/provider-setup.html` | Modify | Render per-dimension freshness and remediation hints |
| `src/http/providerDiagnostics.test.ts` | Modify | Extend diagnostics route assertions |
| `tests/bootstrap.test.ts` | Modify | Extend setup-state assertions |
| `config/curated-model-catalogs.yaml.example` | Modify | Correct the stale Claude entry and record observation scope (Task 2.7) |
| `docs/api.md` | Modify | Document the additive provenance payload |

Note on `src/http/ui/pages/provider-setup.html`: per `CLAUDE.md`, touching `src/http/ui/**`
requires `npm run build:ui` and committing the regenerated `public/*.html` and
`src/http/ui/generated/runtimeTailwind.ts`, or `tests/runtime-ui-build.test.ts` fails.

## Technical Decisions

- **Phase 0 declares in TypeScript, not YAML, and that is a packaging decision.** `npm run build`
  is `clean:build` + `build:ui` + `tsc`; `scripts/build-runtime-artifacts.mjs` copies no assets.
  `package.json` `files` is an allowlist, and `tests/package-contract.test.ts` asserts it with
  `toEqual`. A runtime-loaded YAML tree therefore needs a new build copy step, a `files` entry, a
  `package-contract` update, and — for a root `providers/` directory — an `AGENTS.md` Project
  Structure Convention entry. Compiled TypeScript needs none of that. A flat declaration table is
  still safely machine-editable; the 1490-line-module objection applies to knowledge with logic in
  it, not to a source table.
- **The YAML registry is deferred with its packaging cost written down.** When the consolidation
  slice lands, it must include: the build copy step, the `files` allowlist entry,
  `tests/package-contract.test.ts`, and the `AGENTS.md` convention entry if it lives at the repo
  root. Note that `config/*.yaml.example` is *not* the precedent to copy — those are
  user-overridable templates resolved through `resolveRuntimeCuratedModelCatalogPath`, and the
  registry is not user-overridable.
- **No duplicate npm source table.** Package coordinates keep exactly one handwritten home in
  install knowledge; the registry derives from it, and a reconciliation test prevents a future
  rename from updating one and not the other.
- **Observation delivery is not acceptance.** Scheduled jobs write reports, operational state, and
  issues. A reviewed snapshot may enter the runtime as provenance, but it cannot set or move a
  capability's accepted reference. Phase 0 provides the fields; the candidate/rejected store and
  promotion workflow are a later slice.
- **Version comparison is source-aware.** Semver, numeric vendor versions, opaque labels,
  prerelease channels, and HTTP artifact changes do not share one comparison rule.
- **Pure logic is separated from IO, with an explicit execution path.** Classification is
  unit-testable offline; only the thin `tsx` script performs network calls. Using the repo's
  existing `tsx` development dependency lets the script import source TypeScript directly and
  avoids an undocumented dependency on a prebuilt `build/runtime` tree.
- **The watcher opens issues, not pull requests.** Automated candidate PRs are the L4 slice and
  require their own gates.
- **Warning precedes behavior change, but the known-bad datum still gets fixed.** The runtime
  contract stays warning-only; Task 2.7 is a content correction, not a behavior change, so
  deferring degradation does not mean shipping data we already know is wrong.
- **Absence of signal is never coverage.** Every non-`automated` capability carries a reason;
  durable operational state preserves each source or collector's last success across failures;
  and a scheduler heartbeat is checked outside the scheduler it monitors. A source, collector, or
  scheduler without that liveness path is `unknown`, not current.
- **Runtime observation input is reviewed and release-bundled.** Phase 2 reads the compiled
  snapshot, never mutable GitHub state. Diagnostics expose snapshot age. L5 later replaces this
  release-coupled delivery with an integrity-checked, rollback-capable knowledge pack.
- **Agent-hosted schedules are optional collectors and monitors.** ChatGPT Work, Claude Cowork, or
  Claude Code cloud may collect changelog, documentation, and interactive-picker evidence or
  prepare candidate changes. CI remains the deterministic gate. Claude Code cloud is the preferred
  default for repo-native tests and PR preparation when available; Work or Cowork may be preferable
  for connected or account-scoped context. Each deployment records local versus remote execution
  and proves its own delivery receipt.

## Testing Strategy

- **Unit tests**: every `ProviderName` declared; source and coverage schema including a reason on
  every non-`automated` entry; install-knowledge coordinate reconciliation; observation versus
  accepted-reference separation; semver/numeric/opaque comparisons; channel filtering; artifact
  fingerprints; staleness threshold; risk tags; freshness and backend-scope matrix
- **Integration tests**: provider diagnostics, advanced catalog, setup state, and provider-setup
  page carry additive freshness; a version-only mismatch remains warning-only
- **Workflow tests**: fixture-fed watcher output, stable issue identity, transition from drift to
  resolved state, prior-success preservation across `feed_error`, invalid durable-state handling,
  `not_automated`, stale-observation flagging, deterministic snapshot rendering, and a simulated
  stale scheduler heartbeat; no workflow test calls a live feed
- **Manual testing**:
  - run `npm run watch:providers` against live sources and inspect per-source scope
  - trigger `workflow_dispatch` and confirm the report artifact and issue reconciliation
  - stop or delay a test heartbeat and confirm the independent monitor alerts after the threshold
  - import a report snapshot, inspect the deterministic TypeScript diff, and confirm it changes no
    accepted reference
  - compare a locally installed CLI outside an accepted surface range and confirm warnings
  - confirm API/agent/local targets without a CLI fingerprint are not falsely marked stale
  - run `npm run release:check` after Phase 0 to confirm no packaging contract moved
- Tests must use `createRuntimeTestEnv` / `createRuntimeTestPaths` and must not touch the real
  `~/.cats/runtime`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| A source silently stops resolving and the watcher reports no drift | High | `feed_error` is first-class; durable state preserves the prior `lastSuccessfulObservationAt`; the workflow reports both loudly |
| The GitHub Actions schedule never starts, so it cannot report its own failure | High | Publish `lastRunAt` and require an independently hosted monitor; report scheduler coverage as `unknown` until its alert path is tested |
| A CI artifact or mutable issue is mistaken for runtime truth | High | Phase 2 reads only the reviewed, versioned TypeScript snapshot with report provenance and checksum |
| A provider has no deterministic release signal | Medium | Explicit `manual`/`not_automated` coverage with a required reason, plus optional artifact fingerprint and agent-hosted collection |
| Stable, beta, or OS-specific releases are compared as one stream | High | Source arrays carry channel, platform, version scheme, and prerelease policy |
| A newly observed version is mistaken for verified compatibility | High | Observation and per-capability accepted references are separate contracts, and observation cannot write them |
| Exact version mismatch strips working controls | High | The runtime contract stays warning-only; regression test forbids version-only degradation |
| One account's model picker is generalized to every user | High | Catalog evidence records target scope and stays candidate until reviewed |
| A failed live probe becomes the next baseline | High | Future wire work must promote an explicit accepted pointer; no scheduled canary before that lands |
| A runtime-loaded data tree is not packaged, or breaks `package-contract` | High | Phase 0 declares in compiled TypeScript; the deferred YAML slice carries its packaging checklist explicitly |
| Deferring degradation leaves known-wrong data shipped | Medium | Task 2.7 corrects the stale entry as content, independent of the degradation gate |
| Scope creep back into the registry refactor or the L2 install matrix | Medium | Both are explicit non-goals with their own SPEC requirement; Phase 0 is a source table, not a knowledge migration |
| Registry rate limits cause issue churn | Medium | Per-source timeouts, stable issue identity, transition-aware updates, and daily cadence |

## Progress Log

| Date | Update |
|------|--------|
| 2026-08-17 | Plan created from ADR-034 and the provider upstream drift research note |
| 2026-08-17 | Review revision: added minimal registry first, per-capability acceptance, coverage matrix, multi-dimensional warning-only freshness, normalized future surface contracts, and scheduled desktop-agent collection |
| 2026-08-17 | Second review pass: Phase 0 reduced to a compiled-TypeScript source/coverage table after the YAML tree was found to need unlisted packaging work; candidate/rejected store deferred; observation staleness threshold added; stale-catalog correction restored as a deliverable |
| 2026-08-18 | Third review pass: added durable per-source state, an independent scheduler heartbeat, reviewed observation-snapshot delivery into runtime, conservative canonicalization, explicit `tsx` script execution, and execution-mode-aware agent scheduling |

---

*Created: 2026-08-17*
*Revised: 2026-08-18 after a third review pass closed the runtime-delivery and scheduler-liveness gaps*
*Author: Claude + Codex*
