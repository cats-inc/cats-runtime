# 2026-10-14 Cursor, OpenCode, Kilo, Cline and Devin move to full catalogs

Date: 2026-10-14 (UTC+8). Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the last five shortlists, Cursor (`cli`), OpenCode (`cli`, `opencode-go` channel), Kilo
(`cli`, `kilo` channel), Cline (`cli`, `cline-pass` channel) and Devin (`agent`/`acp_stdio`), at
the CLI versions installed on the operator's Windows 11 machine. After this change every one of
the sixteen CLIs carries a full catalog; no shortlist remains.

## Operator decisions

A read-only spike reported the size and difficulty of each list first. The operator then decided:

- **OpenCode:** the complete channel, models and effort. The operator warned that a model chosen
  before may sit under Recent instead of the OpenCode Go section, to be confirmed.
- **Cline:** the installed static list is accepted as the channel list. A few models with limited
  usage outside the ClinePass quota stay out unless they belong to ClinePass; like Free channels
  elsewhere, they get no channel of their own.
- **Devin:** the fusion family and the legacy `MODEL_*` UIDs stay out. The spike counted "18"
  legacy UIDs; that count wrongly included `adaptive`, an ordinary row the 2026-09-18 shortlist
  already held. The exclusion is the 17 `MODEL_*` UIDs, and Adaptive stays.
- **Kilo:** the 327 rows of the gateway list are the scope, not the picker; write a picker capture
  tool and check whether Recent is exclusive with the gateway section.
- **Cursor:** capture the parameterized models and add controls (the operator counted 44 families
  in the picker).
- After the captures, one grouped question: Devin effort follows the CLI list order (recommended)
  rather than a picker read or an ascending order; commit, PR, merge and cleanup are authorized.

## Evidence and results

### OpenCode 1.19.0 (`opencode-go`), 32 rows

- Rows: `opencode models opencode-go --verbose --pure`, membership complete, 32 active rows.
  Fixture: [opencode-1.19.0](./fixtures/opencode-1.19.0/model-list.probe.redacted.json).
- The installed binary's model dialog (read as text, never executed for this) answers the
  operator's question: without a search, Favorites and Recent rows are filtered out of their
  provider section, so a picker reading must include those sections. The listing command is
  unaffected. The same dialog hides `deprecated` rows and orders a provider section by release
  date (newest first), then title; the catalog uses that order.
- Effort: after a model with variants is chosen, a `Select variant` dialog offers `Default`
  (no variant) and then each variant under its raw name. Each row now has an `opencode.variant`
  control with those values, Default first. The native prompt accepts a top-level `variant`
  (installed 1.19.0 schema), which the adapter now sends; Default sends none.

### Kilo CLI 7.8.8 (`kilo`), 327 rows

- Rows: `kilo models kilo --verbose --pure`, 327 rows.
  Fixture: [kilo-7.8.8](./fixtures/kilo-7.8.8/model-list.probe.redacted.json).
- Picker: the new `Capture-KiloPicker.ps1` walked the `/models` dialog (334 rows: Recent 7,
  Recommended 9, Kilo Gateway 318) with Up and Down only; the model state file kept its SHA-256.
  Fixture, without the Recent rows (selection history):
  [model-picker capture](./fixtures/kilo-7.8.8/model-picker.agent-capture.redacted.json).
- Exclusivity: unlike OpenCode, Kilo keeps Recent rows in the gateway section (4 of the 7 also
  appear there) and removes Recommended rows from it (0 of 9). Recommended plus Kilo Gateway are
  exactly the 327 listed models. The catalog follows that order, Recommended first.
- Two names differed: the picker showed `Google: Gemini 4 Argon (50% off)`, a promotion the 03:57
  list omitted, and the listed Gemma 4 26B A4B name has a trailing space. Labels use the listed
  names, trimmed (the probe now trims too). By the 06:34 probe the list carried the promotion as
  well; the label keeps the name without it, and an acknowledgement pins that observed value so a
  later change reopens it.
- The section order is not OpenCode's release-date order, so the captured order is used as is.
- `/variants` shows `Default` (current), `instant`, `thinking`: the same dialog as OpenCode. Rows
  use the existing `kilo.variant` binding with Default first; the adapter now sends no variant for
  Default. This replaces the fixed `thinking` of the shortlist's Seed 2.1 Turbo and Nano Banana Pro.

### Cline 3.0.71 (`cline-pass`), 14 rows

