# Auggie Catalog Refresh

Auggie is a full-catalog provider: the interactive `/model` picker defines membership and order.
Current models and evidence belong in `docs/research/2026-09-27-auggie-picker-full-catalog.md`
(which supersedes the 2026-09-23 shortlist), not in this procedural reference.

## Picker capture

Use this when the operator asks the agent to collect the picker. Follow
[interactive capture](../interactive-capture.md) and its Auggie helper.

- The picker title is `Select model for this session`, six rows visible with `↑`/`↓ N more`
  counters. Each row shows a label, badges such as `[New] [Auto]`, a `$`–`$$$$` cost tier and a
  description line. Left and Right do nothing. A read right after a key can be a partial render
  with no highlight; wait for two identical reads that contain one.
- `(current)` marks the session model and is not a default. Only a `(default)` suffix on the
  picker is default evidence; in 0.36.0 it matched the JSON row with `isDefault: true`. The
  envelope `defaultModelId` may name no picker row; keep it in notes.
- The list shows no effort, no slash command covers effort, reasoning or thinking, and the `?`
  shortcut list has no effort key. Enter selects the row for the session only (`Using model:
  <label>`), opens no effort step and leaves `~/.augment/settings.json` unchanged. Enter needs
  operator authorization; keep the settings hash guard on every key. This describes the picker,
  not the separate `--reasoning-effort` argument.
- The picker and JSON orders differ. Match rows to JSON by exact `displayName`; ask when any
  label does not match one to one.
- Picker access follows the account. Evidence from one OS or account does not establish what
  another (for example WSL) can see.
- Auggie writes a small session file for each interactive launch, even without a prompt.

## Resolve IDs without a model turn

- Inspect the installed version/help when necessary. In verified 0.36.0, `auggie model list --json`
  returns an envelope with a `models` array whose rows contain `id` and `displayName`.
  Use one bounded read; retain only the selected public fields. No prompt/session or login is
  needed when the installed CLI can already enumerate. If authentication is required, stop and
  report the mapping gap rather than initiating login.
- Match exact supplied names; do not manufacture IDs by lowercasing or replacing punctuation.
  Names can map to opaque tokens (the retained Prism evidence is one example).
- Inspect the current JSON shape before filtering. Per-model `effortLevels` are the account-resolved
  supported tokens, in their listed order. Under the operator's 2026-10-24 authorization, Cats
  exposes these as a separate effort control even though the picker has no effort step. Use the
  exact tokens as labels; do not invent a picker label or default. Argument help proves the
  `--reasoning-effort` syntax, not per-model values. Account/default envelope fields never establish
  effort defaults. An ID mapping also does not prove availability on another account.
- Do not scan the minified package or launch inference once the selected mappings are resolved.
  Preserve a projected-field artifact honestly as a projection, not a verbatim capture.


## Schema-2 execution data

Use exact CLI-observed IDs in `id` and `execution.model`, with the exact picker `label` (without
`(current)`/`(default)` suffixes). Set `default: true` only on a picker `(default)` row. Opaque IDs
are valid. Each nonempty JSON `effortLevels` array becomes its own `auggie.reasoning_effort` enum
(`scope: both`), using raw tokens for values and labels, without a default. Missing levels mean
`controls: []`. Runtime, Playground and Desktop initialize to the first value and send
`--reasoning-effort`; custom model strings have no inferred effort. This additive binding was
authorized on 2026-10-24. Preserve the source class explicitly rather than presenting JSON tokens
as picker observations.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
