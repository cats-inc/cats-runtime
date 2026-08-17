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
[ADR-034](../decisions/034-automate-light-tier-provider-drift-detection-and-keep-live-probes-manual.md)
and [2026-08-17 Provider Upstream Drift Automation](../research/2026-08-17-provider-upstream-drift-automation.md),
following the PLAN-031 precedent of an ADR-anchored plan without a preceding SPEC.

Later slices (normalized cross-platform help baselines, accepted wire-baseline promotion,
capability-specific degradation, agent triage, full registry consolidation, and knowledge-pack
delivery) **do** need a SPEC before implementation. This plan deliberately stops short of them.

## Overview

Three slices, ordered so the watcher does not create another provider-truth table:

- **Phase 0 — Minimal automation registry.** Declare one machine-readable manifest for each of
  the 16 CLI provider families. The manifest records support tier, automation coverage,
  platform/channel-scoped release sources, version scheme, and capability-specific acceptance
  provenance. Existing npm package coordinates are migrated or consumed, not copied.
- **Phase 1 — Release watch.** Run a scheduled CI job that resolves the latest observable
  upstream state and reports it as a candidate relative to accepted evidence. No CLI installs,
  credentials, acceptance mutation, or user machines.
- **Phase 2 — Multi-dimensional staleness visibility.** Add release, surface, catalog, and wire
  freshness to runtime provenance so `setup` and `diagnostics` expose what is current, candidate,
  unverified, unavailable, or outside accepted scope. This phase is warning-only.

The plan intentionally distinguishes three things:

- **source declaration** — where an upstream signal can be read
- **observation** — what the latest watcher or probe saw
- **acceptance** — what Cats maintainers have reviewed and approved for a specific capability

A newly observed upstream version is not automatically accepted provider knowledge.

Non-goals for this plan:

- installing upstream CLIs in CI or committing normalized help baselines (the L2 slice)
- automatically promoting any surface, catalog, or wire candidate
- changing parser logic or provider capabilities
- degrading advanced metadata solely because a CLI version differs
- automated pull requests (L4)
- knowledge-pack distribution (L5)
- changing live-probe scheduling; ADR-025 remains binding

## Implementation Phases

### Phase 0: Minimal provider automation registry

- [ ] Task 0.1: Define a schema-gated `ProviderAutomationManifest` contract under the repo-owned
      `providers/<name>/manifest.yaml` tree. It includes provider identity, support tier, and
      coverage for release, install, surface, model-catalog, wire, and execution capabilities.
- [ ] Task 0.2: Model release sources as an array. Each source declares a stable id, kind
      (`npm` | `github` | `pypi` | `installer` | `http_artifact` | `manual`), ref, channel,
      platform scope, version scheme (`semver` | `numeric` | `opaque`), prerelease policy, and
      optional version URL. `manual` means no deterministic automated signal and must remain
      visible in reports.
- [ ] Task 0.3: Onboard all 16 `ProviderName` values. Record the actual support level rather than
      treating family registration as full execution support. In particular, install-only,
      alternate-backend, and missing evolution-probe coverage must be explicit.
- [ ] Task 0.4: Make the registry canonical for migrated release coordinates. The seven existing
      npm coordinates (`codex`, `copilot`, `opencode`, `kilo`, `auggie`, `pi`, `cline`) must be
      consumed by provider install knowledge or mechanically derived from one shared declaration;
      no second handwritten package-name table is allowed.
- [ ] Task 0.5: Add capability-specific acceptance metadata for `release`, `surface`, `catalog`,
      and `wire`. Each dimension keeps an accepted scoped version range or baseline pointer where
      applicable, with `verifiedAt`, `verifiedBy`, and `evidenceRefs`. Candidate and rejected
      evidence records coexist with that pointer; only explicit review promotion replaces it.
      Acceptance is independent per dimension.
- [ ] Task 0.6: Add schema validation and completeness tests: exactly one manifest per known
      provider, no unknown providers, unique source ids, valid platform/channel combinations, no
      placeholder refs, and explicit `manual` coverage where automation is unavailable.

**Deliverables**: One canonical automation and acceptance declaration for all 16 provider
families, plus an honest machine-readable coverage matrix. No network access or runtime behavior
changes yet.

### Phase 1: Scheduled upstream observation

- [ ] Task 1.1: Implement pure observation and classification types. Generated output records
      `latestObservedVersion` or artifact fingerprint separately from accepted evidence, with
      states `up_to_date` | `behind` | `artifact_changed` | `unknown` | `feed_error` |
      `not_automated`.
