# Copilot 1.0.105 catalog refresh

Date: 2026-11-02, UTC+8. Mode: refresh. Policy: confirm uncertainty. Scope: only
`copilot` / `cli` in the authored factory and generated projection, supporting evidence,
and existing catalog/Playground expectations. Other providers and their controls are unchanged.
This completes the Copilot portion deferred by the
[2026-11-01 feature-access failure](2026-11-01-seven-cli-catalog-refresh.md).

## Evidence and decisions

The owner confirmed that Copilot now works and requested another catalog refresh. Native Windows
11, Windows Terminal, installed npm GitHub Copilot CLI 1.0.105, existing Copilot Pro sign-in.
The CLI was launched in a dedicated window with auto-update, custom instructions and built-in
MCPs disabled, after clearing inherited terminal, agent and `COPILOT_*` environment variables.
No login, installation, model-selection confirmation or inference prompt was submitted.

- The bounded, existing `models.list` reader succeeded and returned fourteen rows, including
  `auto` and new `gpt-6.1-terra`. It supplies exact IDs and per-model reasoning/context metadata;
  it still omits Gemini 3.8 Flash. Its global response has `models` and `imageModels`, not the
  session picker's dynamic Auto-tier catalog.
- The default recommended-group `/model` picker was walked Down to wrap and then Up through the
  reverse order. All 33 rows were captured: fifteen selectable, eighteen plan-unavailable.
  Fourteen selectable rows had reasoning or tier arrows; every range was cycled in both
  directions and restored to its arrival value. Context figures were read without toggling Tab.
- GPT-6.1 Terra is seventh, after Claude Sonnet 5.5: reasoning Low, Medium, High, Extra High, Max;
  Context 272K / 1M (`272000` / `1000000` in the RPC). Neither its model nor its controls has a
  default marker. Arrival Medium is session state. This is the Copilot variant; Codex Terra's
  separately maintained context must not be copied here.
- GPT-5.6 Terra remains the only explicit model default. Every other existing model's reasoning
  order, Context figures and default status agree with the previous factory. Gemini 3.8 Flash
  remains selectable; retain its previously operator-confirmed `gemini-3.8-flash` ID.
- Auto now displays **Copilot Fusion**, still executed as `auto`. Its arrows remain at Standard;
  the matched visible detail pane explicitly marks High and Max unavailable for this plan.
  The old capture helper reports this renamed pane as unmatched. Its row/option observation is
  retained, while the detail-pane availability and description are recorded separately as a
  manual UI Automation observation checked against a private screenshot.

Material questions and answers:

1. Windows refused automatic focus transfer. The owner brought the dedicated capture window
   forward when asked. No picker keys were sent while focus was unverified.
2. The global RPC exposes no raw tier IDs. Independent read-only inspection of the installed
   native schema says Standard uses Auto Balance, but also warns against synthesizing an
   `autoTier` from `fusionTier`. This is supporting static evidence, not account proof.
   The owner explicitly answered **“確認 balance → Standard，更新 Fusion 與 Terra”** to adopting
   `--auto-tier balance` for Standard and removing the old Efficiency/Intelligence choices.
   That operator-confirmed mapping settles the data edit; no `standard` token is guessed and no
   High/Max mapping is adopted. The decision assessor reports all four proposed changes ready.

Evidence:

- [Account model projection](fixtures/copilot-1.0.105/model-list-2026-11-02.probe.redacted.json)
- [Ordered picker rows, per-row option cycles, pane qualification and operator decision](fixtures/copilot-1.0.105/model-picker.agent-capture.2026-11-02.redacted.json)
- [Supporting static schema excerpt and artifact hashes](fixtures/copilot-1.0.105/fusion-tier-static.2026-11-02.redacted.json)

The old 403 fixture and earlier captures remain historical evidence. The new successful read
does not rewrite what the earlier release actually contained.

## Projection and behavior

- Add GPT-6.1 Terra with separate reasoning and context controls, in observed order. Selection
  starts at Low and default context and sends both values under the existing first-value policy.
- Rename Auto's display to Copilot Fusion, retaining Auto in `source_names`. Its sole Tier value
  is Standard with executable token `balance`; selecting it emits `--model auto --auto-tier balance`.
  The single available value does not establish a declared control default.
- Keep all fourteen existing model IDs. No model is removed, no binding/schema/adapter changes,
  and no new capability or image-support claim is introduced. The captured unavailable rows
  stay in evidence; the factory remains scoped to the Copilot Pro plan and allows custom input.
