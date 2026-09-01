# Catalog Surfaces

Use current repository sources instead of a provider list copied into this skill.

## Build the inventory

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
| Selection resolution | `src/core/models/providerSelectionResolution.ts` | whether curated defaults/options are honored |
| Provider adapter | `src/backends/cli/providers/<provider>.ts` | accepted model/control argv and execution support |

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

If an environment-sensitive suite fails for a pre-existing reason, retain the output and distinguish
that failure from a regression. Do not change unrelated assertions to obtain a green run.
