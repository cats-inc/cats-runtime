# ADR-040: Use Data-Driven Provider Catalogs and Local Overrides

## Status

Proposed — 2026-09-23. The operator requested this ADR, specification, and plan;
implementation has not started. The data-only soft-patch direction is requested;
the detailed contract below is proposed for review.

## Context

September catalog maintenance required changing the curated YAML, Runtime static
tables, Playground JavaScript, Platform static tables, and sometimes model-specific
execution mappings. A change to YAML alone cannot update every final fallback.
The personal curated loader currently selects an entire document over the bundled
example; an old document can therefore hide unrelated new provider sections.

The operator needs to change one installation's factory fallback without upgrading
Cats. A supported model-list, label, default, or fixed-effort correction should be
deliverable as one local data file. The same correction must reach execution and
the UI, including labels shown when Runtime is unavailable.

Relevant current surfaces are `curatedModelCatalog.ts`, `providerModelCatalog.ts`,
`providerAdvancedKnowledge.ts`, the provider-specific `*ModelCatalog.ts` modules,
Playground's `PROVIDER_MODELS`, and Platform's `providerCatalogData.ts` and label
registry. These are implementation observations, not additional authorities.

## Decision

### 1. Runtime owns one authored catalog pack

Evolve `config/curated-model-catalogs.yaml.example` into the versioned factory pack.
It holds ordered entries, exact IDs and labels, evidenced defaults, option values,
and data needed for approved execution combinations. Generated JSON or bundled
resources may copy this pack deterministically; no second manually maintained
model table is permitted in Runtime, Playground, or Platform.

The factory pack is read as a package resource. Installed product data can override
it without rebuilding that package. Model-name branches and fixed-effort lookup
tables move into catalog data. Provider transport, argument encoding, control-key
support, authentication, and installation knowledge remain executable code.

### 2. A local file replaces complete provider scopes

Reuse `<runtimeRoot>/config/curated-model-catalogs.yaml` as the one local override
file, outside the install directory. YAML is the authoring format; JSON syntax is
accepted by the same parser. JSONL is not a catalog snapshot format.

Always load the factory pack, then replace each explicitly supplied catalog scope
from the override. A scope identifies provider family and backend/transport; Pi's
CLI data must not replace an API target or an unrelated provider. Omitting a scope
inherits the factory scope. Within a replaced scope, model order, removals, controls,
and defaults come entirely from the replacement, avoiding stale row merges.

Removing an override scope restores that scope's current factory data; removing
the file restores the whole factory pack. A valid explicit empty list means no
curated choices, not permission to resurrect hardcoded models. Existing custom
model input remains available under the target's execution contract.

### 3. Resolve and publish one effective catalog revision

Runtime validates the complete candidate before activating it. Menus, advanced
metadata, default selection, and execution bindings use the same immutable
revision. A local reload does not enumerate CLIs, contact vendors, or change
provider selection. Invalid candidates leave the last accepted revision in place
and return a diagnostic. Without any accepted snapshot, report catalog unavailable
instead of silently ignoring a rejected patch.

New selections use the activated revision. Existing sessions retain their recorded
execution binding until an explicit model change. A stale new-selection request
must be reconciled, not silently executed with changed fixed parameters.

### 4. Consumers share data without claiming availability

Playground obtains its models and controls from Runtime; it has no independent
literal list. Platform consumes Runtime responses through its existing server
boundary. Its local host may use a Runtime-owned read-only catalog resolver for
informational/offline labels without starting a server or probing a provider.
Factory resources shipped with Desktop come from the pinned Runtime package.

An offline execution picker retains only previously observed Runtime choices under
Platform SPEC-013. A factory pack or soft patch never grants provider availability,
authentication, or selected-target membership. Remote/browser consumers cannot read
a disconnected machine's latest patch; they retain the last observed revision and
reconcile when that Runtime reconnects. Local overrides never bleed into a remote
Runtime connection.

### 5. Preserve the operator's model policy

Codex, Claude, Antigravity, Grok, and Muse retain full evidenced catalogs/options.
The other eleven maintained CLIs retain at most six selected rows plus custom
input. Exact labels, raw IDs, and subscription-provider routing remain distinct.
Only an explicit default produces ` (default)`; first-item UI initialization and
fixed controls do not manufacture a provider-default claim.

For these managed full/shortlist scopes, live discovery can annotate observations
but cannot overwrite the menu, order, labels, effort, or defaults. Separately
declared discovery-owned/BYO-model scopes keep their existing discovery behavior
and use data-backed factory fallback where applicable.

### 6. Ship maintenance guidance and enforcement with the cutover

Update the canonical `skills/maintain-provider-model-catalogs/` workflow and all
provider references as part of implementation. Teach two entry points: update
factory data for all installations, or prepare/apply a scoped local soft patch.
Both use the same validator/resolver. Remove instructions to edit handwritten
fallback arrays or add model-name branches; generate derivative assets instead.

Synchronize Runtime and workspace `.agents` and `.claude` mirrors from the owned
source. CI must detect regenerated-data drift and model-specific production tables
outside approved data/generated locations. Historical fixtures and evidence remain
valid uses of literal model strings. Skill cutover and a data-only patch regression
are release requirements, not optional follow-up work.

## Consequences

- A model-data correction becomes one authored provider-scope change; a local
  soft patch needs no package version bump or Desktop rebuild.
- Changes to CLI protocols, unsupported control bindings, or a new adapter still
  require software work. A patch cannot supply commands or executable code.
- The initial refactor spans Runtime resolution, adapters, Playground, Platform,
  packaging, and skill guidance; moving only the visible lists is insufficient.
- Existing schema-1 personal snapshots need an explicit, backed-up conversion.
  The execution loader will not retain parallel legacy normalization paths.
- Factory upgrades preserve local overridden scopes; those scopes stay pinned to
  the user's replacement until edited or removed. Diagnostics expose that origin.
- The read-only resolver and revision-aware caches become supported Runtime
  boundaries and need package/consumer contract tests.

## Alternatives Considered

| Alternative | Why not selected |
|---|---|
| Continue synchronizing handwritten tables | Keeps duplicated maintenance and cannot patch all installed fallbacks with one file |
| Generate TypeScript only at build time | Removes authoring duplication but still requires rebuilding for a local correction |
| Edit the installed factory file directly | Upgrades can erase changes; it obscures factory versus local origin |
| Let each UI merge its own overrides | Duplicates semantics and lets menu/execution mappings diverge |
| Remove all offline catalog data | Loses useful labels and retained UI behavior without solving execution-data ownership |
| Keep whole-document personal replacement | An unrelated missing scope continues to hide factory data |

## References

- [SPEC-031: data and override contract](../specs/SPEC-031-provider-catalog-data-and-local-overrides.md)
- [PLAN-040: joint implementation and skill cutover](../plans/PLAN-040-provider-catalog-data-and-local-overrides.md)
- [SPEC-024: original curated input](../specs/SPEC-024-curated-cli-catalog-pack-and-evidence-overlay.md)
- [ADR-029: verified metadata and manual discovery](./029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md)
- [ADR-035: CLI version drift](./035-never-block-provider-execution-on-exact-cli-version.md)
- [ADR-036: canonical maintenance skills](./036-separate-repository-maintenance-skills-from-runtime-delivered-skills.md)
- [ADR-039: selected-provider boundary](./039-use-selected-provider-config-as-the-resource-boundary.md)
- [Platform SPEC-013: selector continuity](../../../cats-platform/docs/specs/SPEC-013-provider-catalog-consumption-and-ui-seam.md)

*Last updated: 2026-09-23*