- Advance the Copilot CLI version and scope date only after the complete picker was reread.
  Factory sourceDigest: `d564a694089df72ddf4ae92cd33fbb7043d16ca63debbb28af495e445c19d1fa`.

Runtime and Playground consume this same factory. Platform reads Runtime catalog observations
and the shared read-only projection; it has no separate model table to refresh. Bot continues
to offer the owner-selected Codex, Claude, Antigravity, Grok and Muse providers, so Copilot does
not expand its menu. Historical consumer/release notes and frozen migration fixtures retain
their old observations. This source refresh does not replace an installed Desktop/Bot Runtime.

## Validation

- `catalog:generate` and `catalog:check` passed, including the code/data boundary guard.
- A private evidence comparison checked all fifteen candidate rows against the complete picker,
  every reasoning/context/tier value, default markers, and unchanged non-Copilot scopes.
- Catalog-data 22, catalog-runtime 38, Playground shared 22 and Copilot provider 41: **123 tests
  passed**. These cover accepted data, first-value rendering, custom strings, selection resolution
  and actual emitted CLI arguments. This is focused validation, not a full-suite claim.
- `npm run typecheck` passed after an isolated `npm ci --ignore-scripts` installed the existing
  lockfile dependencies. The first attempt reused the main checkout's partial dependency folder
  and failed only because `pngjs` was absent. Package manifests/lockfiles were not changed; the
  shared dependency folder was preserved. Relevant passing focused tests were reused.
- Both Copilot configuration files kept their pre-launch SHA-256 through capture and shutdown.
  Ordinary CLI session/cache records were created by startup. No Cats product records were added.

## Capture cost and temporary scripts

The dedicated CLI's shutdown receipt records zero premium requests, zero nano-AIU and zero API
duration, with no user/assistant messages. Its loaded context-token count is not billed inference.
Five screenshot saves produced three distinct private 1129×635 PNG files; two images were viewed
by the agent (about 1,912 image-input tokens using the workspace's pixel estimator). The 228
navigation/option steps otherwise used UI Automation text. Orchestrator token/currency totals
are not exposed by this host, so no total-cost claim is made.

Run-local files are private under `tmp/copilot-refresh-20261102/`; images and raw session material
are outside Git. No new reusable script was added: the existing catalog reader, picker capture,
decision assessor and Windows UI helpers did the reusable work. The following wrappers duplicate
those helpers or encode this capture/version and are intentionally not kept in the repository:

| Script | Purpose and reuse verdict |
| --- | --- |
| `launch-capture.ps1` | This run's title, paths, flags and cleared environment names; use `Start-WindowsUiTerminal` for another run. |
| `type-model.ps1` | Guarded typing of this run's slash commands; delegates to the existing UI helper. `/status` only autocompleted to `/statusline` and was cancelled without Enter. |
| `open-picker.ps1` | One guarded bare `/model` Enter. A wrapper-only wait-parameter error stopped after opening; the key was not replayed. |
| `snapshot-picker.ps1` | Observe the already-open picker and hash the selected configuration files. |
| `window-state.ps1` | Read the owned window's current UIA state and foreground identity. |
| `input-desktop.ps1` | Read input-desktop readiness without switching desktops or changing permissions. |
| `focus-surface.ps1` | Guarded focus diagnosis; foreground validation failed and no picker input was sent. |
| `inspect-model-metadata.mjs` | Version-specific bounded metadata-shape projection; discovered the global RPC lacks Auto tiers. |
| `metadata-reader.generated.mjs` | Temporary derived reader for that shape check; no new RPC method, session or prompt. |
| `inspect-routing-cache.py` | Unsuccessful JSON-format check of an opaque CLI cache; not used as catalog evidence and not decoded further. |
| `cancel-picker.ps1` | Cancel the owned picker after the complete capture. |
| `clear-unexecuted-command.ps1` | Cancel the unexecuted `/statusline` autocomplete. The dedicated CLI subsequently shut down; a later `/session` typing attempt stopped because its target was gone. |
| `inspect-owned-session.mjs` | Allowlisted model/cost fields from the uniquely identified empty capture session; no user content or session identity retained. |
| `prepare-evidence.mjs` | This run's ordered evidence assembly and scoped candidate comparison. |
| Reused private `inspect.ps1` | Earlier same-machine UI readiness/focus wrapper; canonical `WindowsUi.ps1` remains the reusable implementation. |
| In-memory native payload inspection | Independent, read-only version-specific gzip/tar/schema inspection; no embedded module was executed or extracted to disk. |

The capture helper was not changed to understand the Fusion detail pane. That limitation is
explicit in both the fixture and the validation above; no second capture was needed.
