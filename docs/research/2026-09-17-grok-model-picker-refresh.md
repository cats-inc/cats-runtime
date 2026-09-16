# Grok Build 1.0.34 model picker refresh

## Scope and evidence

Refresh, Grok only, confirm-uncertainty policy. The operator supplied a complete
two-model `/model` transcription and two effort screenshots on 2026-09-17 (Windows,
operator account). TUI text could not be copied. The operator confirmed the second
heading repeated `Grok 4.6` by mistake and meant `Grok 4.5`.

- [Transcription](./fixtures/grok-1.0.34/model-picker.success.redacted.txt)
- [Grok 4.6 screenshot](./fixtures/grok-1.0.34/effort-grok-4.6.redacted.png)
- [Grok 4.5 screenshot](./fixtures/grok-1.0.34/effort-grok-4.5.redacted.png)
- [Earlier raw-ID evidence](./fixtures/grok-1.0.13/models-cache.success.redacted.txt)

| Model | Effort labels, in order | CLI tokens |
|---|---|---|
| Grok 4.6 | Extra High Effort, High Effort, Medium Effort, Low Effort | xhigh, high, medium, low |
| Grok 4.5 | High Effort, Medium Effort, Low Effort | high, medium, low |

The 1.0.13 manifest and existing normalizer prove the unchanged label-to-token
mapping. Those tokens and the retained 500000 context limits were not independently
re-enumerated on 1.0.34. No CLI, authentication, or model turn was launched.
Screenshots were checked for private material before storage; none was present.

## Display and initialization decisions

The operator explicitly requested first-item UI initialization with no invented
default marker, and exclusion of the session-only `(active)` suffix. This overrides
Cats' earlier curated High defaults; it does **not** claim that the upstream
manifest's default metadata changed. Both models and all seven combinations remain.

The YAML uses exact effort labels accepted by the existing Grok normalizer. Raw
tokens remain separate in the public controls and execution arguments. Each
model's description is retained in its own option notes, including `Higher`
(4.6) versus `Highest` (4.5). The shared public enum retains its existing
first-appearance description policy; model-specific wording remains in the YAML
and source screenshots. No schema change was needed.

Playground already initializes the first applicable option. Desktop's fallback
now includes both exact model names, without a default flag, and its Grok effort
picker omits the synthetic Default option. Desktop persists the initial effort
(`xhigh` for 4.6, `high` for 4.5) so the submitted selection matches the displayed
choice. Provider default metadata remains absent; saved explicit effort survives
reload and model switches start with the new model's first option.

The operator separately authorized synchronizing the local Grok override. It was
backed up and replaced only after an unchanged-input check; readback and semantic
comparison verified all other provider blocks remained unchanged.

## Validation

- Intake normalization, observation gaps, and decision assessment: ready, no gaps.
- Focused Runtime catalog/normalization/advanced controls/Playground/Grok adapter:
  89 tests passed, including all seven label-to-token-to-argv combinations and
  rejection of `grok-4.5` with `xhigh`.
- The initial sandboxed test launch failed before collecting tests (`spawn EPERM`
  in Vite's Windows helper); the authorized retry passed.
- Runtime `npm run typecheck` passed (including its required UI generation; generated
  assets remained unchanged). The seven-file Vitest run took 5.76 seconds.
- Desktop's seven focused catalog/selection/label/DOM test files passed: 74 tests,
  33.49 seconds. Server and UI-test builds passed. See the
  [Desktop note](../../../cats-platform/docs/research/2026-09-17-grok-model-picker.md)
  for its type-check scope.
- Exact old-ID and bundled-example consumer searches retained independent historical
  manifest/default fixtures; only the bundled Grok expectations changed.
- Installed Desktop and live CLI execution were not tested. No release requested.

Last updated: 2026-09-17.
