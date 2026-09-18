---
name: maintain-provider-model-catalogs
description: >-
  Refresh, audit, or independently review cats-runtime provider model catalogs, including raw
  pasted CLI model-picker or option-picker evidence. A bare catalog-evidence paste is preview-only.
  Do not use for ordinary current-session model selection or troubleshooting, generic provider
  adapter work, or dependency updates without catalog-maintenance intent.
---

# Maintain Provider Model Catalogs

Maintain `cats-runtime` catalog knowledge from observable evidence without flattening
provider-specific model options or expanding the operator's scope.

## Maintenance and menu policy

The operator-approved policy is recorded in the 2026-09-17 amendment to
`docs/specs/SPEC-028-provider-model-catalog-maintenance-skill.md` in cats-runtime:

- **Full catalogs:** Codex, Claude, Antigravity (`agy`), Grok, and Muse. Maintain the complete
  evidenced CLI model lists and applicable effort/options; offer all of them in Desktop and
  Playground, plus custom model-string input. The six-model limit does not apply to this group.
- **Shortlists:** Cursor Agent, Goose, Junie, Devin, Kiro, GitHub Copilot, OpenCode, Kilo Code,
  Auggie, Pi, and Cline. Maintain at most six explicitly selected model entries per CLI, plus
  custom input. Effort remains attached to its model; the custom-input action is not a model slot.
- Approved shortlists are recorded in `docs/research/2026-09-17-cursor-fixed-presets.md`,
  `docs/research/2026-09-17-copilot-fixed-presets.md`,
  `docs/research/2026-09-18-opencode-shortlist.md`,
  `docs/research/2026-09-18-kilo-shortlist.md`,
  `docs/research/2026-09-18-devin-shortlist.md`,
  `docs/research/2026-09-18-cline-shortlist.md`, and
  `docs/research/2026-09-18-kiro-shortlist.md`.
  Other shortlist members/order are pending individual operator decisions. Do not truncate current
  catalogs or select the first six discovered models from this policy alone. These are product
  policy groups, not a substitute for deriving the registered inventory during an audit.
- Custom input remains available for both groups, including API-key-backed use on supported
  execution paths. Preserve backend-specific identifiers; this policy does not establish new
  adapter/API support or unknown model capabilities.

Cursor uses fixed parameterized model strings; Copilot resolves fixed effort separately from its
model id; OpenCode uses provider-qualified model IDs without evidenced option controls; Kilo
resolves approved fixed variants separately from the raw model ID; Devin uses executable variant
UIDs containing the fixed effort on its agent/ACP target; ClinePass uses explicit CLI provider
selection plus a separate fixed thinking argument; Kiro uses verbatim model IDs with no
evidenced option controls. Other shortlist rollouts remain pending.
No scheduled refresh cadence or automated refresh job has been specified.

## Route the request

- **Refresh**: collect evidence and edit only the provider scope the operator authorized.
- **Review**: independently reacquire or inspect evidence and report findings. Do not edit unless
  the operator separately asks for a fix.
- **Audit**: derive the current provider inventory from code and classify every registered family
  across all catalog surfaces.
- **Capture/preview**: use for a raw picker paste that is supplied as catalog evidence without an
  edit request. Parse and summarize it, but do not modify repository files, including evidence
  fixtures.

Do not claim a `/model` paste that the operator supplied only to select or troubleshoot the current
session model. Catalog-maintenance intent must also be present.

## Start safely

1. Work from the `cats-runtime` repository root and read its current agent instructions.
2. Run `git status --short --branch`. Preserve every unrelated tracked and untracked change.
3. Record the requested provider/file scope, mode, and interaction policy before collecting
   evidence. A provider-scoped request does not authorize global catalog cleanup.
4. Read [evidence and scope](./references/evidence-and-scope.md). Read
   [catalog surfaces](./references/catalog-surfaces.md) when inventorying, editing, or auditing.
5. For supplied picker text, screenshots, or transcription, read
   [paste intake](./references/paste-intake.md) before interpreting it. Load a provider reference
   only when that provider is in scope.

## Select the interaction policy from plain language

- **capture/preview**: default for a bare paste; report the reading and gaps without editing.
- **confirm all**: show a compact redacted preview of all parsed models, labels, option axes,
  values, defaults, completeness, and gaps before editing.
- **confirm uncertainty**: default for an explicit update request; confirm only material
  uncertainty and hard gates, then apply the confirmed in-scope subset.
- **apply authorized**: when explicitly requested, apply unambiguous in-scope readings without a
  routine preview. Omit and report non-hard low-confidence readings.

No policy bypasses a hard gate. Stop for confirmation when a proposed edit depends on:

- whether a marker means account default or only current selection;
- whether a list is complete before a removal or `last_updated` change;
- an unobserved raw id, raw option token, or label-to-token mapping;
- choosing between conflicting evidence;
- deleting a row, expanding scope, or projecting away observed hierarchy.

Check the conversation before asking: an explicit answer already covering the same evidence and
proposed change satisfies that question. Group remaining uncertainties into one compact delta;
do not restart intake after each answer or extend old authorization to new removals.

For paste-driven edits, create the agent-owned decision artifact described in
[paste intake](./references/paste-intake.md), run its `assess` command, and honor the resulting
ready, confirmation-required, omitted, and deferred classifications. Never ask the operator to
author that artifact.

