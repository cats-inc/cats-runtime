# Cursor Catalog Refresh

Use this reference for Cursor's parameterized model families. Current model values belong in the
curated catalog and evidence, not this skill. The full catalog and its capture are recorded in
`docs/research/2026-10-14-shortlists-to-full.md` in cats-runtime; the earlier fixed-combination
shortlist is history in `docs/research/2026-09-17-cursor-fixed-presets.md`.

## What the picker offers

- The picker lists families. A family's parameters (context, effort, reasoning, thinking, fast and
  others) are chosen in a parameter editor: an enum shows each value's display name, a boolean is
  an on/off switch named after the parameter, and a parameter with one value is not shown.
- The executable `--model` value is the server's exact `variantStringRepresentation`, such as
  `claude-opus-4-8[thinking=true,context=300k,effort=high,fast=false]`. The CLI accepts only a
  string equal to a listed variant (or a legacy slug); do not assemble one from display text.
- Without a saved choice for the family, the picker preselects its `isDefaultNonMaxConfig` variant.
  Those values are the control defaults. Other internal flags (`isDefaultMaxConfig`, `defaultOn`)
  are not Cats defaults.
- Max mode is a separate CLI setting (`/max-mode`, `/config`), not a model choice.
- `--list-models` prints only legacy slugs, which can name a different context than the picker
  (a "1M" slug can resolve to a 272K variant) and omit some families. It is not picker evidence.

## Capture account-resolved parameterized models

Run `node skills/maintain-provider-model-catalogs/scripts/capture-cursor-parameterized-models.mjs --output <file>`
with optional `--cli <install root | version dir | index.js | shim>`, `--raw-output <file>`,
`--fixture-output <file>`, `--work-dir <dir>` and `--timeout-ms <ms>` (default 60000).

- It runs the installed CLI's own `--list-models` once, from an empty temporary directory, with
  stdin closed and a bounded timeout that kills the process tree. A process-local preload records
  the decoded `availableModels`, `getUsableModels` and `getDefaultModelForCli` replies in memory.
- Outputs: the projection (families in server order, `parameterDefinitions`, every variant with
  its exact `variantStringRepresentation`, default flags, cross-product analysis, `--list-models`
  slug mapping) and an optional redacted raw capture. `--fixture-output` writes a compact,
  ASCII-escaped evidence file for `docs/research/fixtures/`.
- Exit codes: 0 ok, 2 usage or no install found, 3 CLI timeout, 4 capture missing or `ok:false`
  (fail closed), 5 safety scan hit or installed files changed.
- Read-only: no login, prompt, agent run or inference. Installed files, CLI config and auth state
  are never written by the hook, and request headers are never read. Credential fields are dropped
  in memory; emails and account ids are redacted. Output is refused if a bearer token, JWT, token
  key, API key, authorization or cookie pattern remains.
- The CLI itself may refresh its own `~/.cursor/cli-config.json` during a normal run. That is
  reported as `integrity.cliConfigMtimeChanged`, not prevented.
- Version-specific: the install layout `versions/<YYYY.MM.DD[-HH-MM-SS]-commit>/{node(.exe),index.js}`;
  the webpack module ids `./src/commands/models.ts` and `./src/models/model-service.ts`; the RPC
  method names; require()-based chunk loading; and the bundled exclusion list. All were verified
  on 2026.10.01-e373342. After a CLI update, a "command module was never loaded" failure means the
  preload ids need updating.
- Tests: `node --test skills/maintain-provider-model-catalogs/tests/capture-cursor-parameterized-models.node-test.mjs`
  (synthetic inputs only).

## Build the scope

`scripts/catalog-scope-entries.mjs --cursor <projection> --provider cursor --write <yaml>` builds one
entry per picker family in server order, skipping families the CLI excludes:

- one `cursor.<parameter id>` control per parameter with more than one value, with the
  preselected variant's values as defaults, and `execution.variants` mapping every combination to
  its exact string; the starting variant is the entry id and leads the variant list;
- a family that does not list every combination of its values is split on the first parameter
  that leaves each part complete, and each part is named like the picker's row summary (an enum
  value's display name, "No Thinking" for thinking off). No unlisted combination is offered;
- a new parameter id needs a `cursor.<id>` binding in `src/catalogs/bindings.ts` first.

The probe's Cursor source checks families through legacy slugs only. Its known naming gaps are
acknowledged with a `subjectPattern`; rerun the capture to check those rows.

## Schema-2 execution data

Store exact observed variant strings in `execution.model` and `execution.variants`. The adapter
passes the resolved string as one `--model` argument; the `cursor.*` controls only choose it.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Validate labels,
ordered values, defaults, custom input, and actual emitted bindings. Discovery tests must
explicitly use a `selection_mode: discovery` scope before constructing the service.
`catalogs: []` inherits factory; `models: []` empties a full scope.
