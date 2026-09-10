# Meta Muse Catalog Evidence

`muse` has no model-listing subcommand. `muse --help` shows no `models` entry, and `muse exec`
cannot enumerate — so there is no CLI path to the catalog at all.

The one enumeration surface is the MSP host the CLI serves on stdio. Start `muse serve`, send the
JSON-RPC `initialize` request, send the `initialized` notification, then call `model/list`. The
`initialized` notification is required: without it `model/list` returns
`{"code":-32600,"message":"Not initialized","data":{"kind":"notInitialized"}}`. Frames are
newline-delimited JSON, not LSP `Content-Length` framing.

The reply is the account-resolved catalog and carries its own provenance — `providerId`,
`profileId`, and a `source` field that distinguishes a live provider catalog from a test fake.
Record all three. Each row carries `modelId`, `displayLabel`, `releaseDate`, `contextLimit`,
`outputLimit`, `cost`, `isDefault`, and `isActive`; a field the source declared nothing for comes
back `null` and must be omitted rather than guessed.

Two judgements are specific to this provider.

**`isDefault` is not automatically the curated default.** Meta ships `-contributor` variants of each
model whose own description says the session may be used for product improvement, and the catalog's
`isDefault` has pointed at one of them. Projecting that into curated YAML opts every runtime turn
into content sharing. Leave the curated default unset unless the operator asks for a specific row;
with no `--model` argument muse uses whatever the account already prefers.

**The effort axis is provider-wide, not per model.** `--reasoning-effort` is a root argument on both
`muse` and `muse exec`, and its help declares one list for every model. Unlike Grok, whose menu
differs per model, muse's belongs in `shared_options` with no per-model override. Confirm the list
against the current build's `muse exec --help` rather than copying it forward.

Never verify a muse build by running the tool as part of catalog work. The installed entry point is
a launcher that forwards every argument to the agent binary, so an unrecognised flag opens the
interactive TUI. Read the version from `.muse-version` in the install directory. The launcher also
self-updates in the background, so record the exact `muse-bin-<version>` the evidence came from.
