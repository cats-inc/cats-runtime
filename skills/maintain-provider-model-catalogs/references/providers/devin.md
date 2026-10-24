# Devin Catalog Refresh

The scope is every Devin family except the fusion family and the legacy `MODEL_*` UIDs, as recorded
in `docs/research/2026-10-14-shortlists-to-full.md`; the earlier shortlist and the ACP transport
investigation are in the [Devin evidence note](../../../../docs/research/2026-09-18-devin-shortlist.md).

## Read the list

- The verified read-only enumeration is `devin models list --format json` (the probe's Devin
  source). Parse the output in-process; it is verbose enough to truncate tool output. Its fields
  are family (`family_uid`, `family_label`, `slug`, `aliases`) and variant (`model_uid`, `label`,
  costs, token limits, `is_new`, `is_beta`); it has no default, hidden or order field.
- `devin help acp` exits after showing help. Do not run `devin acp --help`: older builds enter the
  ACP server. A family slug passed as `--model` resolves to a variant Devin chooses, so always use
  exact UIDs.
- The interactive picker needs a trusted directory; in an untrusted one it asks first, and the
  answer is the operator's.

## Families as controls

A variant UID is the family base plus an effort (`none`, `minimal`, `low`, `medium`, `high`,
`xhigh`, `max`) and modifiers. In 3000.11.3 every family was the full product of its efforts and its
speed form, so one entry per family has:

- `devin.effort` (Reasoning Effort) with the list's labels (No Thinking, XHigh and so on), in the
  list's order, the first value starting a selection without a default claim;
- `devin.speed` (Speed: Standard, Fast) where the family has `fast` (Claude) or `priority` (GPT)
  variants; both read Fast in the list;
- separate entries for the `1m`, `thinking` and `lightning` forms, named as the list names them.
  Lightning is its own form, not an alias for the Fast speed control. The helper preserves each
  form's exact UIDs and effort order without manufacturing missing combinations.

Some bare UIDs carry an effort only in their label (`glm-5-2` is High); read it from the label.
`scripts/catalog-scope-entries.mjs --snapshot <probe snapshot> --provider devin --exclude-family fusion --exclude-id '^MODEL_' --write <yaml>`
builds the entries and fails on any family that is not a full product. The probe acknowledges the
excluded rows with `subjectPattern` entries.

## Schema-2 execution data

Use provider `devin`, backend `agent`, transport `acp_stdio`. The empty CLI scope is intentional.
Store the exact UIDs in `execution.model` and `execution.variants`; the `devin.*` controls only
choose one. ACP sets it after session/new or session/load and permission pinning, before prompt.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Validate labels,
ordered values, defaults, custom input, and actual emitted bindings. Discovery tests must
explicitly use a `selection_mode: discovery` scope before constructing the service.
`catalogs: []` inherits factory; `models: []` empties a full scope.
