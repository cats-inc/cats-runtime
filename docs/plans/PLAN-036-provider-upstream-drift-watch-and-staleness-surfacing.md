# PLAN-036: Provider Upstream Drift Watch and Staleness Surfacing

> First two landing slices of the provider knowledge supply chain from ADR-034.

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

Later slices (containerized help baselines, registry consolidation, agent triage, knowledge-pack
delivery) **do** need a SPEC before implementation; this plan deliberately stops short of them.

## Overview

Two slices, both additive, chosen for the highest value-over-cost ratio in the research note:

- **Phase 1 — Release watch.** Declare a machine-readable release feed for each of the 16 CLI
  provider families, then run a scheduled CI job that resolves the latest upstream version,
  compares it against the recorded verified version, and reports drift. No CLI installs, no
  credentials, no user machines.
- **Phase 2 — Staleness visibility.** Feed the recorded verified version and the already-parsed
  curated-catalog `version` / `lastUpdated` into runtime provenance so `setup` and `diagnostics`
  report when provider knowledge is behind the installed CLI, instead of silently serving stale
  truth.

Phase 1 is pure addition and touches no runtime contract. Phase 2 extends one existing
read-model shape and one warning path.

Non-goals for this plan:

- installing upstream CLIs in CI (that is the L2 slice, needs its own SPEC)
- automated pull requests (L4)
- knowledge-pack distribution (L5)
- any change to live-probe or `providerEvolutionProbe` policy — ADR-025 governs that and stays
  intact

## Implementation Phases

### Phase 1: Release feed declaration and scheduled watch

- [ ] Task 1.1: Add `ProviderReleaseFeed` types — feed `kind`
      (`npm` | `github` | `pypi` | `installer` | `none`), `ref`, optional `versionUrl`,
      `verifiedVersion`, `verifiedAt`, `verifiedBy`, `notes`
- [ ] Task 1.2: Declare a feed entry for all 16 providers in a flat table. Seven already have a
      resolvable coordinate via `check.npmPackage` and can be filled mechanically:
      `codex` → `@openai/codex`, `copilot` → `@github/copilot`, `opencode` → `opencode-ai`,
      `kilo` → `@kilocode/cli`, `auggie` → `@augmentcode/auggie`,
      `pi` → `@earendil-works/pi-coding-agent`, `cline` → `cline`
- [ ] Task 1.3: Research and declare feeds for the remaining nine (`claude`, `cursor`, `goose`,
      `junie`, `kiro`, `antigravity`, `grok`, `aider`, `devin`). Known starting points: `aider`
      resolves to `aider-chat` on PyPI via the uv installer; `claude` installs from
      `claude.ai/install.sh` and has no version feed declared anywhere yet. Any provider with no
      resolvable feed must be recorded as `kind: 'none'` with a reason — never left absent
- [ ] Task 1.4: Implement pure drift logic: version comparison, drift classification
      (`up_to_date` | `behind` | `unknown` | `feed_error`), and risk tagging by changelog keyword
      scan (`breaking`, `--`, `output-format`, `model`, `deprecat`, `rename`)
- [ ] Task 1.5: Implement the feed resolvers (npm dist-tags, GitHub releases/tags, PyPI JSON) with
      per-feed timeout and explicit `feed_error` reporting. A feed that fails to resolve must
      report loudly, never as "no drift"
- [ ] Task 1.6: Add `scripts/check-provider-releases.mjs` as a thin IO shell over the pure logic,
      emitting `provider-watch-report.json` plus a human-readable summary, and an
      `npm run watch:providers` script
- [ ] Task 1.7: Add `.github/workflows/provider-release-watch.yml` — daily cron plus
      `workflow_dispatch`, no credentials beyond the default token, uploading the report as an
      artifact and opening/updating one issue per drifting provider
- [ ] Task 1.8: Tests — every `ProviderName` has a feed entry with a valid shape and no
      placeholder value; drift classification and risk tagging are covered against fixture feed
      payloads with no network access

**Deliverables**: A daily report that names every provider whose upstream version has moved past
the recorded verified version, with changelog excerpts where upstream publishes them. Nothing in
the runtime's behavior changes yet.

### Phase 2: Staleness visibility in setup and diagnostics

- [ ] Task 2.1: Add freshness computation comparing three inputs — the locally fingerprinted
      version from `CompatibilityVersionFingerprint`, the `verifiedVersion` from the feed table,
      and the curated catalog's parsed `version` / `lastUpdated`. Output a discriminated
      `staleness` state (`fresh` | `catalog_behind_local` | `version_unverified` |
      `version_unknown`)
- [ ] Task 2.2: Extend `ProviderAdvancedCatalogSupport.provenance` with the freshness fields.
      This is additive to an existing shape — do not introduce a parallel provenance object
- [ ] Task 2.3: Surface the freshness state and an actionable warning on
      `GET /diagnostics/providers` and `GET /providers/{provider}/models/advanced`
- [ ] Task 2.4: Surface it on `GET /setup-state` and in the provider-setup page, since ADR-029
      rule 5 makes `setup` and `diagnostics` the canonical surfaces for capability inspection
- [ ] Task 2.5: Warning-only first. Do **not** change what metadata is served in this task
- [ ] Task 2.6: Then honor ADR-029 rule 2 — degrade advanced metadata to entry-only when the
      local fingerprint matches no verified version. Gate this on Task 1.3 being complete for all
      16 providers, so degradation cannot fire merely because a feed was never declared
- [ ] Task 2.7: Update `docs/api.md` for the extended provenance payload, and refresh the
      curated-catalog seed data that Phase 1 exposes as stale
- [ ] Task 2.8: Tests — freshness state matrix at unit level; diagnostics and advanced-catalog
      route assertions extended; a regression test that an unverified local version degrades to
      entry-only once Task 2.6 lands

