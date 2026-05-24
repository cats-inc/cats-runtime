# ADR-032: Replace Gemini CLI with Antigravity CLI as the Google-family provider

Date: 2026-05-24
Status: Proposed

## Context

`environment-bootstrap` (the upstream installer suite this project uses to provision local CLIs) has, as of commits `b273f63` and `5725e63` on 2026-05-24, made two changes:

1. Removed `@google/gemini-cli` from `Install-NodeCLITools` / `install-node-cli-tools` on all three OSes.
2. Added native Antigravity CLI installers (`Install-AntigravityCLI.ps1` / `install-antigravity-cli.sh`) that drop an `agy` binary on PATH (or `LOCALAPPDATA` / `~/.local/bin`), and switched `Check-Installation` to probe `agy` instead of `gemini`.

The owner has confirmed that Antigravity CLI is the native replacement for Gemini CLI in this project and Gemini CLI will be deprecated. `cats-runtime` currently treats `gemini` as a first-class provider family across:

- `src/core/provider-install/knowledge.ts` (npm-based install knowledge)
- `src/core/compatibility/knowledge.ts` (`gemini-cli-stream-json-v1` profiles)
- `src/core/models/providerModelCatalog.ts` (Google native model catalog)
- `src/backends/cli/discovery/GeminiSessionScanner.ts` (file-backed session discovery)
- `src/backends/agent/adapters/acp/profiles.ts` (`GEMINI_ACP_PROFILE`)
- `src/http/ui/pages/{index,playground,provider-setup}.html` (dashboard + playground + setup UI)
- `src/http/routes/{sessions,history,diagnostics,workspaceSubstrate}.ts`
- `config/providers.yaml.example`, `.env.example`, `docs/setup-guide.md`
- assorted test fixtures

The question is whether the runtime should:

- keep Gemini CLI as a supported provider and add Antigravity as a parallel family,
- treat Antigravity as a rename/swap of Gemini CLI in place,
- or model both directions explicitly.

## Decision

`cats-runtime` will replace Gemini CLI with Antigravity CLI as the Google-family local provider. The runtime will not retain a Gemini CLI subprocess provider after this slice lands.

Specifically:

