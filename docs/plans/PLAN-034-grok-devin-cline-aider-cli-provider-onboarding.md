# PLAN-034: Grok, Devin, Cline, and Aider CLI Provider Onboarding

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft — implementation blocked pending User approval |
| **Owner** | User |
| **Assigned To** | Unassigned |
| **Reviewer** | User |

## Related Spec

[SPEC-027: Grok, Devin, Cline, and Aider CLI Provider Onboarding](../specs/SPEC-027-grok-devin-cline-aider-cli-provider-onboarding.md)

## Overview

This plan executes the runtime side of onboarding four upstream CLIs as provider families. Work moves outward from the type layer, because widening `KNOWN_PROVIDERS` first makes the TypeScript compiler enumerate every exhaustive map that needs an entry — the integration surface is discovered, not guessed.

Phase ordering:

- Phase 1 records upstream install facts and probe results before any code is written.
- Phase 2 widens the taxonomy and lets `npm run typecheck` produce the authoritative list of touch points.
- Phases 3–5 fill those touch points: install knowledge, refusal adapters, config.
- Phase 6 touches runtime-owned UI. Refusal-only providers do not enter the platform product execution catalog.
- Phases 7–8 batch tests and docs.

## Coordination With cats-platform

This plan and `cats-platform` PLAN-102 land as one coordinated change.

- **Runtime owns**: provider taxonomy, install/check knowledge, refusal adapters, capability and evolution metadata, runtime config and `providers.yaml.example`, dashboard/playground/provider-setup UI, runtime tests and docs.
- **Platform owns**: packaged installer helpers (`scripts/{windows,linux,macos}`), desktop host wiring (`cliInventoryProbe`, `contracts`, `setupAssets`, `packaging`, `bootstrapPage`), the setup-provider inventory, smoke tests, platform docs. It does not add refusal-only providers to the product execution catalog.

Handoff order: runtime Phase 2 (taxonomy) → platform PLAN-102 Phase 1 (desktop setup contracts) → both repos' remaining phases in parallel. Runtime UI values are runtime-owned and no longer block on a platform catalog landing.

## Architecture Guardrails

1. Do not implement session execution, stream parsing, session discovery, or history import for any of the four. Refusal stubs only.
2. Do not add compatibility profiles in `src/core/compatibility/knowledge.ts`. Presence-only evidence is the intended state.
3. Do not add bundled model ids. Only `<provider>-default` sentinels.
4. Do not register Grok's `agent` alias as a detection candidate.
5. Do not treat a successful Devin install as readiness; `devin setup` is a required manual step.
6. Do not render an interactive sign-in affordance for Aider.
7. Preserve existing provider relative order. The four append to the CLI-family segment after `kiro`; `ollama` and `openclaw` shift four absolute positions later.
8. Do not add the four to `cats-platform/src/shared/providerCatalogData.ts` or `providerCatalogInstances.ts` while their adapters are refusal-only.
9. Do not invent behavior. If a probe cannot answer a question, leave the field empty and record the gap.
10. Do not hand-edit `src/http/ui/generated/runtimeTailwind.ts` or `public/*.html`; regenerate them.

## Implementation Phases

### Phase 1: Record Upstream Facts and Probe Reality

Goal: replace guesses with facts before touching code. This is the same shared probe as `cats-platform` PLAN-102 Phase 0.

Evidence channel: the `environment-bootstrap` installer and check scripts are authoritative for install commands, install directories, PATH entries, upgrade semantics, and auth flows — they are the scripts users actually run. Execution contracts require a live probe; anything not proven stays empty.

Install facts already extracted from upstream (no further probing needed):

- [ ] Grok — `platform/windows/Install-GrokCLI.ps1`, `platform/{linux,macos}/install-grok-cli.sh`. Installer `https://x.ai/cli/install.{ps1,sh}`. Binary `~/.grok/bin/grok{,.exe}` plus an `agent` alias. Auth `grok login` → `~/.grok/auth.json`, or `XAI_API_KEY`. Upstream Quick mode.
- [ ] Devin — `platform/windows/Install-DevinCLI.ps1`, `platform/{linux,macos}/install-devin-cli.sh`. Installer `https://static.devin.ai/cli/setup.ps1` (Windows, PowerShell-only) / `https://cli.devin.ai/install.sh` (Unix). Binary `%LOCALAPPDATA%\devin\cli\bin\devin.exe` / `~/.local/bin/devin`, versions under `$XDG_DATA_HOME/devin/cli/_versions`. Upstream strips the trailing `devin setup`. Upstream Full mode.
- [ ] Aider — `platform/windows/Install-Aider.ps1`, `platform/{linux,macos}/install-aider.sh`. Installer `https://aider.chat/install.{ps1,sh}`, which is the `uv` installer plus `uv tool install --force --python python3.12 --with pip aider-chat@latest`. Binary `~/.local/bin/aider{,.exe}`. Credential sources include environment, `.env`, `.aider.conf.yml`, command-line options, and local models; ambient key names are evidence, not readiness. Upstream Full mode.
- [ ] Cline — npm package `cline`, added to `Install-NodeCLITools.ps1` / `install-node-cli-tools.sh`. Official CLI support is macOS/Linux preview only; Windows packaged install remains unsupported pending official support or a reviewed Windows execution probe. Upstream Full mode.

