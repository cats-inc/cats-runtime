# PLAN-033: Replace Gemini CLI with Antigravity CLI

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | User |
| **Assigned To** | Unassigned |
| **Reviewer** | User |

## Related Spec

[SPEC-026: Antigravity CLI Provider Replacing Gemini CLI](../specs/SPEC-026-antigravity-cli-provider-replacing-gemini.md)

## Overview

This plan executes the runtime side of the Gemini-to-Antigravity provider swap. The work moves from the data layer outward (provider knowledge, ACP profile, compatibility) through session discovery, HTTP routes, UI, and finally tests and docs.

Phase ordering matters because:

- UI phases depend on the platform shared provider catalog landing first in cats-platform SPEC-110 / PLAN-100, then runtime mirrors those values.
- Session/discovery phases depend on a live `agy` install being probed first so we don't invent a fake session layout.
- Test fixture updates piggyback on the route + UI updates and are batched at the end.

## Coordination With cats-platform

This plan and cats-platform PLAN-100 land together as a single coordinated change. The split:

- **Runtime owns**: provider knowledge, compatibility profiles, ACP profile, session scanner, HTTP routes, dashboard UI, playground UI, provider-setup UI, runtime test fixtures, runtime docs.
- **Platform owns**: packaged installer scripts, desktop host code (`cliInventoryProbe`, `bootstrapPage`, `packaging`, `setupAssets`, `contracts`), shared provider catalog data, `Sync-AgentSkills` decisions, smoke tests, platform docs.

Cross-repo blocking points are called out per phase.

## Architecture Guardrails

1. Do not retain `gemini` as a local CLI provider id, family, or alias anywhere in runtime CLI config, provider-install knowledge, or setup/dashboard/playground local-provider UI. Google API provider names/model ids are separate and may remain.
2. Do not add a Google API HTTP backend in this plan — that is a separate decision.
3. Do not invent Antigravity behavior. If `agy` does not expose a probe or session format, return empty/unsupported rather than fake it.
4. Do not regress the dashboard provider-order layout. Antigravity takes Gemini's slot.
5. Do not edit `cats-platform/src/shared/providerCatalogData.ts` from this plan — that is owned by cats-platform PLAN-100 Phase 1.
6. Do not remove or rename `GEMINI_API_KEY` / Google API transport surfaces in this plan; that is a separate API-provider decision.
7. Do not read, rename, or delete `GEMINI.md`; it is an agent-specific instruction file, not Gemini CLI runtime config.
8. Do not design any cross-package catalog handoff from `cats-platform` in this slice; runtime UI mirrors the platform catalog values explicitly. The runtime HTTP model catalog may still omit bundled Antigravity model ids until live `agy` model evidence exists; the playground may expose only the `antigravity-default` provider-default sentinel.

## Implementation Phases

### Phase 1: Probe `agy` Reality

Goal: replace guesses with facts before touching code.
This phase is the same shared probe as cats-platform PLAN-100 Phase 0.

- [ ] Install `agy` locally via environment-bootstrap `Install-AntigravityCLI.ps1` (Windows) or `install-antigravity-cli.sh` (macOS/Linux).
- [ ] Capture `agy --version` output (or equivalent flag) and parse format.
- [ ] Capture `agy --help` to identify ACP / stream-json / session subcommands.
- [x] Look for model-id evidence using candidate subcommands (`agy models`, `agy models list`, or equivalent), documented config files, official product documentation, and smoke-run acceptance. `agy --help` alone is not sufficient model-id evidence. The shared research note found display-name evidence only and kept bundled Antigravity model ids out of the runtime catalog.
- [x] For the shared platform probe, record whether Antigravity's user-scoped installer requires elevation and whether native-binary download retries are idempotent enough for Cats Desktop to mark the setup helper `resumable: true`.
- [ ] Identify Antigravity's session storage path (PATH, `LOCALAPPDATA`, `~/.local`, or none).
- [ ] If sessions exist, capture a sample session file to determine readable format.
- [ ] Compare against openab's `agy-acp` adapter expectations to confirm ACP transport contract.
- [x] Document findings in a research note under `docs/research/2026-05-24-antigravity-cli-probe.md`.

