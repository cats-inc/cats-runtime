# PLAN-034: Grok, Devin, Cline, and Aider CLI Provider Onboarding

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress — Grok 1.0.0 and Cline 3.0.51 execution complete; Devin install-tier complete with CLI execution refused on evidence; Aider pending User approval |
| **Owner** | User |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Spec

[SPEC-027: Grok, Devin, Cline, and Aider CLI Provider Onboarding](../specs/SPEC-027-grok-devin-cline-aider-cli-provider-onboarding.md)

## Overview

This plan executes the runtime side of onboarding four upstream CLIs as provider families. Work moves outward from the type layer, because widening `KNOWN_PROVIDERS` first makes the TypeScript compiler enumerate every exhaustive map that needs an entry — the integration surface is discovered, not guessed.

Phase ordering:

- Phase 1 records upstream install facts and probe results before any code is written.
- Phase 2 widens the taxonomy and lets `npm run typecheck` produce the authoritative list of touch points.
- Phases 3–5 fill those touch points: install knowledge, evidence-gated adapters, config.
- Phase 6 touches runtime-owned UI. Only providers with working adapters enter the platform product execution catalog; Grok now qualifies.
- Phases 7–8 batch tests and docs.

## Coordination With cats-platform

This plan and `cats-platform` PLAN-102 land as one coordinated change.

- **Runtime owns**: provider taxonomy, install/check knowledge, evidence-gated adapters, capability and evolution metadata, runtime config and `providers.yaml.example`, dashboard/playground/provider-setup UI, runtime tests and docs.
- **Platform owns**: packaged installer helpers (`scripts/{windows,linux,macos}`), desktop host wiring (`cliInventoryProbe`, `contracts`, `setupAssets`, `packaging`, `bootstrapPage`), the setup-provider inventory, smoke tests, platform docs. It does not add refusal-only providers to the product execution catalog.

Handoff order: runtime Phase 2 (taxonomy) → platform PLAN-102 Phase 1 (desktop setup contracts) → both repos' remaining phases in parallel. Runtime UI values are runtime-owned and no longer block on a platform catalog landing.

## Architecture Guardrails

1. Do not implement session execution, stream parsing, session discovery, or history import without a complete per-provider live probe. Grok 1.0.0 has passed this gate; the other three remain refusal-only.
2. Do not add compatibility profiles without fixture-backed evidence. Grok is pinned to exact version 1.0.0; the remaining providers stay presence-only.
3. Do not add unverified model ids. Grok uses the sole live-enumerated id `grok-4.5`; the other three keep `<provider>-default` sentinels.
4. Do not register Grok's `agent` alias as a detection candidate.
5. Do not treat a successful Devin install as readiness; `devin setup` is a required manual step.
6. Do not render an interactive sign-in affordance for Aider.
7. Preserve existing provider relative order. The four append to the CLI-family segment after `kiro`; `ollama` and `openclaw` shift four absolute positions later.
8. Add providers to `cats-platform/src/shared/providerCatalogData.ts` and `providerCatalogInstances.ts` only after their adapters work. Grok is promoted; Devin, Cline, and Aider remain excluded.
9. Do not invent behavior. If a probe cannot answer a question, leave the field empty and record the gap.
10. Do not hand-edit `src/http/ui/generated/runtimeTailwind.ts` or `public/*.html`; regenerate them.

## Implementation Phases

### Phase 1: Record Upstream Facts and Probe Reality

Goal: replace guesses with facts before touching code. This is the same shared probe as `cats-platform` PLAN-102 Phase 0.

Evidence channel: the `environment-bootstrap` installer and check scripts are authoritative for install commands, install directories, PATH entries, upgrade semantics, and auth flows — they are the scripts users actually run. Execution contracts require a live probe; anything not proven stays empty.

Install facts already extracted from upstream (no further probing needed):

