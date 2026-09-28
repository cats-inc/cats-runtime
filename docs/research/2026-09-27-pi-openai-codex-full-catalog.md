# Pi 0.87.1 full openai-codex channel

Date: 2026-09-27 (UTC+8). Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the `pi` / `cli` catalog scope, changed from a six-row fixed-medium shortlist to
`selection_mode: full` for the `openai-codex` (ChatGPT subscription) channel only.

## Request and decisions

The operator asked for Pi's `openai-codex` channel to be expanded into its full model list, done
by Claude Code directly rather than by another agent CLI operating its own picker. Expanding every
Pi provider, and the full expansion of the Cursor, Devin, Kilo, Cline, Goose and OpenCode
shortlists, is deferred.

Question asked, and the operator's answer:

1. **`gpt-5.3-codex-spark`.** Pi lists it for the channel, but the same ChatGPT account's Codex CLI
   0.156.1 catalog (2026-09-24) did not offer it, not even as a hidden entry. Answer: include it.
   The Codex list alone could not tell a plan limit from Pi's build-time list being out of date.
   Superseded on 2026-09-29; see [Later change](#later-change-2026-09-29).

Policy: [SPEC-028](../specs/SPEC-028-provider-model-catalog-maintenance-skill.md) now lists Pi's
`openai-codex` channel in the full-catalog group (2026-09-27 Pi amendment). The
[2026-09-23 shortlist](./2026-09-23-pi-shortlist.md) is superseded.

## Evidence

Everything came from the installed `@earendil-works/pi-coding-agent` 0.87.1 and its nested
`@earendil-works/pi-ai` 0.87.1. Pi was not launched and `auth.json` was not read; of the local
state, only the model store and the model fields of `~/.pi/agent/settings.json` were inspected.
`pi --list-models` was avoided because it queues an availability refresh. That settings file's
own scoped-model list (`enabledModels`) still names the six earlier rows; it is Pi's
configuration and was left unchanged.

- **Rows:** `models.generated.js` lists 8 `openai-codex` models. The local model store
  (`~/.pi/agent/models-store.json`, checked 2026-09-22) holds the same 8 ids in the same order. The
  provider is Pi's "OpenAI (ChatGPT Plus/Pro)" OAuth subscription, and its list is Pi's build-time
  catalog, not a per-account list.
- **Labels and order:** `model-selector.js` draws each row as `<id> [<provider>]` and sorts the
  current model, then a configured default model, first; otherwise registry order stays. Its
  ` · default` badge appears only for a user-configured `defaultModel`. This machine's is `gpt-5.4`,
  which is not in the channel, so no row is a default.
- **Thinking levels:** `getSupportedThinkingLevels` (pi-ai `models.js`) keeps
  `off, minimal, low, medium, high, xhigh, max` minus any level whose `thinkingLevelMap` entry is
  `null`, and keeps `xhigh`/`max` only with an explicit entry. Computed with Pi's own function:

| Model | Thinking levels | Context / max output |
| --- | --- | --- |
| `gpt-5.3-codex-spark` | off, minimal, low, medium, high, xhigh | 128K / 128K, text only |
| `gpt-5.5` | off, minimal, low, medium, high, xhigh | 272K / 128K |
| `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra` | off … max | 272K / 128K |
| `gpt-6-astra` | minimal … max (no off) | 272K / 128K |
| `gpt-6-luna`, `gpt-6-sol` | off … max | 272K / 128K |

  Every row maps `minimal` to the `low` reasoning effort on the wire; the level stays because
  Pi offers it.
- **Thinking default:** `thinking-selector.js` appends ` · default` to the default level, which is
  `settings.defaultThinkingLevel` or the built-in `DEFAULT_THINKING_LEVEL = "medium"`
  (`dist/core/defaults.js`). This machine's setting is also `medium`. By the operator's rule a
  default is set only where the picker marks one, so every row's control defaults to `medium`.
- **Labels and descriptions:** the thinking selector shows Pi's lowercase tokens with descriptions
  such as "Moderate reasoning (~8k tokens)"; the catalog reuses both.
- **Execution:** `dist/cli/args.js` accepts `--thinking` with all seven tokens, and `dist/main.js`
  gives the parsed flag precedence over saved defaults, as the 2026-09-23 note recorded.

Evidence: [channel extraction](./fixtures/pi-0.87.1/openai-codex-models.redacted.json), with the
SHA-256 of each file read.

## Catalog delta

The six `<id> [openai-codex] — medium` rows became 8 rows in registry order:
`gpt-5.3-codex-spark`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra`,
`gpt-6-luna`, `gpt-6-sol`, each with id `openai-codex/<id>`, label `<id> [openai-codex]`,
`execution.provider: openai-codex` and its registry context/max-output limits.

- `fixed_controls` is replaced by a per-row `pi.thinking` enum with only that row's levels and
  `default: medium`. No row is a model default; the UI starts at the first row.
- Old labels remain in `source_names`. No binding or adapter code changed: the Pi adapter already
  sends `--provider`, `--model` and `--thinking` from the resolved controls.

### Behavior change

- Existing selections keep sending `--thinking medium` unless the user picks another level.
- The first row is now `gpt-5.3-codex-spark`, so a new Pi selection without a saved choice starts
  there instead of `gpt-5.6-luna`.
- Other Pi providers remain reachable as custom `provider/model` strings without thinking metadata.

## Validation

- `npm run catalog:generate` and `npm run catalog:check` passed.
- `npx vitest run` on `tests/catalog-runtime.test.ts`, `tests/catalog-data.test.ts`,
  `src/http/ui/shared.playground.test.ts`, the Pi adapter, model, parser and resume tests,
  `tests/api-backend.test.ts`, `tests/agent-skill-sync.test.ts` and
  `src/core/models/providerModelCatalog.test.ts`: 10 files, 177 tests passed on two consecutive
  runs. One earlier run of the same set reported two failed files; its output was not kept, so the
  cause is unknown. `npm run typecheck` passed.
- The first PR preflight failed two `tests/runtime-server.test.ts` cases that still expected the six
  bundled shortlist rows (the old-label search had missed them). They now expect the eight-row
  channel, and the file's 73 tests pass. New checks cover the 8 ids and labels, no model default,
  spawned arguments with the `medium` default and explicit levels, and rejection of `off` on
  `gpt-6-astra` and `max` on `gpt-5.5`; the Playground renders each row's levels with `medium`
  selected and keeps a custom `provider/model` string.
- The Playground option regex in the Copilot test missed unselected options (they render as
  `<option value="x" >`). It is fixed, so that test's "no default label" check now covers every
  option.
- `extract-pi-models.node-test.mjs` passed 4/4, and CI runs it from `tests/agent-skill-sync.test.ts`.

## Later change (2026-09-29)

A Cats turn on the installed 0.5.6 Desktop that selected `gpt-5.3-codex-spark` failed with
`The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.`
([fixture](./fixtures/pi-0.87.1/spark-rejection.redacted.txt)). The ChatGPT backend rejects it for
ChatGPT-account Codex use, so the row is removed and the catalog carries the 7 remaining models;
`gpt-5.5` is kept because the same account's Codex server list offers it. Pi's build-time list and
its refreshed local store (2026-09-27) both still include Spark, so Pi has not caught up; the row
stays reachable as a custom `openai-codex/gpt-5.3-codex-spark` string. The first row, and a new
selection without a saved choice, is now `gpt-5.5`.

## Scripts

| Temporary script | Purpose | Rerunnable? | Kept? |
| --- | --- | --- | --- |
| Ad hoc `node -e` reads of `models.generated.js`, `models.js`, the model store and the selectors | Found the channel, levels, labels and defaults | Partly | Generalized as `extract-pi-models.mjs` |
| `gen-pi-scope.mjs` | Spliced the 8-row YAML scope from the installed registry | No: holds this version's notes and old-label list | No. Model rows belong in YAML, not code. |

Kept in this PR: `scripts/extract-pi-models.mjs` and `tests/extract-pi-models.node-test.mjs`, which
read one provider channel from an installed Pi package with Pi's own level rule, compare the local
store by id and never read account files.
