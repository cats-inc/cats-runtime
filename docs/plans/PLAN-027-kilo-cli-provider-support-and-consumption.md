# PLAN-027: Independent Kilo CLI Provider Support and Product Consumption

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Artifacts

- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [SPEC-018](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [SPEC-023](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
- [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md)
- [PLAN-025](./PLAN-025-executable-packaging-and-publish-follow-through.md)
- [cats-platform SPEC-045](../../../cats-platform/docs/specs/SPEC-045-cross-layer-bootstrap-and-onboarding-diagnostics.md)

## Overview

`cats-runtime` already has a full `opencode` integration path across runtime
config, provider cataloging, dynamic model discovery, provider-native session
inspection, setup/bootstrap surfaces, and downstream product consumption in
`cats-platform`.

The new goal is to add `kilo` as an independent provider backed by
`@kilocode/cli`, while still moving quickly by reusing the already-proven
`opencode` implementation pattern where the CLI seam is genuinely equivalent.

This plan explicitly does **not** treat Kilo and OpenCode as one merged
provider family. The contract is:

- `kilo` gets its own provider id everywhere
- `kilo` gets its own config keys, install metadata, compatibility metadata,
  tests, route names, and product catalog entry
- `kilo` is inserted immediately after `opencode` in every ordered provider list
- `opencode` code is treated as the first implementation reference, not as a
  long-term abstraction requirement

## Scope

In scope:

- runtime provider registration and config parsing
- `config/providers.yaml.example`
- runtime install knowledge and compatibility knowledge
- runtime bootstrap/setup/provider diagnostics visibility
- runtime model catalog and advanced catalog follow-through
- runtime dashboard/playground/setup provider ordering and labels
- runtime provider-native routes and MCP tools, if Kilo exposes the same seam
- packaged Windows node CLI pack and Electron setup/onboard visibility
- `cats-platform` provider catalog consumption so Kilo appears in product lists
- regression tests across `cats-runtime` and `cats-platform`

Out of scope:

- creating a shared `opencode-family` abstraction before evidence shows it is needed
- forcing Kilo to share OpenCode internals if its CLI seam has already drifted
- renaming or collapsing existing OpenCode APIs/routes/config into generic family terms
- inventing Kilo-specific advanced controls before the runtime has verified them

## Delivery Principles

1. Keep Kilo independent in every public/runtime-facing contract.
2. Reuse OpenCode only as an implementation accelerator.
3. Prefer copy-first, verify-first delivery over premature abstraction.
4. Keep advanced catalog truth conservative until Kilo-specific evidence exists.
5. Preserve user-defined provider order by placing Kilo immediately after OpenCode.

## Reuse Policy

### Safe to seed from OpenCode first

- `src/backends/cli/opencode/OpencodeNativeSessionService.ts`
- `src/backends/cli/opencode/models.ts`
- `src/backends/cli/providers/opencode.ts`
- `src/http/routes/opencode.ts`
- `src/core/compatibility/knowledge.ts` OpenCode profile shape
- `src/core/provider-install/knowledge.ts` generic npm-installed provider path
- `cats-platform/scripts/windows/Install-NodeCliPack.ps1` npm-global pack pattern

### Must stay Kilo-specific even if copied initially

- provider id, labels, route prefix, and MCP tool names
- command path and env keys
- server host / port / startup-timeout keys if Kilo also uses a sidecar server
- model-discovery command and parser behavior
- install package name: `@kilocode/cli`
- provider ordering in runtime and product surfaces
- tests, fixtures, warnings, and operator-facing remediation copy

### Validation gates before copying OpenCode behavior wholesale

- Does `kilo` expose a `models` command with output close enough to reuse the
  OpenCode parser?
- Does `kilo` expose the same local server lifecycle as OpenCode?
- Does `kilo` expose session list / prompt / abort / permission / question APIs
  with the same semantics?
- Do returned model ids stay vendor-neutral, or are they still OpenCode-shaped?

If any answer is "not yet confirmed", the first slice should still ship Kilo as
an independent provider but with narrower capability surface rather than faking
full parity.

## Current Repo Gaps

There is currently no `kilo` footprint in either repo.

OpenCode-specific handling currently exists in these areas:

- runtime provider registry and ordering
- runtime config parsing and per-provider special fields
- runtime compatibility/install knowledge
- native session route exposure
- dynamic CLI model discovery
- dashboard/playground hardcoded provider ordering and seed models
- Windows packaged node CLI pack contents
- `cats-platform` shared provider catalog and renderer fallback data

That means Kilo support is a real cross-cutting addition, not a one-file patch.

## Recommended Delivery Shape

### Phase 1: Capture Kilo CLI Evidence and Freeze the First Slice

- [ ] Run a local comparison pass against the installed `kilo` CLI on this
      machine:
  - `kilo --version`
  - `kilo --help`
  - `kilo models --help`
  - any server/session subcommands that look equivalent to OpenCode
- [ ] Record whether Kilo supports:
  - dynamic model discovery
  - sidecar native-session service
  - session listing / resumption
  - permission/question automation hooks
- [ ] Create a short research note only if the evidence is non-obvious or
      likely to drift.
- [ ] Freeze the v1 capability target:
  - minimum acceptable slice: config + install/compatibility + model catalog +
    product visibility
  - stretch slice: native session service parity with OpenCode

Deliverables:

- a verified command/seam matrix for `kilo` versus `opencode`
- a clear decision on whether Kilo v1 ships with full native-session parity or
  a narrower execution/catalog slice

### Phase 2: Add Kilo to Runtime Provider Registration and Config

- [ ] Add `kilo` to `KNOWN_PROVIDERS` immediately after `opencode`.
- [ ] Add Kilo to runtime provider ordering in `src/core/providerCatalog.ts`
      immediately after `opencode`.
- [ ] Extend `src/backends/cli/config.ts` with Kilo command/runtime fields.
- [ ] If Kilo uses a local server like OpenCode, add Kilo-specific
      host/port/startup-timeout keys rather than reusing OpenCode keys.
- [ ] Update `config/providers.yaml.example`:
  - add `routing.providers.kilo`
  - add `backends.cli.providers.kilo`
  - keep Kilo directly after OpenCode
- [ ] Add config tests proving Kilo parses and orders correctly.

Deliverables:

- runtime can parse and resolve Kilo as a first-class provider
- example config shows Kilo in the intended slot after OpenCode

### Phase 3: Land the Runtime Adapter Slice

- [ ] Create a dedicated Kilo adapter area under `src/backends/cli/kilo/`.
- [ ] Create `src/backends/cli/providers/kilo.ts`.
- [ ] Seed implementation from OpenCode where the command seam matches.
- [ ] Keep Kilo route/service names separate from OpenCode even if internals are
      initially similar.
- [ ] Wire WorkerPool/session runtime selection so `providerName === 'kilo'`
      resolves its own adapter.
- [ ] If Kilo exposes equivalent session-native APIs, add:
  - Kilo native session service
  - Kilo HTTP routes
  - Kilo MCP tool exposure
- [ ] If Kilo does **not** expose equivalent session-native APIs, keep the v1
      surface narrower and do not publish fake native-session tools/routes.

Deliverables:

- independent Kilo runtime adapter
- no accidental sharing of OpenCode route names or provider ids
- capability surface aligned with verified Kilo reality

### Phase 4: Add Kilo Catalog, Compatibility, Setup, and Diagnostics Truth

- [ ] Add Kilo install metadata in `src/core/provider-install/knowledge.ts`
      using the generic npm-global pattern with package name `@kilocode/cli`.
- [ ] Add Kilo compatibility knowledge in `src/core/compatibility/knowledge.ts`.
- [ ] Add Kilo event-capability truth in `src/core/providerEventCapabilities.ts`
      only to the level actually verified.
- [ ] Add static Kilo catalog entries in `src/core/models/providerModelCatalog.ts`.
- [ ] If `kilo models` is available, add dynamic discovery support using an
      OpenCode-derived runner/parser only after verifying the output shape.
- [ ] Keep advanced catalog behavior conservative:
  - no guessed presets
  - no guessed controls
  - no guessed default-selection semantics
- [ ] Ensure bootstrap scan, provider diagnostics, and setup pages include Kilo
      through the normal runtime-owned provider catalog flow.

Deliverables:

- Kilo appears in runtime install/setup/diagnostic views
- Kilo model catalog exists with truthful static or dynamic backing
- advanced catalog stays safe if Kilo semantics are still partially unknown

### Phase 5: Update Runtime Dashboard, Playground, and Setup Ordering

- [ ] Update any hardcoded runtime provider order arrays so Kilo appears
      immediately after OpenCode.
- [ ] Update any hardcoded provider swatch/seed-model tables in
      `public/index.html` and `public/playground.html`.
- [ ] Verify whether `public/provider-setup.html` needs any hardcoded label or
      palette additions; if not, rely on runtime-fed provider config.
- [ ] Add or update runtime HTML/route tests that enforce ordering.

Deliverables:

- runtime UI shows Kilo in the correct slot after OpenCode
- no mismatch between runtime config ordering and static UI fallbacks

### Phase 6: Update Packaged Windows Setup and Electron Onboard Paths

- [ ] Add `@kilocode/cli` to
      `cats-platform/scripts/windows/Install-NodeCliPack.ps1`.
- [ ] Keep Kilo immediately after OpenCode in that package list.
- [ ] Update packaged setup/readiness tests that assert node CLI pack contents.
- [ ] Update `cats-platform/electron/packaging.ts` notes so the packaged
      contract truthfully says the node CLI pack now covers Kilo too.
- [ ] Verify packaged bootstrap/onboard can surface Kilo through runtime
      provider diagnostics without extra product-side duplication.

Deliverables:

- packaged Windows helper can install/upgrade Kilo
- Electron packaging docs/contracts stay truthful

### Phase 7: Make `cats-platform` Consume Kilo Cleanly

- [ ] Add Kilo to `cats-platform/src/shared/providerCatalog.ts` immediately
      after OpenCode.
- [ ] Add a product fallback model list for Kilo, but prefer runtime catalogs
      at read time as today.
- [ ] Add a Kilo instance entry so Chat/Work/Code setup surfaces can render it.
- [ ] Keep consumption product-wide through shared catalog helpers so Kilo
      appears everywhere `listProductProviders()` is used.
- [ ] Verify `/api/providers` merging still works without special casing.

Deliverables:

- Kilo appears in Chat, Work, and Code provider lists
- fallback product catalog order matches runtime order

### Phase 8: Verification and Follow-Through

- [ ] Add targeted runtime tests for:
  - config parsing
  - provider order
  - provider catalog resolution
  - model catalog fallback/dynamic discovery
  - setup/bootstrap visibility
  - native-session routes if shipped
- [ ] Add targeted platform tests for:
  - shared provider catalog order
  - packaged node CLI pack contents
  - packaged setup/readiness smoke coverage
- [ ] Update runtime/product docs only where implementation actually changes
      public truth.

Deliverables:

- end-to-end regression coverage for the new provider
- no silent ordering regressions between runtime and product

## Files / Areas Likely to Change During Implementation

### cats-runtime

- `config/providers.yaml.example`
- `src/backends/cli/providers/types.ts`
- `src/backends/cli/config.ts`
- `src/backends/cli/pool/WorkerPool.ts`
- `src/core/providerCatalog.ts`
- `src/core/bootstrap/BootstrapService.ts`
- `src/core/models/providerModelCatalog.ts`
- `src/core/compatibility/knowledge.ts`
- `src/core/provider-install/knowledge.ts`
- `src/core/providerEventCapabilities.ts`
- `src/http/app.ts`
- `src/mcp/tools.ts`
- `public/index.html`
- `public/playground.html`
- new `src/backends/cli/kilo/**`
- new `src/http/routes/kilo.ts` if native-session parity is real

### cats-platform

- `src/shared/providerCatalog.ts`
- `src/server/routes/providers.ts` only if merge behavior needs additive guardrails
- `scripts/windows/Install-NodeCliPack.ps1`
- `electron/packaging.ts`
- packaged setup/readiness/installer smoke tests

## Testing Strategy

Runtime:

- `npx vitest run src/backends/cli/config.test.ts`
- `npx vitest run src/core/providerCatalog.test.ts`
- `npx vitest run src/core/models/providerModelCatalog.test.ts`
- `npx vitest run tests/runtime-server.test.ts`
- adapter-specific tests for any new `src/backends/cli/kilo/**`

Platform:

- `npm test -- --runInBand` or the repo-equivalent targeted node tests for:
  - `tests/desktop-node-cli-pack.test.js`
  - `tests/desktop-setup-readiness.test.js`
  - `tests/desktop-packaging.test.js`
  - provider/setup renderer tests that depend on `src/shared/providerCatalog.ts`

Manual verification:

- confirm `kilo` appears after `opencode` in runtime dashboard/setup/playground
- confirm `kilo` appears after `opencode` in Cats Chat/Work/Code provider lists
- confirm packaged node CLI helper reports Kilo in check/apply/upgrade modes
- confirm runtime model catalog returns truthful Kilo entries

## Risks / Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Kilo CLI only partially matches OpenCode | High | Ship Kilo as an independent provider with a narrower v1 surface instead of forcing parity. |
| Premature shared-family abstraction hides future drift | High | Keep separate ids/files/tests; abstract only after evidence across multiple releases. |
| Wrong model ids are copied from OpenCode guesses | High | Capture live `kilo models` output first and use returned ids verbatim. |
| Ordering drifts between runtime and product | Medium | Add explicit order assertions in both repos and always place Kilo after OpenCode. |
| Packaged setup claims Kilo support before helper/tests are updated | Medium | Treat node CLI pack and Electron packaging notes as part of the same delivery slice. |
| Advanced catalog overclaims Kilo support | High | Keep Kilo advanced metadata conservative until verified under SPEC-023 rules. |

## Decision Gates

- If Kilo exposes the same native-session seam as OpenCode:
  - copy the OpenCode adapter shape, fork names, and verify behavior with
    Kilo-specific tests.
- If Kilo exposes only `models` plus prompt execution:
  - ship config/catalog/execution first, skip native-session routes and MCP
    tools for v1.
- If Kilo needs materially different config or server orchestration:
  - keep the provider separate and consider a small ADR only if a new
    cross-provider abstraction becomes unavoidable.

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-31 | Plan created for adding `kilo` as an independent provider while using OpenCode as the first implementation reference where the CLI seam actually matches. |

## Execution Checklist

- [x] Plan created
- [ ] Phase 1 complete: Kilo seam comparison captured
- [ ] Phase 2 complete: runtime config and provider registration landed
- [ ] Phase 3 complete: runtime adapter slice landed
- [ ] Phase 4 complete: catalog/setup/diagnostics truth landed
- [ ] Phase 5 complete: runtime UI ordering landed
- [ ] Phase 6 complete: packaged setup/onboard support landed
- [ ] Phase 7 complete: `cats-platform` consumption landed
- [ ] Phase 8 complete: regression coverage and doc follow-through landed

---

*Created: 2026-03-31*
*Author: Codex*
