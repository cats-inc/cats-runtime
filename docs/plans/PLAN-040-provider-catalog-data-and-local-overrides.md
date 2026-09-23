# PLAN-040: Provider Catalog Data and Local Overrides

## Metadata

| Field | Value |
|---|---|
| Status | Draft — planning requested; implementation not started |
| Owner | Runtime catalog workstream with Platform consumer/packaging workstream |
| Assigned To | Unassigned implementation owner |
| Reviewer | User; independent contract review before cutover |
| Spec | [SPEC-031](../specs/SPEC-031-provider-catalog-data-and-local-overrides.md) |
| Decision | [ADR-040](../decisions/040-use-data-driven-provider-catalogs-and-local-overrides.md) |

## Delivery Outcome

One authored factory catalog and one optional local override replace handwritten
model data across Runtime, Playground, and Desktop. A supported data-only patch
changes a fixed installed version's UI and execution together. Skill guidance,
conversion, packaged resources, and regression enforcement ship with that outcome.

## Current Findings

- The personal loader selects a whole document, hiding missing factory scopes.
- Runtime, Playground, and Platform carry independently maintained literal lists.
- Pi/Goose/Junie and other fixed combinations use model-keyed execution helpers;
  moving only the UI rows would leave execution data hardcoded.
- Normalizers and advanced manifests contain label/ID/default/option knowledge
  that must be inventoried, not assumed to be generic transport behavior.
- Platform SPEC-013 already separates retained observed choices from executable
  authority. A new factory projection cannot undo that contract.
- Existing provider references teach agents how to update the old static tables.
  Those instructions must be removed at cutover, not merely supplemented.

## Sequence and Ownership

Phases 1–3 establish the data/resolver contract. Phase 4 integrates consumers.
Phase 5 updates procedural guidance against working commands. Phase 6 proves the
installed-version use case. Work can be split into reviewable PRs, but do not mark
the feature delivered or publish the soft-patch promise before all phases pass.
Future PR/publication steps require the operator's authorization.

### Phase 1 — Inventory and Freeze the Data Contract (Runtime + Platform)

- [ ] Derive all registered provider/backend/transport families from current code.
  Classify full, shortlist, discovery-owned, empty, BYO-model, and sentinel scopes.
- [ ] Inventory catalog literals, normalization branches, advanced manifests,
  fixed-combination helpers, config defaults, label consumers, and package assets.
  Include Chat/Code/Work drafts, execution chips, audience labels, and native/WSL
  target variants; historical test fixtures are not replacement candidates.
- [ ] Finalize schema 2 using lossless projections of all current evidenced models,
  option inheritance, defaults, fixed controls, and Antigravity execution variants.
  Preserve opaque Cursor strings, Devin ACP UIDs, subscription routes, and
  Claude alias/display separation without model-name inference.
- [ ] Define the supported binding registry and generic adapter serializers.
  Distinguish unsupported protocol work from adding another ID/value through an
  existing binding; record genuine gaps before implementation.
- [ ] Freeze package exports, catalog revision, reload/error contract, snapshot
  compatibility, and session-binding persistence fields with Platform consumers.
- [ ] Review ADR/spec and replace illustrative details with the agreed schema.

**Exit:** mapping coverage is complete and reviewable; no provider loses current
capability/default/custom-input behavior; implementation authorization is recorded.

### Phase 2 — Factory Pack, Overrides, and Validation (Runtime)

- [ ] Evolve the single factory YAML and add typed schema validation, deterministic
  JSON projection, source digest, and a generator/check command.
- [ ] Load factory plus scoped local replacements through one injected resolver.
  Honor Runtime root/config-path resolution; validate duplicates, empty semantics,
  options/defaults, explicit variants, and supported bindings before activation.
- [ ] Add explicit schema-1 conversion/preview tooling. Preserve all source scopes,
  provenance and labels; report unresolved mappings. Check the selected installed
  Runtime's capability before apply; unsupported/unknown installs stay unchanged.
  No implicit home-file writes or promises to alter old loader behavior.
- [ ] Implement immutable snapshots, compatible last-accepted persistence, status
  diagnostics, and authenticated revision-checked local reload without CLI probes.
- [ ] Add the side-effect-free package export for local host reads, with explicit
  paths and shared validation/failure semantics. Distinguish informational candidate
  data from activated Runtime data; only Runtime activation writes accepted snapshots.
