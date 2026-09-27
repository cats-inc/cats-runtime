# Copilot Catalog Refresh

Copilot is a full-catalog provider: the interactive `/model` picker defines membership and order for
the account's plan. Current rows, IDs and capture details belong in
`docs/research/2026-09-27-copilot-picker-full-catalog.md` and its fixtures in cats-runtime, not in
this skill. Inspect the personal override's version/count early; it can hide bundled updates.

## Read the picker

Follow [interactive capture](../interactive-capture.md) and its Copilot helper when the operator asks
the agent to collect the picker; follow [picker intake](../paste-intake.md) for supplied text.

- Capture on the default `group: recommended` sort; `shift+tab` only re-sorts the same rows. Rows
  fall under Recent, Recommended, New and Other models. The Recent group follows the account's
  recently used models, so a later capture can reorder the first rows without an upstream change.
- Only an explicit `(default)` suffix is a model default. The check mark after a label marks the
  session's current model, not a default.
- A row whose Context column shows two figures has a Tab context toggle: the first figure is
  `--context default`, the second `--context long_context`. The highlighted figure is only a color
  change, but an unfocused row shows its selected figure as text. A dash means no context control.
- `←/→` cycles the row's Reasoning values in a linear range; the ends do not wrap. Labels map to
  CLI tokens by case, except Extra High = `xhigh`. No Reasoning value carries a default marker. A
  dash with no arrows means the row has no reasoning control.
- The Auto row's arrows set the routing profile (Tier). Its key graph is irregular (1.0.88: Right
  from Balance alternated Intelligence and Fast), so record the observed sequences and take the
  value order from the detail pane and `--help`.
- Rows under "Unavailable models" show "Your plan doesn't include this model" in the detail pane.
  Omit them when the operator scopes the catalog to their plan, and list them in notes.
- The detail pane (cost tier and credits per 1M tokens) can lag the highlight by a render; read it
  only once it names the highlighted row.
- Picker changes apply to the session only. Never press Enter in the list: it selects the session
  model and rewrites `recentModelIds` in `~/.copilot/config.json`.

## Resolve IDs

The installed CLI has a machine-readable `models.list` RPC, verified with 1.0.85 and 1.0.88. Older
notes about the absence of a `models` subcommand do not imply that this RPC is unavailable. Prefer
this bounded read over scanning native executables, guessing ids, or installing an SDK solely for
enumeration:

- Run [`list-copilot-models.mjs`](../../scripts/list-copilot-models.mjs) with
  `--loader <npm root -g>/@github/copilot/npm-loader.js`. It starts that loader with
  `--headless --stdio --no-auto-update`, removes `COPILOT_*` and terminal variables, sends
  Content-Length framed `models.list`, falls back to `connect` then `ping` on method-not-found
  (the pattern in `src/backends/cli/usage/copilotQuota.ts`), and prints only ids, names, effort
  tokens, context sizes and discounts. Direct `models.list` succeeded with 1.0.85 and 1.0.88. Do not
  call the quota collector to obtain model metadata. Its offline suite is
  `node --test skills/maintain-provider-model-catalogs/tests/list-copilot-models.node-test.mjs`.
- Use the CLI's existing login. Bound the read (the captures used 30 seconds), stop the child on
  success/failure, and retain only relevant model metadata. Do not create a session, send a prompt,
  extract credentials, start login, or alter installed files. Stop on authentication or protocol
  failure and request the smallest missing picker evidence instead of adding more probe modes.
- Preserve returned `id`, visible `name`, supported effort tokens and their source. Its
  `supportedReasoningEfforts` matched the picker's Reasoning order on every listed 1.0.88 row, but
  the picker remains the per-row evidence.

`models.list` does not include every selectable picker row (1.0.88 omitted all four Gemini rows).
Absence from that response is not evidence to remove a row, and a missing ID is not guessed: ask the
operator. A CLI message of the form `Model changed from … to <raw-id> (<effort>) for this session`
also establishes a mapping, but only after an operator-authorized selection. Record the discrepancy
and both sources. Such a session selection proves neither an account default nor the complete
effort menu.

CLI help proves flag syntax, not a model's supported values. 1.0.88 lists `--reasoning-effort`
(`--effort`) with `none, minimal, low, medium, high, xhigh, max`, `--context` with
`default, long_context`, and `--auto-tier` with `efficiency, balance, intelligence, fast`.

## Schema-2 execution data

Keep the model ID and each control separate. A row with Reasoning arrows gets its own
`copilot.reasoning_effort` enum with only its picker values; a two-figure row gets `copilot.context`
with `default` then `long_context`, labeled with the picker figures; the Auto row gets
`copilot.auto_tier`. Rows showing dashes have `controls: []`. With no default marker, selection
starts at each control's first value and always sends it, overriding the CLI's saved setting; record
that in notes. Keep earlier shortlist labels in `source_names`.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
