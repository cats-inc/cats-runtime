# Meta Muse Catalog Evidence

The recorded Muse build has no model-listing subcommand. This limits noninteractive enumeration;
it does not establish that the TUI lacks a model/effort picker. Use supplied picker evidence first.

When model ids need verification, the recorded enumeration surface is the MSP host on stdio.
Start `muse serve`, send the
JSON-RPC `initialize` request, send the `initialized` notification, then call `model/list`. The
`initialized` notification is required: without it `model/list` returns
`{"code":-32600,"message":"Not initialized","data":{"kind":"notInitialized"}}`. Frames are
newline-delimited JSON, not LSP `Content-Length` framing. `clientInfo` requires a `name`
matching `^[a-z0-9_]+$` plus a `version` string; a hyphenated name is rejected with
`invalidParams`, which then leaves the session uninitialized.

The reply is the account-resolved catalog and carries its own provenance — `providerId`,
`profileId`, and a `source` field that distinguishes a live provider catalog from a test fake.
Record all three. Each row carries `modelId`, `displayLabel`, `releaseDate`, `contextLimit`,
`outputLimit`, `cost`, `isDefault`, and `isActive`; a field the source declared nothing for comes
back `null` and must be omitted rather than guessed. Since Muse Code 1.4.0
(`muse-bin-1.4.0-R4161.1`) each row may also carry an ordered `variants` array holding that
model's reasoning-effort tokens (observed: both 1.3 rows through `max`, both 1.2 rows through
`xhigh`; parser-only `none`/`ultra` absent). Treat `variants` as corroboration for retaining
already-evidenced per-model menus, not as picker evidence: it carries no default marker and
says nothing about session-current state, so absence-of-default and marker semantics still
require picker observation.

Two judgements are specific to this provider.

**`isDefault` is not automatically the curated default.** Meta ships `-contributor` variants of each
model whose own description says the session may be used for product improvement, and the catalog's
`isDefault` has pointed at one of them. Projecting that into curated YAML opts every runtime turn
into content sharing. Leave the curated default unset unless the operator asks for a specific row;
with no `--model` argument muse uses whatever the account already prefers.

**Effort menus are per model.** A global `--reasoning-effort` argument describes parser vocabulary,
not the values or defaults shown for each model. Keep the operator's complete per-model menus in
model `controls`, including regular and contributor rows only where both were confirmed. Do not
restore extra values or a help-derived default when refreshing model ids through MSP. Absence of a
picker default means no curated/default label; the UI initializes to the first option and must
persist that value for execution. Keep broader parser acceptance separate from menu metadata.

The 2026-09-18 correction is recorded in `docs/research/2026-09-05-meta-muse-cli-probe.md`.
Verify exact ordered values and absence of default metadata for every affected model through the
loaded catalog and picker, including that a value available on one generation is rejected for
another. Do not validate only the union of all values or an inline copy of the expected YAML.

Never verify a muse build by running the tool as part of catalog work. The installed entry point is
a launcher that forwards every argument to the agent binary, so an unrecognised flag opens the
interactive TUI. Read the version from `.muse-version` in the install directory. The launcher also
self-updates in the background, so record the exact `muse-bin-<version>` the evidence came from.

## Schema-2 execution data

Keep exact per-model `muse.reasoning_effort` values, including regular/contributor variants only where separately confirmed. Do not import help-wide enums or MSP defaults into per-model picker data.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