- Rows: the bundled `@cline/llms` 0.0.93 static `cline-pass` block, read without executing Cline.
  Fixture: [cline-3.0.71](./fixtures/cline-3.0.71/model-list.probe.redacted.json).
- The picker lists the 14 subscribed models, then a `Free` header with "Try with limited usage,
  separate from ClinePass quota." over four `cline-free/*` models. Those are the limited models the
  operator described; they stay out. The picker reads the list from Cline's recommended-models
  service, so the live picker can differ from the static block.
- Effort: the picker ignores `reasoningOptions` and offers every reasoning model the same thinking
  dialog: Off, Low, Medium, High, Extra High, preselecting Medium. Each row has an editable
  `cline.reasoning_effort` control with default `medium`, replacing the fixed Medium. Cline then
  moves a level to the nearest effort the model advertises (for example Medium to High on GLM-5.3).
- `Qwen3.8 Max` keeps its 2026-09-18 approved display name; the upstream name is the raw id.

### Devin 3000.11.3, 54 entries over 47 families

- Rows: one `devin models list --format json` run. 54 families and 838 UIDs; without fusion (575
  UIDs) and the 17 `MODEL_*` UIDs in six all-legacy families, 47 families and 246 UIDs remain.
  Fixture of the kept rows:
  [devin-3000.11.3 full](./fixtures/devin-3000.11.3/model-list.full.probe.redacted.json).
- Every family is the full product of its efforts and its speed form, so one entry per family has
  `Reasoning Effort` and `Speed` (Standard, Fast) controls whose combinations select the exact UID
  through `execution.variants` and the new `devin.effort` and `devin.speed` model-variant
  bindings. Fast is the `fast` suffix on Claude rows and `priority` on GPT rows; both read Fast.
- The 1M and Thinking forms (GLM-5.2, Claude Opus 4.6, Claude Sonnet 4.6) are separate entries
  named as the list names them, because no control label for them is evidenced.
- The JSON has no default or visibility field. By the operator's choice, effort values keep the
  list order and the first is the initial choice without a default claim (Medium for eleven
  families). The Devin picker was not read.

### Cursor 2026.10.01-e373342, 47 entries over 44 families

- `--list-models` prints only 259 legacy slugs. A research subagent reconstructed the 2026-09-17
  approach as `capture-cursor-parameterized-models.mjs`: a process-local preload records the
  decoded `availableModels`, `getUsableModels` and `getDefaultModelForCli` replies that
  `--list-models` already fetches. No installed file, credential or inference was touched.
  Fixture: [parameterized models](./fixtures/cursor-2026.10.01-e373342/parameterized-models.redacted.json).
- The reply has 45 families and 468 variants; the CLI excludes `gemini-2.5-flash`, leaving the 44
  picker families the operator counted.
- Each parameter is a control over the exact `variantStringRepresentation` through new
  `cursor.*` model-variant bindings (context, effort, reasoning, reasoning_effort, thinking, fast).
  Enum values use the picker's display names; thinking and fast are the picker's on/off switches,
  here Off and On. A one-value parameter is fixed and hidden, as in the picker.
- Defaults: the bundle shows the picker preselects, after a draft, the current model and the
  user's saved choice, the family's `isDefaultNonMaxConfig` variant. Those values are the control
  defaults and the entry's starting model.
- Claude Opus 5 (thinking off has no Extra High or Max), GPT-5.5 and GPT-5.4 (1M has no Fast) do
  not list every combination. Each is split on the parameter that leaves both parts complete and
  named like the picker's row summary: `Claude Opus 5 No Thinking`, `Claude Opus 5`, `GPT-5.5 272K`,
  `GPT-5.5 1M` and the same for GPT-5.4. No unlisted combination is offered.
- Max mode is a separate CLI setting (`/max-mode`, `/config`), not a model choice; it is left to
  the CLI configuration.
- During the subagent's last verification run the CLI rewrote its own `~/.cursor/cli-config.json`
  (mtime only; contents not read). The hook never writes it; the script reports
  `integrity.cliConfigMtimeChanged` instead of failing.

## Existing selections

Kept ids keep their old labels in `source_names`. Explicit saved selections of these removed entry
ids no longer resolve and need a new choice; their strings still work as custom models:

- Devin: `grok-4-6-medium` (now `grok-4-6-low`) and `nemotron-3-ultra-high` (now
  `nemotron-3-ultra-none`).
- OpenCode: `opencode-go/hy4-preview` and `opencode-go/qwen3.8-flash` stay; no shortlist id was
  removed. Kilo and Cline kept every shortlist id.
