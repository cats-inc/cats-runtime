# GitHub Copilot CLI 1.0.88 full catalog from an agent-operated picker capture

Date: 2026-09-27 (UTC+8). Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the `copilot` / `cli` catalog scope, changed from a six-row fixed-effort shortlist to
`selection_mode: full`, plus the new `copilot.context` and `copilot.auto_tier` bindings.

## Request and decisions

The operator asked GitHub Copilot CLI, running on a Copilot Pro account, to capture its own
`/model` picker through maintain-provider-model-catalogs and desktop-ui-automation and to turn the
catalog into a full list like Claude and Codex. Constraints set by the operator:

- The picker defines membership and order; `models.list` supplies IDs. A picker row without an ID
  is not guessed. Labels are the picker text.
- Rows the Copilot Pro plan cannot use (greyed out, Copilot Pro+ and above) are skipped.
- `default` only where the picker marks one. Effort comes from each model's picker row, not
  `--help`. Without a marked default, start at the first value and send it every time (the Junie
  and Kiro rule).
- `--context default|long_context`, the Auto row's `--auto-tier` and `-fast` model IDs: check each
  on the picker; add a binding only for an axis the picker shows.
- Do not press Enter in the model list or switch the agent's own model. Hash and back up
  `~/.copilot/config.json`. Do not update Copilot, submit inferences, log in or out; BYOK and custom
  providers are out of scope. Screenshots stay out of Git. Windows native only.

Question asked, and the operator's answer (through Copilot's question tool, 08:34 UTC+8):

1. **Gemini IDs.** All four Gemini rows are selectable but absent from `models.list`. Answer:
   `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`. The same prompt
   stated the planned effort, context and Tier handling; the operator did not change it.

Copilot finished the capture but its account then hit the monthly quota (`402 quota_exceeded`)
before it edited the repository. Claude Code continued from the private evidence directory and
Copilot's session events (`~/.copilot/session-state/<session>/events.jsonl`); no further picker
input was sent.

Policy: [SPEC-028](../specs/SPEC-028-provider-model-catalog-maintenance-skill.md) now lists
Copilot in the full-catalog group (2026-09-27 Copilot amendment). The
[2026-09-17 fixed presets](./2026-09-17-copilot-fixed-presets.md) are superseded.

## Capture

- **Environment:** `copilot --version` read GitHub Copilot CLI 1.0.88. Native Windows 11, a
  1129×635 Windows Terminal window titled `Cats catalog copilot 1.0.88`, launched with
  `--no-auto-update --no-custom-instructions --disable-builtin-mcps --no-remote --no-remote-export`
  after clearing `TERM`, `CI`, `NO_COLOR`, pager/git-prompt variables and `COPILOT_*`.
- **Settings:** `~/.copilot/config.json` was `AE8D7E14…` before launch. The first launch in Windows
  Terminal added `askedSetupTerminals` (`CCB9E6B9…`), and the hash then held through every picker
  probe. After the capture the operator selected Gemini 3.8 Flash in the capture window to show its
  session message, which rewrote `recentModelIds`. The file was not restored; that is the
  operator's decision. `~/.copilot/settings.json` (`model: auto`) was not modified.
- **`models.list`:** one bounded headless read returned 16 rows including `auto`, in 8.9 s on a
  rerun with the kept reader; no session or prompt, and the config hash did not change. It omits
  the four Gemini rows and every plan-unavailable row.
- **Picker walk:** a Down-only walk wrapped to Auto after 30 rows: Auto plus 19 selectable models in
  the Recent, Recommended, New and Other groups, then 10 rows under "Unavailable models" whose
  detail pane reads "Your plan doesn't include this model". Shift+Tab re-sorts the same rows by
  vendor or category. Only GPT-5.6 Terra shows `(default)`; Auto's check mark is the session's
  current model.
- **Reasoning:** `←/→` cycled every row with arrows. The ranges are linear (no wrap). Labels map by
  case except Extra High = `xhigh`; Gemini 3.6 and 3.5 add Minimal. Every listed row's
  `supportedReasoningEfforts` equals its picker order. Claude Haiku 4.5 and Kimi K2.7 Code show no
  arrows.
- **Context:** 12 rows show two figures. Tab switches which figure is highlighted, a color change
  only; the unfocused row shows the selected figure as text. On seven rows the long figure doubles
  the detail pane's input credits; Sonnet 5 and the Gemini rows only change the highlight (checked on row
  crops). `--help` gives `--context default|long_context`, "overrides persisted setting".
- **Auto Tier:** the detail pane describes Efficiency, Balance and Intelligence; the value also
  reaches Fast, matching `--auto-tier efficiency|balance|intelligence|fast`. The key graph is
  irregular: Right from Balance alternated Intelligence and Fast, and Left went Efficiency, Fast.
