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

Search each affected repository for `curated-model-catalogs.yaml.example`, its runtime path resolver,
and exact old model/label strings before running expensive gates. Use `rg -n -F 'old label' src tests`
from each owning checkout; do not limit the search to selector test names. Distinguish:

- tests that read the bundled example;
- tests with independent inline YAML fixtures;
- generated/package assertions;
- runtime static tables that are intentionally separate.

Desktop labels also reach execution chips and audience participants through shared fallback data.
When that fallback changes, inspect `tests/execution-label.test.js` and
`tests/audience-participant-builder.test.tsx` alongside selector tests. Classify each exact-string
match by its data source; leave deliberately supplied historical/inline labels unchanged.

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

- When PR/release work is authorized, inspect the intended base and integrate required upstream
  changes before the final local gate. Record the tree tested and expand package scripts once to
  see which commands already include typecheck/build/test; avoid stacking duplicate phases.
- Follow the owning repository's Local Validation Scope for the final diff too. Commit/PR creation
  alone does not require a full local suite. Reuse passing checks with unchanged inputs; full local
  runs need the reasons defined by that policy. Required full CI/release gates still apply, and a
  focused local pass must be reported as focused.
- Serialize heavy Runtime and Desktop builds/full suites on one Windows machine. Independent
  searches can run in parallel; package builds and child-process tests compete for CPU and disk.
- Record command, scope, exit status, elapsed time, and log path. Keep valid results until another
  change affects what they tested; do not repeat a successful suite merely to reassure yourself.
  Inspect `npm pack --json` before parsing it: npm versions can return an array or a package-keyed
  object. Reuse saved output if only the inspection failed; do not repeat a successful pack/build.
- On failure, retain the assertion output and rerun affected files first to diagnose. A timeout
  under contention is not automatically pre-existing or harmless. A focused retry proves only that
  scope; report the original failure and satisfy any still-required full gate.
- Quiet package/build tests can run synchronous subprocesses for minutes. Check process/log
  progress before interrupting; silence alone is not evidence of a hang. Prefer a reporter that
  emits failure details as they occur.
- If only this skill's Markdown changes, validate frontmatter, links, diff, and discovery sync.
  Do not run product tests solely for prose edits or the later commit/PR step.

### Desktop iteration, only when its consumers change

Read the member's instructions and verify these paths/scripts still exist. Build server output
once for JavaScript consumers (`npm run build:server`); use `npm run build:test-ui` for TSX consumers.
Use the official JSX/DOM bundle, not `tsx --test`. Choose affected files from these examples:

```text
node --test tests/provider-selection.test.js tests/execution-label.test.js
node --test --test-isolation=none build/test/provider-model-fields.test.js build/test/provider-model-defaults.test.js build/test/provider-model-fields-label-persist.test.js build/test/audience-participant-builder.test.js
```

Mounted selector tests must wait for catalog loading and initial target reconciliation before
changing model/effort. Wait for the observable target/control state, not an arbitrary delay; an
early change can be overwritten by initialization and produce a misleading default-selection failure.

Use `--test-reporter=tap` when running a required full Node suite. Package-contract tests can clear
`build/test`; rebuild that bundle before a later test run if needed. A test-only correction does not
invalidate unchanged server/host builds, but any required full test gate still needs to pass.

### Authorized PR/release follow-through

Use the owning release guides and current workflow definitions; a catalog refresh alone does not
authorize publication. Keep only real dependencies on the critical path:

- Submit each ready repository's PR without waiting for the other's local tests. Remote CI can
  overlap local work; serialize only heavy builds that compete on the same machine.
- Observe actual merge completion when merge/cleanup is requested. Verify release source commits
  and pass the intended Runtime commit to Desktop packaging. Start independent authorized npm and
  preview workflows together; do not wait for registry visibility when packaging uses Git source.
- Track workflow ids and phase transitions. Report useful progress without treating repeated
  unchanged polls as new findings. When explaining elapsed time, distinguish local checks, remote
  jobs, registry propagation, and agent overhead; do not sum overlapping jobs as wall time.
- After a successful npm publish, verify the exact version, Git commit, and requested dist-tag.
  Temporary E404/stale tags can be registry propagation: retry reads with bounded backoff while
  doing independent work, never blindly republish a successful version. If visibility stays
  unresolved, report that limitation separately from workflow success.
