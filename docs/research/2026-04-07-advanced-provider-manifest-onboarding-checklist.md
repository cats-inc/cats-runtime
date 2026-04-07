# 2026-04-07 Advanced Provider Manifest Onboarding Checklist

## Summary

This checklist turns the `SPEC-023` / `PLAN-026` verified-manifest rollout into
an explicit repeatable process.

Use it before promoting any provider target from conservative
`unverified_omitted` advanced catalogs to public `verified_manifest` metadata.

The goal is narrow:

- keep public advanced catalogs truthful
- require concrete runtime-owned evidence before widening support
- make future manifest additions auditable in repo memory

## Scope

This checklist applies to one concrete runtime target at a time:

- provider family
- backend family
- concrete transport/runtime shape when relevant

Examples:

- `provider=codex`, `backend=api`, `transport=openai`
- `provider=claude`, `backend=cli`
- `provider=ollama`, `backend=local`, `transport=ollama`

Do not mark an entire provider family as verified unless the manifest matcher is
actually scoped that broadly and the evidence truly covers every target that
matcher would include.

## Exit Criteria

Only promote a target to `verified_manifest` when all items below are true:

- The target already has runtime-owned selection or execution handling for every
  public control being exposed.
- The target's public `entries`, `presets`, `controls`, and
  `defaultSelection` are all explainable from runtime-owned evidence.
- Conservative mode would be meaningfully worse than the verified shape for
  operators or hosts.
- The manifest matcher is narrow enough that nearby targets are not
  accidentally promoted by pattern overlap.
- Repo memory includes a research note section for the manifest id/version.
- Regression coverage locks both the public catalog shape and the execution or
  resolver behavior that makes that shape truthful.

If any one of those is not true, keep the target in conservative
`entry_only` mode.

## Checklist

### 1. Target Boundary

- [ ] Write the exact target matcher in plain language:
      provider, backend, and any transport/runtime qualifiers.
- [ ] Confirm that no adjacent targets would be incorrectly matched by the same
      predicate.
- [ ] Confirm whether the manifest is target-specific or should remain split
      into multiple manifests.

### 2. Evidence Basis

- [ ] Identify the runtime-owned source of truth for each public control or
      preset:
      CLI args, request-body patching, local transport parameters, or other
      runtime-owned execution logic.
- [ ] Confirm that each exposed value is actually accepted by the target.
- [ ] Confirm per-entry applicability where values differ by model.
- [ ] Confirm default behavior:
      the public `defaultSelection` must match runtime-owned behavior, not just
      a UI preference.
- [ ] Record the evidence in a research note section keyed by manifest id and
      version.

### 3. Public Catalog Shape

- [ ] Verify that `entries` are stable enough to host public advanced metadata.
- [ ] Add only controls that the runtime can already validate and deliver.
- [ ] Add presets only when their preferred entry and default controls are
      evidence-backed.
- [ ] Keep unsupported controls or guessed presets out of the public catalog.
- [ ] Recheck whether the support tier should be `full` or `read_only`;
      default to the narrower tier when in doubt.

### 4. Runtime Wiring

- [ ] Add or update the manifest in
      `src/core/models/providerAdvancedKnowledge.ts`.
- [ ] Keep `evidenceRefs` pointed at the research note section for this exact
      manifest id/version.
- [ ] Ensure `buildProviderAdvancedKnowledge()` still falls back to
      conservative `unverified_omitted` metadata for all non-matching targets.

### 5. Regression Coverage

- [ ] Add/extend `src/core/models/providerAdvancedKnowledge.test.ts` to lock the
      public advanced catalog shape and provenance metadata.
- [ ] Add/extend `src/core/models/providerSelectionResolution.test.ts` when the
      manifest exposes controls or defaults that affect selection resolution.
- [ ] Add/extend route coverage such as
      `src/core/models/providerModelCatalog.test.ts` or
      `tests/runtime-server.test.ts` so public HTTP behavior stays truthful.
- [ ] Verify at least one negative case proving a nearby non-verified target
      still stays conservative.

### 6. Documentation Follow-through

- [ ] Add or update the corresponding section in
      `docs/research/2026-04-07-advanced-provider-manifest-baseline.md`, or
      create a successor research note if the baseline note is no longer the
      right anchor.
- [ ] Update `docs/research/README.md` if a new research note was added.
- [ ] Update `PLAN-026` progress log when the promotion lands.
- [ ] If the manifest materially changes operator-visible behavior, update
      `ROADMAP.md` / `PROGRESS.md` summaries as needed.

## Non-Goals

This checklist does not justify:

- widening manifests because a provider "probably" supports something
- exposing presets just because model names look similar
- promoting targets based only on vendor marketing copy without runtime-owned
  enforcement or regression coverage
- merging multiple transports into one manifest to reduce file count

## Current Baseline Reminder

As of 2026-04-07, the verified baseline remains intentionally small:

- `codex-api-openai-v1`
- `codex-cli-v1`
- `claude-cli-v1`
- `ollama-local-v1`

All other targets should stay conservative until this checklist is completed for
their exact matcher.
