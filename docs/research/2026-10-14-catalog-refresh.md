# 2026-10-14 catalog refresh of eleven full-catalog CLIs

Date: 2026-10-14 (UTC+8). Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the `cli` scopes of Codex, Claude, Antigravity, Grok, Muse, Copilot (Copilot Pro plan),
Auggie, Pi (`openai-codex` channel), Kiro, Junie and Goose (`chatgpt_codex` channel), at the CLI
versions installed on the operator's Windows 11 machine. The operator also moved Goose from the
shortlist group to the full-catalog group for its `chatgpt_codex` channel.

## Method

1. The read-only [catalog probe](../../skills/maintain-provider-model-catalogs/references/catalog-probe.md)
   ran on the eleven scopes at 01:27 (snapshot `tmp/catalog-probe/20261014-012753`, private).
   Grok, Pi, Junie and Kiro came back clean; Claude, Codex, Antigravity, Muse, Copilot and Auggie
   needed an agent; Goose has no enumeration.
2. The probe rows each edit relies on are committed as `model-list.probe.redacted.json` fixtures.
3. Agent-operated `/model` captures (Windows UI Automation text, no screenshots) ran one CLI at a
   time in dedicated Windows Terminal windows, from 01:36 to 02:14, using the skill's helpers where
   one exists. Every CLI's settings file kept its prelaunch SHA-256 through exit. No prompt was
   submitted and no login ran.
4. Goose's `chatgpt_codex` list and effort menu were read from the v1.54.0 source and the
   installed binary by a research subagent; no Goose session or `goose configure` ran.

## Questions asked and the operator's answers

One grouped question, after the captures:

- Removals: Codex GPT-5.5; Codex GPT-6.1-Sol's model default; Antigravity Gemini 3.7 Flash, Gemini
  3.6 Flash and Gemini 3.1 Pro; Muse's two `-contributor` rows. Answer: apply all four.
- Goose effort menu: Goose's own menu (Off, Low, Medium, High, Max) on every row, or per-model
  levels without Off on gpt-5.5/gpt-5.4. Answer: Goose's menu on every row.
- Clean scopes (Pi, Kiro, Grok): advance `cli_version` with the probe fixture, or leave them.
  Answer: advance them.
- Commit, PR, merge and worktree cleanup: authorized.

## Results by CLI

### Codex 0.162.1

`codex debug models` marks gpt-5.5 `visibility=hide` ("Legacy coding model."), and the picker
lists seven rows without it. The 0.162.1 picker shows no `(default)` marker on any row; 0.159.2
marked GPT-6.1-Sol. Every reasoning and More reasoning menu, label and description of the seven
rows equals the 0.159.2 capture. Removed gpt-5.5 and the GPT-6.1-Sol model default.
Evidence: [picker](./fixtures/codex-0.162.1/picker.agent-capture.redacted.txt),
[probe](./fixtures/codex-0.162.1/model-list.probe.redacted.json).

### Claude Code 2.1.296

13 rows (Default plus 12 models). Haiku 5.5 is new, between Sonnet 5.5 and Haiku 4.5, with Low
to Max and `(default)` Medium. `/status` after `s` on each row: Haiku 5.5 sets `haiku`
(claude-haiku-5-5); Haiku 4.5 sets `claude-haiku-4-5-20251001` and supports no effort. Following
the existing alias rule, the `haiku` entry keeps its ID and execution, is relabelled Haiku 5.5 and
gains the effort control; Haiku 4.5 is a new entry under its full ID with the 200000 context
limit. Every other row matches the catalog. From 2.1.293 the effort line stops at both ends
instead of wrapping, so `Capture-ClaudePicker.ps1` now walks Right to the highest level and Left
to the lowest. Evidence: [picker](./fixtures/claude-2.1.296/model-picker.agent-capture.redacted.txt).

### Antigravity (agy) 1.3.4

