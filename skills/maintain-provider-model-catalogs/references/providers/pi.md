# Pi

Pi's catalog is the complete `openai-codex` (ChatGPT subscription) channel. Other Pi providers are
out of scope unless the operator adds one; they stay reachable as custom `provider/model` strings.
Current rows and evidence belong in `docs/research/2026-09-27-pi-openai-codex-full-catalog.md` and
its fixtures in cats-runtime, not in this skill.

Keep the selected provider attached to each model. A model-selector row such as
`model-id [provider-id]` has three separate representations: its visible label,
Cats' `provider-id/model-id` selection, and separate CLI provider/model arguments.
Preserve the bracketed provider suffix; it distinguishes subscription routing from another
provider offering the same model.

## Evidence from the installed package

Pi's model and thinking menus are computed from package data, so read the installed package
instead of launching Pi or loading account state:

```text
node skills/maintain-provider-model-catalogs/scripts/extract-pi-models.mjs \
  --package <npm root -g>/@earendil-works/pi-coding-agent --provider openai-codex \
  --store ~/.pi/agent/models-store.json
```

[`extract-pi-models.mjs`](../../scripts/extract-pi-models.mjs) imports the channel from pi-ai's
`models.generated.js`, computes each model's levels with Pi's own `getSupportedThinkingLevels`, reads
the built-in `DEFAULT_THINKING_LEVEL` and hashes every file it read. It never reads `auth.json` or
settings. `--store` compares Pi's local model store by id. Its offline suite is
`node --test skills/maintain-provider-model-catalogs/tests/extract-pi-models.node-test.mjs`.

- The channel list is Pi's build-time catalog, not account entitlement, and it can lag the backend:
  Pi 0.87.1 still listed `gpt-5.3-codex-spark` after ChatGPT accounts stopped accepting it ("not
  supported when using Codex with a ChatGPT account"). Compare it with the same account's Codex CLI
  list; a row that list does not offer is a likely rejection, so ask the operator before keeping it.
- Pi's model selector draws `<id> [provider]`, puts the current and a configured default model
  first, then keeps registry order. It marks only a user-configured `defaultModel` (` · default`),
  so a factory catalog has no default row.
- A model's thinking levels come from `getSupportedThinkingLevels` over its `thinkingLevelMap`: a
  `null` entry removes a level, and `xhigh`/`max` need an explicit entry. Some levels map to the same
  API effort (for example `minimal` → `low`); record that in notes instead of dropping the level.
- The thinking selector labels levels with Pi's tokens and marks the default level
  (`settings.defaultThinkingLevel`, else the built-in `DEFAULT_THINKING_LEVEL`) with ` · default`.
  Use the built-in value as the control default.
- `--thinking` accepts `off, minimal, low, medium, high, xhigh, max` and takes precedence over saved
  defaults (`dist/cli/args.js`, `dist/main.js`).

Do not launch `pi --list-models` for this: it loads account state and queues an availability refresh
(`ModelRuntime.getAvailable` in `dist/core/model-runtime.js`).

## Schema-2 execution data

Use qualified Cats `id` (`openai-codex/<id>`), the `<id> [openai-codex]` label, bare
`execution.model` and explicit `execution.provider`. Each row carries its own `pi.thinking` enum with
only its supported levels and `default` set to the thinking selector's default. Never send the
display suffix to the CLI or derive a provider from a model family. Keep earlier shortlist labels in
`source_names`.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