**Deliverables**: Research note with concrete answers to all SPEC-026 Open Questions.

### Phase 2: Data Layer

- [x] In `src/core/provider-install/knowledge.ts:471-476`, remove the `gemini` `createGenericNpmKnowledge(...)` entry and add an `antigravity` `createNativeInstall(...)` entry using the binary name `agy` and the PATH/LOCALAPPDATA detection contract.
- [x] In `src/core/compatibility/knowledge.ts:152-174`, remove `gemini-cli-stream-json-v1` and `gemini-cli-stream-json-best-fit` profiles. Add `antigravity-*` profiles if Phase 1 confirms a stream contract worth profiling; otherwise leave Antigravity profile-less and let the evidence engine fall back to presence detection.
- [x] In `src/backends/agent/adapters/acp/profiles.ts:41-50`, remove `GEMINI_ACP_PROFILE` and add `ANTIGRAVITY_ACP_PROFILE` (family `antigravity`, tier 1) aligned with openab's `agy-acp` adapter. Detect `agy-acp` command / args for ACP; do not treat raw `agy` as ACP-capable unless Phase 1 proves it.
- [x] In `src/core/models/providerModelCatalog.ts`, decouple local CLI provider selection from the Google API model catalog. Keep Google/Gemini API model ids and transport behavior intact unless a separate API-provider rename lands.

**Deliverables**: Provider data layer recognizes `antigravity`, no longer recognizes `gemini`.

### Phase 3: Session, Discovery, History

- [x] Remove Gemini native-session discovery and do not add an Antigravity scanner until Phase 1 records a real `agy` session storage contract. If `agy` later exposes scannable sessions, add an `AntigravitySessionScanner` from that evidence instead of porting the legacy Gemini reader.
- [x] Remove `getGeminiSessionsDir` / Gemini file-backed path resolution. Do not add `getAntigravitySessionsDir` until a real session path is known.
- [x] In `src/http/routes/sessions.ts`, remove Gemini native-session import/discovery branches. Add Antigravity discovery only if Phase 1 confirms an importable session format.
- [x] In `src/http/routes/history.ts:32,35,64,479-500`, remove `geminiExtractText`, the `gemini_native` parser branch, and the `'gemini_native'` parser id. Add an `antigravity_native` parser only if Phase 1 confirms a readable format.

**Deliverables**: Session discovery and history import operate on Antigravity (or honestly return empty).

### Phase 4: Routes and UI

**Blocking dependency**: cats-platform PLAN-100 Phase 1 (shared provider catalog data) must be merged before this phase touches UI files. Confirm by checking that `cats-platform/src/shared/providerCatalogData.ts` lists `antigravity` as the platform-side provider, then mirror those values here.

- [x] Audit `src/http/routes/diagnostics.ts` and `src/http/routes/diagnosticsSupport.ts` for Gemini CLI provider literals. Local-provider diagnostics now use `antigravity`; the remaining `instance.transport === 'gemini'` checks are Google API transport aliases and intentionally stay out of this CLI migration.
- [x] In `src/http/routes/workspaceSubstrate.ts:33,48,50`, remove `gemini` from the `ENABLED_AGENTS` literal and related union type. Do not add `antigravity` unless a later probe confirms a workspace-substrate / skills-file contract equivalent to the existing Claude/Codex support.
- [x] Decide on a new `--antigravity` color token value (resolves SPEC-026 Open Question). Apply it in:
  - [x] `src/http/ui/tailwind.runtime.css` (CSS var definition)
  - [x] `src/http/ui/shared.ts:36` (badge style)
  - [x] `src/http/ui/pages/index.html:34,177,194,218` (dashboard CSS / selectors)
