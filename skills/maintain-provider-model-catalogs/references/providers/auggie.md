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
  operator authorization; keep the settings hash guard on every key.
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
- Inspect the current JSON shape before filtering. Account/default envelope fields, per-model
  `effortLevels` and global `--reasoning-effort` help do not establish picker defaults or effort
  menus. An ID mapping also does not prove availability on another account.
- Do not scan the minified package or launch inference once the selected mappings are resolved.
  Preserve a projected-field artifact honestly as a projection, not a verbatim capture.


## Schema-2 execution data

Use exact CLI-observed IDs in `id` and `execution.model`, with the exact picker `label` (without
`(current)`/`(default)` suffixes). Set `default: true` only on a picker `(default)` row. No
effort/default metadata follows from a model list alone. Opaque IDs are valid. There is no
`auggie.reasoning_effort` binding; record JSON `effortLevels` in notes unless the operator
authorizes a binding as a separate code change.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
