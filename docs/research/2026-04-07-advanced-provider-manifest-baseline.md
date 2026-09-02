# 2026-04-07 Advanced Provider Manifest Baseline

## Summary

This note records the first runtime-owned advanced-provider manifest baseline
used by `SPEC-023` / `PLAN-026`.

The goal is narrow: freeze which provider targets are currently treated as
verified for public advanced metadata, and point future audits at one repo
location instead of leaving the knowledge implicit inside route builders.

## Verified Targets

### `codex-api-openai-v1`

- Target match: `provider=codex`, `backend=api`, `transport=openai`
- Verified metadata:
  - `openai.reasoning_effort`
  - runtime-owned `balanced` / `fast` / `deep_reasoning` presets
  - default selection derived from the verified preset/control set
- Evidence basis:
  - current runtime behavior already ships transport-specific request mapping in
    `src/core/models/providerSelectionResolution.ts`
  - regression coverage locks the public catalog shape in
    `src/core/models/providerAdvancedKnowledge.test.ts`,
    `src/core/models/providerModelCatalog.test.ts`, and
    `tests/runtime-server.test.ts`

### `codex-cli-v1`

- Target match: `provider=codex`, `backend=cli`
- Verified metadata:
  - entry-scoped `codex.reasoning_effort`
  - no public presets; default selection remains explicit
- Evidence basis:
  - current runtime behavior already maps this control into runtime-owned
    request patches in `src/core/models/providerSelectionResolution.ts`
  - regression coverage locks entry-specific values/defaults in
    `src/core/models/providerAdvancedKnowledge.test.ts`,
    `src/core/models/providerSelectionResolution.test.ts`, and
    `tests/runtime-server.test.ts`

### `claude-cli-v1`

- Target match: `provider=claude`, `backend=cli`
- Verified metadata:
  - entry-scoped `claude.reasoning_effort`
  - executable alias entries `opus` / `fable` / `sonnet` / `haiku`
  - Low / Medium / High / xHigh / Max / Ultracode for Opus, Fable, and Sonnet,
    with High as the observed default; Haiku does not support effort
  - no public presets; default selection remains explicit
- Evidence basis:
  - the operator-confirmed complete Claude Code 2.1.257 interactive `/model`
    picker capture in
    `docs/research/fixtures/claude-2.1.257/model-picker.success.redacted.txt`
  - read-only Claude Code 2.1.258 `--help`, static artifact extraction, and a
    successful `claude --effort ultracode --version` parser check independently
    confirm the `fable` alias and raw `ultracode` session value; the newer
    artifact is token-mapping evidence, not 2.1.257 account entitlement
  - the picker-visible `Default (recommended)` row is a provider-default null
    sentinel and is deliberately not exposed as an executable model id
  - current runtime behavior already maps this control into runtime-owned
    request patches in `src/core/models/providerSelectionResolution.ts`
  - regression coverage locks entry-specific values/defaults in
    `src/core/models/providerAdvancedKnowledge.test.ts`,
    `src/core/models/providerSelectionResolution.test.ts`, and
    `tests/runtime-server.test.ts`

### `ollama-local-v1`

- Target match: `provider=ollama`, `backend=local`, `transport=ollama`
- Verified metadata:
  - runtime-owned `ollama.temperature`
  - runtime-owned `ollama.keep_alive`
  - default selection derived from the verified control set
- Evidence basis:
  - current runtime behavior already maps these controls into transport-native
    request patches in `src/core/models/providerSelectionResolution.ts`
  - regression coverage locks the public catalog shape in
    `src/core/models/providerAdvancedKnowledge.test.ts`,
    `src/core/models/providerSelectionResolution.test.ts`, and
    `tests/runtime-server.test.ts`

## Non-Verified Targets

- Any target not listed above stays on conservative entry-only advanced
  catalogs.
- Conservative mode means:
  - `entries` remain public
  - `presets` stay empty
  - `controls` stay empty
  - `defaultSelection` stays `null`
  - support metadata reports `unverified_omitted`

## Follow-through

- Future manifest additions should add one new section here before the target is
  promoted to verified public metadata.
- If provider behavior changes, update the corresponding manifest id/version and
  extend the regression matrix before widening public support.