## Perform the mode

### Refresh

1. Locate the requested provider's catalog path using its reference and current code. Reserve the
   full provider inventory for an audit; a single-provider refresh does not require one.
2. Use sufficient supplied evidence before collecting more. Do not launch a CLI, research unrelated
   providers, or repeat a capture merely to corroborate a complete, unambiguous picker paste.
   Authentication, paid probes, or quota use require explicit authorization.
3. Preserve raw ids separately from visible labels. Build a lossless ordered observation tree for
   pasted evidence before considering YAML.
4. Inspect the typed curated schema and the relevant normalizer. Loss-check every observation-tree
   branch against the schema. Distinguish a data refresh using existing defaults/options from a
   demonstrated behavior gap that needs separately scoped implementation; reuse existing support.
5. Apply only the authorized, representable subset. Partial evidence never removes existing data
   or propagates one model's options to another model.
6. Before the final gate, search each affected repository for the exact old labels/ids and bundled
   example consumers, including display consumers outside model selectors. Follow the consumer
   classification in [catalog surfaces](./references/catalog-surfaces.md).

### Review

1. Treat the submitted diff and another agent's notes as claims, not proof.
2. Reacquire available evidence independently, or state exactly what cannot be verified.
3. Check scope, evidence priority, raw-id/label separation, completeness, `last_updated`, normalizer
   acceptance, projection loss, and whether the chosen interaction policy was honored.
4. Report findings without editing unless the operator asked for fixes.

### Audit

1. Derive all registered provider families from current code and reconcile them with curated YAML,
   static fallback, dynamic discovery, normalization, advanced knowledge, install knowledge, and
   tests.
2. Classify each provider as dynamic, curated, static fallback, intentionally empty,
   account-configured/BYO-model, provider-default sentinel, unsupported, or an actionable gap.
3. Include registered providers absent from curated YAML. Installation method does not determine
   whether catalog maintenance applies.
4. Report stale, missing, conflicting, intentionally empty, and unverified coverage. Do not mutate
   drift merely because it was observed.

## Validate and report

Choose validation proportional to the changed surface. Catalog edits require YAML/schema loading
with no unexpected normalization warnings, focused catalog and advanced-knowledge tests, and a
repo-wide exact-fixture search. Run TypeScript checking when TypeScript or tests changed. Separate
pre-existing environment failures from regressions; do not edit unrelated tests to make them pass.
Follow the owning repository's Local Validation Scope: reuse relevant passing checks and leave
full-suite CI gates to CI; commit/PR creation alone does not require a full local suite.
Follow the scheduling and failure-handling guidance in [catalog surfaces](./references/catalog-surfaces.md).

Keep the following in the evidence note or final report; link the durable note instead of repeating
the entire intake history in chat. The final response should summarize the delta, validation, and
any unresolved limitation:

- mode, provider/file scope, and interaction policy;
- observations and their sources, versions, account scope, and completeness;
- unknowns, omitted rows/claims, unresolved gaps, and conflict decisions;
- every material question asked and the operator's answer;
- files changed and any intentionally retained existing data;
- validation results and unrelated failures.

Stop before commit, push, pull request, release, or publication unless the operator separately
authorizes that external mutation.

## Conditional provider references

- [Antigravity (agy)](./references/providers/antigravity.md): separate picker families/effort from
  executable model ids, first-item initialization without default claims, and structured selection.
- [Claude](./references/providers/claude.md): supplied picker fast path, alias/label projection,
  per-model effort, and existing Runtime/Desktop support; compiled extraction is a possible superset.
- [Cline](./references/providers/cline.md): bounded installed ClinePass mappings, explicit provider
  routing, fixed thinking arguments and consistent structured/plain-string execution.
- [Codex](./references/providers/codex.md): supplied picker evidence, existing per-model defaults,
  exact display labels, fallback locations, and focused Runtime/Desktop validation.
- [Copilot](./references/providers/copilot.md): bounded `models.list` reads, picker/session evidence
  for omitted rows, and fixed effort execution without editable controls.
- [Cursor](./references/providers/cursor.md): exact parameterized variant strings, fixed-combination
  shortlists, refresh/custom-input preservation, and isolated discovery fixtures.
- [Devin](./references/providers/devin.md): family versus executable variant UIDs, bounded JSON
  mapping evidence, ACP new/resume model application, and response-consumer validation.
- [Grok](./references/providers/grok.md): screenshot/transcription evidence, retained effort-token
  mappings, and first-item selection that reaches the execution arguments.
- [Kiro](./references/providers/kiro.md): raw-ID shortlist updates, Native/WSL fallbacks,
  first-row initialization and account-gated model/effort evidence.
- [Kilo](./references/providers/kilo.md): distinguish gateway mappings from the picker and
  execution variants from display-only thinking flags.
- [Muse](./references/providers/muse.md): MSP model-id enumeration versus per-model picker efforts;
  global help is not a menu, and MSP `isDefault` must not be copied into curated YAML.
- [OpenCode](./references/providers/opencode.md): verbose ID/name enumeration, same-name provider
  disambiguation, and entry-only shortlist wiring.

For providers without a reference, inspect the current adapter, discovery helper, catalog notes,
and retained evidence. Add a provider reference only when a stable, non-obvious procedure is proven;
do not copy current model values into this skill.
