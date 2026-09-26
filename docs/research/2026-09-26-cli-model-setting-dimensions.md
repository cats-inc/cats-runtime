# CLI model-setting dimensions and routing prefixes

Date: 2026-09-26. Mode: read-only survey. Scope: the 16 CLI provider families in
`KNOWN_PROVIDERS` (`src/backends/cli/providers/types.ts`), including Devin, which
runs over `agent/acp`. It compares what each CLI exposes with what cats-runtime
currently passes to it.

## Questions

The operator asked two questions:

1. Do these six concepts cover every model setting across all CLIs, providers
   and models: provider, model, thinking, effort (effort/reasoning/reasoning_effort),
   context, fast?
2. Multi-provider and BYOK CLIs such as Pi and Goose resell access. For example, they
   can run on an OpenAI Codex (ChatGPT) subscription. Do they add a prefix level
   above the model, and can there be two?

## Method and evidence boundary

- **Runtime source:** each provider's `buildSpawnArgs`, the OpenCode and Kilo native
  HTTP session services, the Devin ACP profile and `config/curated-model-catalogs.yaml.example`
  (cited below as `catalog:<line>`).
- **Read-only CLI commands:**
  - `--version`, `--help` and subcommand help.
  - Local list commands: `agy models`, `auggie model list --json`,
    `opencode models --verbose --pure`, `kilo models --verbose --pure` and
    `cursor-agent --list-models`.
  - Junie was run through its versioned `junie.exe`, not the auto-updating `junie.bat` shim.
- **Local files read:**
  - Key names in local caches: `~/.codex/models_cache.json`, `~/.grok/models_cache.json`
    and Devin's model configuration cache.
  - Installed package sources: Pi, Cline's `package.json` and bundle, and the Cursor
    bundle.
  - Strings in the Devin binary.
- **Not run:**
  - No model turn, login, configuration change or interactive picker.
  - Cline was not executed, because of its self-update behaviour
    ([2026-08-27 note](./2026-08-27-cline-self-update-and-probe-concurrency.md)).
  - `devin acp` was not started. `kiro-cli chat --list-models` and `devin models list`
    were not run.
- **Evidence strength:**
  - Facts from upstream docs or source on the web are marked **[web]**.
  - Strings found in a bundle or binary are marked **[static]**: they show the code
    exists, but no protocol reply or model turn confirmed them.
  - "Not found" means absent from the sources above, not proven absent upstream.

Installed versions on 2026-09-26 (repo fixture version in parentheses when different):

- claude 2.1.283 (2.1.282)
- codex-cli 0.157.1 (0.156.1)
- copilot 1.0.88 (1.0.85)
- grok 1.0.41
- agy 1.2.11 (1.2.10)
- muse 1.4.0-R4161.1
- junie 26.9.22, build 3419.7 (26.9.21)
- auggie 0.36.0
- opencode 1.18.32 (1.18.31)
- kilo 7.8.1 (7.7.3)
- goose 1.52.0 (1.51.0)
- pi 0.87.1
- cursor-agent 2026.09.26-dd393fe (2026.09.15-d2fe57e)
- kiro-cli 2.24.1 (2.22.0)
- cline 3.0.65, read from `package.json` and not run (3.0.62)
- devin 3000.11.3 (3000.10.31)

## Short answer

1. **The six concepts cover the core, but not the whole set.** They need these
   corrections:
   - **"Provider" has two layers.** One is the CLI host, which cats-runtime calls
     `provider`. The other is the routing channel inside the CLI (`modelProvider` /
     `execution.provider`). A third, hidden layer is the credential kind: the same
     channel ID can use a subscription or an API key.
   - **Thinking and effort overlap.** Thinking is sometimes an independent switch or
     budget, and sometimes just the `none`/`off` value of effort.
   - **Effort has no global scale.** Values run from `none` to `max`, and `ultra` and
     `ultracode` also turn on orchestration, which is a mode rather than an effort level.
   - **"Fast" has three meanings:** a service tier, a separate model ID, or a router
     preference.
   - **"Context" is often not a setting at all.** In many CLIs it is only metadata, a
     local override or a compaction threshold.
   - **Some settings need slots outside the six:** router models, data-use terms,
     Cursor Max Mode, helper or secondary models, fallback, sampling and output limits,
     spend caps, and opaque variants or passthroughs.
