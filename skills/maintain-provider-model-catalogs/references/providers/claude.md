# Claude Catalog Evidence

## Supplied picker fast path

Use the operator's complete `/model` paste and per-model effort displays first, including effort
controls shown inside the model picker. Do not request a separate `/effort` capture or launch Claude
when those screens already establish the requested values/defaults. Follow
[paste intake](../paste-intake.md) once and reuse its artifacts and the conversation's decisions.

- Keep picker labels, descriptions, selectable aliases, and defaults separate. A user-requested
  version-bearing Cats label may combine observed description text with the model name; retain the
  original rows and the approved projection in evidence.
- A duplicate Default/model row may be collapsed only when the operator authorizes that projection
  and current normalization proves the selectable alias. Reuse that authorization; do not ask again.
- Record each model's own effort values/default, including explicit unsupported-effort messages.
  Unsupported effort is not a missing capture and must not inherit another model's controls.
- Keep warnings as evidence. Do not invent executable tokens from symbols, display case, or model
  generation names. Check the current normalizer/adapter mapping.

## Reuse existing support

The curated input is `config/curated-model-catalogs.yaml.example`, not `providers.yaml.example`.
Compare the effective local override's Claude block early; it can mask bundled changes. Prepare
local and tracked deltas together, but write the private override only within the operator's
authorization, with a backup and other providers preserved.

Follow the [catalog surfaces](../catalog-surfaces.md) table, starting with:

| Concern | Existing implementation |
|---|---|
| Aliases and effort tokens | `curatedModelCatalogNormalization.ts` and `src/backends/cli/providers/claude.ts` |
| Effort availability/defaults | `providerAdvancedKnowledge.ts`, `providerAdvancedCatalog.ts`, `providerSelectionResolution.ts` under `src/core/models/` |
| Runtime fallback | `src/core/models/providerModelCatalog.ts` |
| Playground fallback/formatting | `src/http/ui/pages/playground.html`, `src/http/ui/shared.ts` |
| Desktop fallback/formatting | `cats-platform/src/shared/providerCatalogData.ts`, `src/design/components/providerModelFieldsSupport.ts` |

Per-entry `controlDefaults` and explicit empty option lists already carry model-specific defaults
and unsupported effort. First check whether the refresh needs only catalog/fallback data. Expand
schema or UI behavior only for a demonstrated gap within authorized scope. Keep current model
versions, aliases, and effort sets in evidence/catalog data rather than copying them into this guide.

## Validate the changed consumers

Use the focused Runtime tests in [catalog surfaces](../catalog-surfaces.md), adding selection and
Playground tests when those paths change. Verify the actual refreshed catalog's labels, model
default, each model's effort options/default, and unsupported controls once through existing
loaders/consumers. Do not recreate equivalent one-off checks after a result already proves them.

If Desktop fallback labels change, its execution-label and audience-participant consumers are part
of the affected scope, even when selector tests pass. Search exact old labels in both repositories
before the full gate, classify independent fixtures, and use the shared Desktop validation commands.

## When more evidence is needed

Claude's authenticated interactive `/model` picker is the account-resolved model source. Capture
only the missing model/effort context; one model's values/default do not establish another's.

The CLI has no stable `models` subcommand in the currently documented repository evidence. Static
strings extracted read-only from the installed native executable can reveal compiled aliases,
descriptions, filters, and option text, but they form a possible superset. They do not prove account
entitlement, picker visibility, raw selectable ids, or defaults. Label them `static-artifact` and let
a current picker paste override them.

Do not infer that `opus`, `sonnet`, or `haiku` aliases identify a visible generation without reading
the relevant normalizer and observed picker label. A compiled default or first row is not an account
default. Avoid platform-specific extraction commands unless the installed artifact and read-only tool
are first identified; retain exact CLI version/platform provenance.
