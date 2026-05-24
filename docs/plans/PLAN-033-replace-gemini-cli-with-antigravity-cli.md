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

- UI phases depend on the shared provider catalog landing first in cats-platform SPEC-110 / PLAN-100.
- Session/discovery phases depend on a live `agy` install being probed first so we don't invent a fake session layout.
- Test fixture updates piggyback on the route + UI updates and are batched at the end.

## Coordination With cats-platform

This plan and cats-platform PLAN-100 land together as a single coordinated change. The split:

- **Runtime owns**: provider knowledge, compatibility profiles, ACP profile, session scanner, HTTP routes, dashboard UI, playground UI, provider-setup UI, runtime test fixtures, runtime docs.
- **Platform owns**: packaged installer scripts, desktop host code (`cliInventoryProbe`, `bootstrapPage`, `packaging`, `setupAssets`, `contracts`), shared provider catalog data, `Sync-AgentSkills` decisions, smoke tests, platform docs.

Cross-repo blocking points are called out per phase.

## Architecture Guardrails

1. Do not retain `gemini` as a provider id, family, or alias anywhere in runtime config, knowledge, or UI.
2. Do not add a Google API HTTP backend in this plan — that is a separate decision.
3. Do not invent Antigravity behavior. If `agy` does not expose a probe or session format, return empty/unsupported rather than fake it.
4. Do not regress the dashboard provider-order layout. Antigravity takes Gemini's slot.
5. Do not edit `cats-platform/src/shared/providerCatalogData.ts` from this plan — that is owned by cats-platform PLAN-100 Phase 1.

## Implementation Phases

### Phase 1: Probe `agy` Reality

Goal: replace guesses with facts before touching code.

- [ ] Install `agy` locally via environment-bootstrap `Install-AntigravityCLI.ps1` (Windows) or `install-antigravity-cli.sh` (macOS/Linux).
- [ ] Capture `agy --version` output (or equivalent flag) and parse format.
- [ ] Capture `agy --help` to identify ACP / stream-json / session subcommands.
- [ ] Identify Antigravity's session storage path (PATH, `LOCALAPPDATA`, `~/.local`, or none).
- [ ] If sessions exist, capture a sample session file to determine readable format.
- [ ] Compare against openab's `agy-acp` adapter expectations to confirm ACP transport contract.
- [ ] Document findings in a research note under `docs/research/2026-05-24-antigravity-cli-probe.md`.

**Deliverables**: Research note with concrete answers to all SPEC-026 Open Questions.

### Phase 2: Data Layer

- [ ] In `src/core/provider-install/knowledge.ts:471-476`, remove the `gemini` `createGenericNpmKnowledge(...)` entry and add an `antigravity` `createNativeInstall(...)` entry using the binary name `agy` and the PATH/LOCALAPPDATA detection contract.
- [ ] In `src/core/compatibility/knowledge.ts:152-174`, remove `gemini-cli-stream-json-v1` and `gemini-cli-stream-json-best-fit` profiles. Add `antigravity-*` profiles if Phase 1 confirms a stream contract worth profiling; otherwise leave Antigravity profile-less and let the evidence engine fall back to presence detection.
- [ ] In `src/backends/agent/adapters/acp/profiles.ts:41-50`, remove `GEMINI_ACP_PROFILE` and add `ANTIGRAVITY_ACP_PROFILE` (family `antigravity`, tier 1, spawn `agy` with the openab-aligned ACP transport).
- [ ] In `src/core/models/providerModelCatalog.ts`, decide per Phase 1 evidence: keep the Google native-models entries under a separate `google` API path, or remove them entirely if no API path is wired. Either way, decouple them from the retired `gemini` CLI family id.

**Deliverables**: Provider data layer recognizes `antigravity`, no longer recognizes `gemini`.

### Phase 3: Session, Discovery, History

- [ ] Rename `src/backends/cli/discovery/GeminiSessionScanner.ts` → `AntigravitySessionScanner.ts`. Rewrite the body per Phase 1 evidence. If `agy` exposes no scannable sessions, the scanner returns an empty list and logs at debug level.
- [ ] In `src/http/providerServices.ts:81-82`, rename `getGeminiSessionsDir` → `getAntigravitySessionsDir` and adjust the resolver argument.
- [ ] In `src/http/routes/sessions.ts:58-59,76,2034,2183-2186`, replace the `GeminiSessionScanner` import, `getGeminiSessionsDir` reference, and the `case 'gemini':` switch arm with `antigravity` equivalents.
- [ ] In `src/http/routes/history.ts:32,35,64,479-500`, remove `geminiExtractText`, the `gemini_native` parser branch, and the `'gemini_native'` parser id. Add an `antigravity_native` parser only if Phase 1 confirms a readable format.

