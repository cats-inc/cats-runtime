# ADR-033: Adopt Grok, Devin, Cline, and Aider as CLI provider families, install-tier first

Date: 2026-08-07
Status: Proposed

## Context

`environment-bootstrap` (the upstream installer suite this project mirrors) added four AI coding CLIs to its supported tool set between 2026-08-04 and 2026-08-05:

- `cb5efc7` — Grok CLI (xAI), native installer, promoted into **Quick** mode alongside Claude Code / Antigravity / Cursor.
- `d131535` — Cline, added to the npm AI-CLI package set (**Full** mode).
- `216ef96` — Devin CLI (Cognition), native installer, **Full** mode; both official installers end by invoking the interactive `devin setup`, and the upstream scripts deliberately strip that final call so unattended installs cannot hang.
- `54992d6` — Aider, native installer, **Full** mode only; the official `install.{ps1,sh}` is really the `uv` installer plus `uv tool install --force --python python3.12 --with pip aider-chat@latest`.

Three supporting commits landed with them and change how the runtime should read installer results:

- `05be416` trimmed Quick mode to a core CLI set, so "Quick vs Full" is now a real upstream distinction rather than an accident of ordering.
- `bef3411` gave the shell checkers a `--full` mode matching Windows, so `check-installation` now reports the same provider matrix on all three OSes.
- `0d1831d` stopped reporting skipped installs and missing tools as success, so a non-zero exit from an upstream installer is now trustworthy signal.

`cats-runtime` recognizes twelve CLI provider families (`KNOWN_PROVIDERS` in `src/backends/cli/providers/types.ts`): claude, codex, antigravity, cursor, copilot, opencode, kilo, goose, pi, auggie, junie, kiro. None of the four new CLIs is represented, which means:

- `src/core/provider-install/knowledge.ts` has no install/check metadata for them, so provider-setup and diagnostics cannot see a `grok`, `devin`, `cline`, or `aider` binary even when it is sitting on PATH.
- `config/providers.yaml` bootstrap (ADR-021) cannot generate an instance block for them.
- The dashboard, playground, and provider-setup surfaces have no slot for them.
- `cats-platform` cannot ship packaged installer helpers for them, because the desktop CLI inventory probe (`desktop/host/cliInventoryProbe.ts`) maps desktop provider ids onto runtime `KNOWN_PROVIDERS` ids.

Separately, while auditing the four new CLIs against the upstream suite, a pre-existing drift surfaced: `cfe7785` followed Pi's npm package rename to `@earendil-works/pi-coding-agent` (removing the old `@mariozechner/pi-coding-agent` first, because npm reports a renamed package as permanently up to date). Both `cats-runtime` and `cats-platform` still install and check the abandoned package name.

The question this ADR settles is not *whether* to adopt the four CLIs — the upstream suite already installs them on every developer machine this project targets — but **at what tier** they enter the runtime, and **what the runtime is allowed to claim about them** before anyone has probed their execution contract.

## Decision

`cats-runtime` adopts `grok`, `devin`, `cline`, and `aider` as first-class CLI provider **families**, landing them at the install/check/setup tier first. Session execution adapters are gated behind per-CLI probe evidence and ship as explicit refusals until that evidence exists.

Specifically:

1. **Four new provider ids** join `KNOWN_PROVIDERS`: `grok`, `devin`, `cline`, `aider`. They take the four slots after `kiro` and before `ollama` / `openclaw` in `PROVIDER_ORDER`, so no established provider changes position in the dashboard.
2. **Install packs follow the upstream install method**, not a house style: `grok`, `devin`, and `aider` register through `createNativeInstall(...)`; `cline` registers through `createGenericNpmKnowledge(...)` against the `cline` npm package.
3. **Execution adapters ship as refusal stubs**, following the `AntigravityProvider` precedent (ADR-032). `buildSpawnArgs` throws a message that names the missing evidence and points at provider setup. The runtime does not invent a stream contract, a `-p`/`--print` flag, a session storage layout, or a model id list for any of the four.
4. **Compatibility falls back to presence-only detection.** No `*-stream-json-v1` profiles are added in `src/core/compatibility/knowledge.ts` until a live probe captures a real stream contract per CLI.
5. **Aider is modeled as env-key auth, not interactive login.** Its `auth` block sets `interactive: false` and carries the BYO-model env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`), with `docsUrl` pointing at `https://aider.chat/docs/llms.html`. It is the first runtime provider whose readiness is a function of environment rather than a stored credential, and provider-setup must not render a "sign in" affordance for it.
6. **Devin is modeled as install-complete-but-auth-incomplete by default.** Because upstream deliberately strips the trailing `devin setup` from both official installers, a successful install never implies a usable CLI. Devin's knowledge entry carries `requiresShellRestart: true` plus an explicit manual step (`devin setup`) in `notes`, and provider-setup surfaces that step rather than treating presence as readiness.
7. **Grok registers only the `grok` binary.** The upstream installer also drops an `agent` / `agent.exe` alias next to it; the runtime does not add `agent` as a PATH candidate. `agent` is a generic name with a high collision probability on a developer PATH, and a false positive there would report Grok as installed on a machine that has some unrelated `agent` binary.
8. **Devin's classification is probe-gated, not assumed.** Upstream documents Devin CLI as an interactive terminal coding agent with a Kanban surface for parallel tasks, which reads as a session provider. If a probe shows it only orchestrates remote Devin sessions and does not execute locally, it is reclassified as a management adapter under ADR-023 and removed from `KNOWN_PROVIDERS` in a follow-up ADR. This ADR registers it as a CLI family on the strength of the upstream description and accepts that reversal risk explicitly.
9. **Quick/Full pack membership stays upstream metadata.** The runtime treats all four as equally installable; pack membership (`native_cli_pack`) is carried by `cats-platform` setup-asset metadata, matching how the existing twelve are handled.
10. **The Pi package rename is corrected in the same slice.** `src/core/provider-install/knowledge.ts` moves to `@earendil-works/pi-coding-agent`. This is not scope creep: it is the same "runtime provider knowledge drifted from the upstream installer suite" defect the rest of this ADR exists to fix, and leaving it means Pi upgrades silently no-op forever.