- [x] Grok — install contract plus authenticated Grok 1.0.0 success, model, tool, permission, error, cancellation, resume, and fork lifecycle captured in `docs/research/2026-08-08-grok-cli-install-tier-probe.md`.
- [x] Devin — install tier landed; CLI execution refused on evidence. `devin --version` is `devin 3000.3.27 (0becb483)` (prefixed, not bare semver). Auth is `devin auth login` / `devin auth status`, with `devin setup` as the broader wizard. Probe: `docs/research/2026-08-08-devin-cli-probe.md`.
- [ ] Aider — `platform/windows/Install-Aider.ps1`, `platform/{linux,macos}/install-aider.sh`. Installer `https://aider.chat/install.{ps1,sh}`, which is the `uv` installer plus `uv tool install --force --python python3.12 --with pip aider-chat@latest`. Binary `~/.local/bin/aider{,.exe}`. Credential sources include environment, `.env`, `.aider.conf.yml`, command-line options, and local models; ambient key names are evidence, not readiness. Upstream Full mode.
- [x] Cline — npm package `cline`, binary `cline`, auth via `cline auth` into `~/.cline`. Install tier plus the full 3.0.51 execution contract captured in `docs/research/2026-08-08-cline-cli-probe.md` with four fixtures. The upstream macOS/Linux-preview note does not hold for the runtime tier: version, help, JSON execution, tool calls, and history all work on Windows 11. Packaged Windows support remains a separate call under cats-platform PLAN-102.

