# Copilot Catalog Refresh

Use the supplied picker and retained mappings first. Current selected models and capture details
belong in `docs/research/2026-09-17-copilot-fixed-presets.md` and its fixtures in cats-runtime,
not in this skill. Inspect the personal override's version/count early; it can hide bundled updates.

## Resolve only missing execution evidence

The installed CLI has a machine-readable `models.list` RPC, verified with 1.0.85. Older notes
about the absence of a `models` subcommand do not imply that this RPC is unavailable. When a
supplied display name lacks a raw-id mapping, prefer this bounded read over scanning native
executables, guessing ids, or installing an SDK solely for enumeration:

- Start the resolved installed executable with `--headless --stdio --no-auto-update`, with logs
  directed to a task temporary directory. Use Content-Length framed JSON-RPC; the request is
  `{"jsonrpc":"2.0","id":1,"method":"models.list","params":{}}`.
- Direct `models.list` succeeded in the recorded capture. If the current version requires a
  handshake, follow the official SDK contract. The existing transport pattern in
  `src/backends/cli/usage/copilotQuota.ts` demonstrates `connect` with a method-not-found fallback
  to `ping`; do not call the quota collector to obtain model metadata.
- Use the CLI's existing login. Bound the read (the capture used 30 seconds), stop the child on
  success/failure, and retain only relevant model metadata. Do not create a session, send a prompt,
  extract credentials, start login, or alter installed files. Stop on authentication or protocol
  failure and request the smallest missing picker evidence instead of adding more probe modes.
- Preserve returned `id`, visible `name`, supported effort tokens and their source. Fetching more
  account models does not authorize expanding the operator's shortlist.

`models.list` did not include every operator-observed picker row. Absence from that response alone
is not evidence to remove a selected row. A CLI message of the form
`Model changed from … to <raw-id> (<effort>) for this session` can establish the missing mapping;
ask for that selected row's confirmation, not another full picker capture. A settings model field
can also establish an id; read only the relevant field rather than dumping the configuration.
Record the discrepancy and both sources. Such a session selection proves neither an account
default nor the complete effort menu.

Do not diagnose an adapter defect solely because help omits an alias: the retained official
changelog confirms `--effort` aliases `--reasoning-effort`. Reuse that evidence unless the current
CLI demonstrably rejects the invocation. CLI help proves flag syntax, not a model's supported values.


## Schema-2 execution data

Keep model ID and `copilot.reasoning_effort` separate. Approved fixed effort belongs in `execution.fixed_controls`; an observed model default remains a separate `default: true`. Fixed effort is neither editable nor a default claim.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
