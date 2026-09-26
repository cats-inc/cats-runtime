# Kiro catalog refresh

Kiro is a full-catalog provider. Current choices and evidence belong in the
[Kiro picker capture](../../../../docs/research/2026-09-27-kiro-picker-full-catalog.md). The
earlier [shortlist note](../../../../docs/research/2026-09-18-kiro-shortlist.md) is superseded.
Do not copy its model values into this reference.

## Bounded evidence

- **Enumeration:** `kiro-cli chat --list-models --format json-pretty` gives raw `model_id`,
  description, `context_window_tokens`, credit rate and `default_model`. It needs no chat or
  inference. Use it to check picker IDs and order. It is not effort evidence, and its
  `default_model` (plain output: `* = default`) is not a catalog default.
- **Picker:** in interactive `kiro-cli chat`, type `/model`, wait for the echo, then press Enter to
  run the slash command. The list shows raw IDs, credit rate and description. Rows scroll 8 at a
  time with a `(+N more)` counter; read every row while highlighted.
  - `[active]` marks the current selection only.
  - Below the list, a per-model panel shows `thinking` and `effort`. Its header is
    `Settings for selected model: <id>` on auto and `Settings for model: <id>` elsewhere.
  - Tab switches between the list and the panel. In the panel, Up/Down pick the row and ←→ cycle
    its value. Enter in the list selects the model; never send it.
- **Toggles persist immediately, without Enter.** Each ←→ rewrites `~/.kiro/settings/cli.json`
  `chat.modelDefaults.<id>`.
  - Hash and privately back up that file before the first toggle. Cycle every ring back to its
    starting value.
  - After the owned Kiro exits, confirm that no other writer changed the file since the last
    toggle, then restore the backup byte for byte and compare hashes.
  - If the file changed concurrently, stop and ask instead of overwriting.
- **Reading the ring:**
  - An unset row shows `default`, which leaves the ring on the first Right and never returns. It
    is the unset state, not a value or a default marker.
  - Derive linear order from the wrap point: `max` wraps to the lowest value.
  - Values differ per model; never copy one row's ring to another.
  - A value shown without a saved setting (for example `xhigh` or `high`) carries no default
    marker; do not declare it.
- **Thinking:** some Claude rows also toggle thinking on/off, and off makes effort n/a.
  `kiro-cli chat --help` has no thinking argument, so record it in notes only unless the CLI later
  gains one.
- **Help is global text.** `--effort <EFFORT>` lists example values, not per-model availability.
  `--list-models` accepts any `--effort` string, so it cannot validate tokens. A real turn would
  consume credits and needs separate authorization.
- **Windows capture:** clear inherited `KIRO_*`, `AWS_EXECUTION_ENV` and `JSC_*` variables when
  an agent running inside Kiro launches the capture instance. Kiro 2.24.1 then started normally in
  Windows Terminal; no Defender detection occurred.

## Schema-2 execution data

- `id`, `label` and `execution.model` are the verbatim picker IDs, including the `auto` routing
  row, in picker order. Add a separate label only if the picker shows a display name.
- Give each effort-bearing row its own `kiro.reasoning_effort` enum `controls`, with only its
  observed values. Rows showing effort n/a use `controls: []`. Add `default` only when the picker
  marks one.
- With no default, Desktop, Playground and runtime resolution start at the first value. The
  adapter sends it as `--effort`, which overrides Kiro's saved `chat.modelDefaults`. Do not add a
  fabricated "default" option to preserve Kiro's setting.
- Without a model default, the advanced projection's `defaultSelection` is the generic first row
  with no controls. That is initialization, not a default claim.
- Context limits may come from `--list-models` `context_window_tokens`.
- Native and WSL share this scope. That does not establish equal account entitlement: evidence
  from one platform does not prove the other's model or effort list.
- Custom model strings stay verbatim and get no inferred effort.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. The
`kiro.reasoning_effort` binding exists, so a data refresh using it needs no new implementation.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