**Deliverables**: Session discovery and history import operate on Antigravity (or honestly return empty).

### Phase 4: Routes and UI

**Blocking dependency**: cats-platform PLAN-100 Phase 1 (shared provider catalog data) must be merged before this phase touches UI files. Confirm by checking that `cats-platform/src/shared/providerCatalogData.ts` lists `antigravity` and not `gemini`.

- [ ] In `src/http/routes/diagnostics.ts:1382` and `src/http/routes/diagnosticsSupport.ts:27`, replace `'gemini'` literals with `'antigravity'`.
- [ ] In `src/http/routes/workspaceSubstrate.ts:33,48,50`, replace the `ENABLED_AGENTS` literal and the `'claude' | 'gemini' | 'codex'` union type with `antigravity`.
- [ ] Decide on a new `--antigravity` color token value (resolves SPEC-026 Open Question). Apply it in:
  - [ ] `src/http/ui/tailwind.runtime.css` (CSS var definition)
  - [ ] `src/http/ui/shared.ts:36` (badge style)
  - [ ] `src/http/ui/pages/index.html:34,177,194,218` (dashboard CSS / selectors)
- [ ] In `src/http/ui/pages/index.html:1098,1227,1266`, replace the `gemini` option, `PROVIDER_ORDER` entry, and agent-enabled list entry with `antigravity`.
- [ ] In `src/http/ui/pages/playground.html:389,407,421,1274`, replace the `gemini` badge style block, model list, `PROVIDERS` array entry, and default agent provider with `antigravity`. Pull the new model list from the updated `cats-platform/src/shared/providerCatalogData.ts`.
- [ ] In `src/http/ui/pages/playground.html:408,413,414`, audit the `copilot` / `openrouter` / `cursor` model lists for references to `gemini-*` vendor models — those are vendor-named submodels and may stay if Google still ships them under Copilot / Cursor, but the labels should be reviewed for accuracy.
- [ ] Audit `src/http/ui/pages/provider-setup.html` for any Gemini-specific UI that the SPEC-026 grep did not catch (the file showed no matches but should be eyeballed).
- [ ] Regenerate `src/http/ui/generated/runtimeTailwind.ts` via the runtime UI build (`npm run build:runtime-ui-css` or equivalent).
- [ ] Regenerate `public/index.html` and `public/playground.html` from the updated sources.

**Deliverables**: Dashboard, playground, and diagnostics surfaces present Antigravity in the slot Gemini previously held.

### Phase 5: Config and Env Examples

- [ ] In `config/providers.yaml.example:41-44,150-157,262-270`, rename the `gemini` CLI provider block to `antigravity`, update `command:` from `gemini` to `agy`, update session-timeout if Antigravity has a different expected latency profile, and adjust the auth-hint copy if Antigravity has a different login flow.
- [ ] In `.env.example:28`, remove `GEMINI_API_KEY=`. Do not add `ANTIGRAVITY_API_KEY=` in this plan (no API path wired here).

**Deliverables**: Generated-config bootstrap (per ADR-021) produces an Antigravity entry instead of a Gemini entry.

### Phase 6: Tests

- [ ] Update fixtures in `src/http/providerDiagnostics.test.ts` (the heaviest user of `gemini`): the new Gemini-style API probe tests can either be migrated to Antigravity if it has an API path, or replaced by Google API tests under the `api` backend family.
- [ ] Update fixtures across the remaining `src/http/*.test.ts` files that mention `gemini`: `acpRoutes`, `sessionWorktree`, `sessionClose`, `messagesRoute`, `fileDiscoveredDelete`, `auggieManagement`, `browserRoutes`, `mcpRoutes`, `wakeupRoutes`, `opencodeManagement`, `kiloManagement`, `kiroManagement`, `cursorManagement`, `codexManagement`. Replace `gemini` with `antigravity` where the test cares about a Google-family provider; replace with a different existing provider id where the test is provider-agnostic.
- [ ] Update `src/http/ui/shared.playground.test.ts` to match the playground changes.
- [ ] Run `npm test -- src/http` and confirm green.