- **`-fast`:** `claude-opus-4.8-fast` is its own row, and it is plan-unavailable.
- **Detail-pane lag:** twice in the walk (MAI-Code-1.1-Flash, Grok 4.5) the pane still showed the
  previous row when the highlight moved. Those rows were read again in a later pass.

Evidence: [transcription](./fixtures/copilot-1.0.88/model-picker.agent-capture.redacted.txt) and
[`models.list` projection](./fixtures/copilot-1.0.88/models-list.redacted.json). Screenshots
stayed in the private evidence directory.

## Catalog delta

The six fixed combinations (`GPT-5.6 Terra — Medium` and five others) became 20 rows in picker
order: `auto`, `grok-4.7`, `gpt-5.6-terra`, `mai-code-1.1-flash`, `claude-sonnet-5`,
`gemini-3.8-flash`, `gpt-6-luna`, `grok-4.6`, `gpt-5.6-luna`, `gpt-5.4`, `gpt-5.4-mini`,
`gpt-5.3-codex`, `gpt-5-mini`, `claude-haiku-4.5`, `gemini-3.7-flash`, `gemini-3.6-flash`,
`gemini-3.5-flash`, `grok-4.5`, `kimi-k3`, `kimi-k2.7-code`.

- `default: true` stays only on GPT-5.6 Terra; its label drops the `(default)` marker.
- 18 rows carry `copilot.reasoning_effort` with only their own picker values; 12 carry
  `copilot.context` (`default`, `long_context`) labeled with the picker figures; Auto carries
  `copilot.auto_tier`. Haiku and Kimi K2.7 Code have `controls: []`. `fixed_controls` is gone.
- Old combination labels remain in `source_names`. `latency_optimized` stays only on the two rows
  that had it. Picker figures, cost tiers and credits are notes, not limits.
- New bindings: `copilot.context` → `--context`, `copilot.auto_tier` → `--auto-tier`
  (`src/catalogs/bindings.ts`, `src/backends/cli/providers/copilot.ts`).

### Behavior change

- Selection starts at each control's first value and always sends it: for example GPT-5.6 Terra now
  starts at `--effort none --context default` (the shortlist sent a fixed `medium`), and Auto sends
  `--auto-tier efficiency` although the CLI arrived at Balance. This overrides Copilot's own saved
  or session values, as for Junie and Kiro.
- Choosing a long context raises credits on seven rows. Cats shows the figures but no prices.
- Pro+ rows are not listed; a Pro+ user can still type their IDs as custom model strings.

## WSL scope

Captured on Windows native only. The `copilot` / `cli` scope is shared with WSL, but a WSL
installation and account can see different models and plans; nothing here establishes equal WSL
entitlement.

## Validation

- `npm run catalog:generate` and `npm run catalog:check` passed.
- `npx vitest run` on `src/backends/cli/providers/copilot.test.ts`, `tests/catalog-runtime.test.ts`,
  `src/http/ui/shared.playground.test.ts` and `tests/catalog-data.test.ts`: 4 files, 113 tests passed.
  The runtime test checks 20 rows, the Terra default, the omitted Pro+ rows, 12 context rows,
  spawned arguments per row and rejection of a context value on a row without one; a data-only
  unknown ID emits `--context` and `--auto-tier`. The Playground test renders each row's first
  values without any "default" label.
- Node suites: `measure-agent-usage.node-test.mjs` 8/8 and `list-copilot-models.node-test.mjs` 7/7.
- `Test-CopilotPicker.ps1` 5/5 under Windows PowerShell 5.1. Its parser also read all 31 real
  capture screens: groups, markers, figures, values and the two lagging panes came out as recorded.
- `list-copilot-models.mjs` against the installed 1.0.88 returned the committed 16-row projection
  unchanged, with the config hash unchanged.

## Cost

- **Images:** Copilot saved 28 PNGs privately: 16 windows at 1129×635 and 12 row crops (260×50,
  240×50, 220×50). It sent 11 to its model: 5 windows (about 956 input tokens each at
  width × height / 750) and 6 row crops (about 15–17 each), about 4,900 tokens in total. Everything
  else was read as UI Automation text.
- **Copilot session** (`grok-4.7` for all 209 assistant messages, plus two auxiliary `gpt-4o-mini`
  calls): Copilot 1.0.88 writes no per-message tokens, and its per-model totals arrive only in
  `session.shutdown` when the session exits. The session was still open when measured, so the
  only recorded totals are its last checkpoint before the quota error: 1,427,675,000,000 nano AIU
  and 2 premium requests. Three context compactions ran; the third failed on the quota error.
  Rerun `measure-agent-usage.mjs copilot <session folder>` after exiting for tokens.
- **Claude Code continuation** (`claude-opus-5-5`), measured with the Claude reader from the
  takeover request:

| Phase | Calls | Uncached input | Cache write | Cache read | Output |
| --- | --- | --- | --- | --- | --- |
| Assessment of Copilot's evidence and session | 30 | 60 | 215,116 | 6,101,443 | 25,460 |
| Catalog, bindings, tests and the Copilot usage reader | 39 | 78 | 93,291 | 11,009,100 | 42,495 |
| Picker capture helper and its tests | 27 | 54 | 71,784 | 10,184,329 | 48,745 |
| Docs and the `models.list` reader (until measured) | 19 | 38 | 42,573 | 8,129,751 | 26,466 |
| **Total, 08:55–09:26 (UTC+8)** | 115 | 230 | 422,764 | 35,424,623 | 143,166 |

The continuation ran in a long existing session, so cache reads dominate: every call re-read the
whole earlier conversation. Commit, PR and cleanup calls are not included.

## Capture tooling

Temporary scripts written for this run, all in the private evidence directory or the session
scratchpad:

| Temporary script | Purpose | Rerunnable? | Kept? |
| --- | --- | --- | --- |
| `list-models.mjs` | Headless `models.list` with connect/ping fallback | Only with its hard-coded loader path and output folder | Generalized as `list-copilot-models.mjs` |
| `Launch-CopilotCaptureWindow.ps1` | Cleans the environment and opens the titled window | On this machine | No. `Start-WindowsUiTerminal` plus the documented launch flags covers it. |
| `Read-CaptureWindow.ps1` | Reads the window text without input | Only with this title | No. One helper call. |
| `Walk-CopilotModelList.ps1` | Down-only walk of the list | Only with this window and hash | Merged into `Capture-CopilotPicker.ps1` |
| `Probe-CopilotAllAxes.ps1`, `Probe-CopilotLeft.ps1`, `Probe-CopilotGrokAxes.ps1`, `Probe-CopilotGrokLeft.ps1` | Left/Right option cycles and restore | No: hard-code Grok 4.7 and this run's arrival values | Merged into `Capture-CopilotPicker.ps1 -CycleOptions` |
| `Probe-CopilotAxes.ps1`, `Probe-CopilotTierGraph.ps1` | Maps the Auto Tier key graph | No: planned key lists for this run | The helper records the graph generically |
| `Probe-CopilotGroups.ps1`, `Probe-CopilotGroupWalk.ps1`, `Probe-CopilotCategoryWalk.ps1` | Shift+Tab group sorts | No: fixed group names and a local Shift+Tab sender | No. Groups only re-sort the same rows; the helper requires the recommended sort. |
| `Probe-CopilotContextVisual.ps1`, `Probe-CopilotContextPixels.ps1` | Row crops before and after Tab | No: named rows and pixel offsets | No. The helper reads the two figures as text instead of pressing Tab. |
| `gen-copilot-scope.mjs` | Splices the 20-row YAML scope | No: holds this version's rows | No. Model rows belong in YAML, not code. |
| `detail-panes.mjs`, `grep-session.mjs`, `dump-conversation.mjs`, `event-shapes.mjs` | Read capture text and Copilot session events during the takeover | Yes, but one-off inspection | No. The usage reader covers the recurring need. |
| `make-parse-real.mjs`, `debug-*.ps1`, `rename-mock-vars.mjs` | Replayed real screens through the helper's parser; debugged the test mock | No | No |

Kept in this PR:

- `scripts/Capture-CopilotPicker.ps1` and `tests/Test-CopilotPicker.ps1`: walk, option cycling,
  lagging-pane and settings guards against a simulated picker.
- `scripts/list-copilot-models.mjs` and `tests/list-copilot-models.node-test.mjs`: the redacted
  `models.list` projection against a fake JSON-RPC CLI (direct, connect and ping paths, errors,
  timeouts, no `COPILOT_*` leak). CI runs it from `tests/agent-skill-sync.test.ts`.
- The Copilot reader in `scripts/measure-agent-usage.mjs`, with a synthetic session test.

## Capture lessons

- **A quota can end the capture agent mid-task.** Copilot's session events kept the operator's
  answers, help text and a compaction summary, which let another agent finish without new picker
  input. Keep private evidence and decisions on disk as the capture goes.
- **The detail pane lags the highlight.** Read it only once it names the highlighted row.
  Plan-unavailable panes are identical, so a stale one looks correct; the helper also requires the
  pane to change when the row changes.
- **PowerShell variables are case-insensitive.** `$left` overwrote the `$LEFT` arrow glyph in the
  first helper draft, and a dot-sourced test mock shared the helper's `$RULE`. Keep simulator
  state and glyph names distinct.
- **Enter in the picker has side effects.** The operator's selection rewrote `recentModelIds`,
  which also feeds the Recent group, so the first rows' order depends on account history.