- [ ] Task 1.2: Implement npm dist-tag, GitHub release/tag, PyPI JSON, and installer-version
      resolvers with per-source timeout, channel filtering, prerelease policy, and explicit
      `feed_error` reporting.
- [ ] Task 1.3: Implement the `http_artifact` resolver. Prefer ETag and Last-Modified when stable,
      retain SHA-256 as the deterministic fallback, and classify a changed artifact without
      inventing a semantic version.
- [ ] Task 1.4: Research and fill the non-npm sources. A provider with no resolvable source stays
      `manual`; it is never omitted and never reported as up to date.
- [ ] Task 1.5: Add advisory changelog risk tagging (`breaking`, `--`, `output-format`, `model`,
      `deprecat`, `rename`). Keyword output is triage context only and never a compatibility gate.
- [ ] Task 1.6: Add `scripts/check-provider-releases.mjs` as the thin IO shell over pure logic,
      emitting `provider-watch-report.json` plus a human-readable summary, and add
      `npm run watch:providers`.
- [ ] Task 1.7: Add `.github/workflows/provider-release-watch.yml` with a daily cron and
      `workflow_dispatch`. It uploads the report and opens or updates one issue per drifting,
      errored, or newly uncovered provider. It does not edit manifests or acceptance state.
- [ ] Task 1.8: Add offline fixture tests for every resolver, version scheme, channel/prerelease
      policy, classification, artifact fingerprint, and risk tag. Tests never call live feeds.

**Deliverables**: A daily candidate report for every provider/source combination. Automated
coverage, errors, and manual gaps are all visible. Nothing observed by this phase becomes
accepted automatically.

### Phase 2: Multi-dimensional staleness visibility

- [ ] Task 2.1: Add a freshness read model with independent `release`, `surface`, `catalog`, and
      `wire` dimensions. Each reports an applicable state such as `accepted`, `candidate`,
      `outside_accepted_scope`, `unverified`, `not_automated`, `not_applicable`, `unknown`, or
      `feed_error`, plus evidence/provenance references.
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
      `GET /setup-state`, and the provider-setup page.
- [ ] Task 2.6: Keep this phase warning-only. Add an explicit regression assertion that exact CLI
      version inequality alone does not strip entries, presets, controls, defaults, or capability
      claims. Capability-specific entry-only degradation requires a later SPEC and accepted
      catalog/advanced-evidence rule.
- [ ] Task 2.7: Update `docs/api.md` for the additive provenance payload and refresh curated seed
      data only through reviewed evidence, keeping the observed scope visible.
- [ ] Task 2.8: Add unit and route tests for the freshness matrix, non-CLI targets, semver ranges,
      opaque versions, a CLI patch release with unchanged accepted catalog evidence, and a model
      catalog candidate that changes without a CLI release.

**Deliverables**: Users and maintainers can see which knowledge dimension is current or uncertain
without a coarse version mismatch unexpectedly removing working controls.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `providers/<name>/manifest.yaml` | Create | Sixteen schema-gated automation, coverage, source, and acceptance manifests |
| `src/core/provider-registry/types.ts` | Create | Manifest, source, coverage, acceptance, and observation contracts |
| `src/core/provider-registry/loader.ts` | Create | Typed schema-validated manifest loader |
| `src/core/provider-registry/loader.test.ts` | Create | Completeness, uniqueness, scope, and placeholder tests |
| `src/core/provider-install/knowledge.ts` | Modify | Consume or derive migrated npm/install coordinates without duplication |
| `src/core/provider-install/knowledge.test.ts` | Modify | Guard registry/install coordinate reconciliation |
| `src/core/provider-registry/releaseObservation.ts` | Create | Pure version/fingerprint comparison and risk tagging |
| `src/core/provider-registry/releaseObservation.test.ts` | Create | Offline resolver-output and classification fixtures |
| `scripts/check-provider-releases.mjs` | Create | IO shell: resolve sources and emit report/summary |
| `.github/workflows/provider-release-watch.yml` | Create | Daily cron, dispatch, artifact upload, and issue reconciliation |
| `package.json` | Modify | Add `watch:providers` script |
| `src/core/models/catalogFreshness.ts` | Create | Multi-dimensional freshness read model |
| `src/core/models/catalogFreshness.test.ts` | Create | Freshness, scope, backend, and non-degradation matrix |
| `src/core/models/providerAdvancedCatalog.ts` | Modify | Extend existing provenance with freshness dimensions |
| `src/core/models/providerAdvancedKnowledge.ts` | Modify | Populate warning-only capability-specific provenance |
| `src/http/routes/diagnostics.ts` | Modify | Report freshness and warnings on provider diagnostics |
| `src/http/routes/setup.ts` | Modify | Report freshness on setup state |
| `src/http/ui/pages/provider-setup.html` | Modify | Render per-dimension freshness and remediation hints |
| `src/http/providerDiagnostics.test.ts` | Modify | Extend diagnostics route assertions |
| `tests/bootstrap.test.ts` | Modify | Extend setup-state assertions |
| `config/curated-model-catalogs.yaml.example` | Modify | Refresh seed data only from reviewed scoped evidence |
| `docs/api.md` | Modify | Document the additive provenance payload |

