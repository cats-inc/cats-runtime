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
5. If raw terminal output is present, read [paste intake](./references/paste-intake.md) before
   interpreting it. Load a provider reference only when that provider is in scope.

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

For paste-driven edits, create the agent-owned decision artifact described in
[paste intake](./references/paste-intake.md), run its `assess` command, and honor the resulting
ready, confirmation-required, omitted, and deferred classifications. Never ask the operator to
author that artifact.

## Perform the mode

### Refresh

1. Derive the current provider inventory and applicable catalog path from repository code; never
   use a fixed provider count or list stored in this skill.
2. Acquire the strongest available in-scope evidence. Authentication, paid probes, or quota use
   require explicit authorization.
3. Preserve raw ids separately from visible labels. Build a lossless ordered observation tree for
   pasted evidence before considering YAML.
4. Inspect the typed curated schema and the relevant normalizer. Loss-check every observation-tree
   branch against the schema.
5. Apply only the authorized, representable subset. Partial evidence never removes existing data
   or propagates one model's options to another model.
6. Search the whole repository for consumers of the exact bundled example before changing tests or
   assertions.

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

The final report must include:

- mode, provider/file scope, and interaction policy;
- observations and their sources, versions, account scope, and completeness;
- unknowns, omitted rows/claims, unresolved gaps, and conflict decisions;
- every material question asked and the operator's answer;
- files changed and any intentionally retained existing data;
- validation results and unrelated failures.

Stop before commit, push, pull request, release, or publication unless the operator separately
authorizes that external mutation.

## Conditional provider references

- [Claude](./references/providers/claude.md): picker-first evidence; compiled extraction is a
  possible superset.
- [Copilot](./references/providers/copilot.md): account-resolved interactive model list.
- [Kiro](./references/providers/kiro.md): authenticated, account-gated model listing and effort.
- [Kilo](./references/providers/kilo.md): distinguish the gateway catalog from the picker.

For providers without a reference, inspect the current adapter, discovery helper, catalog notes,
and retained evidence. Add a provider reference only when a stable, non-obvious procedure is proven;
do not copy current model values into this skill.
