# 2026-10-20 catalog refresh of Codex, Claude, Antigravity, Grok and Muse

Date: 2026-10-20 (UTC+8). Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the `cli` scopes of Codex, Claude, Antigravity (agy), Grok and Muse, at the CLI versions
installed on the operator's Windows 11 machine. The operator's main question was whether Gemini 4
Argon can now be used in agy.

## Method

1. `npm run catalog:logins` for the five CLIs: all signed in (agy, Grok and Muse verified online;
   Codex and Claude by local credentials).
2. The read-only [catalog probe](../../skills/maintain-provider-model-catalogs/references/catalog-probe.md)
   ran at 00:20 (snapshot `tmp/catalog-probe/20261020-002025`, private). Codex 0.163.0 7/7,
   Grok 1.0.62 4/4 and Muse 1.4.10 3/3 were confirmed; agy 1.4.2 needed an agent for three new
   rows; Claude 2.1.303 reported `No embedded changelog literal was found in this binary`.
3. Agent-operated captures (Windows UI Automation text, one private screenshot to check the agy
   text) ran one CLI at a time in dedicated Windows Terminal windows from 00:27 to 00:40, after
   clearing `CLAUDECODE`, `CLAUDE_PID` and `CLAUDE_CODE_*`. No prompt was submitted and no login ran.
4. Grok's model cache and bundled user guide were read from disk; one Grok session ran
   `/session-info` only.
5. The probe rows each edit relies on are committed as `model-list.probe.redacted.json` fixtures.

## Questions asked and the operator's answers

One grouped question, after the captures:

- Gemini 4 Argon is the picker's first row; with no default, Cats initializes agy to its first
  entry. Answer: follow the picker, so Gemini 4 Argon low becomes agy's initial selection.
- Grok's default context window is now 256000, with 500000 selectable in the picker. Answer:
  change the limits to 256000; a context-window control is separate code work.
- Run one quota-using headless prompt on gemini-4-argon-low to prove execution. Answer: no.
- Version handling and Git. The recommended option read "Codex/Muse/Grok advance cli_version (not
  last_updated); Claude/agy advance cli_version and last_updated", then commit, PR, merge and
  clean up. Answer: that option. Codex and Grok then received data edits (gpt-6.1-sol context and
  the Grok limits), and a scope whose data an agent edits on a complete, `listConfirmed` source run
  may advance `last_updated` (catalog probe, step 5). Both therefore advance to 2026-10-20; Muse,
  with no data edit, keeps 2026-10-14. The Codex context change was found after the question and
  applied as same-source drift.

## Results by CLI

### Antigravity (agy) 1.4.2: Gemini 4 Argon

`agy models` lists gemini-4-argon-low, gemini-4-argon-medium and gemini-4-argon-high. The picker,
on the same Google AI Pro sign-in as 1.3.4, shows five rows: Gemini 4 Argon first, then Gemini 3.8
Flash `(current)`, Claude Opus 5.5, Claude Sonnet 5.5 and GPT-OSS 120B (Medium). On 1.3.4 the
Argon row read `Gemini 4 Argon (Medium)` with `Unavailable · Gemini 4 Argon is currently available
to Ultra plan subscribers.` and no `enter Select`. On 1.4.2 it reads `Gemini 4 Argon`, has a
low/medium/high slider and the footer has `enter Select`. No default marker; its slider opened on
medium, which is session or remembered state.

Gemini 4 Argon is added as the first entry, `gemini-4-argon-low`, whose effort selects one of the
three listed IDs. The other four rows and their IDs are unchanged.

So Gemini 4 Argon is listed by the CLI and selectable in its picker on this plan. Whether a prompt
runs on it was not checked: the probe proves "listed", and the operator declined a quota-using
execution check.

The picker opened on the `(current)` row, so the capture pressed Up once before
`Capture-AntigravityPicker.ps1`. Accepting the trust prompt for the new empty working folder added
it to `trustedWorkspaces` in `~/.gemini/antigravity-cli/settings.json`; the file then kept that
hash through traversal and exit. The entry is left for the operator.
Evidence: [picker](./fixtures/antigravity-1.4.2/model-picker.agent-capture.redacted.txt),
[probe](./fixtures/antigravity-1.4.2/model-list.probe.redacted.json).

### Claude Code 2.1.303

From 2.1.300 the binary embeds its release notes as a double-quoted literal, which
`claude-changelog.mjs` did not read, so the probe could not tell whether a capture was needed. The
fixed helper reads 2.1.299 to 2.1.301 from 2.1.303 (2.1.302 and 2.1.303 are embedded nowhere
yet); 2.1.299 mentions `/model` and effort in agent view, which the probe's signal matches, so the
picker was captured.