## Technical Decisions

- **Registry files are repo-owned provider truth, not user config.** The `providers/` tree is not
  part of user-overridable runtime configuration. The bundled registry is schema-gated and loaded
  by runtime and maintainer tooling.
- **No duplicate npm source table.** Existing package coordinates are migrated or derived through
  the same loader during Phase 0. A reconciliation test prevents a future package rename from
  updating install knowledge but not the watcher, or vice versa.
- **Observation is not acceptance.** Scheduled jobs write reports and issues. Only reviewed
  changes may move a capability's accepted pointer or range.
- **Version comparison is source-aware.** Semver, numeric vendor versions, opaque labels,
  prerelease channels, and HTTP artifact changes do not share one comparison rule.
- **Pure logic is separated from IO.** Classification is unit-testable offline; only the thin
  script performs network calls.
- **The watcher opens issues, not pull requests.** Automated candidate PRs are the L4 slice and
  require their own gates.
- **Warning precedes behavior change.** This plan adds visibility but deliberately does not use an
  exact version mismatch as a proxy for unverified advanced metadata.
- **Desktop agents are optional scheduled collectors.** ChatGPT Work or Claude Cowork may collect
  changelog, documentation, and interactive-picker evidence or prepare candidate changes. CI
  remains the deterministic gate, and missed desktop-agent runs must not look like successful
  coverage.

## Testing Strategy

- **Unit tests**: one manifest per `ProviderName`; source and coverage schema; observation versus
  acceptance separation; semver/numeric/opaque comparisons; channel filtering; artifact
  fingerprints; risk tags; freshness and backend-scope matrix
- **Integration tests**: provider diagnostics, advanced catalog, setup state, and provider-setup
  page carry additive freshness; a version-only mismatch remains warning-only
- **Workflow tests**: fixture-fed watcher output, stable issue identity, transition from drift to
  resolved state, `feed_error`, and `not_automated`; no workflow test calls a live feed
- **Manual testing**:
  - run `npm run watch:providers` against live sources and inspect per-source scope
  - trigger `workflow_dispatch` and confirm the report artifact and issue reconciliation
  - compare a locally installed CLI outside an accepted surface range and confirm warnings
  - confirm API/agent/local targets without a CLI fingerprint are not falsely marked stale
- Tests must use `createRuntimeTestEnv` / `createRuntimeTestPaths` and must not touch the real
  `~/.cats/runtime`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| A source silently stops resolving and the watcher reports no drift | High | `feed_error` is first-class and the workflow reports it loudly |
| A provider has no deterministic release signal | Medium | Explicit `manual`/`not_automated` coverage plus optional artifact fingerprint and desktop-agent collection |
| Stable, beta, or OS-specific releases are compared as one stream | High | Source arrays carry channel, platform, version scheme, and prerelease policy |
| A newly observed version is mistaken for verified compatibility | High | Observation and capability-specific acceptance are separate contracts |
| Exact version mismatch strips working controls | High | Phase 2 is warning-only; regression test forbids version-only degradation |
| One account's model picker is generalized to every user | High | Catalog evidence records target scope and remains candidate until reviewed |
| A failed live probe becomes the next baseline | High | Future wire work must promote an explicit accepted pointer; no scheduled canary before that lands |
| Registry migration duplicates existing package coordinates | Medium | Migrate/derive once and enforce reconciliation in tests |
| Registry rate limits cause issue churn | Medium | Per-source timeouts, stable issue identity, transition-aware updates, and daily cadence |

## Progress Log

| Date | Update |
|------|--------|
| 2026-08-17 | Plan created from ADR-034 and the provider upstream drift research note |
| 2026-08-17 | Review revision: added minimal registry first, per-capability acceptance, coverage matrix, multi-dimensional warning-only freshness, normalized future surface contracts, and scheduled desktop-agent collection |

---

*Created: 2026-08-17*
*Revised: 2026-08-17 after Codex review*
*Author: Claude + Codex*