**Deliverables**: A user or maintainer can see, per provider, whether runtime knowledge matches
the installed CLI, and the runtime stops presenting unverified advanced metadata as authoritative.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/provider-install/releaseFeeds.ts` | Create | `ProviderReleaseFeed` type plus the flat 16-entry feed table with verified-version provenance |
| `src/core/provider-install/releaseFeeds.test.ts` | Create | Every `ProviderName` covered; shapes valid; no placeholders |
| `src/core/provider-install/releaseDrift.ts` | Create | Pure version comparison, drift classification, changelog risk tagging |
| `src/core/provider-install/releaseDrift.test.ts` | Create | Classification and risk-tag coverage against fixture payloads, offline |
| `src/core/provider-install/types.ts` | Modify | Export the release-feed contract alongside existing install/check metadata |
| `scripts/check-provider-releases.mjs` | Create | IO shell: resolve feeds, emit `provider-watch-report.json` and summary |
| `.github/workflows/provider-release-watch.yml` | Create | Daily cron + `workflow_dispatch`; artifact upload; one issue per drifting provider |
| `package.json` | Modify | Add `watch:providers` script |
| `src/core/models/catalogFreshness.ts` | Create | Freshness state from local fingerprint + verified version + catalog `version`/`lastUpdated` |
| `src/core/models/catalogFreshness.test.ts` | Create | Freshness state matrix |
| `src/core/models/providerAdvancedCatalog.ts` | Modify | Extend `ProviderAdvancedCatalogSupport.provenance` with freshness fields |
| `src/core/models/providerAdvancedKnowledge.ts` | Modify | Populate the extended provenance in `buildVerifiedSupportMetadata`; apply entry-only degradation in Task 2.6 |
| `src/http/routes/diagnostics.ts` | Modify | Report freshness and warnings on `GET /diagnostics/providers` |
| `src/http/routes/setup.ts` | Modify | Report freshness on `GET /setup-state` |
| `src/http/providerDiagnostics.test.ts` | Modify | Extend for freshness payload and warnings |
| `config/curated-model-catalogs.yaml.example` | Modify | Refresh the seed data Phase 1 exposes as stale |
| `docs/api.md` | Modify | Document the extended provenance payload |
| `docs/decisions/README.md` | Modify | Index ADR-034 |
| `docs/plans/README.md` | Modify | Index PLAN-036 |
| `docs/research/README.md` | Modify | Index the 2026-08-17 research note |
| `docs/README.md` | Modify | Extend the research-directory description |

## Technical Decisions

- **Feed coordinates live beside install knowledge, not in `config/`.** `config/` holds
  user-overridable runtime config templates; feed coordinates are repo-owned provider truth that
  Phase 2 needs at runtime. `src/core/provider-install/` already owns `check.npmPackage`, so this
  is the same concern. ADR-034 decision 6 will migrate it into the declarative registry later;
  this location is a deliberate interim, not the end state.
- **Pure logic separated from IO.** Version comparison and classification are unit-testable
  offline; only the thin script performs network calls. Tests must not hit the network.
- **The watcher opens issues, not pull requests.** Automated PRs are the L4 slice and need the
  candidate-PR gates from ADR-034 decision 5 in place first.
- **Warning before degradation.** Task 2.5 ships visibility, Task 2.6 ships behavior change,
  because degradation can strip advanced controls from users whose CLI silently auto-updated.
- **Additive provenance, not a parallel object.** The pre-release policy in `AGENTS.md` forbids
  compatibility shims; extending the one existing provenance shape and updating its consumers is
  the correct move.

## Testing Strategy

- **Unit Tests**: feed-table completeness across all 16 `ProviderName` values; drift
  classification including `feed_error`; changelog risk tagging; the freshness state matrix
- **Integration Tests**: `GET /diagnostics/providers`, `GET /providers/{provider}/models/advanced`,
  and `GET /setup-state` carry freshness and warnings; entry-only degradation regression once
  Task 2.6 lands
- **Manual Testing**:
  - `npm run watch:providers` against the live feeds; confirm the seven npm-based providers
    resolve and the report flags the stale Claude curated entry
  - trigger the workflow via `workflow_dispatch` and confirm the report artifact and issue body
  - point a runtime at a locally installed CLI whose version is not in the verified table and
    confirm the warning appears on `setup` and `diagnostics`
- Tests must use `createRuntimeTestEnv` / `createRuntimeTestPaths` and must not touch the real
  `~/.cats/runtime`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| A feed silently stops resolving and the watcher reports "no drift" | High | `feed_error` is a first-class state; the workflow fails or reports loudly on any unresolved feed |
| Registry rate limits or transient failures cause noisy issue churn | Medium | Per-feed timeout, daily cadence, update the existing issue instead of opening duplicates |
| Task 2.6 degradation strips advanced controls from working setups | High | Warning-only first; degradation gated on all 16 feeds being declared; regression test for the mismatch path |
| Nine providers may have no machine-readable feed at all | Medium | `kind: 'none'` with a recorded reason keeps the gap explicit and routes those providers to the desktop-agent collector path in ADR-034 decision 8 |
| Refreshing the curated catalog seed data introduces a wrong model id | Medium | Fixture tests plus the normalization tests in `curatedModelCatalogNormalization.test.ts`; treat catalog edits as reviewed content, not mechanical |
| Scope creep into the L2 container matrix | Medium | Explicit non-goal here; L2 requires its own SPEC |

## Progress Log

| Date | Update |
|------|--------|
| 2026-08-17 | Plan created from ADR-034 and the 2026-08-17 research note |

---

*Created: 2026-08-17*
*Author: Claude*