2. **The prefix hypothesis is correct.**
   - Direct and subscription channels add one level, for example `openai-codex/gpt-5.6-sol`.
   - Aggregators add a second, vendor namespace inside their own model ID, for example
     `kilo/deepseek/deepseek-v4.1-flash`.
   - A third level, upstream inference-provider routing such as OpenRouter's provider
     `order`/`only`, exists only in configuration, never in the model string.
   - Resellers with a single subscription (Cursor, Copilot, Kiro, Auggie, Antigravity,
     Devin and Junie by default) have no prefix at all: the CLI itself is the channel.
3. **A custom model string can carry settings only for some CLIs.** The runtime passes the
   string through unchanged, as a single argument. Cursor (bracket parameters), Pi
   (`:level`), Goose (effort suffix, OpenAI and xAI models only), Antigravity and Devin
   (variant IDs) parse settings out of it. The other CLIs need separate controls. See
   [Custom model strings](#custom-model-strings).

## What cats-runtime passes today

- claude: `--model <id>`, plus `--effort` from `claude.reasoning_effort`
  (`providers/claude.ts:56-60`).
- codex: `-c model="<id>"` and `-c model_reasoning_effort="<level>"` (`providers/codex.ts:142-148`).
- antigravity: `--model <id>`. Effort selects a different model ID through catalog
  `execution.variants`, for example `gemini-3.8-flash-high` (`providers/antigravity.ts:143`).
- grok: `--model <id>`, `--reasoning-effort <level>` (`providers/grok.ts:143-151`).
- muse: `--model <id>`, `--reasoning-effort <level>` (`providers/muse.ts:210-220`).
- cursor: a single `--model` holding a bracket expression such as
  `claude-opus-5[thinking=true,context=300k,effort=high,fast=false]` (`providers/cursor.ts:83-84`).
- copilot: `--model <id>`, `--effort <level>` from fixed controls (`providers/copilot.ts:73-77`).
- opencode: HTTP prompt body `model`, split at the first `/` into `providerID`/`modelID`
  (`opencode/OpencodeNativeSessionService.ts:571-587`). No `variant` is sent.
- kilo: the same split, plus a top-level `variant`. Only the fixed value `thinking` is
  used, on two rows (`providers/kilo.ts:70-72`, `kilo/KiloNativeSessionService.ts:293-303`).
- goose: `--provider <channel> --model <id>`. Thinking Off becomes the model suffix
  `-none` (`providers/goose.ts:51-58`).
- pi: `--provider <channel> --model <id> --thinking <level>` (`providers/pi.ts:27-33`).
- auggie: `--model <id>` (`providers/auggie.ts:124-126`).
- junie: `--model "<display name>"`, `--effort <level>` (`providers/junie.ts:92-102`).
- kiro: `--model <id>` (`providers/kiro.ts:66-67`).
- cline: `--provider cline-pass` (or `modelProvider`), `--model <id>`, and
  `--thinking <level>` from `cline.reasoning_effort` (`providers/cline.ts:117-130`).
- devin: ACP `session/set_config_option` for the model. Effort is encoded in the
  model UID (`catalog:2031`).

## Dimension matrix

Legend:

- **W:** cats-runtime passes it.
- **E:** the CLI exposes it, but cats-runtime does not pass it.
- **id:** encoded in the model ID or model string.
- **—:** not found.

| CLI | Routing channel | Thinking | Effort | Context | Fast / speed |
| --- | --- | --- | --- | --- | --- |
| claude | E: Bedrock/Vertex/Foundry env, `ANTHROPIC_BASE_URL`, API key vs OAuth [web] | E: `alwaysThinkingEnabled`, `MAX_THINKING_TOKENS` [web] | W `--effort` | id: `opus[1m]`; the catalog stopped using it on 2026-09-26 | E: `fastMode` setting or `/fast`; no `--fast` flag in 2.1.283 [web] |
| codex | E: `model_provider`, `--oss`, `forced_login_method` [web] | — (only `model_reasoning_summary`) | W `model_reasoning_effort` | E: `model_context_window`; cache shows `max_context_window` 872000 vs `context_window` 272000 | E: `service_tier`; cache tier `priority`, named "Fast" |
| copilot | E: `--model auto` + `--auto-tier`; BYOK `COPILOT_PROVIDER_*` env | — (effort has `none`) | W, fixed per row | E: `--context default\|long_context` | id: `claude-opus-4.8-fast`; `--auto-tier fast` |
| grok | E: per-model `api_key`/`base_url`, `XAI_API_KEY` | — (only `reasoning_summary`) | W `--reasoning-effort` | — (500000 fixed; `context_window` controls compaction) | id: `grok-4.7-build-fast` |
| antigravity | E: Google plan, Gemini API key, enterprise region | id: `claude-opus-4-6-thinking` | W as id variants; E `--effort low\|medium\|high\|max` | — | — |
| muse | E: `META_API_KEY`, `--base-url` | — (parser accepts effort `none`) | W `--reasoning-effort` | — (fixed `contextLimit`) | — |
| junie | E: `--provider openai\|anthropic\|google\|xai\|meta\|openrouter\|copilot\|litellm` | — | W `--effort`, fixed per row | E: custom-profile `maxContextLength` [web] | — (custom-profile `fasterModel` role) |
| auggie | E: hidden BYOK flags, still routed through Augment [static] | effort `none`/`dynamic` | E `--reasoning-effort` (0.36.0) | id: legacy `-500k` IDs | — |
| cursor | E: Bedrock mode (`bedrock configure`) | W bracket `thinking` | W bracket `effort`/`reasoning`/`reasoning_effort` | W bracket `context` (`1m` costs more) | W bracket `fast` |
| opencode | W `providerID` | E `variant` (`none`, `thinking`) | E `variant` (`minimal` through `max`) | E: config `limit` override | — (only an opaque `options` passthrough) |
| kilo | W `kilo` gateway | W partial: `variant` fixed to `thinking` | E `variant` (`none`, `instant`, `minimal` through `max`) | — (metadata only) | id: `glm-5.3-flashx` |
| goose | W `--provider` | W partial: Off via the `-none` suffix | E `GOOSE_THINKING_EFFORT`; suffixes `-low` to `-xhigh` | E `GOOSE_CONTEXT_LIMIT` | — |
| pi | W `--provider` | E `thinkingBudgets` | W `--thinking off…max`, fixed medium | E: `models.json` `contextWindow` | — (library `serviceTier` only) |
| kiro | — (account and region only) | E: config `thinking.type adaptive\|disabled` [web] | E `--effort low…max` | — | — |
| cline | W partial `--provider` | — (SDK `reasoningOptions` toggle or budget; no CLI flag) | W `--thinking none…xhigh` | — (fixed; `--compaction` only) | — |
| devin | — (Devin account only) | id `-thinking`; ACP `thought_level` [static] | id: UID suffix `-none` to `-max` | id: `-1m` | id: `-fast`/`-priority`; ACP `speed` [static] |

## Findings by concept

### Provider has two layers, plus a hidden credential kind

- **Name collision.** In cats-runtime, `provider` means the CLI host. `--provider` in
  Goose, Pi, Cline and Junie, and `providerID` in OpenCode and Kilo, mean a routing
  channel inside that host (`modelProvider` / `execution.provider` in the catalog).
- **Credential kind can be hidden behind one ID.**
  - Pi uses the same provider IDs for API keys and OAuth subscriptions: `anthropic`
    (Claude Pro/Max), `xai`, `github-copilot`, `openrouter` and others.
  - OpenCode does the same for `openai` (ChatGPT Plus/Pro) and `anthropic` [web].
  - Only some IDs name the subscription explicitly: Goose `chatgpt_codex`, Pi
    `openai-codex`, OpenCode `opencode-go`, Cline `cline-pass`.
- **Channels outside the model string:** Claude (Bedrock, Vertex, Foundry and gateway
  environment variables), Cursor (Bedrock mode), Copilot (`COPILOT_PROVIDER_*` BYOK
  environment variables) and Codex (`model_provider`).
- **The same upstream service has different channel IDs in each CLI:**
  - ChatGPT subscription: Goose `chatgpt_codex`, Pi `openai-codex`, Cline `openai-codex`,
    OpenCode `openai` [web].
  - OpenCode Go: Goose `opencode_go`, Pi and OpenCode `opencode-go`.
  - OpenCode Zen: Goose `opencode_zen`, Pi and OpenCode `opencode`.
  - Vercel AI Gateway: Goose `vercel_ai_gateway`, Pi `vercel-ai-gateway`, OpenCode
    `vercel` [web].

### Model

- **Router and auto "models":**
  - Cursor `auto` (the default row in `--list-models`) and Kiro `auto`.
  - Devin `adaptive` ("Automatically balances quality and cost").
  - Auggie `butler_a` and `butler_b` ("Prism", routing between named models).
  - Copilot `--model auto` together with `--auto-tier efficiency|balance|intelligence|fast`.
  - Kilo `kilo-auto/*` and `openrouter/auto`.
  - Junie's dynamically set default model.
- **Aliases:**
  - Claude `opus`/`sonnet`, `opusplan` (Opus in plan mode, Sonnet otherwise) and the
    `ANTHROPIC_DEFAULT_*_MODEL` remaps.
  - Kilo `~vendor/*-latest`.
  - Junie takes display names such as `Gemini 3.8 Flash`, while its settings store the slug.
- **Other dimensions are often folded into the model ID:**
  - effort: Antigravity, Devin, Goose `-none`, Pi `:<level>`;
  - thinking: Antigravity, Devin;
  - context: Claude `[1m]`, Auggie `-500k`, Devin `-1m`;
  - speed: Grok, Copilot, Kilo, Devin;
  - data terms: Muse `-contributor`;
  - price: Kilo `:free`.
- **Cursor legacy slugs don't reliably fix context.** Labels on 153 legacy slugs say
  "1M", yet the fixture maps `claude-opus-5-thinking-high` to the 300k variant
  (`fixtures/cursor-2026.09.15-d2fe57e/selected-variants.redacted.json:228`).

### Thinking and effort

- **Thinking takes three different forms:**
  - **An independent switch:** Cursor `thinking` (a boolean next to `effort` on Claude),
    Claude Code `alwaysThinkingEnabled` [web], Kiro `thinking.type adaptive|disabled` [web].
  - **An effort value:** Pi `--thinking off`, Goose Off, Copilot `none`/`minimal`, Auggie
    `none`/`dynamic`, Cline `none`, and OpenCode and Kilo variants `none`/`instant`.
    Kilo's `thinking` variant expands to `reasoning.enabled: true` with high effort.
  - **A token budget:** Claude `MAX_THINKING_TOKENS` [web], Pi `thinkingBudgets`, Goose
    `thinking_budget`/`budget_tokens`, Cline SDK `budget_tokens`, OpenCode model option
    `thinking.budgetTokens` [web].
- **Every effort value observed:** `none`, `off`, `instant`, `minimal`, `low`, `medium`,
  `high`, `xhigh`, `max`, `dynamic`, `thinking`, `default`, `ultra`, `ultracode`.
  Each model supports its own subset.
- **Two effort values change orchestration.** Claude `ultracode` sends xhigh plus
  dynamic workflow orchestration, and Codex `ultra` is "maximum reasoning with automatic
  task delegation". Both are modes that happen to sit in the effort menu.
- **The same concept goes by many names:**
  - Cursor `effort`, `reasoning` and `reasoning_effort` (the last displayed as "Effort").
  - Cline and Pi use the flag `--thinking` for effort levels; Goose calls it `thinking_effort`.
  - Devin labels its effort variants "Thinking" and has a separate ACP option,
    `thought_level` [static].
  - Kiro's `--effort` maps to Claude `output_config.effort` or GPT `reasoning.effort` [web].
- **Summary controls are separate** and not part of either axis: Codex
  `model_reasoning_summary` and Grok `reasoning_summary`.

### Context

- **Selectable product tier:**
  - Cursor bracket `context` (`300k|1m` or `272k|1m`; `1m` is marked `increasesModelCost`).
  - Copilot `--context default|long_context`, which Copilot describes as "for
    tiered-pricing models".
  - Claude `[1m]` suffix.
  - Devin `-1m` UIDs and Auggie `-500k` IDs (legacy).
  - Codex `model_context_window`: the local cache lists `max_context_window` 872000 for
    every model except gpt-5.5. Whether raising the window works was not verified.
- **Local overrides, not product tiers:** Goose `GOOSE_CONTEXT_LIMIT`, Pi `models.json`
  `contextWindow`, OpenCode `limit`, Junie custom-profile `maxContextLength`.
- **Compaction-only settings that look like context:** Claude `--autocompact`, Grok
  `context_window`, Muse `--context-compaction-*`, Cline `--compaction`.

### Fast

- **A service tier on the same model:** Codex `service_tier` (catalog tier ID
  `priority`, named "Fast", 1.5x–2x speed), Claude Code fast mode [web], Cursor `fast`,
  and Devin `-priority` UIDs for GPT models.
- **A separate model ID:** Grok `grok-4.7-build-fast` ("2x the price"), Copilot
  `claude-opus-4.8-fast`, Kilo `z-ai/glm-5.3-flashx`, and Devin `-fast` UIDs.
- **A router preference:** Copilot `--auto-tier fast`.
- Every form costs more. A normalized field should be named for the speed or cost
  tier, not for a boolean "fast".

### Settings outside the six concepts

- **Data-use and retention terms:**
  - Muse `-contributor` models.
  - 20 Cursor slugs labelled "(NO ZDR)" (confirmed in `--list-models`), and Cursor's
    `requires_data_retention` [static].
  - Grok `/privacy` and ZDR.
  - Devin "Prompt Cache Retention: 24h" [static].
- **Billing or context modes:** Cursor Max Mode (`maxMode`, `/max-mode`, and
  `requiresMaxMode` on variants; not available for `auto`) [static].
- **Multi-model compositions:** Devin Fusion (`fusion-<lead>-sidekick-<sidekick>`)
  [static] and Auggie Prism routers.
- **Helper and secondary models:**
  - OpenCode and Kilo `small_model`, Junie `fasterModel`.
  - Subagent models: Claude `CLAUDE_CODE_SUBAGENT_MODEL`, Goose `GOOSE_SUBAGENT_*`, and
    Codex and Copilot subagent effort settings.
  - Extra model calls: Muse `--approval-judge`, Auggie `--enhance-prompt`.
- **Mode-bound model or effort:** Claude `opusplan`, Codex `plan_mode_reasoning_effort`.
  Cline's per-mode Plan/Act models exist only in the extension; the 3.0.65 CLI keeps
  them only in its settings-migration code.
- **Fallback and rerouting:** Claude `--fallback-model`, Copilot `continueOnAutoMode`,
  and Codex's server-side `model/rerouted` event (handled at `providers/codex.ts:802`).
- **Output shaping and sampling:**
  - Codex `model_verbosity` and `personality`.
  - Temperature, `top_p` and max output tokens: Grok, Goose, OpenCode and Kilo agents,
    Junie custom profiles, Kiro `max_tokens` [web], Cline SDK.
  - Muse `--[no-]parallel-tool-calls`.
- **Spend caps:** Claude `--max-budget-usd`, Copilot `--max-ai-credits`.
- **Opaque passthroughs:** OpenCode and Kilo `variant`/`options`, Goose
  `OPENROUTER_PARAMETERS`, Junie `extraBody`.

## Routing prefixes

All cats-runtime parsers split at the first `/`, so an aggregator's `vendor/model` stays
intact (`OpencodeNativeSessionService.ts:571-587`, `KiloNativeSessionService.ts:575-591`,
`goose/parser.ts:192-214`, `pi/parser.ts:452-464`). Goose and Pi rows that carry
`execution.provider` skip parsing. Pi itself splits at the first slash only when the
prefix is a known provider, and treats a trailing `:<level>` as thinking only when the
level is valid, so OpenRouter suffixes such as `:free` survive.

- **No prefix, where the CLI itself is the channel:** Cursor, Copilot, Kiro, Auggie,
  Antigravity, Devin and Junie by default. They all resell Anthropic, OpenAI, Google
  and xAI models, and some resell open-weight models, under their own subscription or
  credits. Kiro, for example, prices models with credit multipliers from 0.05x to 6x
  [web]. The model name alone implies the upstream vendor, and naming differs by CLI:
  `claude-opus-5-5`, `Claude Fable 5.1`, `grok-4-6-medium`.
- **One level:** Goose `chatgpt_codex` + `gpt-5.6-sol`, Pi `openai-codex/gpt-5.6-sol`,
  OpenCode `opencode-go/deepseek-v4.1-flash`, Cline `cline-pass/glm-5.3`. Cline needs
  both `--provider cline-pass` and the prefixed model; the prefix alone does not select
  the channel (`providers/cline.ts:119-122`).
- **Two levels, an aggregator plus a vendor namespace:**
  - Kilo `kilo/deepseek/deepseek-v4.1-flash`: `providerID` is `kilo`, and the model is
    `deepseek/deepseek-v4.1-flash`.
  - Pi `openrouter/anthropic/…` and `vercel-ai-gateway/zai/glm-5`.
  - Goose `openrouter` + `anthropic/claude-sonnet-4`.
  - Cline `cline` + `anthropic/claude-opus-5`.
  - Kilo also nests routers: `kilo/openrouter/auto`, `kilo/kilo-auto/frontier`,
    `kilo/~openai/gpt-sol-latest`.

  The vendor namespace is part of the gateway's model ID. It is not an independent
  choice: you cannot pick `deepseek` and then change the model under it.
- **A third level, in configuration only:** upstream inference-provider routing for
  OpenRouter-style gateways. OpenCode and Kilo use
  `provider.openrouter.models.<id>.options.provider.{order,only,allow_fallbacks,sort,data_collection,zdr}`
  [web], and Pi uses `compat.openRouterRouting` / `vercelGatewayRouting`. A Kilo gateway
  routing UI was still an unmerged PR on 2026-09-25 [web]. This level is a
  request-routing policy that can also carry data-retention terms. cats-runtime sets
  none of it.

## Custom model strings

Both selection UIs hide model controls once Custom is chosen
(cats-platform `src/design/components/providerModelFieldsSupport.ts:893`, Playground
`src/http/ui/pages/playground.html:1579`). The operator asked whether the single custom
text field can instead carry effort, thinking and similar settings inside the string.

What the runtime does with the string:

- **Passed through unchanged.** It is only trimmed (`normalizeProviderCatalogModelId`,
  `src/core/models/providerModelCatalog.ts:192`) and becomes the execution model with
  empty controls and no route (`src/http/routes/sessions.ts:500-513`).
- **One exception.** If the string equals a catalog entry ID, the runtime resolves that
  entry and applies its fixed controls and provider (`sessions.ts:506`). For example,
  `chatgpt_codex/gpt-5.6-sol` typed into Goose's custom field runs with the catalog's
  Off setting, not Goose's own default.
- **No flag injection.** The string is always a single argv element, so typing
  `gpt-5.6-sol --effort high` produces an unknown-model error rather than a second flag.
  Codex also wraps it as `-c model="…"`. Windows launches keep it as one argument
  through the PowerShell base64 payload or cmd quoting
  (`src/backends/cli/runtime/runtime.ts:180-209`). This boundary is deliberate: a free-text
  field must not be able to add flags such as permission bypasses.

So a setting can travel in the string only when the CLI itself parses parameters out of
its model value.

- **Works, because the CLI parses parameters from the model value:**
  - **Cursor:** all four dimensions, for example
    `claude-opus-5[thinking=true,context=1m,effort=max,fast=true]`. This is exactly how
    the catalog executes. Parameter IDs and values are server-defined per model.
  - **Pi:** effort only, as `openai-codex/gpt-5.6-sol:high`. The runtime sends
    `--provider openai-codex --model gpt-5.6-sol:high`, and Pi treats a trailing valid
    `:off…max` as the thinking level when no `--thinking` flag is present. A custom string
    sends none (Pi 0.87.1 `dist/main.js:374-378`, `dist/core/model-resolver.js:145-200`).
  - **Goose:** effort only, as `chatgpt_codex/gpt-5.6-sol-high`, and only for OpenAI
    reasoning models and xAI. Goose turns the suffixes `-none`, `-low`, `-medium`,
    `-high` and `-xhigh` into a thinking effort (`-xhigh` becomes Max). On Claude or
    Gemini the suffix stays part of the model name (v1.52.0
    `crates/goose-provider-types/src/model.rs`, `normalize_effort_suffix`) [web].
  - **Antigravity:** effort and thinking are separate model IDs, for example
    `gemini-3.8-flash-high` and `claude-opus-4-6-thinking`.
  - **Devin:** the UID carries effort, fast or priority, `-1m` and thinking.
- **Partly works, only where a separate model ID happens to exist:**
  - **Claude:** context via `opus[1m]`; not effort, thinking or fast.
  - **Copilot:** fast only through IDs such as `claude-opus-4.8-fast`; effort and context
    are flags.
  - **Grok:** fast only through `grok-4.7-build-fast`.
  - **Muse:** data-use terms only, through `-contributor`.
  - **Auggie:** context only through legacy `-500k` IDs.
  - **Kilo:** only suffixes that are part of the ID, such as `:free` or
    `glm-5.3-flashx`. The variant is a separate HTTP body field.
- **Does not work, because effort or variant travel only in a separate flag, config key
  or body field:**
  - **Codex:** `model_reasoning_effort`.
  - **Junie:** `--effort`.
  - **Kiro:** `--effort`.
  - **Cline:** `--thinking`. A custom Cline string also cannot pick a route, except
    through the `cline-pass/` prefix.
  - **OpenCode:** `variant`. `opencode-go/minimax-m3:thinking` becomes a nonexistent
    model ID.

What this means for the UI:

- **CLIs that parse settings from the string:** Cursor, Pi, Goose with OpenAI or xAI
  models, Antigravity and Devin need only a syntax hint in the custom field, not
  controls.
- **CLIs that need a flag or body field:** Claude, Codex, Copilot, Grok, Muse, Junie,
  Cline, OpenCode and Kilo, plus Kiro and Auggie once wired, still need controls for a
  custom model. Otherwise effort cannot be set at all.
- **Pick one channel per CLI, because the two can conflict.** Pi's explicit `--thinking`
  overrides a `:level` suffix. In Goose, an explicit `thinking_effort` request parameter
  makes the suffix a no-op: it is still stripped from the name, but not applied.

## Candidate normalized shape

This is a discussion input, not a decision. Any contract change needs a spec or ADR.

- **host:** the CLI family, the existing cats `provider`.
- **route:**
  - the channel ID, kept per CLI and not unified across CLIs;
  - the credential kind: subscription, API key or cloud account;
  - optionally, gateway routing policy.
- **model:** an opaque ID that may contain a vendor namespace, plus an optional router
  flag. The namespace is display grouping only.
- **reasoning:**
  - `thinking`: off, on or adaptive, with an optional budget;
  - `effort`: a per-model enum;
  - `effort=none/off` implies thinking off.
- **context:** a tier or window size, only where the CLI treats it as selectable.
- **speed:** a tier, with an explicit cost implication.
- **terms:** data-use or retention variant.
- **extensions:** per-CLI opaque keys, such as a Kilo or OpenCode `variant`, Cursor
  Max Mode, Codex verbosity, or a summary level.

Each adapter projects this shape into its own encoding: flags, model-ID suffixes,
bracket expressions, HTTP body fields or ACP options. Per the layer rules, those quirks
stay inside `src/backends/**`.

## Discrepancies and follow-ups

None of these were changed in this survey. They are catalog or adapter work for later
review.

- **Copilot context:** the note at `catalog:1350` says the picker's context figures are
  not selectable. Copilot 1.0.88 help lists `--context default|long_context`.
- **Copilot effort flag:** 1.0.88 help lists `--reasoning-effort`, but the adapter passes
  `--effort` (`providers/copilot.ts:77`). `--effort` is documented as an alias only in
  the changelog, and no model turn verified it.
- **Codex context:** the note at `catalog:433` reports 272000. The local cache also
  advertises `max_context_window` 872000, and `model_context_window` exists [web].
- **Antigravity 1.2.11** exposes `--effort`. Cats selects effort through variant model
  IDs instead. Both work today; the flag may be simpler.
- **Unexposed effort controls:**
  - Auggie 0.36.0 `--reasoning-effort` and Kiro 2.24.1 `--effort` are not wired.
  - OpenCode never sends `variant`.
  - Four Kilo shortlist rows have variants that are not offered.
- **Custom models lose controls.** Desktop and Playground hide all model controls for a
  custom model. For flag-based CLIs, that makes effort impossible to set on a custom
  model (see [Custom model strings](#custom-model-strings)).
- **Junie `--timeout`:** the adapter passes `--timeout` (`providers/junie.ts:89`, added
  in `07fb58e`), but the flag does not appear in 26.9.22 `--help`. It may be a hidden
  option; no turn verified it.
- **Newer installs than fixtures:** 11 of the 16 installed CLIs are newer than their
  repo fixtures. Catalog refresh follows the maintain-provider-model-catalogs skill.
