# SPEC-032: Model Selector Custom Controls, Route Display and Cost Signals

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft — pending approval (not approved) |
| **Owner** | Runtime catalog workstream; Platform owns the Desktop consumer |
| **Reviewer** | User |
| **Evidence** | [CLI model-setting dimensions](../research/2026-09-26-cli-model-setting-dimensions.md) |
| **Plan** | [PLAN-042](../plans/PLAN-042-model-selector-custom-controls-route-and-cost-signals.md) (on hold) |

Nothing in this spec is approved for implementation. It records the proposal so it can
be reviewed.

## Summary

The Desktop and Playground model selectors already render catalog controls generically:
enum, boolean, number and string, scoped to individual entries. Thinking, effort, context
and fast settings therefore need catalog data and adapter wiring, not new selector
components. The
[research survey](../research/2026-09-26-cli-model-setting-dimensions.md) found four gaps
this spec addresses:

1. **Custom models lose all controls.** Both selectors hide controls once Custom is
   chosen, and the runtime forces empty controls for a custom model
   (`src/http/routes/sessions.ts:506-513`). So "custom model plus effort high" cannot be
   expressed today. Only some CLIs parse settings out of the model string itself.
2. **The routing channel is invisible or inconsistent.** Pi labels show `[openai-codex]`,
   but Goose labels do not show `chatgpt_codex`. The channel decides account and billing.
3. **Cost and data-use variants look like any other row.** Examples: fast rows, 1M
   context, Muse `-contributor` and Cursor "(NO ZDR)" models.
4. **Every CLI catalog shows a disabled Mode field.** None of the 16 CLI catalogs define
   presets, so Mode always reads "Standard only".

## Goals

- A custom model string can carry settings, through exactly one channel per CLI:
  - a syntax hint, for CLIs that parse settings from the model value;
  - catalog-declared controls, for CLIs that take settings as flags or body fields.
- Each entry shows its routing channel as read-only text wherever the runtime knows it.
- Entries that raise cost or change data-use terms carry a visible badge driven by
  catalog data.
- The Mode field disappears when no preset applies.

## Non-Goals

- **No channel selector.** A route selector between Provider and Model is deferred until
  a multi-channel CLI leaves fixed shortlists.
- **No unbundling of fixed combinations.** Examples include independent Cursor context,
  effort and fast controls. Inter-control dependency rules are also deferred.
- **No normalized cross-CLI dimension model.** The research note's candidate shape stays
  a discussion input.
- **No CLI-local settings.** Subagent models, fallback models, helper models, sampling,
  spend caps and upstream inference-provider routing stay out of the selector.
- **No catalog refresh.** Wiring of Kiro or Auggie effort, OpenCode `variant`, the
  Copilot `--context` flag and the other research discrepancies is tracked separately.
  This spec only consumes them once they exist.

## User Stories

- As an operator, I type a custom Claude or Codex model and still choose its effort.
- As an operator, I type a custom Cursor model and see the bracket syntax I can use,
  instead of a control that the string would contradict.
- As an operator, I can see that a Goose row runs through my ChatGPT Codex subscription
  before I start a session.
- As an operator, I notice that a row is a "fast" tier, costs more, or shares content
  before I pick it.

## Requirements

### Functional Requirements

1. **FR-1 Custom-model declaration.** A CLI catalog scope may declare how custom model
   strings accept settings:
   - `mode`: `syntax`, `controls` or `none`.
   - For `syntax`: a short hint and optional examples.
   - For `controls`: control definitions with the existing `CatalogControl` shape.
   - An absent declaration means `none`, which is today's behaviour.
2. **FR-2 No forced value.** Custom-model controls are optional. An unset control sends
   nothing, so the CLI uses its own default. Both selectors must offer an explicit
   "CLI default" choice rather than silently selecting the first enum value.
3. **FR-3 Runtime acceptance.** A session request whose selection names an entry ID not
   in the catalog may carry controls only when the scope declares `mode: controls`.
   - Each key must be declared, and each value must match the declared kind and values.
   - Anything else is rejected with a clear error, as unknown controls are today.
   - Accepted controls reach the adapter as `modelControls` through the existing path.
   - The resolution records the model as custom, with a warning that the combination
     is unverified.
4. **FR-4 Single channel per CLI.** A scope with `mode: syntax` must not also expose
   custom controls. This avoids CLI-specific precedence conflicts: Pi's `--thinking`
   overrides a `:level` suffix, and an explicit Goose effort makes the suffix a no-op.