- [ ] Cover AC-03 through AC-06 and AC-12 in temp-root tests, including wrong target
  scope, patch deletion, new factory data, and read-only installation directories.

**Exit:** a local data file replaces a scope without hiding unrelated factory data;
no candidate is partially activated and no read writes personal configuration.

### Phase 3 — Menus and Execution Share the Revision (Runtime)

- [ ] Refactor basic/advanced catalog construction and normalizers to consume the
  effective pack. Remove static model arrays and model-keyed defaults/effort helpers.
- [ ] Make curated full/shortlist membership authoritative while retaining the
  separate discovery behavior for discovery-owned/BYO scopes. Refresh is explicit
  and cannot reintroduce removed models or unwanted option defaults.
- [ ] Resolve known raw-string and structured selections through the same mapping;
  unknown custom strings keep their existing unadorned transport semantics.
- [ ] Snapshot resolved bindings in sessions; preserve them on resume. Reconcile
  stale new requests before launch and use the new revision only on explicit change.
  For discovered/pre-cutover sessions without a full binding, preserve native or
  recorded wire values; require an explicit first selection when the adapter cannot
  resume without missing data. Never infer prior effort from the current patch.
- [ ] Replace Playground handwritten arrays with served projections. Cover initial
  selected values, model switches, empty data, fixed combos, and custom restoration;
  regenerate public assets from their source as required by the repo.
- [ ] Cover AC-02 and AC-07 through AC-09 with fake CLI/ACP transports. Assert actual
  model/provider/control arguments, not only rendered labels.
- [ ] Migrate discovery/bootstrap fixtures to explicit isolated catalog input so
  shortlist bypasses cannot leave tests awaiting a discovery runner indefinitely.

**Exit:** changing a data fixture changes UI and emitted execution bindings with
zero provider-specific production edits; existing sessions remain stable.

### Phase 4 — Platform/Desktop and Packaging (Platform + Runtime)

- [ ] Remove Platform's authored model/default tables. Route initial drafts, labels,
  chips, audience participants, and selectors through scoped effective projections.
- [ ] Keep execution pickers Runtime-backed under Platform SPEC-013; cold factory
  data does not fabricate usable targets. Retain automatic recovery and selection/
  authorization resets across tray idle and transport failures.
- [ ] Consume the Runtime read-only module for local offline informational labels.
  Use the configured local Runtime paths; do not import startup or duplicate merge
  logic. Remote connections use only their remote observed data.
- [ ] Key caches/label maps by connection, authorization context, target, selection,
  and catalog revision. Remove stale rows on replacement and reject late responses
  with request/activation fences, not content-hash ordering. Test mixed base/advanced
  revisions explicitly: retain a coherent old snapshot or withhold mismatched
  advanced selections while revalidating.
- [ ] Package the factory resource and resolver from the same pinned Runtime build.
  Verify npm/Desktop assets and digests; retain patches across updates/relocation.
- [ ] Cover AC-09 through AC-11 with mounted selector tests, isolated host/package
  fixtures, and native checks on each available OS; record remaining OS limits.

**Exit:** no independently editable Platform catalog remains; online/offline label
behavior and actual picker availability obey their respective contracts.

### Phase 5 — Maintenance Skill Cutover and Enforcement (Runtime)

The owner is `cats-runtime/skills/maintain-provider-model-catalogs/`. Never edit
`cats-inc/.agents`, Runtime `.agents`, or `.claude` mirrors as source. Consult the
skill-authoring instructions when implementing this work package.

| Source | Required update |
|---|---|
| `SKILL.md` | Route factory maintenance versus local soft patch; state the installed capability/schema requirement and data-only completion gate |
| `references/catalog-surfaces.md` | Replace handwritten-fallback edit matrix with factory source, resolver, generated consumers, revision/cache and package checks |
| `references/evidence-and-scope.md` | Replace whole-document precedence advice with full-scope replacements, local authorization, backup/digest checks, reload and rollback |
| `references/paste-intake.md` and intake tooling | Project exact IDs/labels/options into schema 2; assess unsupported bindings without inventing mapping code |
| `references/providers/*.md` | Remove instructions to update static arrays/fixed helpers; preserve evidence capture and provider-specific transport facts, point to data fields |
| Runtime setup/deployment/API/architecture docs | Document installed-version patch workflow, rejection diagnostics, conversion, package boundaries, and remote/offline limits |
| Platform integration/selector/package docs | Document effective data, cache scope, local informational reads, and unchanged execution authority |

