# 2026-10-20 Grok context-window transport

Date: 2026-10-20 (UTC+8). Grok Build 1.0.62 (1474f9cbdd91) on the operator's Windows 11 machine,
signed in. Question: can Cats offer a `grok.context_window` control for the 500K window that
the [2026-10-20 catalog refresh](./2026-10-20-catalog-refresh.md) found? Answer: not on this
version. Only the TUI can choose a window, so the operator stopped the implementation and Cats
keeps the 256000 limit that a plain `--model` session gets.

## Method

Nothing here sent a prompt or used quota.

1. `grok --help`, the bundled user guide (`~/.grok/docs/user-guide`) and a strings search of
   `~/.grok/bin/grok.exe`.
2. One TUI session started with `-m "grok-4.7 500k"` in a dedicated Windows Terminal window;
   `/session-info` read through Windows UI Automation, then `/exit`.
3. Three short `grok agent --no-leader stdio` exchanges from an empty private folder:
   `initialize` and `session/new`, plus `x.ai/commands/list` in the last one. Each reply was read
   with session IDs removed, and stdin was then closed.

## Findings

- `grok --help` lists `-m, --model` and `--reasoning-effort` and no window option. The guide
  documents a window only for the TUI: `/model <name> [window] [effort]` (for example
  `/model Reasoning X 500k high`), the picker's window step and `/context-window <size>`, which
  "lasts for the session".
- `-m "grok-4.7 500k"` printed `Couldn't switch model: Invalid params: "unknown model id"`. The
  session fell back to the saved default grok-4.7, and `/session-info` showed
  `Context: 1816 / 256000 tokens`.
- ACP `session/new` returns two `configOptions`: `model` and `reasoning_effort`
  (`thought_level`). Each model's `_meta` lists `totalContextTokens: 256000` and
  `contextWindows: [256000, 500000]`, which are read-only. `_meta["x.ai/sessionConfig"]` repeats
  the model and effort choices only.
- ACP's `available_commands_update` lists compact, always-approve, context, plugins,
  reload-plugins, session-info, feedback, deep-research, workflow, goal, loop and learn-traces, plus
  user skills. It has no `context-window`. `x.ai/commands/list` answers `Method not found`.
- The binary carries an `x-grok-context-window` request header and a persisted
  `context_window_selection`. No `GROK_CONTEXT_WINDOW`-style variable appears. The project
  `.grok/config.toml` cannot set `model.*` keys, and Cats does not write the user's
  `~/.grok/config.toml`.

So a Cats control would have no transport. Recheck `--help`, the ACP `configOptions` and the ACP
slash commands on a later Grok version before adding one. The
[Grok reference](../../skills/maintain-provider-model-catalogs/references/providers/grok.md)
records the same check.

## Side effects

- `~/.grok/config.toml` and `~/.grok/trusted_folders.toml` kept their SHA-256 through every step.
- The TUI window closed with `/exit`, and no grok process remained.
- Each ACP exchange left one empty session, with no turns, in Grok's session store, three in all.
- The private UI text, which included the account banner, and the probe folder were deleted.

## Scripts

Private, not kept:

- `grok-acp-config.cjs` and `grok-acp-commands.cjs` start `grok agent stdio`, send `initialize`
  and `session/new`, and print the config options, `_meta` or advertised commands. They answer one
  question about one version. If this recurs, a read-only Grok source in the catalog probe would
  be a better home than another script.
- The run reused the private `drive.ps1` from the catalog refresh for the TUI window.

## Cost

`measure-agent-usage.mjs` on this Claude Code session for the investigation, through 01:33:
25 calls, 52 uncached input, 47,838 cache writes, 8,574,639 cache reads, 18,804 output tokens.
