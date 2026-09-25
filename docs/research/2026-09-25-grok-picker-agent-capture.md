# Grok Build 1.0.41 agent-operated picker capture

## Scope and policy

Refresh, Grok only, confirm-uncertainty policy. The operator asked for a live menu
capture with desktop UI automation, then a pull request. No personal
`curated-model-catalogs.yaml` override was present. The factory Grok scope is the
only catalog edit.

The decision assessment marked five changes ready and allowed the repository edit:
add `grok-4.7`, add `grok-4.7-build-fast`, update the 4.6 and 4.5 effort labels and
descriptions, and advance `last_updated`. No default was proposed. The effort-list
gap check found no missing path.

## Evidence

- CLI: `grok 1.0.41 (4220f3b224a6)`, signed-in session, identity redacted.
- Date: 2026-09-25. Windows interactive session, Windows Terminal, Windows PowerShell 5.1
  UI Automation helper. The capture process cleared inherited `GROK_AGENT` and
  `GROK_SESSION_ID` so the picker was a normal TUI.
- [Picker text](./fixtures/grok-1.0.41/model-picker.agent-capture.redacted.txt)
- [`grok models`](./fixtures/grok-1.0.41/models-command.success.redacted.txt)

The model list wrapped after four rows:

| Picker label | Raw id | Effort labels, in visual order |
|---|---|---|
| Grok 4.7 | `grok-4.7` | Extra High, High, Medium, Low |
| Grok 4.7 Fast | `grok-4.7-build-fast` | Extra High, High, Medium, Low |
| Grok 4.6 | `grok-4.6` | Extra High, High, Medium, Low |
| Grok 4.5 | `grok-4.5` | High, Medium, Low |

Raw ids come from `grok models` and the CLI model cache, matched by the cache's
display name. Effort tokens are the cache values whose labels match the picker:
`xhigh`, `high`, `medium`, `low`. The session status showed `(xhigh)` on the same
row the picker marked `Extra High (active)`.

4.7 and Grok 4.7 Fast use the new descriptions, including the periods and
`Recommended.` on High. 4.6 and 4.5 keep their own period-free wording, including
Higher versus Highest on High. Context 500000 was re-read from the cache for every
row. The cache had no output limit.

## Defaults that were not copied

`(current)` was the new session's model. `config.toml` still said `default = grok-4.6`
and `default_reasoning_effort = xhigh` after the capture. `grok models` printed
`Default model: grok-4.7` and marked `grok-4.7 (default)`, so that command marker no
longer matches the saved model setting. `(active)` matched the session effort, not a
catalog default. The model cache marks `high` as default, and effort menus for the
other models opened with High highlighted, but the picker never shows a default
marker. The 2026-09-17 first-item policy stays: menus start at the first row and no
YAML default is set.

## Capture mechanics and cost

The owned window was a uniquely titled Windows Terminal tab. Enter on a highlighted
model opened its effort list and did not write `config.toml`. Enter was never sent
on an effort row. Escape closed the list, and Ctrl+C cleared the unsent draft.
`/exit` ended the owned Grok process and closed that window. The shared Windows
Terminal process was not killed.

`config.toml` model and effort defaults were unchanged. During the capture the file
also gained `permission_mode = "always-approve"`; that concurrent key was left in
place. `trusted_folders.toml` was unchanged. `slash-mru.json` updated only the
`model` timestamp.

Saved screenshots: 10, each 1129 x 635 window pixels. Nine of those images were
read by the agent (startup, the typed command, the model list, one highlight move,
and the four effort menus). The unchanged Right-arrow capture was kept on disk and
not read as an image. At width x height / 750, each image is about 960 input tokens,
so the nine read images are about 8,600. That is a size heuristic, not a measured
API charge.

The session log records cumulative `totalTokens` on stream updates. It does not
record uncached input, cache writes, cache reads, or output separately.

| Phase | Stream updates | Context size at the end | Growth during the phase |
|---|---:|---:|---:|
| Preparation | 208 | 117,759 | from the first observed 3,211 |
| Capture | 514 | 224,812 | 107,053 |
| Catalog update | 125 | 259,015 | 34,203 |

## Validation

- `npm run catalog:generate` wrote digest `20719e7c584425fa0cba7fb3d1dc679a56a92f7135b4be0cd2f1f44a7faed5a3`.
- `npm run catalog:check` passed, including the code/data boundary check.
- Vitest passed 68 tests across `tests/catalog-data.test.ts`, `tests/catalog-runtime.test.ts`,
  and `src/http/ui/shared.playground.test.ts`. The runtime assertion that still expected
  Grok 4.6's old High description on the first row was updated to the four observed
  descriptions and rerun: 28 tests passed.
- The basic catalog projection in `providerModelCatalog.test.ts` now expects the four
  observed ids and still expects no catalog default.
- Installed Desktop was not part of this data refresh. No release was requested.

Last updated: 2026-09-25.