Live probe questions (SPEC-027 Probe Items; gate execution adapters, not this plan's install tier):

- [x] **P5 (Grok)** — Captured exact 1.0.0 version/help and model enumeration. Remaining providers stay open.
- [x] **P2 (Grok)** — Verified native `streaming-json` and alternate Messages-compatible NDJSON. Remaining providers stay open.
- [x] **P1** — Resolved: Devin executes locally (`-p/--print`, `--permission-mode`, `--sandbox`) and keeps its remote surface in a separate `cloud` subcommand, so the ADR-023 reclassification is not triggered and no follow-up ADR is needed.
- [x] **Grok model list** — `grok models` returned only `grok-4.5`, marked default. Remaining providers stay open.
- [x] **P3 (Grok)** — Resume and fork work by returned session id; private history scanning/import remains out of scope. Remaining providers stay open.
- [ ] **P4** — Capture the exact upstream Cline allowlist and determine how the helper feature-detects npm's global `allow-scripts` support. Documentation and compatibility coverage only; SPEC-027 D5 already defines the policy.
- [ ] Record findings in `docs/research/2026-08-07-grok-devin-cline-aider-cli-probe.md`, marking unanswered questions as deferred rather than guessing.

The badge palette is no longer a technical probe item: SPEC-027 D1 proposes candidate values. The User approved the Grok token and Grok-only slice on 2026-08-08; the corresponding choices for Devin, Cline, and Aider remain blocked pending approval.

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

### Phase 4: Evidence-Gated Adapters and Capability Metadata

- [ ] Add `src/backends/cli/providers/{grok,devin,cline,aider}.ts`; unprobed providers use the Antigravity-style refusal.
- [ ] Wire the four into `WorkerPool.createProvider` and update the unknown-provider error string to list all sixteen families.
- [ ] Add conservative entries to `src/core/providerEventCapabilities.ts`, declaring nothing unobserved.
- [ ] Register the four in `src/core/compatibility/providerEvolutionEntry.ts` so evidence capture has a home.
- [ ] Confirm unprobed providers gain no compatibility profiles or fabricated model ids.

Grok execution follow-up (completed 2026-08-08):

- [x] Replace the Grok refusal with a native `streaming-json` adapter pinned to exact CLI version 1.0.0.
- [x] Parse text, reasoning, tool use/result, errors, terminal usage, resume, and fork; terminate the worker on cancellation without requiring a terminal record.
- [x] Compile permissions from observed behavior: a non-empty `--tools` allowlist is the hard boundary; reject empty whitelists and `search_replace` without `read_file`.
- [x] Add sanitized full lifecycle fixtures, adapter/fixture/compatibility tests, `grok-4.5`, and provider-evolution observation.

**Deliverables**: Session attempts against the four refuse honestly; evidence capture is wired.

### Phase 5: Config and Generated Bootstrap

- [ ] Add `grokPath`, `devinPath`, `clinePath`, `aiderPath` to `src/backends/cli/config.ts`, with `GROK_PATH` / `DEVIN_PATH` / `CLINE_PATH` / `AIDER_PATH` overrides defaulting to the bare binary names.
- [ ] Add `native` to `defaultProviderRuntimeMode` for all four.
- [ ] Add the four to `readProviderCommandConfig` wiring, instance-map construction, and the clone helpers.
- [ ] Add routing defaults and `backends.cli.providers.<id>.instances.native` blocks to `config/providers.yaml.example`.
- [ ] Leave `.env.example` unchanged. Per SPEC-027 D2, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, and `OPENROUTER_API_KEY` stay out; they are CLI-consumed, not runtime-consumed.

**Deliverables**: A fresh `providers.yaml` bootstrap produces `cli/native` instances for all four.

### Phase 6: Routes and UI

The runtime owns these surfaces. Grok is now mirrored into the platform product catalog because its adapter works; the remaining three stay excluded.

- [ ] Add badge tokens to `src/http/ui/tailwind.runtime.css` and `src/http/ui/shared.ts` using the SPEC-027 D1 proposal once approved: `--grok #e5e7eb`, `--devin #38bdf8`, `--cline #e879f9`, `--aider #60a5fa`.
- [ ] Add the four to `src/http/ui/pages/index.html` — provider dropdown, `PROVIDER_ORDER`, and dashboard CSS selectors.
- [ ] Add the four to `src/http/ui/pages/playground.html` — badge style blocks and `PROVIDERS`; use verified `grok-4.5` for Grok and default sentinels for the remaining three.
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

**Deliverables**: Suite passes; Grok is covered at the exact-version execution tier and the other three at install/check/refusal tier.

### Phase 8: Docs and Hygiene

- [ ] Update `docs/setup-guide.md` with install commands, binary locations, and auth for all four, calling out `devin setup` and Aider's optional, non-secret credential evidence with auth remaining unknown.
- [ ] Update `docs/decisions/README.md`, `docs/specs/README.md`, `docs/plans/README.md` indexes.
- [ ] Note in the research note that the Pi package rename was corrected here and why it was invisible to version checks.
- [ ] Final sweep: confirm Grok has only fixture-backed model/profile data and the remaining providers have no fabricated ids, stream profiles, or session scanners.

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
- **Evidence over guessing**: an unprobed provider refuses; a probed provider such as Grok is pinned to the exact verified compatibility profile.
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
  - Grok 1.0.0 executes and another Grok version refuses compatibility; Devin, Cline, and Aider return their refusal messages.
- **Cross-repo**: after platform PLAN-102 lands and Desktop is repackaged, smoke-test install-from-setup for each on each OS.

## Risks & Mitigations

- **Live probe unavailable for some CLIs**: Grok is complete; Phase 1 continues to gate Devin, Cline, and Aider execution while their install tier proceeds from upstream scripts. Deferred items are recorded, not guessed.
- **Compiler list is larger than expected**: Phase 2 deliberately produces it before estimating Phases 3–5.
- **Refusal-only providers leak into product selectors**: platform execution catalogs include Grok and exclude Devin, Cline, and Aider until their adapters land.
- **`agent` alias false positives**: covered by a dedicated negative test in Phase 7.
- **Aider evidence is mistaken for readiness or leaks secrets**: the summary returns names only from an injected environment, keeps status `unknown`, and provider-setup branches on `auth.interactive` rather than special-casing the id.
- **Devin reclassification**: if Phase 1 shows it is control-plane only, stop at the install tier and raise a follow-up ADR rather than forcing it into session routing.

## Progress Log

| Date | Update |
|------|--------|
| 2026-08-07 | Plan created alongside ADR-033 and SPEC-027, after auditing `environment-bootstrap` commits `cb5efc7`, `d131535`, `216ef96`, `54992d6`, `05be416`, `bef3411`, `0d1831d`, `cfe7785`. Pi npm package drift found during the same audit and folded into Phase 3. |
| 2026-08-07 | SPEC-027 open questions rewritten as Proposed Decisions D1–D5 pending User approval, so implementation remains blocked. Review corrections use the official Grok `XAI_API_KEY`, treat Aider keys as evidence rather than readiness, keep Cline Windows install unsupported, and separate runtime setup visibility from the platform product execution catalog. |
| 2026-08-08 | User approved implementation starting with Grok. The Grok install/check taxonomy, native config, refusal adapter, conservative capabilities, empty bundled model catalog, dashboard/playground/setup surfaces, tests, setup guide, and read-only version/help probe landed as the first slice. Devin, Cline, Aider, and the Pi rename remain pending. |
| 2026-08-08 | Completed the authenticated Grok 1.0.0 lifecycle probe and promoted Grok to exact-version native execution. Added full sanitized fixtures, tool/error/cancellation/resume/fork parsing, permission safeguards, `grok-4.5`, compatibility refusal for version drift, and the platform catalog handoff. |
| 2026-08-08 | Closed the Devin ACP tails. Cancellation is clean: `session/cancel` settles the in-flight prompt in ~12ms with `stopReason: cancelled`, the session stays usable, and no usage is reported for the cancelled turn — much better than the CLI path, which emitted no terminal event at all on SIGTERM. `session/load` restores context across processes but returns `currentModeId: accept-edits` regardless of the mode set before the restart, so resumed turns would silently become permissive; the adapter already sets the mode after the bootstrap branch and a regression test now pins that, verified by simulating the regression. Also recorded that `session_locked` replays history before failing, and that orphaned processes were a probe artifact (`shell: true`), not a runtime defect. |
| 2026-08-08 | Mapped runtime permission modes onto Devin's ACP session modes after a three-run probe found a safety gap: in Devin's default `accept-edits` mode the agent calls `fs/write_text_file` with no `session/request_permission` for the write, so a conservative runtime turn would have edited the workspace un-gated — and the adapter never set a mode. Now pinned at bootstrap: `skip`→`bypass`, `default`→`ask`, `whitelist` refused (no Devin mode both permits and constrains an edit tool). The mapping is profile-declared, so ACP agents governed purely by permission requests are unaffected. |
| 2026-08-08 | Drove `session/prompt` over Devin ACP for a text turn and a tool turn. Every `session/update` type Devin emits is already handled by `AcpAdapter`, and usage is reported in the prompt result — something the CLI backend could not provide. The probe also found a latent runtime bug: `AcpStdioClient.isRequest` required a numeric JSON-RPC id, so Devin's string-UUID `fs/read_text_file` matched no guard and hit `failAll`, tearing down the session on the first file read. JSON-RPC 2.0 allows string ids, so this affected any ACP provider using them, not just Devin. Fixed with a regression test verified to fail against the old guard. |
| 2026-08-08 | Devin ACP profile landed. A live handshake against `devin acp` confirmed protocol version 1, `loadSession: true`, and four session modes, so `devin-acp` is registered tier 1 with subcommand detection and a working `providers.yaml` block. Correction to the previous entry: the ACP resolver already supported subcommand detection (`opencode acp`, `kilo acp`, `goose acp`, `kiro-cli acp`), so no new machinery was needed. `session/prompt` is not yet driven, so the update stream, tool shapes, usage, and cancellation over ACP remain uncharacterized. |
| 2026-08-08 | Devin 3000.3.27 install tier landed and P1 resolved: it executes locally, so it stays a CLI family and no ADR-023 reclassification is needed. CLI execution is refused on settled evidence rather than pending a probe — 3000.3.27 has no machine-readable output mode at all, so tool calls, usage, and session identity are unrecoverable from stdout. Its structured surface is `devin acp`, which belongs to the agent backend under ADR-031 and is the natural next slice. |
| 2026-08-08 | Cline 3.0.51 landed across five slices: install tier, the Pi package-rename fix, stream capture with a fixture-backed parser, a denied-tool fix that corrected three parser gaps the success fixtures hid, and execution enablement behind the exact-version profile `cline-cli-json-3.0.51`. Resume is disabled (`--id` fails under `--json`) and `whitelist` permission mode refuses (no per-tool flag exists), per User approval. One authenticated end-to-end run through WorkerPool remains outstanding; the probe account hit a zero credit balance mid-slice. |

---

*Created: 2026-08-07*
*Author: Claude draft for User review*