13 rows (Default plus 12 models) with the same labels, descriptions, effort levels and
`(default)` levels as 2.1.296. `/status` after `s` on rows 2 to 13: Opus 5.5 `opus`
(claude-opus-5-5), Fable 5.1 `fable` (claude-fable-5-1), Sonnet 5.5 `sonnet` (claude-sonnet-5-5),
Haiku 5.5 `haiku` (claude-haiku-5-5), and every other row its full ID. No alias moved. Only
`cli_version`, `last_updated` and a note changed. `~/.claude/settings.json` kept its prelaunch
hash. Evidence: [picker](./fixtures/claude-2.1.303/model-picker.agent-capture.redacted.txt).

### Codex 0.163.0

`codex debug models` lists the same seven picker rows and two hidden rows with the same labels,
efforts and effort defaults, so there was no picker capture. The same source now gives
gpt-6.1-sol `contextWindow` 500000 (272000 on 0.162.1), which the probe does not compare; the
limit follows that source, as the catalog's earlier 272000 did. Evidence:
[probe](./fixtures/codex-0.163.0/model-list.probe.redacted.json).

### Grok 1.0.62

`grok models` lists the same four IDs. The CLI's model cache gives the same names, descriptions,
effort tokens, labels and descriptions as the catalog, so there was no picker traversal. The cache
now has `context_window` 256000 and `context_windows` [256000, 500000] for every row, and the
bundled `/model` help says the picker asks for a window between model and effort. A fresh session
on grok-4.7, with no window saved in `config.toml`, showed `Context: 1816 / 256000 tokens`. Cats
sends only `--model` and `--reasoning-effort`, so the four limits are now 256000. Selecting 500K
from Cats needs a new control and binding, which the operator left for separate work. The other
three rows' 256000 rests on the cache only. Grok's `config.toml` and `trusted_folders.toml` kept
their hashes. Evidence: [context](./fixtures/grok-1.0.62/context-window.agent-capture.redacted.txt),
[probe](./fixtures/grok-1.0.62/model-list.probe.redacted.json).

### Muse 1.4.10 (muse-bin-1.4.10-R6427.1)

MSP `model/list` lists the same three rows, order, effort variants, release dates and limits.
Only `cli_version` and a note changed. Evidence:
[probe](./fixtures/muse-1.4.10-R6427.1/model-list.probe.redacted.json).

### Not in scope

The `antigravity` `api`/`google` discovery scope still lists Gemini 3.7 Flash, Gemini 3.6 Flash,
Gemini 3.1 Pro and the two Claude 4.6 Thinking rows that left the `cli` scope on 2026-10-14. It is
a different scope and was not changed.

## Validation

- `npm run catalog:generate` and `npm run catalog:check` passed.
- `catalog-probe.mjs validate` on a copy of the same snapshot: all five scopes `ok`; agy 5/5.
- Vitest: `tests/catalog-data.test.ts`, `tests/catalog-runtime.test.ts`, `src/core/models` and
  `src/http/ui/shared.playground.test.ts`: 107 tests; the one failure was the Playground pin of
  agy's first entry, now `gemini-4-argon-low`, after which all 22 Playground tests passed.
  `tests/runtime-server.test.ts` filtered to models and catalogs: 31 passed. `tests/agent-skill-sync.test.ts`: 19 passed.
- Node tests `claude-changelog` (5, one new), `catalog-probe` and `normalize-picker-paste`: 52 passed.
- `Test-AntigravityPicker.ps1` passed. `npm run typecheck` passed.

## Scripts

Kept in the skill, with an offline test:

- `claude-changelog.mjs` now reads a double-quoted literal; a new test covers it. A later version
  can rerun it unchanged.

Private, not kept:

- `drive.ps1`: a launcher and key/text/read driver around the platform `WindowsUi.ps1` with this
  run's titles. It repeats helper calls, like the 2026-10-14 `launch.ps1` and `drive.ps1`.
- `agy-capture.ps1`: passes this run's label array to `Capture-AntigravityPicker.ps1`, as its
  reference describes.
- `build-agy-fixture.cjs` and `build-claude-fixture.cjs`: turn this run's private capture files
  into the redacted fixtures; their headers are specific to this run.
- One-off Python and awk edits of the YAML, the Playground test and the references.

## Cost

One private screenshot was saved and inspected (agy row 1); every other read was text.
`measure-agent-usage.mjs` on this Claude Code session, through 00:55:

- Preparation (sign-ins, probe, orientation, Grok cache, changelog diagnosis): 30 calls, 62
  uncached input, 109,312 cache writes, 3,414,770 cache reads, 13,782 output tokens.
- Capture (agy, the changelog fix, Claude, Grok): 56 calls, 112 uncached input, 87,701 cache
  writes, 10,725,514 cache reads, 37,276 output tokens.
- Catalog update and validation, in progress at measurement: 37 calls, 74 uncached input, 55,229
  cache writes, 9,694,792 cache reads, 26,807 output tokens.
