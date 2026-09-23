# Goose

Use supplied provider/model picker evidence first. Goose is a multi-provider CLI:
keep its selected provider context attached to every model, and preserve lowercase
raw model labels. A complete selected Cats shortlist does not describe all upstream
providers or all their effort menus.

## Bounded evidence

- A date-shaped value such as `YYYYMMDD_N` may be a session ID, not a CLI version.
  When ambiguous, use an informational version query and confirm the source version.
- Goose can initialize logs even for `--version` or `run --help`. Set
  `GOOSE_PATH_ROOT` to an agent-owned temporary directory before such probes; do not
  escalate access to the user's logs or launch a native session just for evidence.
- Provider-qualified Cats IDs use the existing `provider/model` parser. Verify the
  provider token separately from its display label; ChatGPT Codex's token is
  `chatgpt_codex`, not the OpenAI API provider `openai`.
- For an execution mapping absent from help, inspect versioned upstream source at
  the installed version. `goose-providers` reexports model/thinking types from
  `goose-provider-types`; follow that reexport instead of repeatedly guessing paths.
  This source proves transport semantics, not account-visible menus or defaults.


## Schema-2 execution data

Use qualified Cats `id`, bare wire `execution.model`, `execution.provider: chatgpt_codex`, and `execution.fixed_controls.goose.thinking_effort: off`. The generic serializer uses Goose’s native `-none` suffix; its backend may map none to the lowest supported effort. No model-keyed lookup remains; unknown custom strings get no inferred Off.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