Live probe questions (SPEC-027 Probe Items; gate execution adapters, not this plan's install tier):

- [ ] **P5** — Capture `--version` and `--help` for each of the four. Record exact version-string shapes for the check path.
- [ ] **P2** — Determine whether each exposes a non-interactive/headless mode and whether any emits machine-readable output. Feeds the D4 ordering.
- [ ] **P1** — Determine whether Devin executes locally or orchestrates remote sessions (resolves the ADR-023 classification).
- [ ] Determine whether any exposes an enumerable model list. `--help` alone is not model-id evidence.
- [ ] **P3** — Determine whether any writes scannable session storage.
- [ ] **P4** — Capture the exact upstream Cline allowlist and determine how the helper feature-detects npm's global `allow-scripts` support. Documentation and compatibility coverage only; SPEC-027 D5 already defines the policy.
- [ ] Record findings in `docs/research/2026-08-07-grok-devin-cline-aider-cli-probe.md`, marking unanswered questions as deferred rather than guessing.

The badge palette is no longer a technical probe item: SPEC-027 D1 proposes candidate values. The overall plan remains blocked until the User approves that proposal and the other decisions.

**Deliverables**: Research note answering every SPEC-027 Probe Item that evidence supports; explicit deferrals for the rest.

### Phase 2: Widen the Taxonomy

- [ ] Append `grok`, `devin`, `cline`, `aider` to `KNOWN_PROVIDERS` in `src/backends/cli/providers/types.ts`.
- [ ] Insert the four after `kiro` in `PROVIDER_ORDER` in `src/core/providerCatalog.ts`.
- [ ] Run `npm run typecheck` and capture the complete list of exhaustive maps the compiler flags. Treat that list — not this plan's file list — as authoritative for Phases 3–5.

**Deliverables**: A compiler-generated integration checklist.

### Phase 3: Install and Check Knowledge

- [ ] Refactor `createGenericNpmKnowledge` in `src/core/provider-install/knowledge.ts` to take an explicit `binaryName` and optional supported-platform overrides, removing the `provider === 'opencode'` special case.
- [ ] Add a `createGrokBinPathHints` helper (or extend `createLocalBinPathHints` with a configurable directory) for `~/.grok/bin`.
- [ ] Add the `grok` entry per SPEC-027 §4, including the note that the `agent` alias is intentionally ignored.
- [ ] Add the `devin` entry per SPEC-027 §5, including the PowerShell-only installer note and the `devin setup` manual step.
- [ ] Add the `aider` entry per SPEC-027 §6 with `auth.interactive: false` and the model-key evidence list, including the bundled-`uv` shadowing note. Do not derive readiness from key presence.
- [ ] Extend `ProviderAuthSummary` with additive `detectedEnvVars: string[]`, inject the environment into `ProviderCompatibilityService`, and report non-empty variable names only. Keep Aider auth `unknown`; never return values or classify absent names as missing.
- [ ] Add the `cline` entry via `createGenericNpmKnowledge`, with Windows install metadata unsupported pending official support or probe evidence.
- [ ] Change the Pi entry's npm package to `@earendil-works/pi-coding-agent`.
- [ ] Extend `src/core/provider-install/knowledge.test.ts` to assert each new entry's binary name, expected paths, auth shape, Cline platform support, and — for Aider — `interactive === false`.
- [ ] Extend `ProviderCompatibilityService` tests with an injected environment proving that only key names are returned, values are never serialized, and zero detected keys leaves Aider auth `unknown`.

**Deliverables**: `buildProviderInstallCatalogView` returns correct metadata for all four across the three execution platforms.

### Phase 4: Refusal Adapters and Capability Metadata

- [ ] Add `src/backends/cli/providers/{grok,devin,cline,aider}.ts`, modeled on `antigravity.ts`, each with a refusal message naming its own missing evidence.
- [ ] Wire the four into `WorkerPool.createProvider` and update the unknown-provider error string to list all sixteen families.
- [ ] Add conservative entries to `src/core/providerEventCapabilities.ts`, declaring nothing unobserved.
- [ ] Register the four in `src/core/compatibility/providerEvolutionEntry.ts` so evidence capture has a home.
- [ ] Confirm `src/core/compatibility/knowledge.ts` gains no profiles.
- [ ] Add `src/core/models/curatedModelCatalog.ts` / `providerAdvancedKnowledge.ts` / `curatedModelCatalogNormalization.ts` keys with empty bundled model lists.

**Deliverables**: Session attempts against the four refuse honestly; evidence capture is wired.

### Phase 5: Config and Generated Bootstrap

- [ ] Add `grokPath`, `devinPath`, `clinePath`, `aiderPath` to `src/backends/cli/config.ts`, with `GROK_PATH` / `DEVIN_PATH` / `CLINE_PATH` / `AIDER_PATH` overrides defaulting to the bare binary names.
- [ ] Add `native` to `defaultProviderRuntimeMode` for all four.
- [ ] Add the four to `readProviderCommandConfig` wiring, instance-map construction, and the clone helpers.
- [ ] Add routing defaults and `backends.cli.providers.<id>.instances.native` blocks to `config/providers.yaml.example`.
- [ ] Leave `.env.example` unchanged. Per SPEC-027 D2, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, and `OPENROUTER_API_KEY` stay out; they are CLI-consumed, not runtime-consumed.

**Deliverables**: A fresh `providers.yaml` bootstrap produces `cli/native` instances for all four.

### Phase 6: Routes and UI

The runtime owns these install/check surfaces. Do not wait for or mirror a platform product catalog entry; the four remain excluded from executable product selectors.

- [ ] Add badge tokens to `src/http/ui/tailwind.runtime.css` and `src/http/ui/shared.ts` using the SPEC-027 D1 proposal once approved: `--grok #e5e7eb`, `--devin #38bdf8`, `--cline #e879f9`, `--aider #60a5fa`.
- [ ] Add the four to `src/http/ui/pages/index.html` — provider dropdown, `PROVIDER_ORDER`, and dashboard CSS selectors.
- [ ] Add the four to `src/http/ui/pages/playground.html` — badge style blocks, `PROVIDERS` array, and `<provider>-default` sentinels only.
- [ ] Update `src/http/ui/pages/provider-setup.html` so Aider renders credential evidence with auth still unverified and no sign-in affordance, and Devin renders `devin setup` as a manual step without claiming completion state.
- [ ] Audit `src/http/routes/diagnostics.ts` and `diagnosticsSupport.ts` for provider-list literals that need the four.
- [ ] Leave `src/http/routes/workspaceSubstrate.ts` `ENABLED_AGENTS` unchanged; none of the four has a proven workspace-substrate contract.
- [ ] Regenerate `src/http/ui/generated/runtimeTailwind.ts` via `npm run build:ui`.
- [ ] Regenerate `public/index.html` and `public/playground.html`, and commit both.

**Deliverables**: All four appear across dashboard, playground, and provider setup with honest readiness semantics.

### Phase 7: Tests

- [ ] Update provider-count and provider-order assertions across `src/http/*.test.ts` and `tests/*.test.ts`.
- [ ] Add `src/http/providerDiagnostics.test.ts` cases covering: Grok detected via `~/.grok/bin`, an unrelated `agent` binary **not** counting as Grok, Devin present with auth unverified, Aider present with and without detected model-key evidence, and Cline install unsupported on Windows.
- [ ] Add a `WorkerPool` test asserting each of the four refuses with its own message.
- [ ] Update `src/http/ui/shared.playground.test.ts` for the new badges and sentinels.
- [ ] Run `npm test` and confirm green.

**Deliverables**: Suite passes; the four are covered at the install/check/refusal tier.

### Phase 8: Docs and Hygiene

- [ ] Update `docs/setup-guide.md` with install commands, binary locations, and auth for all four, calling out `devin setup` and Aider's optional, non-secret credential evidence with auth remaining unknown.
- [ ] Update `docs/decisions/README.md`, `docs/specs/README.md`, `docs/plans/README.md` indexes.
- [ ] Note in the research note that the Pi package rename was corrected here and why it was invisible to version checks.
- [ ] Final sweep: confirm no fabricated model ids, no stream profiles, and no session scanners were added for the four.

**Deliverables**: Docs match the shipped reality; indexes current.

## Files to Create / Modify

### Create

- `src/backends/cli/providers/grok.ts`
- `src/backends/cli/providers/devin.ts`
- `src/backends/cli/providers/cline.ts`
- `src/backends/cli/providers/aider.ts`
- `docs/research/2026-08-07-grok-devin-cline-aider-cli-probe.md`

### Modify

- `src/backends/cli/providers/types.ts`
- `src/core/providerCatalog.ts`
- `src/core/provider-install/knowledge.ts` (+ `knowledge.test.ts`)
- `src/core/provider-install/types.ts`
- `src/core/compatibility/ProviderCompatibilityService.ts` (+ focused tests)
- `src/core/providerEventCapabilities.ts`
- `src/core/compatibility/providerEvolutionEntry.ts`
- `src/core/models/{curatedModelCatalog,curatedModelCatalogNormalization,providerAdvancedKnowledge}.ts`
- `src/backends/cli/config.ts`
- `src/backends/cli/pool/WorkerPool.ts`
- `src/http/ui/{shared.ts,tailwind.runtime.css}`
- `src/http/ui/pages/{index,playground,provider-setup}.html`
- `src/http/routes/{diagnostics,diagnosticsSupport}.ts`
- `config/providers.yaml.example`
- `docs/setup-guide.md`
- test fixtures across `src/http/*.test.ts` and `tests/*.test.ts`

### Regenerate (do not hand-edit)

- `src/http/ui/generated/runtimeTailwind.ts`
- `public/index.html`, `public/playground.html`

## Technical Decisions

- **Taxonomy widening comes before knowledge**: the compiler is a better integration checklist than a grep.
- **Refusal over guessing**: per ADR-025 and the ADR-032 precedent, an unprobed provider refuses with a message naming the missing evidence.
- **CLI-segment append ordering**: preserves existing relative order while explicitly shifting the two non-CLI providers four absolute positions later.
- **Pi rename rides along**: same defect class, same file; splitting it would leave a known-broken upgrade path in place.
- **No backwards-compat shim**: pre-release policy.

## Testing Strategy

- **Unit**: per-file runs as each phase lands (`npx vitest run <file>`).
- **Integration**: `npm test -- src/http` after Phase 7.
- **Manual**: start the runtime (`npm run dev`) and confirm —
  - Dashboard shows all four badges after `kiro`.
  - Playground lists all four with only default sentinels.
  - With none installed, each shows missing with a correct install hint.
  - With Grok installed, it shows available; planting an unrelated `agent` binary does not flip it.
  - Devin shows the `devin setup` manual step with auth unverified.
  - Aider shows only detected credential names, keeps auth unverified, never leaks values, and has no sign-in button.
  - Starting a session against any of the four returns the refusal message.
- **Cross-repo**: after platform PLAN-102 lands and Desktop is repackaged, smoke-test install-from-setup for each on each OS.

## Risks & Mitigations

- **Live probe unavailable for some CLIs** (Devin and Grok both need accounts): Phase 1 gates only the execution tier; the install tier proceeds from upstream scripts. Deferred items are recorded, not guessed.
- **Compiler list is larger than expected**: Phase 2 deliberately produces it before estimating Phases 3–5.
- **Refusal-only providers leak into product selectors**: runtime UI remains install/check-owned, while platform execution catalogs exclude the four until working adapters land.
- **`agent` alias false positives**: covered by a dedicated negative test in Phase 7.
- **Aider evidence is mistaken for readiness or leaks secrets**: the summary returns names only from an injected environment, keeps status `unknown`, and provider-setup branches on `auth.interactive` rather than special-casing the id.
- **Devin reclassification**: if Phase 1 shows it is control-plane only, stop at the install tier and raise a follow-up ADR rather than forcing it into session routing.

## Progress Log

| Date | Update |
|------|--------|
| 2026-08-07 | Plan created alongside ADR-033 and SPEC-027, after auditing `environment-bootstrap` commits `cb5efc7`, `d131535`, `216ef96`, `54992d6`, `05be416`, `bef3411`, `0d1831d`, `cfe7785`. Pi npm package drift found during the same audit and folded into Phase 3. |
| 2026-08-07 | SPEC-027 open questions rewritten as Proposed Decisions D1–D5 pending User approval, so implementation remains blocked. Review corrections use the official Grok `XAI_API_KEY`, treat Aider keys as evidence rather than readiness, keep Cline Windows install unsupported, and separate runtime setup visibility from the platform product execution catalog. |

---

*Created: 2026-08-07*
*Author: Claude draft for User review*