5. **FR-5 Initial assignment.** This is a proposal to confirm at approval (see Open
   Questions).
   - `syntax`:
     - Cursor: `model[param=value,…]`.
     - Pi: `provider/model:<level>`.
     - Goose: `provider/model-<none|low|medium|high|xhigh>`, for OpenAI reasoning and
       xAI models only.
     - Antigravity and Devin: effort-bearing model IDs.
   - `controls`:
     - Existing adapter keys: Claude, Codex, Copilot, Grok, Muse, Junie and Cline effort,
       and the Kilo variant.
     - OpenCode, once its `variant` wiring exists.
   - `none`: Kiro and Auggie until their effort flags are wired.
6. **FR-6 Route display.** The advanced catalog exposes a read-only route for each entry
   when one is known, and both selectors render it under the Model field.
   - Sources: `execution.provider` (Goose, Pi, Cline), or the adapter-owned model-string
     prefix (OpenCode, Kilo).
   - Display text is catalog data, for example a map from channel ID to label, never a
     UI table. Absent data renders nothing.
7. **FR-7 Cost and data-use badges.** Two entry `capabilityTags` values get defined
   display semantics: one for "raises cost or usage", one for "changes data-use terms".
   Names are to be decided. Both selectors render them as badges. Initial data tags the
   existing Cursor fast rows, Grok `grok-4.7-build-fast` and the Muse `-contributor` rows.
8. **FR-8 Mode visibility.** Both selectors hide the Mode field when no preset applies to
   the selected entry. API and local catalogs with presets keep today's behaviour.

### Non-Functional Requirements

- **Security:** a custom string remains a single argument. The existing pass-through and
  Windows quoting boundary is unchanged, and no feature here may add a path that turns
  free text into additional CLI flags.
- **Layering:** channel derivation and syntax knowledge stay inside
  `src/backends/**` and catalog data. Core and HTTP only carry declared data.
- **Compatibility:**
  - Catalog validation is strict (`src/catalogs/schema.ts:107`), so a Runtime at or
    below 0.3.x rejects a catalog that uses the new optional keys.
  - Selection and catalog API additions are additive.
  - The needed boundary is recorded under Open Questions; no version is bumped by this
    spec.
- **Pre-release policy:** replace the custom-model `controls: {}` path in place. Do not
  keep a parallel legacy path.

## Design Overview

```
catalog scope ── custom_model: { mode, hint?, examples?, controls? }   (FR-1)
      │         route label map (FR-6), capabilityTags vocabulary (FR-7)
      ▼
runtime advanced catalog API ── customModel, entry.route, tags         (additive)
      │
      ├─ Playground selector ─┐  custom: hint XOR controls (+ CLI default)
      └─ Desktop selector ────┘  route line, badges, Mode hidden if no presets
      │
session request ── selection{ entryId: <custom>, controls }             (FR-3)
      ▼
runtime validation ── declared keys/values only ── modelControls ── adapter (unchanged flags)
```

## Dependencies

- Research evidence:
  [2026-09-26-cli-model-setting-dimensions](../research/2026-09-26-cli-model-setting-dimensions.md).
- The catalog schema and resolver from
  [SPEC-031](./SPEC-031-provider-catalog-data-and-local-overrides.md).
- cats-platform Desktop selector: `src/design/components/ProviderModelFields.tsx`,
  `providerModelFieldsSupport.ts`, `ProviderModelFieldControls.tsx` and
  `src/shared/providerCatalog.ts`.
- Adapter follow-ups (OpenCode `variant`, Kiro and Auggie effort) are prerequisites only
  for moving those CLIs out of `mode: none`.

## Open Questions

- [ ] Approve or amend the FR-5 per-CLI assignment. Pi could use `controls` instead,
      since `--thinking` is already wired and an explicit flag wins over a suffix.
- [ ] Should custom-model control values be the union of the CLI's known values, or a
      separately curated list?
- [ ] Choose field names: the scope key, the API field and the two tag values.
- [ ] Decide the release boundary. New optional catalog keys are rejected by strict
      readers in Runtime ≤0.3.x. Should this ship as Runtime 0.4.0, or does the
      reviewer treat additive optional keys as compatible within 0.3.x? Platform's
      additions are optional reads, but they depend on the bundled Runtime.
- [ ] Route display for Cline custom strings, which cannot pick a channel except through
      the `cline-pass/` prefix.

## References

- [SPEC-018: Advanced provider model catalog and selection schema](./SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [SPEC-023: Verified advanced provider catalogs](./SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
- [SPEC-031: Provider catalog data and local overrides](./SPEC-031-provider-catalog-data-and-local-overrides.md)
- [Research: CLI model-setting dimensions](../research/2026-09-26-cli-model-setting-dimensions.md)

---

*Created: 2026-09-26*
*Author: Claude (agent), from the operator's review of the research note*
*Related Plan: [PLAN-042](../plans/PLAN-042-model-selector-custom-controls-route-and-cost-signals.md)*
