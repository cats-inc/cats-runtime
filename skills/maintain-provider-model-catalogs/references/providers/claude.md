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


## Agent-operated capture

Use this only when the operator asks the agent to collect the picker. Follow
[interactive capture](../interactive-capture.md) and its Claude helper.

- Launch a dedicated window with `--safe-mode`. Customizations stay off, while OAuth and model
  selection work normally. Do not use `--bare`: it never reads OAuth, so its picker would describe
  API-key access rather than the operator's account.
- Hash the settings file that `/model` writes before launch. The prompt glyph U+276F is followed by
  U+00A0, so match separators with `\s`. Type `/model` and open it only when the prompt holds exactly
  that command.
- The footer reads `Enter to set as default · s to use this session only · Esc to cancel`. Traverse
  with arrow keys only. Escape cancels and prints `Kept model as ...`; exit the CLI with `/exit`.
- A saved model shows a check mark, and a saved effort sets every row's starting effort line. Only
  an explicit `(default)` suffix, reached by cycling with Right, is default evidence. The check
  mark and the starting level are not.
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