- [x] In `src/http/ui/pages/index.html:1098,1227,1266`, replace the `gemini` option, `PROVIDER_ORDER` entry, and agent-enabled list entry with `antigravity`.
- [x] In `src/http/ui/pages/playground.html:389,407,421,1274`, replace the `gemini` badge style block, model list, `PROVIDERS` array entry, and default agent provider with `antigravity`. Expose only the `antigravity-default` provider-default sentinel in the bundled playground list until Phase 1 proves raw `agy` model ids; user-curated YAML may populate local entries explicitly.
- [ ] In `src/http/ui/pages/playground.html:408,413,414`, audit the `copilot` / `openrouter` / `cursor` model lists for references to `gemini-*` vendor models — those are vendor-named submodels and may stay if Google still ships them under Copilot / Cursor, but the labels should be reviewed for accuracy.
- [x] Audit `src/http/ui/pages/provider-setup.html` for any Gemini-specific UI that the SPEC-026 grep did not catch (the file showed no matches but should be eyeballed).
- [x] Regenerate `src/http/ui/generated/runtimeTailwind.ts` via the runtime UI build (`npm run build:runtime-ui-css` or equivalent).
- [x] Regenerate `public/index.html` and `public/playground.html` from the updated sources.

**Deliverables**: Dashboard, playground, and diagnostics surfaces present Antigravity in the slot Gemini previously held.

### Phase 5: Config and Env Examples

- [x] In `config/providers.yaml.example:41-44,150-157`, rename the top-level default target and CLI backend `gemini` blocks to `antigravity`, update `command:` from `gemini` to `agy`, update session-timeout if Antigravity has a different expected latency profile, and adjust the auth-hint copy if Antigravity has a different login flow.
- [x] Leave `config/providers.yaml.example:262-270` (`backends.api.providers.gemini`, `transport: google`, `GEMINI_API_KEY`) intact unless a separate API-provider rename lands.
- [x] In `.env.example:28`, keep `GEMINI_API_KEY=` for the existing Google API transport. Do not add `ANTIGRAVITY_API_KEY=` in this plan (Antigravity is a local CLI provider, not an API backend).

**Deliverables**: Generated-config bootstrap (per ADR-021) produces an Antigravity entry instead of a Gemini entry.

### Phase 6: Tests

- [ ] Update fixtures in `src/http/providerDiagnostics.test.ts` (the heaviest user of `gemini`): CLI-provider fixtures move to `antigravity`; Google API probe tests stay under the existing Google/Gemini API transport unless a separate API-provider rename lands.
- [ ] Update fixtures across the remaining `src/http/*.test.ts` files that mention `gemini`: `acpRoutes`, `sessionWorktree`, `sessionClose`, `messagesRoute`, `fileDiscoveredDelete`, `auggieManagement`, `browserRoutes`, `mcpRoutes`, `wakeupRoutes`, `opencodeManagement`, `kiloManagement`, `kiroManagement`, `cursorManagement`, `codexManagement`. Replace `gemini` with `antigravity` where the test cares about a Google-family provider; replace with a different existing provider id where the test is provider-agnostic.
- [ ] Update `src/http/ui/shared.playground.test.ts` to match the playground changes.
- [ ] Run `npm test -- src/http` and confirm green.

**Deliverables**: Test suite passes with no Gemini references in the codebase.

### Phase 7: Docs and Repo Hygiene

- [ ] Update `docs/setup-guide.md:9,192,497,629,689` to name Antigravity / `agy`.
- [ ] Update `docs/security-guidelines.md`, `docs/plans/PLAN-003-api-backend.md`, `docs/research/2026-03-17-docker-cli-agent-login-validation.md` where they mention Gemini.
- [ ] Leave `cats-runtime/GEMINI.md` untouched. It is agent-instruction content, not Gemini CLI runtime config, and Codex must not edit other agents' files.
- [ ] Final grep sweep: `git grep -i gemini` across `cats-runtime/` — every remaining hit must be justified (e.g. Google API transport/model ids, third-party vendor model labels, or agent-governance references) or removed.

**Deliverables**: No accidental Gemini references; docs reflect the new reality.

## Files to Create / Modify

### Modify

