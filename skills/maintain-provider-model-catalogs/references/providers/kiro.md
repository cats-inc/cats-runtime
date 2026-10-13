# Kiro catalog refresh

Kiro is a full-catalog provider. Current choices and evidence belong in the
[V3 catalog refresh](../../../../docs/research/2026-10-13-kiro-v3-catalog-refresh.md), the
[V3 picker capture](../../../../docs/research/2026-10-13-kiro-v3-picker-capture.md) records what
the picker displays, the
[2.24.1 picker capture](../../../../docs/research/2026-09-27-kiro-picker-full-catalog.md) records
the settings-panel rings the V3 data agreed with, and the earlier
[shortlist note](../../../../docs/research/2026-09-18-kiro-shortlist.md) is superseded. Do not copy
their model values into this reference.

## Bounded evidence

- **Enumeration:** `kiro-cli chat --list-models --format json-pretty` gives raw `model_id`,
  description, `context_window_tokens`, credit rate and `default_model`. It needs no chat or
  inference. Use it to check IDs and order. It is not effort evidence, and its `default_model`
  (plain output: `* = default`) is not a catalog default.
- **Effort levels, defaults and thinking:** the V3 engine lists every model with
  `effortLevels`, `defaultEffortLevel`, `thinkingToggleable` and `defaultThinkingEnabled` in the
  ACP `config_option_update` it sends while creating a session. The
  [catalog probe](../catalog-probe.md) reads it through `kiro-cli acp --agent-engine v3
  --auth-method cli`: `initialize`, `session/new` in the probe's private directory, then
  `session/delete`. No prompt is sent and no credits are spent; the session exists only for that
  exchange. The session-free `_kiro/config/template` reply omits the model option on 2.30.0, which
  is why a session is needed. Headless `--output-format stream-json` runs carry the same update,
  so a real turn's capture (for example in `docs/research/fixtures/kiro-2.30.0/`) is equal
  evidence.
- **Display names:** the V3 option carries a display name per row (`Claude Opus 5.5`), but the
  2.30.0 V3 picker shows the raw IDs. Labels follow the picker, so keep the names in evidence
  only.
- **Picker walk for display text only.** The probe owns membership, efforts and defaults; the
  interactive `/model` picker is needed only to check what it displays: labels, descriptions,
  credit rates and the settings panel's cells. Walk it with the read-only Up/Down helper in
  [interactive capture](../interactive-capture.md#windows-kiro-helper); never cycle Left/Right,
  which persists the value (2.24.1 rewrote `cli.json` on every key).
- **The panel shows current values.** Each row's thinking and effort cells are the values a
  selection would use now, and `chat.modelDefaults` in `~/.kiro/settings/cli.json` overrides
  them. On 2026-10-13 claude-opus-5.5 showed `xhigh` from that setting while its
  `defaultEffortLevel` is `medium`. Never take a catalog `default:` from a panel cell.
- **Help is global text.** `--effort <EFFORT>` lists example values, not per-model availability.
  `--list-models` accepts any `--effort` string, so it cannot validate tokens. A real turn would
  consume credits and needs separate authorization.
- **Windows:** clear inherited `KIRO_*`, `AWS_EXECUTION_ENV` and `JSC_*` variables when an agent
  running inside Kiro launches the probe; the probe does this itself.

## Schema-2 execution data

- `id`, `label` and `execution.model` are the verbatim model IDs, including the `auto` routing
  row, in list order.
- Give each row with `hasEffort` its own `kiro.reasoning_effort` enum `controls`, with exactly its
  `effortLevels` in order, and its `defaultEffortLevel` as the control's `default`. Rows without
  effort use `controls: []`. The defaults were adopted on 2026-10-13; Kiro states them per model,
  so they are evidence, not an inferred setting.
- Selection starts at the default and always sends `--effort`, which overrides Kiro's saved
  `chat.modelDefaults`. Do not add a fabricated "default" option to preserve Kiro's setting.
- `auto` has no effort and no model default; the advanced projection's `defaultSelection` is the
  first row with no controls. That is initialization, not a default claim.
- Thinking toggles are notes only: `kiro-cli chat` has no thinking argument.
- Context limits may come from `--list-models` `context_window_tokens`.
- Native and WSL share this scope. That does not establish equal account entitlement: evidence
  from one platform does not prove the other's model or effort list.
- Custom model strings stay verbatim and get no inferred effort.
- To check that a row actually runs, read the model Kiro reports for the turn, not the flags sent.
  Cats runs Kiro's V3 engine headless (`--agent-engine v3 --output-format stream-json`), which
  applies `--model` and `--effort` and reports both back in its `config_option_update` and
  `session.json`; the runtime's `reportedModels` carries that value. See
  [the V3 contract](../../../../docs/research/2026-10-13-kiro-v3-headless-contract.md) and, for
  the V2 defect that is now history,
  [the engine probe](../../../../docs/research/2026-09-28-kiro-v2-ignores-model.md).

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. The
`kiro.reasoning_effort` binding exists, so a data refresh using it needs no new implementation.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
