# Catalog Surfaces

Use current repository sources instead of a provider list copied into this skill.

## Build the inventory

Use this full inventory for an audit. For a provider-scoped refresh, start at that provider's
reference and catalog section, then follow only its actual consumers and affected identifiers.

Start with repository searches such as:

```text
rg -n "KNOWN_PROVIDERS" src/backends/cli/providers/types.ts src
rg -n "STATIC_PROVIDER_MODELS|loadDynamicModels" src/core/models/providerModelCatalog.ts
rg -n "CURATED_CLI_ALIASES|CURATED_PROVIDER_ALIASES" src/core/models/curatedModelCatalog.ts
rg -n "discover.*Models|model discovery" src/backends src/core/models
```

Read the current values from those results. Do not treat any provider count, current YAML section
count, or list in older docs as authoritative.

For each registered provider, classify the actual path:

- account-resolved dynamic enumeration;
- curated static input;
- runtime static fallback;
- intentionally empty catalog;
- account-configured/BYO-model behavior;
- provider-default sentinel;
- unsupported execution path;
- actionable missing coverage.

Installation knowledge is context only. npm-installed providers can still require catalog work, and
native-installed providers may expose dynamic enumeration.

## Authoritative surfaces

| Surface | Current location | What to verify |
|---|---|---|
| Registered CLI families | `src/backends/cli/providers/types.ts` | `KNOWN_PROVIDERS` and new families |
| Install/auth knowledge | `src/core/provider-install/knowledge.ts` | install channel, executable, auth limits |
| Curated input | `config/curated-model-catalogs.yaml.example` | labels, ids, options, provenance, freshness |
| Typed curated schema/loader | `src/core/models/curatedModelCatalog.ts` | supported YAML fields and warning behavior |
| Curated normalization | `src/core/models/curatedModelCatalogNormalization.ts` | accepted rows, aliases, option mappings, `null` rejection |
| Static fallback and routing | `src/core/models/providerModelCatalog.ts` | `STATIC_PROVIDER_MODELS`, default resolution, dynamic branches |
| Dynamic CLI discovery | `src/backends/cli/**/models.ts` and agent adapters | command, parser, account scope, refresh behavior |
| Advanced controls | `src/core/models/providerAdvancedKnowledge.ts` | controls/presets and verified provenance |
| Public per-model defaults | `src/core/models/providerAdvancedCatalog.ts` | `entries[].controlDefaults` alongside catalog defaults |
| Selection resolution | `src/core/models/providerSelectionResolution.ts` | whether curated defaults/options are honored |
| Provider adapter | `src/backends/cli/providers/<provider>.ts` | accepted model/control argv and execution support |
| Playground | `src/http/ui/shared.ts`, `src/http/ui/pages/playground.html` | labels, per-model defaults, static fallback; generate `public/playground.html` with `npm run build:ui` |
| Desktop consumer | `cats-platform` provider catalog/selector modules | only inspect/change when fallback data or consumer behavior is affected; read that member's instructions first |

Do not assume these paths will stay exhaustive. Use repo-wide search for the provider name, exact
catalog filename, option/control key, and affected ids before editing.

## Exact bundled-example consumers

Search the whole repository for `curated-model-catalogs.yaml.example`, its runtime path resolver, and
exact model/label strings being changed. Distinguish:

- tests that read the bundled example;
- tests with independent inline YAML fixtures;
- generated/package assertions;
- runtime static tables that are intentionally separate.

Do not edit an independent fixture merely to resemble the bundled example. When a test, runtime
output, and curated row disagree, use the conflict procedure in
[evidence and scope](./evidence-and-scope.md).

## Validation by changed surface

At minimum for a curated catalog edit:

```text
npx vitest run src/core/models/curatedModelCatalog.test.ts src/core/models/curatedModelCatalogNormalization.test.ts src/core/models/providerAdvancedKnowledge.test.ts src/core/models/providerModelCatalog.test.ts --pool=threads --poolOptions.threads.singleThread
```

Also:

- load the YAML through the typed loader and require zero unexpected normalization warnings;
- run provider-specific discovery/adapter tests when their surface changed;
- run `npm run typecheck` when TypeScript or tests changed;
- run the wider suite when risk or repository rules require it;
- use `git diff --check` and inspect the final diff/status.

### Schedule validation once per relevant change

- Use focused tests while editing; run required full commit/release gates after the final diff is
  ready. This skill does not waive repository gates or substitute a focused pass for a full pass.
- Serialize heavy Runtime and Desktop builds/full suites on one Windows machine. Independent
  searches can run in parallel; package builds and child-process tests compete for CPU and disk.
- Record command, scope, exit status, elapsed time, and log path. Keep valid results until another
  change affects what they tested; do not repeat a successful suite merely to reassure yourself.
- On failure, retain the assertion output and rerun affected files first to diagnose. A timeout
  under contention is not automatically pre-existing or harmless. A focused retry proves only that
  scope; report the original failure and satisfy any still-required full gate.
- Quiet package/build tests can run synchronous subprocesses for minutes. Check process/log
  progress before interrupting; silence alone is not evidence of a hang. Prefer a reporter that
  emits failure details as they occur.
- If only this skill's Markdown changes, validate frontmatter, links, diff, and discovery sync.
  Do not run product tests solely for prose edits; any later commit remains subject to repo rules.