- `src/core/provider-install/knowledge.ts`
- `src/core/compatibility/knowledge.ts`
- `src/backends/agent/adapters/acp/profiles.ts`
- `src/core/models/providerModelCatalog.ts`
- `src/http/providerServices.ts`
- `src/http/routes/sessions.ts`
- `src/http/routes/diagnostics.ts`
- `src/http/routes/diagnosticsSupport.ts`
- `src/http/routes/workspaceSubstrate.ts`
- `src/http/routes/history.ts`
- `src/http/ui/pages/index.html`
- `src/http/ui/pages/playground.html`
- `src/http/ui/pages/provider-setup.html` (review only)
- `src/http/ui/shared.ts`
- `src/http/ui/tailwind.runtime.css`
- `config/providers.yaml.example`
- `docs/setup-guide.md`
- `src/http/*.test.ts` (15+ files; see Phase 6)

### Create

- `src/backends/cli/discovery/AntigravitySessionScanner.ts` only if the Phase 1 probe finds a readable `agy` session format
- `docs/research/2026-05-24-antigravity-cli-probe.md`

### Delete

- `src/backends/cli/discovery/GeminiSessionScanner.ts` (removed; do not replace until `agy` session evidence exists)
- Regenerated artifacts under `src/http/ui/generated/` (rebuilt, not hand-edited)

## Technical Decisions

- **New provider id is `antigravity` (lowercase) and display label is `Antigravity`**: matches the installer naming and disambiguates from the Google API backend.
- **Phase 1 (probe) blocks all code changes**: the runtime should not invent Antigravity behavior. If a contract is unclear, the runtime returns honest "not yet supported" instead of guessing.
- **No backwards-compat shim**: per project policy, this is a swap, not an additive migration.
- **Cross-repo handoff order**: cats-platform PLAN-100 Phase 1 (shared catalog) -> cats-runtime PLAN-033 Phases 2-3 (data + discovery) -> cats-runtime PLAN-033 Phase 4 (UI mirrors catalog values) -> both repos' Phase 5+ in parallel.

## Testing Strategy

- **Unit tests**: per-file `npm test` runs as each Phase 6 fixture updates land.
- **Integration tests**: `npm test -- src/http` after Phase 6 completes.
- **Manual testing**: Start the runtime (`npm run dev`), confirm:
  - Dashboard shows Antigravity badge in the slot Gemini previously occupied.
  - Playground provider dropdown lists `antigravity` and does not fabricate bundled model ids before the `agy` model contract is proven.
  - `Settings > Runtime` (if visible from runtime side) lists `antigravity` as the Google-family provider.
  - With `agy` not installed, the provider shows as missing with an install hint; with `agy` installed, it shows as available.
- **Cross-repo verification**: After cats-platform PLAN-100 lands and the desktop app is repackaged, smoke-test the Electron flow end-to-end.

## Risks & Mitigations

- **Antigravity CLI's actual contract differs from openab's `agy-acp` profile**: Phase 1 probe surfaces this before any code is written. Mitigation: gate Phases 2-3 on the probe research note.
- **Cross-repo phase ordering breaks**: if runtime UI lands before platform shared catalog, the playground model list can drift from the packaged provider catalog. Mitigation: Phase 4 keeps the bundled runtime list empty until the shared `agy` probe produces finalized values.
- **Tests rely on `gemini` as a generic provider id**: silent test-only references may survive Phase 6. Mitigation: final grep sweep in Phase 7 catches stragglers.
- **Agent-governance files are misclassified as CLI files**: editing `GEMINI.md` would violate the project file-ownership rules and conflate Gemini-the-agent with Gemini CLI. Mitigation: leave `GEMINI.md` out of scope and justify governance references during the final grep sweep.

## Progress Log

| Date | Update |
|------|--------|
| 2026-05-24 | Plan created alongside ADR-032 and SPEC-026. |
| 2026-05-24 | Follow-up tightened the plan around evidence gaps: Antigravity native-session discovery stays absent until a real `agy` session path exists; workspace substrate drops Gemini without adding Antigravity; runtime playground mirrors the platform `antigravity-default` sentinel while the HTTP model catalog still avoids unverified raw model ids. |
| 2026-05-24 | Implementation progress synced: provider-install knowledge, compatibility, ACP profile, session/history removal, diagnostics/UI/provider config, generated UI artifacts, and historical Docker-login docs now reflect Antigravity. Live `agy --help` / `agy --version`, session storage, and importable session evidence remain open. |

---

*Created: 2026-05-24*
*Author: User, with Claude support*
