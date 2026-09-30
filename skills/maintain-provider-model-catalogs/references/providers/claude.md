# Claude Catalog Evidence

## Supplied picker fast path

Use the operator's complete `/model` paste and per-model effort displays first, including effort
controls shown inside the model picker. Do not request a separate `/effort` capture or launch Claude
when those screens already establish the requested values/defaults. Follow
[paste intake](../paste-intake.md) once and reuse its artifacts and the conversation's decisions.

- Keep picker labels, descriptions, selectable aliases, and defaults separate. A user-requested
  version-bearing Cats label may combine observed description text with the model name; retain the
  original rows and the approved projection in evidence.
- A duplicate Default/model row may be collapsed only when the operator authorizes that projection
  and retained evidence proves the selectable alias. Reuse that authorization; do not ask again.
- Record each model's own effort values/default, including explicit unsupported-effort messages.
  Unsupported effort is not a missing capture and must not inherit another model's controls.
- Keep warnings as evidence. Do not invent executable tokens from symbols, display case, or model
  generation names. Check the retained data/adapter mapping.
- The picker list can change without a CLI update. On 2026-09-26 the same 2.1.282 build and Max
  account showed five rows, eleven rows, and (operator-reported, on another machine) twelve rows
  at different times. The CLI caches remote feature flags per machine in `~/.claude.json`. Record
  the capture machine and time. Treat a longer or shorter list as a new observation, not as proof
  that a row was added or removed, and let the operator choose which observation the catalog
  follows. On 2026-09-30 the capture machine showed twelve rows on 2.1.285, adding Sonnet 5.5.
- An alias can move to a newer model while an older row keeps its label. On 2.1.285 `sonnet`
  resolved to claude-sonnet-5-5, and the Sonnet 5 row set the full id `claude-sonnet-5`. Re-read
  the value of every alias row on each refresh. Keep the entry id and its execution, so saved
  selections keep executing what they did, and relabel the entry to the row that sets the alias.
  Add the older model as a new entry under its full id.
- `scripts/claude-changelog.mjs --binary <installed version file> --since <catalog cli_version>`
  lists the release notes that the binary embeds. That is static-artifact evidence of what
  changed, such as picker counting, aliases or effort levels. A build embeds notes only up to its
  previous release.


## Agent-operated capture

Use this only when the operator asks the agent to collect the picker. Follow
[interactive capture](../interactive-capture.md) and its Claude helper.

- Launch a dedicated window with `--safe-mode`. Customizations stay off, while OAuth and model
  selection work normally. Do not use `--bare`: it never reads OAuth, so its picker would describe
  API-key access rather than the operator's account.
- When the agent itself runs in Claude Code, clear `CLAUDECODE`, `CLAUDE_PID` and every
  `CLAUDE_CODE_*` variable before the launch. The 2026-09-26 capture inherited
  `CLAUDE_CODE_CHILD_SESSION`, which turned off transcript saving in the capture window.
- A new working folder first asks whether to trust it. Accepting adds a project entry to
  `~/.claude.json`; it does not change `settings.json`.
- Hash the settings file that `/model` writes before launch. The prompt glyph U+276F is followed by
  U+00A0, so match separators with `\s`. Type `/model` and open it only when the prompt holds exactly
  that command.
- The footer reads `Enter to set as default · s to use this session only · Esc to cancel`. Traverse
  with arrow keys only. Escape cancels and prints `Kept model as ...`; exit the CLI with `/exit`.
- A long list scrolls with eight rows visible. Edge rows carry `↑`/`↓` in the highlight column.
  One `… +N models` line counts every row out of view through 2.1.283; from 2.1.284 it counts only
  the rows below the window and disappears at the last row. Read each row while it is highlighted.
- A saved model shows a check mark. Effort is one picker-wide selection that starts at the saved
  effort; a row lacking that level shows another one (for example High instead of xHigh), and a
  Right press there changes the selection for every row. Only an explicit `(default)` suffix,
  reached by cycling with Right, is default evidence. The check mark and the starting level are not.
- The picker does not display row values. After the arrow-only traversal, choose each row with `s`
  in the dedicated window and read `/status`, with `Read-ClaudePickerRowStatus.ps1` on Windows:
  `alias (id)` means the row sets the alias, and a bare id means it sets that id. Confirm the
  settings hash after each row; `s` left it unchanged on 2.1.282 and 2.1.285.
- From 2.1.284 Ultracode is a separate `/effort` toggle rather than an effort level, and no picker
  row cycles it. The 2.1.285 parser still accepts `--effort ultracode` as a legacy alias of
  `xhigh`. List it as an effort value only where a picker row cycles it.
- Unsupported effort shows one line with no `←/→` hint; do not press keys to probe it.
- Verify context aliases through the local `/status` Model line (for example
  `opus[1m] (claude-opus-5-5[1m])`) without submitting a prompt. The startup banner does not show
  `(1M context)` for every 1M alias, and plain aliases may resolve to standard context. A 1M label
  or limit needs an execution token that resolves to the `[1m]` model.
- The picker's Default row is `value: null`, and `--model default` resolves to the account's
  current default. It is not a model id; Cats keeps explicit aliases.

## Schema-2 execution data

Put verified aliases in `execution.model`, approved version-bearing names in `label`, and per-model `claude.reasoning_effort` controls in data. Explicit unsupported effort uses `controls: []`.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
