# Antigravity 1.2.10 model catalog refresh

Observed: 2026-09-25. Mode: refresh. Policy: confirm uncertainty.
Scope: agy catalog, execution selection, Playground and Desktop consumers.

## Evidence and decisions

- The operator requested an update of the Antigravity (`agy`) model catalog using `maintain-provider-model-catalogs` paired with `desktop-ui-automation`, with interaction policy `confirm uncertainty`.
- Desktop UI Automation exploration in the agent CLI execution environment identified Windows desktop object isolation (`Desktop: exebox-...`), preventing direct interactive UIA terminal control from the sandbox. As authorized under Option A, evidence was verified via live machine enumeration using `agy models` on the locally installed Antigravity CLI 1.2.10.
- [Retained enumeration fixture](./fixtures/antigravity-1.2.10/models-command.success.redacted.txt) preserves all 14 executable combinations across 7 families:
  - Gemini 3.8 Flash (High, Medium, Low)
  - Gemini 3.7 Flash (High, Medium, Low)
  - Gemini 3.6 Flash (High, Medium, Low)
  - Gemini 3.1 Pro (High, Low)
  - Claude Sonnet 4.6 (Thinking)
  - Claude Opus 4.6 (Thinking)
  - GPT-OSS 120B (Medium)
- All 14 model slugs and display names are identical to the previously verified combinations in 1.1.24/1.2.3. No model capability was added, changed, or removed.
- Catalog metadata in `config/curated-model-catalogs.yaml.example` was updated to `cli_version: 1.2.10` and `last_updated: 2026-09-25`.
- Pre-existing policy continues: first-item initialization without invented default markers, keeping seven families and explicit `antigravity.effort` mappings to execution variants.

## UI Automation and execution metrics

- **Desktop UI Automation attempt**:
  - Investigated Windows desktop session: Session ID 2, primary screen resolution `2560 × 1306`.
  - Process isolation: Subprocess execution is confined to a sandbox desktop (`exebox-UNVIIZIJK3KOI7MRWFGD3C3K5B`), where `AutomationElement.RootElement` reports 0 children.
  - Interactive terminal launch was safely cancelled without modifying user configuration or leaving orphaned processes.
- **Screenshots**:
  - Saved screenshots: 0 (window capture blocked by desktop boundary).
  - Target resolution: `2560 × 1306` (desktop).
- **Token usage accounting**:
  - Preparation and environment inspection: ~15,000 input/cache tokens.
  - Desktop automation probe and diagnosis: ~18,000 input/cache tokens.
  - Catalog update and verification: ~12,000 input/cache tokens, ~1,500 output tokens.

## Validation

- `npm run catalog:generate`: regenerated `config/curated-model-catalogs.generated.json`.
- `npm run catalog:check`: passed code/data boundary check and artifact consistency check.
- `npx vitest run tests/catalog-data.test.ts tests/catalog-runtime.test.ts`: passed 48 tests.
- `npx vitest run src/backends/cli/providers/antigravity.test.ts src/backends/cli/providers/antigravity.fixture.test.ts`: passed 18 tests.
