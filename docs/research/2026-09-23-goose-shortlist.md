# Goose 1.51.0 ChatGPT Codex shortlist

Date: 2026-09-23. Mode: refresh. Interaction policy: confirm uncertainty.
Scope: Goose CLI catalog, fixed Off execution, Playground and Desktop consumers.

## Operator decisions and evidence

The operator supplied the six model IDs below under ChatGPT Codex (OAuth) and
specified Thinking Off for every row. This is the complete selected Cats menu;
it does not enumerate other Goose providers or other possible effort values.

- gpt-5.6-sol
- gpt-5.6-terra
- gpt-5.6-luna
- gpt-5.6
- gpt-5.5
- gpt-5.4

The originally supplied date-shaped value was a session identifier. After an
isolated `goose --version` returned 1.51.0, the operator confirmed that version.
The operator separately authorized six fixed ChatGPT Codex + Off combinations
and the missing execution support. No default was supplied; the first row is UI
initialization, not an upstream default. Keep exact lowercase model names and
append ` — Off` to identify the fixed combination. Custom input retains the
existing `provider/model` contract (for example `vendor/CaseSensitive.Model`).

[Redacted operator evidence](./fixtures/goose-1.51.0/operator.redacted.txt).
The normalized observation preserves provider -> model -> Thinking effort -> Off.
The intake decision assessment classified all proposed changes as ready, without
projection loss. No inferred extra efforts or upstream defaults were adopted.

## Execution evidence and limitations

The installed executable's informational help confirms `--provider` and `--model`;
`run --help` has no separate thinking argument. Version/help initially failed to
create a log under the sandbox. Repeating only those informational commands with
`GOOSE_PATH_ROOT` directed to a temporary directory succeeded. No credentials,
login flow, session creation, or inference were used.

Versioned upstream source resolves the missing transport mapping:

- [model parsing](https://github.com/aaif-goose/goose/blob/v1.51.0/crates/goose-provider-types/src/model.rs):
  the native `-none` model suffix normalizes to the original model name plus
  ThinkingEffort::Off. An explicit value survives inherited effort defaults.
- [configuration materialization](https://github.com/aaif-goose/goose/blob/v1.51.0/crates/goose/src/model_config.rs)
  and [CLI session builder](https://github.com/aaif-goose/goose/blob/v1.51.0/crates/goose-cli/src/session/builder.rs)
  show the suffix path for new/resumed runs. The suffixed argument differs from
  the stored base model, so resumed configuration is reconstructed with Off.
- [ChatGPT Codex backend](https://github.com/aaif-goose/goose/blob/v1.51.0/crates/goose/src/providers/chatgpt_codex.rs):
  the provider ID is `chatgpt_codex`; Off becomes `none` for the first four selected
  models, and `low` for 5.5/5.4. Off describes Goose's setting, not a guarantee of
  no underlying model reasoning. Its other effort levels/default were not imported.
- [isolated environment](https://github.com/aaif-goose/goose/blob/v1.51.0/CONTRIBUTING.md):
  `GOOSE_PATH_ROOT` isolates informational-command logs from user state.

Cats stores provider-qualified base IDs, with Off attached as fixed internal
execution metadata. The adapter adds `-none` only to the six approved combinations,
both for plain-string and structured selections, including resume. Other custom
provider/model strings remain unchanged. No shared environment hook or personal
Goose configuration mutation is needed. Live OAuth inference remains untested.

## Implementation and consumer checks

- Curated YAML keeps the ChatGPT Codex provider hierarchy and fixed Off option.
- Runtime static/curated menus and advanced knowledge use the same six entries.
- Playground and Desktop fallbacks preserve names/order and six-plus-custom input.
- Runtime provider-config metadata still reports the native active provider; it
  cannot add a seventh row or label one of the approved rows as default.
- Tests cover refresh, first selection, saved/custom input, all six new/resume
  spawn mappings, fixed-effort rejection, and the HTTP catalog consumer.
- Exact old-ID and bundled-example searches found the changed Goose fallback and
  HTTP tests. Legacy `openai` alias/parser fixtures and unrelated OpenCode/Kilo
  fixtures remain independent of this selected ChatGPT Codex scope.

## Validation and local override

The operator authorized adding only the Goose block to the personal curated file.
Compare-before-write, all-other-provider equality and exact readback passed; backup:
`curated-model-catalogs.yaml.bak-goose-2026-09-22T21-51-41-004Z`. No Goose native
configuration was changed. The operator subsequently authorized commit, PR,
auto-merge and branch cleanup after merge. Publishing and version bumps remain
outside this change.

Focused local checks (not the full CI suite):

| Command / scope | Result | Elapsed / retained log |
| --- | --- | --- |
| `npm run build:ui` | pass; generated Playground equals source | 6.84s |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | pass | elapsed not captured |
| Vitest: curated loader/normalization, advanced knowledge, catalog service, Goose catalog/adapter/parser, Playground (single-thread) | 114 passed initially; two new test assertions expected private fixed controls in the public catalog | 4.78s; `%TEMP%/cats-goose-catalog/runtime-tests.log` |
| Vitest: `src/core/models/gooseModelCatalog.test.ts` after correcting those assertions to the established fixed-combo contract | 2 passed, including all six new/resume mappings | 3.57s; `runtime-goose-retry.log` under the same temporary directory |
| Vitest: `tests/runtime-server.test.ts -t 'surfaces runtime-owned Goose active config'` | 1 passed; 72 unrelated cases skipped | 22.96s; `runtime-http.log` |
| `git diff --check`, exact old-ID/example consumer search | pass | no unrelated fixtures rewritten |

Runtime total: 117 relevant cases passed across the scoped runs. The test-only
correction did not change product implementation. Desktop's seven affected test
files passed 87 cases; see its companion note. Live authenticated inference was
not performed, so these results establish catalog/selection/argument transport.

## Skill feedback

The canonical skill now routes Goose maintenance to a focused reference covering
version versus session identifiers, isolated informational probes, provider tokens,
native Off transport, internal versus public fixed controls, and active-config
separation. Member and parent Codex/Claude mirrors were synchronized; all 24 source
files match all four mirrors, frontmatter is valid, and 47 local skill links resolve.
The existing environment lacks PyYAML, so the documented Node/YAML and link checks
were reused without installing dependencies.