This project has not shipped a stable release. Per the pre-release policy in `AGENTS.md`, no aliases, shims, or deprecation windows are owed for any of the above.

## Rationale

### Why register provider ids now instead of "just porting the install scripts"

The install scripts are not a standalone surface. Every consumer of an installer result — provider-setup UI, `GET /setup-state`, the desktop CLI inventory probe, `providers.yaml` bootstrap, diagnostics — is keyed by provider id. A script that installs `grok` with no `grok` provider id produces a binary the entire product is structurally blind to. The provider id *is* the porting.

### Why install-tier first, with execution gated

The runtime has one honest position on a CLI it has not run: say so. ADR-025 already commits this project to manual-first, evidence-driven provider evolution, and ADR-032 / PLAN-033 established the working pattern — Antigravity is a registered family whose `buildSpawnArgs` throws, and whose session scanner was never written because no one had probed `agy`'s session layout.

Guessing an execution contract is worse than refusing one. A fabricated `--output-format json` flag produces a provider that spawns, fails opaquely, and lands the failure in the user's session history as a runtime bug rather than an unsupported-provider message.

Meanwhile the install tier needs no guessing at all: the binary names, install URLs, install directories, PATH entries, upgrade semantics, and auth flows are all directly readable from the upstream installer scripts, which are the same scripts these users already run.

### Why the four take slots after `kiro`

`PROVIDER_ORDER` drives dashboard layout and the platform's `PRODUCT_PROVIDER_ORDER` mirrors it. Inserting by vendor affinity (Grok next to the other native installers, say) would reflow the badge order for every existing provider and invalidate a large set of ordering assertions in both repos for no user benefit. Appending keeps the diff proportional to the change.

### Why Aider gets a different auth model rather than being forced into the existing one

Every current provider either stores a credential from an interactive login or reads a single vendor key. Aider is BYO-model: it routes to whatever provider the user's environment has keys for, and it has no login at all. Rendering an interactive "sign in to Aider" step would be a lie in the UI, and marking it `requiredAfterInstall` with an empty `envVars` list would make it permanently un-ready. Modeling env-key auth as a first-class shape is a small addition that the runtime will need again the moment another BYO-key tool arrives.

### Why Devin is registered despite the classification risk

The alternative — hold Devin out until someone probes it — leaves upstream installing a CLI that the product cannot see, which is exactly the gap this ADR closes. Registering it install-tier-only costs one entry in each exhaustive map and one refusal stub; reversing it costs the same. The asymmetry favors registering now.

## Consequences

### Positive

- The runtime's provider taxonomy matches the installer suite users actually run, so setup diagnostics stop being silently incomplete.
- `KNOWN_PROVIDERS` growing from 12 to 16 makes TypeScript enumerate every exhaustive `Record<ProviderName, …>` that needs a new entry. The compiler, not a grep, finds the integration surface.
- The four CLIs become installable and checkable from packaged Cats Desktop the moment `cats-platform` PLAN-102 lands, with no runtime follow-up needed for the install path.
- Fixing the Pi package name restores Pi upgrades, which have been silently no-op since the upstream rename.
- Establishes a reusable "install-tier first, execution on evidence" onboarding path, so the next upstream CLI addition is a mechanical change rather than an architecture question.

### Negative