Five picker rows: Gemini 3.8 Flash, Claude Opus 5.5 and Claude Sonnet 5.5 (low/medium/high),
GPT-OSS 120B (Medium) (no slider) and Gemini 4 Argon (Medium), which reads `Unavailable · Gemini 4
Argon is currently available to Ultra plan subscribers.` and is not in `agy models`. Gemini 3.7
Flash, Gemini 3.6 Flash and Gemini 3.1 Pro are gone from both. Removed those three; Gemini 4 Argon
is not added (no ID, not in this plan). `Capture-AntigravityPicker.ps1` stopped on the Unavailable
row's footer; it now accepts it and reports the row. Evidence:
[picker](./fixtures/antigravity-1.3.4/model-picker.agent-capture.redacted.txt),
[probe](./fixtures/antigravity-1.3.4/model-list.probe.redacted.json).

### Muse 1.4.7 (muse-bin-1.4.7-R6101.1)

MSP `model/list` and the picker list muse-wonder-1.0 (new, released 2026-10-12), muse-spark-1.3
and muse-spark-1.2; the `-contributor` rows are gone, and the settings file now has a
`contributor_mode_enabled` switch. `/effort` with muse-wonder-1.0 active lists minimal to max with
no default marker. Added muse-wonder-1.0 first and removed the two contributor rows. MSP marks
muse-wonder-1.0 `isDefault`, which is not projected. Evidence:
[picker](./fixtures/muse-1.4.7-R6101.1/model-picker.agent-capture.redacted.txt),
[probe](./fixtures/muse-1.4.7-R6101.1/model-list.probe.redacted.json).

### Copilot 1.0.96 (Copilot Pro)

19 selectable rows. Claude Haiku 5.5 (claude-haiku-5.5) is new under Other models: Low to Max
reasoning, Context 100K/936K. Every row's Context figures changed and now equal models.list
`contextMax`/`longContextMax` (for example GPT-5.6 Terra 400K/1.1M became 272K/922K), so the
Context labels and notes follow. Groups moved and the Unavailable group lists 12 models; the
catalog keeps its 2026-09-27 order and inserts Haiku 5.5 before Haiku 4.5. Reasoning orders,
arrival values and the GPT-5.6 Terra `(default)` marker are unchanged. Evidence:
[picker](./fixtures/copilot-1.0.96/model-picker.agent-capture.redacted.txt),
[probe](./fixtures/copilot-1.0.96/model-list.probe.redacted.json).

### Auggie 0.36.0

37 rows; the only change is Claude Haiku 5.5 (claude-haiku-5-5), sixth. Every other label,
order, cost tier, badge and description equals the catalog, and Claude Opus 5.5 is still the
only `(default)` row. Evidence:
[picker](./fixtures/auggie-0.36.0/model-picker.agent-capture.2026-10-14.redacted.txt),
[probe](./fixtures/auggie-0.36.0/model-list-2026-10-14.probe.redacted.json).

### Grok 1.0.52, Pi 1.2.0, Kiro 2.31.0 and Junie (build 3659.4)

The probe confirmed every entry: Grok 4/4 (IDs only), Pi 8/8 (thinking levels and default),
Kiro 21/21 (IDs, efforts and defaults; labels are raw IDs, so Kiro's minor release needed no
picker capture) and Junie 18/18 (labels from the JAR; the build is unchanged). At the operator's
request `cli_version` advanced for Grok, Pi and Kiro with their probe fixtures; `last_updated`
did not change. Junie keeps its version.

### Goose 1.54.0 `chatgpt_codex` {#goose}