**Deliverables**: Test suite passes with no Gemini references in the codebase.

### Phase 7: Docs and Repo Hygiene

- [ ] Update `docs/setup-guide.md:9,192,497,629,689` to name Antigravity / `agy`.
- [ ] Update `docs/security-guidelines.md`, `docs/plans/PLAN-003-api-backend.md`, `docs/research/2026-03-17-docker-cli-agent-login-validation.md` where they mention Gemini.
- [ ] Decide on `cats-runtime/GEMINI.md`: this file is for agent-instruction purposes (not Gemini CLI runtime config). Options: (a) delete if Gemini-the-agent is not used in this project anymore; (b) rename to `ANTIGRAVITY.md` if Antigravity acts as an agent here; (c) leave untouched if it documents general Google-agent instructions independent of CLI choice. Default: delete and let `AGENTS.md` cover cross-agent instructions.
- [ ] Final grep sweep: `git grep -i gemini` across `cats-runtime/` — every remaining hit must be justified (e.g. third-party vendor model labels) or removed.

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
- `.env.example`
- `docs/setup-guide.md`
- `src/http/*.test.ts` (15+ files; see Phase 6)

### Create

- `src/backends/cli/discovery/AntigravitySessionScanner.ts` (renamed from `GeminiSessionScanner.ts`)
- `docs/research/2026-05-24-antigravity-cli-probe.md`

### Delete

- `src/backends/cli/discovery/GeminiSessionScanner.ts` (after rename)
- `cats-runtime/GEMINI.md` (per Phase 7 decision)
- Regenerated artifacts under `src/http/ui/generated/` (rebuilt, not hand-edited)

## Technical Decisions

- **New provider id is `antigravity` (lowercase) and display label is `Antigravity`**: matches the installer naming and disambiguates from the Google API backend.
- **Phase 1 (probe) blocks all code changes**: the runtime should not invent Antigravity behavior. If a contract is unclear, the runtime returns honest "not yet supported" instead of guessing.
- **No backwards-compat shim**: per project policy, this is a swap, not an additive migration.
- **Cross-repo handoff order**: cats-platform PLAN-100 Phase 1 (shared catalog) → cats-runtime PLAN-033 Phases 2-3 (data + discovery) → cats-runtime PLAN-033 Phase 4 (UI consumes shared catalog) → both repos' Phase 5+ in parallel.

## Testing Strategy

- **Unit tests**: per-file `npm test` runs as each Phase 6 fixture updates land.
- **Integration tests**: `npm test -- src/http` after Phase 6 completes.
- **Manual testing**: Start the runtime (`npm run dev`), confirm:
  - Dashboard shows Antigravity badge in the slot Gemini previously occupied.
  - Playground provider dropdown lists `antigravity` and the model list populates.
  - `Settings > Runtime` (if visible from runtime side) lists `antigravity` as the Google-family provider.
  - With `agy` not installed, the provider shows as missing with an install hint; with `agy` installed, it shows as available.
- **Cross-repo verification**: After cats-platform PLAN-100 lands and the desktop app is repackaged, smoke-test the Electron flow end-to-end.

## Risks & Mitigations

- **Antigravity CLI's actual contract differs from openab's `agy-acp` profile**: Phase 1 probe surfaces this before any code is written. Mitigation: gate Phases 2-3 on the probe research note.
- **Cross-repo phase ordering breaks**: if runtime UI lands before platform shared catalog, the playground model list will reference a missing entry. Mitigation: Phase 4 explicitly waits on cats-platform PLAN-100 Phase 1.
- **Tests rely on `gemini` as a generic provider id**: silent test-only references may survive Phase 6. Mitigation: final grep sweep in Phase 7 catches stragglers.
- **GEMINI.md decision is misjudged**: if it documents general agent instructions used by other tools (e.g. Gemini CLI for unrelated tasks outside this project), deletion would lose context. Mitigation: open the file and read it before deciding; default to keep if uncertain.

## Progress Log

| Date | Update |
|------|--------|
| 2026-05-24 | Plan created alongside ADR-032 and SPEC-026. |

---

*Created: 2026-05-24*
*Author: User, with Claude support*
