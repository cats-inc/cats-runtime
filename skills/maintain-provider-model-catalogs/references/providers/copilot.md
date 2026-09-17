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

## Project the approved menu

- Resolve fixed combinations versus adjustable effort before choosing YAML. Reuse the operator's
  explicit choice. An effort column records one value, not the model's complete option menu.
- For approved fixed combinations, use `selection_mode: shortlist`, an observed raw model id in
  `name`, and a separate display label composed from the original model name and approved effort.
  A single value under that model's effort option is resolved internally by the Copilot overlay.
  Do not set an effort `default` merely to force the combo, or invent a Cursor-style bracket id.
- The Runtime keeps fixed effort out of public editable controls and their defaults, then resolves
  it for execution. Public `defaultSelection` must remain valid when submitted unchanged. Verify
  separate `--model` and `--effort` arguments, model switches and rejection of unsupported overrides.
- Preserve an explicit model default independently of fixed effort. Check both the offline fallback
  and the loaded Runtime menu: the fixed-combo Playground branch needs to format default metadata
  too. Its earlier Cursor-only use had no default row and did not exercise that path.
- Context figures in the picker and maximum limits from RPC can differ. Keep their provenance
  separate; do not infer a selectable tier, convert rounded figures to exact limits, or silently
  replace the picker figure. Follow the operator's display choice.
- For adjustable catalogs, retain provider grouping and per-model effort evidence. Shared option
  inheritance needs observed scope; distinguish unsupported effort from an uncaptured menu.

## Focused verification

Follow [catalog surfaces](../catalog-surfaces.md). The existing `copilotPresets.test.ts` covers
shortlist/cache/refresh behavior, public default submission, fixed effort resolution and adapter
argv. Include the affected Playground form/default/custom-input tests and Desktop fallback tests.
Custom strings and saved out-of-shortlist selections must survive refresh without acquiring a
fixed combo's effort. Keep test state isolated from the personal catalog.