Goose's list for this channel is its built-in `CHATGPT_CODEX_KNOWN_MODELS`: gpt-5.6-sol,
gpt-5.6-terra, gpt-5.6-luna, gpt-5.6, gpt-5.5, gpt-5.4, the same six as the shortlist. There is
no live fetch. The thinking-effort menu is global (Off, Low, Medium, High, Max) with no default.
Goose parses the model suffixes `-none`, `-low`, `-medium`, `-high` and `-xhigh` (Max); there is
no `-max`. The scope is now `selection_mode: full`, labels are the raw IDs, and each row carries a
`goose.thinking_effort` enum; old `— Off` labels stay in `source_names`. Code: the binding now
accepts the five values instead of only `off`, and the adapter maps each to its suffix.
`CATALOG_BINDING_VERSION` stays 1, because Desktop and the patch tool require 1 and the change only
adds values; an older Runtime rejects the new scope at validation instead of misrouting it.
Evidence: [source and binary reading](./fixtures/goose-1.54.0/model-list.source.redacted.txt).
Not verified: the live configure screen and actual requests.

## Validation

- `npm run catalog:generate` and `npm run catalog:check` passed.
- Vitest: `tests/catalog-runtime.test.ts`, `tests/catalog-data.test.ts`,
  `src/core/models/providerModelCatalog.test.ts` (79 passed) and
  `src/http/ui/shared.playground.test.ts` (22 passed), after updating the row-count pins
  (Muse, Auggie, Copilot), Copilot Context labels and the Goose labels, and adding Goose
  channel/suffix and Playground tests.
- `tests/runtime-server.test.ts`, `tests/api-backend.test.ts`, `tests/agent-skill-sync.test.ts`,
  `src/backends/cli/goose` and `src/backends/cli/providers` in one run: 548 passed, 6 failed.
  One failure was real: the Codex advanced-catalog test assumed a model default, so it now starts
  from the first row when none is marked, and it passes. The Goose label pins were updated. The
  other five (four skill-sync suites timing out at 5 s and one API rate-limit test) passed when
  their two files were rerun alone (31 passed).
- `catalog-probe.mjs validate` on the same snapshot reports every one of the eleven scopes clean.
- `npx tsc --noEmit -p tsconfig.json` passed.
- `Test-ClaudePicker.ps1` (12 cases, including non-wrapping effort) and
  `Test-AntigravityPicker.ps1` (4 cases, including a plan-unavailable row) passed.

## Scripts

Kept in the skill, with offline tests:

- `Capture-ClaudePicker.ps1`: walks a non-wrapping effort line to both ends and reports `Shape`
  and `Order`. A later version can rerun it unchanged.
- `Capture-AntigravityPicker.ps1`: accepts and reports plan-unavailable rows. Rerunnable.

Private, not kept:

- `launch.ps1` and `drive.ps1`: a generic terminal launcher and key/text driver around the
  platform `WindowsUi.ps1`. They wrap existing helper calls with this run's paths.
- `agy-capture.ps1`: passes this run's label array to the Antigravity helper, as its reference
  describes.
- `build-fixtures.mjs`: turns this run's private capture files into the redacted fixtures; its
  file names and headers are specific to this run.
- `copilot-refresh.cjs`: rewrites the Copilot notes and Context labels from a capture. It depends
  on this catalog's note wording, so a later refresh should re-check it rather than rerun it.
- `yedit.cjs`, `bump.cjs`, `goose-scope.cjs`, `scope.cjs`: one-off YAML edits and a catalog
  reader for this run.

## Cost

No screenshots were saved or sent; every capture was text. `measure-agent-usage.mjs` on this
Claude Code session (including the Goose research subagent) reported, through 02:40:

- Preparation (probe, orientation, Goose research start): 31 calls, 64 uncached input, 113,488
  cache writes, 2,524,822 cache reads, 19,906 output tokens.
- Capture (six CLIs, the Claude helper fix and its test): 158 calls, 316 uncached input, 250,661
  cache writes, 25,898,867 cache reads, 61,749 output tokens.
- Catalog update and validation, in progress at measurement: 86 calls, 172 uncached input,
  147,704 cache writes, 28,812,867 cache reads, 74,907 output tokens.

The session also carried an earlier, unrelated Kiro task, which is excluded above.