- Cursor kept all six combinations as entry ids, because each matches its family's preselected
  variant.

## Code changes

- Bindings: `opencode.variant`; `devin.effort` and `devin.speed`; six `cursor.*` keys; all
  model-variant except `opencode.variant`. `CATALOG_BINDING_VERSION` stays 1.
- OpenCode and Kilo adapters send the selected variant in the native prompt and send none for
  `default` (`NATIVE_DEFAULT_VARIANT`).
- Catalog probe: an acknowledgement can use `subjectPattern` (a regular expression) instead of
  `subject`. Devin's fusion and `MODEL_*` rows and Cursor's legacy-slug gaps are acknowledged that
  way: `--list-models` prints Auto as `auto` and the Claude 4.x families as `claude-4.6-sonnet` and
  the like, and it omits Claude Haiku 4.5 and both GLM 5.3 families, which the parameterized reply
  lists. Cursor's probe still checks families only; the capture script is the refresh path.
  Kilo's gateway source now counts as complete with labels compared, because the gateway list is
  the scope, and verbose names are trimmed.
- Performance: the factory YAML grew from 191 KB to 536 KB, and one YAML parse from about 0.4 s
  to 1.3 s. One catalog load parsed the same factory up to three times, so `parseCatalogDocument`
  now keeps the last four validated documents and returns copies. Measured on this machine:
  a cold local projection 1.17 s before and 2.2 s after; repeated loads 0.4 to 0.8 s before and
  0.2 s after. Loading the digest-checked generated JSON instead of parsing the YAML would remove
  most of the cold cost; that is a separate design change, not made here.

## Validation

- `npm run catalog:generate`, `npm run catalog:check` and `npm run typecheck` pass.
- A fresh probe at 06:34 after the edits: all five scopes `ok` (Cursor 38/47 confirmed and 9
  entries acknowledged, OpenCode 32/32, Kilo 326/327 with the promotion label acknowledged, Cline
  14/14, Devin 54/54 with 592 rows acknowledged). Kilo's source now counts as complete, because the
  gateway list is the scope.
- Focused Vitest: catalog data and runtime, `src/core/models`, `src/catalogs`, Playground and UI
  helpers, the CLI provider tests, the catalog-related runtime-server tests, and the skill sync
  suite, including the new generator and Cursor capture suites. A new check pins that a full
  curated scope keeps precedence over discovery on refresh, as a shortlist did.
- PowerShell: `Test-KiloPicker.ps1` (4 cases) passes. The skill's catalog-probe suite passes.

## Capture notes and incidents

- Git Bash converted a typed `/models` into a Windows path. The input was cleared with Backspace
  through a one-off guarded raw key script; the committed Kilo tool sends only Up and Down.
- The Devin trust prompt for the private scratch directory was answered Yes by the operator, which
  added that directory to Devin's trusted workspaces; it was left as the operator chose. The Devin
  window was then closed through UI Automation without sending keys; Devin's config kept its hash.
- Kilo's model state and config files kept their pre-capture hashes; Kilo exited through `/exit`.

## Scripts

Kept, with offline tests:

- `scripts/catalog-scope-entries.mjs`: builds a scope's `models:` list from a probe snapshot
  (OpenCode, Kilo, Cline, Devin) or the Cursor capture and splices it into the YAML, keeping
  existing tags and spellings. Reusable for later versions; the picker rules it encodes are
  version-specific and named in its comments. Test: `tests/catalog-scope-entries.node-test.mjs`.
- `scripts/Capture-KiloPicker.ps1`: the Kilo `/models` walk. Test: `tests/Test-KiloPicker.ps1`.
- `scripts/capture-cursor-parameterized-models.mjs` and its preload: the Cursor capture. Module
  ids and RPC names are version-specific and fail closed. Test:
  `tests/capture-cursor-parameterized-models.node-test.mjs`.

Left out as one-off: the Kilo and Devin launch, observe, key and snapshot wrappers around the
platform helper; the raw-key Backspace script; the fixture writers for this run; the Devin and
Cline research parsers (their results are in the fixtures); and the Cursor bundle-reading tools.

## Cost

Claude Code session usage from the decision to the end of the catalog update (subagents included),
measured with `measure-agent-usage.mjs`: 462 calls, 930 uncached input tokens, 1.41 M cache-write
tokens, 116.7 M cache-read tokens and 270 K output tokens. Seven window screenshots were saved
privately (three while setting up Kilo, one per capture run's opened picker); two were sent to the
agent. Everything else was read as text.