1. The provider family identifier `gemini` is retired from runtime config, knowledge, compatibility, ACP profile, session scanner, model catalog dispatch, and UI lists.
2. A new provider family `antigravity` (id) / `Antigravity` (label) takes its place, registered through `createNativeInstall(...)` against the `agy` binary delivered by environment-bootstrap.
3. The ACP-direction `agy-acp` adapter (already shipped in openab v0.8.4-beta.3 as PR #896) is the preferred transport profile for Antigravity in the agent backend.
4. The Google API backend (HTTP completion against Google's API, distinct from the local CLI) is **not** retired by this ADR. The `GEMINI_API_KEY` env var and Google transport in `providerModelCatalog.ts` may be kept under an explicit `google` API backend entry if owner-driven separation is desired — but no Gemini CLI subprocess wiring remains.
5. Session storage, history parser, and `gemini_native` parser id are removed; Antigravity's own session storage format becomes the new truth (to be probed during PLAN-033 Phase 1).
6. Runtime dashboard color tokens, provider badges, playground model list, and `ENABLED_AGENTS` enums lose their `gemini` entry; a new `antigravity` entry takes its slot in the same provider ordering position.

This project has not shipped; no migration shim, dual-config support, or deprecation window is required (see project-wide policy on backwards compatibility).

## Rationale

### Why a full swap rather than parallel coexistence

- Gemini CLI is being removed from the installer suite — keeping a runtime provider entry that has no install path produces dead diagnostics noise and false setup-readiness signals.
- The two CLIs do not share session storage, ACP capability profile, or process contract, so "alias" semantics would leak implementation details.
- The project has never shipped, so the cost of preserving the old name is pure ongoing complexity for zero user benefit.

### Why `antigravity` as the new family id

- Matches the installer's display naming (`Install-AntigravityCLI.ps1`, "Antigravity CLI").
- Disambiguates from the Google API HTTP transport, which is a separate backend concern.
- Aligns with openab's existing `agy-acp` adapter family, so ACP-direction wiring stays consistent across the ecosystem.

### Why keep the Google API backend separate from this decision

- The Google completion API is owned by Google and not coupled to the Antigravity CLI's local execution. Conflating them would force two unrelated lifecycles into one provider entry.
- A separate `google` API backend (or no API backend at all, if the owner chooses to drop it) is a follow-up call, not blocked by this ADR.

## Consequences

### Positive

- One Google-family local provider, one install path, one diagnostics surface.
- Eliminates the `@google/gemini-cli` npm dependency from the install matrix.
- Lets the runtime adopt Antigravity's native session model directly instead of layering it on top of legacy Gemini CLI assumptions.
- Aligns runtime provider taxonomy with the upstream installer suite, so a future runtime/installer drift is easier to catch.

### Negative

- Touches a wide surface (UI, routes, knowledge, compatibility, model catalog, tests, docs) in one coordinated slice.
- Existing local developer instances that have a checked-out `gemini` provider config will see that config rejected after the swap — owner will need to regenerate `providers.yaml` (this is an explicit non-issue per the no-backward-compat policy, but should be called out in the rollout note).

### Neutral

- Antigravity CLI's session storage format must be probed during implementation; this ADR does not freeze that format.
- The decision does not specify whether a `.antigravity/skills/` directory will exist or be supported — that is owned by the platform-side `Sync-AgentSkills` decision (see ADR-107).

## Alternatives Considered

### 1. Keep Gemini CLI and add Antigravity as a parallel family

- **Pros**: No code removal; owner can choose per session.
- **Cons**: Two install paths, two diagnostics paths, two session scanners. The Gemini install path no longer exists upstream, so the choice is fictional.
- **Why rejected**: The upstream installer has already removed Gemini CLI; keeping a runtime entry for an uninstallable provider is dishonest diagnostics.

### 2. Treat the swap as a rename with id alias

- **Pros**: Single-line config change for existing instances.
- **Cons**: The two CLIs do not share session format, ACP profile, or process contract — an "alias" would lie at every seam.
- **Why rejected**: The project has not shipped, so there is no installed base to protect, and aliasing would lock in confused semantics.

### 3. Defer until Antigravity CLI ships a stable v1

- **Pros**: Avoids tracking a moving target.
- **Cons**: Gemini CLI is already removed upstream; the runtime would be stuck with a half-working installer matrix in the meantime.
- **Why rejected**: The upstream change is already in `main`; the runtime cannot stay ahead of it.

## Notes for Future Work

- If the Google API completion path becomes a first-class provider after this slice, it should land as a separate ADR under the existing `api` backend family, not under `antigravity`.
- The Antigravity CLI ACP profile may eventually subsume the CLI-subprocess transport entirely (openab's `agy-acp` adapter already exposes ACP from day one). The runtime should treat the CLI-subprocess `antigravity` transport as the baseline and add `agent/acp:antigravity` opportunistically.

## Related

- [SPEC-026: Antigravity CLI Provider Replacing Gemini CLI](../specs/SPEC-026-antigravity-cli-provider-replacing-gemini.md)
- [PLAN-033: Replace Gemini CLI with Antigravity CLI](../plans/PLAN-033-replace-gemini-cli-with-antigravity-cli.md)
- [ADR-013: Extend provider manifests with install and check metadata](./013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-031: Keep ACP inside the agent backend family](./031-keep-acp-inside-agent-backend-and-model-runtime-acp-as-a-separate-facade.md)
- environment-bootstrap commits `b273f63a` (Antigravity installers + Gemini removal) and `5725e637` (installer ordering)
- cats-platform ADR-107 (packaged setup side of the same migration)

---

*Decision made: 2026-05-24*
*Decision makers: User, with Claude support*
