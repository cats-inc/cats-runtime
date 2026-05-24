# SPEC-026: Antigravity CLI Provider Replacing Gemini CLI

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | User |
| **Reviewer** | User |

## Summary

`cats-runtime` currently registers `gemini` as a first-class CLI provider family: install knowledge, compatibility profile, ACP profile, session scanner, model catalog dispatch, dashboard UI, playground UI, and HTTP routes all treat `gemini` as a known provider id. The upstream `environment-bootstrap` installer suite has removed `@google/gemini-cli` and shipped a native Antigravity CLI (`agy` binary) in its place.

This spec defines the runtime-side replacement: how `antigravity` is introduced as a new CLI provider family, how every `gemini`-named seam is migrated, and how the dashboard / playground / provider-setup surfaces stay coherent across the swap. It also defines what is intentionally left to the platform side (packaged installer wiring, shared provider catalog data) so the two sides can land in lockstep without overlapping.

This spec is the runtime counterpart to cats-platform SPEC-110. ADR-032 captures the underlying decision.

## Goals

- Register `antigravity` as a CLI provider family using `createNativeInstall(...)` against the `agy` binary, with the same shape as other native-installer providers.
- Replace the `GEMINI_ACP_PROFILE` with `ANTIGRAVITY_ACP_PROFILE` aligned with openab's `agy-acp` adapter (PR #896, v0.8.4-beta.3); raw `agy` stays the CLI-subprocess command unless the probe proves it has a native ACP mode.
- Remove the Gemini compatibility profiles (`gemini-cli-stream-json-v1` family); add Antigravity stream profiles only after a live `agy` stream contract is proven. Until then, compatibility falls back to presence-only evidence.
- Remove `GeminiSessionScanner` and `getGeminiSessionsDir`; add Antigravity session discovery only after `agy`'s real session storage layout and readable format are proven.
- Replace the `gemini_native` history parser with an `antigravity_native` parser, or remove the parser entirely if `agy` produces no compatible session format.
- Migrate dashboard (`index.html`), playground (`playground.html`), provider-setup (`provider-setup.html`), shared CSS, generated Tailwind, and `public/` mirrors to use `antigravity` as the provider id and badge token.
- Update `config/providers.yaml.example` and `docs/setup-guide.md` to reflect the new CLI provider id and install path.
- Update test fixtures across `src/http/*.test.ts` to use `antigravity` where they currently use `gemini`.
- Keep the Google API completion path (HTTP completion against Google's API) outside the scope of this spec; it remains owned by the `api` backend family and is not part of this provider swap.

## Non-Goals

- Retaining `gemini` as a provider family alias or fallback id (the project has not shipped; no migration shim is owed).
- Designing the Antigravity API HTTP backend or renaming the existing Google/Gemini API env strategy. `GEMINI_API_KEY` remains part of the Google API transport unless a separate API-provider rename lands.
- Reshaping the broader CLI provider taxonomy or the `agent` backend family boundary.
- Coordinating the packaged Desktop installer change — owned by cats-platform SPEC-110.
- Coordinating the shared provider catalog data (`cats-platform/src/shared/providerCatalogData.ts`) — owned by cats-platform SPEC-110; this spec only describes how the runtime UI mirrors those values in this slice.

## User Stories

- As a runtime operator, I want `Settings > Runtime` and the dashboard to show `antigravity` as a known Google-family CLI so that the local `agy` install is recognized as a usable provider.
- As a playground user, I want the provider dropdown to expose `antigravity` without fabricated model ids, so I can compose runs only after the `agy` execution and model-selection contracts are verified.
- As a runtime maintainer, I want `gemini` removed from provider knowledge so that diagnostics don't claim a non-installable provider is missing.
- As an ACP adopter, I want `agent/acp:antigravity` available alongside the CLI-subprocess transport so I can drive Antigravity through openab's `agy-acp` profile when desired.

## Problem Statement

Today the runtime says "Gemini CLI exists" in many places and acts on that belief:

- `provider-install/knowledge.ts` claims `gemini` installs via `npm install -g @google/gemini-cli` — that package is being abandoned upstream.
- `compatibility/knowledge.ts` carries `gemini-cli-stream-json-v1` profiles whose spawn args target the `gemini` binary.
- `GeminiSessionScanner` reads `gemini` session files from a path that may not even exist after the upstream cutover.
- `dashboard / playground / provider-setup` UIs render Gemini badges and offer Gemini in dropdowns.
- Test fixtures assume `gemini` as a stable provider id.

If left in place, every diagnostic surface lies: it reports `gemini` as `available` or `missing` based on a CLI the user can no longer install, while ignoring the `agy` binary that actually sits on the user's PATH.

The fix is not additive. The Gemini-named seams must be replaced, not extended.

## Requirements

### Functional Requirements

1. The runtime shall register `antigravity` as a CLI provider family via `createNativeInstall(...)` in `src/core/provider-install/knowledge.ts`. Binary name: `agy`. Install verification: PATH lookup followed by `LOCALAPPDATA` / `~/.local/bin` fallback (matching `Check-Installation` upstream).
2. The runtime shall remove the `gemini` entry from `src/core/provider-install/knowledge.ts` entirely.
3. The runtime shall add an `ANTIGRAVITY_ACP_PROFILE` in `src/backends/agent/adapters/acp/profiles.ts`, family `antigravity`, tier 1, aligned with the `agy-acp` adapter contract shipped in openab v0.8.4-beta.3. Profile detection shall recognize `agy-acp` command / args; it shall not assume raw `agy` speaks ACP unless Phase 1 proves that contract.
4. The runtime shall remove `GEMINI_ACP_PROFILE`.
5. The runtime shall remove `GeminiSessionScanner`. It shall not add `AntigravitySessionScanner` until `agy`'s actual session storage path and readable parser format are proven; until then, session-discovery routes shall skip Antigravity rather than fabricate sessions.
6. The runtime shall remove the `gemini_native` parser branch from `src/http/routes/history.ts`. If Antigravity emits its own importable format, an `antigravity_native` parser may replace it; otherwise the parser is removed without replacement.
7. The runtime shall update `src/http/routes/sessions.ts`, `src/http/routes/diagnostics.ts`, `src/http/routes/diagnosticsSupport.ts`, and `src/http/routes/workspaceSubstrate.ts` so all `gemini` literals become `antigravity`.
8. The runtime shall remove `getGeminiSessionsDir` from `src/http/providerServices.ts`. A `getAntigravitySessionsDir` helper is out of scope until a live probe proves a real session directory.
9. The runtime shall update the dashboard at `src/http/ui/pages/index.html`:
   - Replace `--gemini` CSS color token with `--antigravity` using the retained Google-family blue value (`#60a5fa`).
   - Replace `data-provider="gemini"` and `data-p="gemini"` selectors with `antigravity`.
   - Replace the `<option value="gemini">` entry with `<option value="antigravity">`.
   - Replace `gemini` in `PROVIDER_ORDER` with `antigravity`, preserving the same slot.
   - Replace `gemini` in the agent-enabled list (line ~1266) with `antigravity`.
10. The runtime shall update the playground at `src/http/ui/pages/playground.html`:
    - Replace the `gemini:` badge style block with `antigravity:`.
    - Replace the `gemini:` model list with an `antigravity:` entry exposing only the `antigravity-default` provider-default sentinel until Phase 1 proves raw `agy` model ids; user-curated YAML may populate local entries explicitly.
    - Replace `gemini` in the `PROVIDERS` array with `antigravity`.
    - Replace the default agent provider entry that points at `gemini`.
    - Audit any `copilot`, `cursor`, or other vendor-owned model-list references that name `gemini-*` models — these are vendor-named submodels and may stay, but they are not Antigravity CLI model-id evidence.
11. The runtime shall update `src/http/ui/shared.ts` and `src/http/ui/tailwind.runtime.css` to use the new `--antigravity` token, then rebuild `src/http/ui/generated/runtimeTailwind.ts`.
12. The runtime shall regenerate `public/index.html` and `public/playground.html` from the updated UI sources.
13. The runtime shall update `config/providers.yaml.example`: rename the top-level default target and CLI backend `gemini` blocks to `antigravity`, update the CLI `command:` field from `gemini` to `agy`, and adjust auth hints if Antigravity uses a different login flow than Gemini. The `backends.api.providers.gemini` block with `transport: google` and `GEMINI_API_KEY` remains intact unless a separate API-provider rename lands.
14. The runtime shall leave `GEMINI_API_KEY` and Google API transport examples intact unless a separate API-provider rename from `gemini` to `google` lands in the same slice. Do not add `ANTIGRAVITY_API_KEY`; Antigravity is a local CLI provider here.
15. The runtime shall update `docs/setup-guide.md` references at lines 9, 192, 497, 629, 689 to name Antigravity / `agy` instead of Gemini / `gemini`.
16. The runtime shall update all `src/http/*.test.ts` fixtures that use `gemini` as a test provider id to use `antigravity`. Fixture replacement may use a different provider id where the test is about CLI provider behavior in general rather than the Gemini specifics.
17. The runtime shall not read, rename, or delete `GEMINI.md`. That file is an agent-specific instruction file governed by `AGENTS.md` / `CODEX.md`, not Gemini CLI runtime config.

### Non-Functional Requirements

- **Correctness over scope**: every removed `gemini` reference must be verified to be replaced by an `antigravity` equivalent or intentionally removed. No silent drops.
- **Dashboard parity**: after the swap, the dashboard must render an Antigravity row with the same visual weight as the previous Gemini row, including badge color, sidebar slot, and provider-order position.
- **No fabricated capability**: if Antigravity's session format or version probe cannot be validated against a real `agy` install during implementation, the corresponding code path must return an honest "not yet supported" state rather than guessing.

## Design Overview

The migration moves through five concentric layers, each depending on the previous:

```
1. Data layer       → provider-install/knowledge, compatibility/knowledge,
                       acp/profiles, model catalog
2. Session/discovery → GeminiSessionScanner rename + format probe
3. Routes / services → sessions, history, diagnostics, workspaceSubstrate,
                       providerServices
4. UI                → dashboard, playground, provider-setup, shared CSS,
                       generated Tailwind, public mirrors
5. Tests + docs      → *.test.ts fixtures, providers.yaml.example,
                       setup-guide.md
```

Layer 4 depends on cats-platform SPEC-110 Phase 1 landing first, because the platform catalog (`cats-platform/src/shared/providerCatalogData.ts`) defines the product-side provider/model values that the runtime UI must mirror. The runtime currently keeps its own hardcoded dashboard/playground data, so PLAN-033 sequences this cross-repo dependency explicitly.

## Dependencies

- environment-bootstrap commits `b273f63a` and `5725e637` (already merged; pulled into this monorepo on 2026-05-24 via the submodule bump in commit `85540ced9`).
- openab `agy-acp` adapter (PR #896, v0.8.4-beta.3) — drives `ANTIGRAVITY_ACP_PROFILE` shape.
- cats-platform SPEC-110 Phase 1 (shared provider catalog data update) — must land before runtime UI Phase 4. cats-platform PLAN-100 Phase 0 and cats-runtime PLAN-033 Phase 1 refer to the same shared `agy` probe.
- Verified knowledge of `agy`'s actual session storage layout, version probe contract, and stream output framing remains a live-probe gap recorded in `docs/research/2026-05-24-antigravity-cli-probe.md`; code paths depending on those facts stay absent or presence-only until a later probe proves them.

## Open Questions

- [x] What is the `--antigravity` dashboard badge color value? Use the previous Google-family blue (`#60a5fa`) for this swap so Antigravity keeps Gemini's dashboard slot and visual weight.
- [x] Does `agy` produce a Cats-importable session file format, or are sessions opaque to the runtime? No live session-storage evidence exists yet. `AntigravitySessionScanner` and the history-import path are therefore absent until a later probe proves a readable format.
- [x] Does Antigravity CLI support a `--version` flag with a parseable output, suitable for the compatibility evidence engine? No live `agy --version` evidence exists yet. Runtime compatibility uses presence-only checks until a parseable version contract is proven.
- [x] Does raw `agy` expose any ACP mode, or is `agy-acp` the only ACP entry point? Raw `agy` ACP behavior was not proven. `agent/acp:antigravity` uses `agy-acp`; raw `agy` remains CLI-subprocess only unless later evidence changes that.

## References

- [ADR-032: Replace Gemini CLI with Antigravity CLI](../decisions/032-replace-gemini-cli-with-antigravity-cli.md)
- [PLAN-033: Replace Gemini CLI with Antigravity CLI](../plans/PLAN-033-replace-gemini-cli-with-antigravity-cli.md)
- [ADR-013: Extend provider manifests with install and check metadata](../decisions/013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-031: Keep ACP inside the agent backend family](../decisions/031-keep-acp-inside-agent-backend-and-model-runtime-acp-as-a-separate-facade.md)
- [SPEC-025: ACP Agent Adapters and Runtime ACP Facade](./SPEC-025-acp-agent-adapters-and-runtime-facade.md)
- cats-platform SPEC-110 (packaged-setup side)
- environment-bootstrap commits `b273f63a` and `5725e637`
- openab PR #896 (`agy-acp` adapter)

---

*Created: 2026-05-24*
*Author: User, with Claude support*
*Related Plan: [PLAN-033](../plans/PLAN-033-replace-gemini-cli-with-antigravity-cli.md)*
