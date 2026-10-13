# Goose

Goose is a multi-provider CLI. Cats maintains the full model list of one channel,
`chatgpt_codex` (ChatGPT subscription OAuth), recorded as the scope's `basis.channel`.
Keep that provider attached to every model and preserve Goose's lowercase raw model
labels. Other Goose providers stay custom `provider/model` input.

## Bounded evidence

- A date-shaped value such as `YYYYMMDD_N` may be a session ID, not a CLI version.
  When ambiguous, use an informational version query and confirm the source version.
- Goose can initialize logs even for `--version` or `run --help`. Set
  `GOOSE_PATH_ROOT` to an agent-owned temporary directory before such probes; do not
  escalate access to the user's logs or launch a native session just for evidence.
- Provider-qualified Cats IDs use the existing `provider/model` parser. Verify the
  provider token separately from its display label; ChatGPT Codex's token is
  `chatgpt_codex`, not the OpenAI API provider `openai`.
- Goose has no read-only model-list command, and `goose configure` writes its config.
  The `chatgpt_codex` list is compiled in: read `CHATGPT_CODEX_KNOWN_MODELS` in
  `crates/goose/src/providers/chatgpt_codex.rs` at the installed version's tag, then find
  the same names in the installed binary (they sit together beside the provider's
  sign-in page text). Record the binary's SHA-256, and compare it with the release asset
  when one exists. `fetch_supported_models` returning that list shows there is no live,
  account-specific fetch; recheck this on each version.
- The configure flow lists those models (filtered by Goose's model registry and sorted
  newest first, ties in list order) and then one global `Select thinking effort:` menu:
  Off, Low, Medium, High, Max, starting on Off. Neither marks a default; the provider's
  fallback model for an unset model is not a picker marker.
- For an execution mapping absent from help, inspect versioned upstream source at
  the installed version. `goose-providers` reexports model/thinking types from
  `goose-provider-types`; follow that reexport instead of repeatedly guessing paths.
  This source proves transport semantics, not account entitlement.

## Schema-2 execution data

Use qualified Cats `id`, the raw model name as `label` and bare wire `execution.model`,
`execution.provider: chatgpt_codex`, and a per-row `goose.thinking_effort` enum with Goose's
menu values `off`, `low`, `medium`, `high`, `max` and no default. The adapter sends the value
as Goose's native model suffix: `-none`, `-low`, `-medium`, `-high`, `-xhigh` (Goose 1.54.0
parses no `-max` suffix and maps `-xhigh` to Max). The binding rejects any other value.
Goose's backend then sends the model's own effort token; on models without `none`, Off is
sent as `low`. Unknown custom strings get no inferred effort.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
