# Junie catalog refresh

Current choices and evidence belong in the
[Junie research note](../../../../docs/research/2026-09-23-junie-shortlist.md).

## Reuse literal names and fixed effort support

- Junie's existing normalizer preserves literal model names, including spaces and case.
  Do not invent lowercase/sluggified IDs or a pretty-name mapping. An approved Cats shortlist
  establishes membership/order, not the full upstream inventory.
- Fixed effort uses a singleton per-model `Effort` option and internal
  `junie.reasoning_effort` defaults. It is sent separately as `--effort <token>`;
  it is not appended to the executable model name. Preserve the CLI label in evidence and
  show the approved combination in Cats with the existing display separator.
- Update `src/core/models/junieModelCatalog.ts`, the Junie curated overlay in
  `providerAdvancedKnowledge.ts`, and the curated YAML together. The adapter shares
  `buildArgs` between initial and streamed/resumed turns. Both structured selections and
  known plain model strings must reach the same approved effort. Unknown custom strings
  receive no inferred effort or BYOK provider.
- Routine refreshes reuse this implemented support; do not ask again to authorize adding
  the already-present effort transport. Changed execution requirements still follow the
  scope gate. A fixed effort is not an upstream effort-default claim; a separately observed
  model default must survive the basic catalog, advanced catalog and both UIs.

## Collect only missing evidence

- Prefer supplied picker evidence and retained literal-name mappings. The observed CLI has
  no model-list subcommand. Do not guess a command that could become a prompt.
- If invocation evidence is missing, `junie --skip-update-check --help` and `--version` are
  informational probes. Global help establishes accepted effort tokens, not model-specific
  menus or defaults. Keep update suppression and avoid starting an interactive/task session.
- Only when names need corroboration, locate the installed version from its shim/current
  pointer. The observed native package carries `junie/app/junie-<channel>-<build>.jar`.
  Inspect bounded strings from `ModelOption$Specific.class` inside that ZIP/JAR; record the
  class and version. This is a possible superset and corroborates spelling, not entitlement
  or an unseen label-to-ID mapping. Do not dump the shim, full package or private settings.

## Validate the actual consumers

Use `junieModelCatalog.test.ts` with the shared catalog checks and affected Playground/Desktop
tests. Cover curated and static fallback, refresh, all final model/effort arguments, custom
input, emitted initial selection and default labels after Runtime metadata loads. Shortlists
contain **at most** six models: a five-row shortlist is complete when the operator specifies five.

Classify old tests before changing them: bundled snapshot expectations change; independent
historical fixtures keep their IDs. Basic static fallback can include explicit `default: false`
while curated rows omit it. Compare that metadata intentionally. The existing approved-shortlist
path suppresses the generic live-list warning, so it differs from uncurated fallback.