- [ ] Teach patch delivery as a small scope replacement plus required schema,
  evidence, validation, apply/reload, and remove/restore instructions. No release
  or rebuild is required for data within the installed binding capability.
- [ ] Distinguish factory canonical edits from generated assets: agents run the
  generator/check instead of editing TS/JS/HTML lists or matching model names.
- [ ] Add a guard that rejects handwritten production model/default/effort tables
  outside approved data/generated paths. Cover AST/table patterns and generator
  imports; allow explicit historical fixtures/evidence and generic protocol code.
  Do not equate any occurrence of `gpt-` in a test with a production hardcode.
- [ ] Add deterministic-generation checks and an unknown-ID data-only regression
  so the guard cannot pass while execution still depends on a model allowlist.
- [ ] Update skill regression fixtures and references that mention old paths/schema.
  Record actual working commands; no proposed command may be presented as available.
- [ ] Sync Runtime `.agents` and `.claude` using `Sync-AgentSkills.ps1`, then the
  parent workspace using `cats-one/scripts/windows/Sync-WorkspaceSkills.ps1` (or
  the owning OS equivalent). Run workspace `-Check` and compare both agent copies.
- [ ] Exercise factory refresh and local patch instructions with isolated files;
  have an independent fresh agent review the workflow and changed-file set. Verify
  no code literals were added and no account/probe/personal-state access occurred.

**Exit:** AC-13/14 pass; future agents discover the new procedure in both mirrors;
old hardcode-edit instructions are gone. This phase ships with the code cutover.

### Phase 6 — Installed-Version Acceptance and Documentation (Joint)

- [ ] Build/stage a candidate once into a temporary installation/profile. Record
  software versions and artifact hashes, then keep them fixed for the experiment.
- [ ] Apply a scoped data patch, reload, and compare effective API data, Playground,
  Desktop labels/menus, revision, and fake-transport invocation. Repeat with an ID
  absent from production code. No rebuild is allowed between baseline and patch.
- [ ] Check empty/removal/rollback, invalid candidate, stale requests, existing
  session resume, local offline labels, disconnected remote views, and reconnect.
- [ ] Verify a later factory package upgrade preserves local replacements while
  unpatched scopes update; explicitly remove the override to adopt new factory data.
- [ ] Record AC-01 through AC-14 results, real commands, timings, platform coverage,
  generated-resource digests, and any remaining limitations in the durable plan.
- [ ] Update affected indexes, superseded schema/static-table guidance, and statuses
  only after implementation evidence supports them. Complete required PR CI when
  PR work is authorized; publication/version bumps are separate instructions.

## Validation Strategy

For this planning change: review document consistency, references, and `git diff
--check`; do not run application builds/tests. For implementation: resolver/schema
tests, focused catalog/selection/adapter/HTTP/bootstrap suites, Playground generated
assets, Platform selector/label/cache/host tests, package contracts, and TypeScript
checks cover the changed surfaces. Reuse passing checks and serialize heavy builds;
required full CI remains the merge gate. All fixtures use temporary Runtime and
Platform roots, never the user's live home or persisted conversations.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Data-only claim hides model-keyed execution code | Inventory and unknown-ID invocation regression before cutover |
| Local full snapshots pin old providers indefinitely | Explicit conversion retains intent; origin diagnostics and per-scope removal restore factory |
| Offline factory choices appear executable | Separate informational reads from SPEC-013 observed-choice continuity |
| Changed effort affects a resumed session | Persist resolved bindings and revision; explicit change required |
| Old skill instructs agents to restore arrays | Same-delivery skill rewrite, mirror checks, fresh-agent exercise, and CI guard |
| Partial repo/package rollout disagrees | Shared versioned Runtime contract and pinned-resource package tests; no compatibility shim to old arrays |

## Progress Log

| Date | Update |
|---|---|
| 2026-09-23 | ADR/spec/plan drafted from current source and operator requirements. Implementation, active skill rewrite, and personal configuration changes remain pending. |
| 2026-09-23 | Independent document review resolved mixed catalog revisions, snapshot/config identity and offline candidate authority, unbound resumed sessions, and old-installation capability checks. Bounded reread found no remaining material issues. |
| 2026-09-23 | Documentation checks passed: 35 new/added local links across 11 changed documents, heading targets, new-file whitespace, and both repos' `git diff --check`. Illustrative YAML syntax was checked. No application builds/tests or installed-version acceptance were run for this documentation-only change. |

*Last updated: 2026-09-23*
