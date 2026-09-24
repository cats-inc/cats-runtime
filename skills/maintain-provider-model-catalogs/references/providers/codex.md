# Codex catalog refresh

Use the supplied complete model picker and each model’s reasoning screens first. Retain raw model
IDs and the exact observed label casing; (current) is not a default. Only explicit (default) establishes
a model or effort default. Max/Ultra availability remains per model, including nested warning
evidence. The operator already approved flattening the reasoning submenu into one list.

Reuse retained raw effort mappings; do not launch Codex or scan its bundle simply to corroborate a
complete paste. In schema 2, put per-model `codex.reasoning_effort` values/defaults under `controls`,
wire IDs under `execution.model`, and explicit model default under `default`.
No code allowlist, UI array, alias mapping or model-keyed fallback is needed. New supported effort
tokens are data; unknown transport requirements need separate scope.

For an operator-requested live capture, use [interactive capture](../interactive-capture.md).
The 0.156.1 Windows pilot proved these details; recheck changed versions rather than treating them
as permanent CLI contracts:

- The picker showed GPT-style labels while execution slugs remained lowercase. Never derive
  display casing from a slug or preserve an older casing against newly observed UI evidence.
- `(current)` masks `(default)` on the same model row. Absence of the default marker on a current
  row is not evidence of no default. A per-invocation `--model` override to another observed,
  non-retiring model exposed the marker without saving a setting. Do not press a final effort's
  Enter: the footer says `enter default`; `s session` is a different action.
- `codex debug models` without `--bundled` supplied slugs, display names, `visibility`, per-model
  effort tokens/defaults and CLI context values. Reconcile `visibility=list` with the actual menu;
  hidden entries are not extra picker rows. Project only needed fields; discard instructions and
  unrelated session/account fields before storing evidence. Do not manufacture absent fields as
  null and then interpret those nulls as upstream observations.
- `More reasoning…` is navigation, not an effort token. Inspect it per model. A retiring-model
  notice used `enter/esc confirm` and `ctrl+c quit`; Escape is only safe where the observed footer
  says back/cancel. Stop on an unexpected notice rather than continuing a menu key sequence.

Follow [catalog surfaces](../catalog-surfaces.md) for generation/checks and
[local soft patches](../local-soft-patch.md) for an installed machine. Confirm basic/advanced API
revision equality, initial model/effort, switches, restored explicit effort and actual adapter
arguments. Preserve historical fixtures; they do not control current menus.