- Four providers appear in the dashboard and provider-setup that cannot yet run a session. The refusal message must be good enough that this reads as "not yet supported" rather than "broken".
- Sixteen exhaustive maps across two repos each grow by four entries; the diff is wide even though it is shallow.
- Devin may be reclassified later, which would mean removing a provider id that briefly existed. Accepted per the rationale above.
- Registering `cline` in the npm pack means the platform npm installer inherits whatever install-script handling upstream needed (`npm 12+` blocks package install scripts by default and `Install-NodeCLITools.ps1` passes `--allow-scripts`); the platform side must mirror that or Cline may install without a working shim.

### Neutral

- Model catalogs stay empty for all four. `curatedModelCatalog` / `providerAdvancedKnowledge` gain provider keys with no bundled model ids, and the playground exposes only `<provider>-default` sentinels, matching how Antigravity shipped.
- Grok's `agent` alias remains installed on user machines; the runtime simply does not look at it.
- The runtime does not adopt upstream's Quick/Full split as a runtime concept.

## Alternatives Considered

### 1. Port only the installer scripts, without runtime provider ids

- **Pros**: Smallest diff; no exhaustive-map churn; no provider-setup entries that cannot run.
- **Cons**: Nothing consumes the result. Provider-setup, `/setup-state`, the desktop inventory probe, and `providers.yaml` bootstrap are all keyed by provider id, so the installed binaries stay invisible to the product.
- **Why rejected**: It would deliver scripts nobody can reach through the product, which is the opposite of "納入 provider".

### 2. Land full execution adapters in the same slice

- **Pros**: The four CLIs would be immediately usable for sessions.
- **Cons**: Requires inventing a headless-invocation contract, stream format, session storage layout, and model list for four separate tools, none of which has been probed. Directly contradicts ADR-025.
- **Why rejected**: Every guess would land as a user-visible runtime failure, and unwinding a wrong stream parser is far more expensive than adding one later from evidence.

### 3. Model all four as `agent`-backend ACP adapters instead of CLI families

- **Pros**: Would sidestep per-CLI stream parsing if any of them ships an ACP mode.
- **Cons**: No evidence that any of the four speaks ACP. ADR-031 scopes the ACP adapter family to tools with a proven ACP contract, and the install/check tier — which is what is actually needed now — lives on the CLI side regardless.
- **Why rejected**: Speculative. If a probe later finds an ACP mode for one of them, an ACP profile can be added alongside the CLI family exactly as ADR-032 anticipated for Antigravity.

### 4. Treat Devin (and possibly Cline) as management adapters under ADR-023

- **Pros**: Correct home if either turns out to be a control-plane tool rather than a local execution agent.
- **Cons**: ADR-023 draws its line at command-oriented tools operating on repos, PRs, and deployments. Upstream describes both as terminal coding agents, so pre-classifying them as control-plane contradicts the only evidence available.
- **Why rejected as a default**: Kept as the documented fallback if the Phase 1 probe contradicts the upstream description.

## Notes for Future Work

- Each CLI's execution adapter should arrive as its own small slice, gated on a research note under `docs/research/`, rather than as one four-provider batch. They share no stream contract.
- If two or more of the four turn out to expose no machine-readable output at all (Aider is the likeliest — it is a human-facing TUI with no documented JSON stream), the runtime should consider a shared "presence-only provider" tier so the dashboard can distinguish *not yet probed* from *probed and not automatable*.
- The Pi package rename exposed a class of drift no test catches: the runtime's install knowledge silently diverging from the upstream installer suite. A periodic reconciliation check between `environment-bootstrap` and `provider-install/knowledge.ts` is worth its own follow-up.

## Related

- [SPEC-027: Grok, Devin, Cline, and Aider CLI Provider Onboarding](../specs/SPEC-027-grok-devin-cline-aider-cli-provider-onboarding.md)
- [PLAN-034: Grok, Devin, Cline, and Aider CLI Provider Onboarding](../plans/PLAN-034-grok-devin-cline-aider-cli-provider-onboarding.md)
- [ADR-013: Extend provider manifests with install and check metadata](./013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-021: Treat providers.yaml as generated config](./021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it.md)
- [ADR-023: Treat management CLIs as control-plane adapters, not session providers](./023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers.md)
- [ADR-025: Keep provider evolution detection manual-first and evidence-driven](./025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR-032: Replace Gemini CLI with Antigravity CLI](./032-replace-gemini-cli-with-antigravity-cli.md)
- environment-bootstrap commits `cb5efc7` (Grok), `d131535` (Cline), `216ef96` (Devin), `54992d6` (Aider), `05be416` (Quick-mode trim), `bef3411` (`--full` shell checkers), `0d1831d` (honest install/check exit codes), `cfe7785` + `75bd6ca` (Pi npm package rename)
- cats-platform ADR-109 (packaged setup side of the same adoption)

---

*Decision made: 2026-08-07*
*Decision makers: User, with Claude support*
