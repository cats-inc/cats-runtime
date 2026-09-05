# ADR-033: Adopt Grok, Devin, Cline, and Aider as CLI provider families, install-tier first

Date: 2026-08-07
Status: Proposed

Implementation note: the User approved the Grok-only subset on 2026-08-08.
Grok subsequently completed an authenticated lifecycle probe and now executes
through the adapter whose fixture baseline was recorded on 1.0.0. The broader Devin, Cline, and Aider
decision remains proposed.

Policy amendment (2026-08-26): [ADR-035](./035-never-block-provider-execution-on-exact-cli-version.md)
supersedes this proposal's exact-version execution gate. Fixture versions remain
provenance, while forward and unknown versions use the best-known adapter.
Cline has since gained a fixture-backed native adapter, and Devin executes
through its verified ACP agent profile; Aider remains install-tier only.

Bootstrap routing amendment (2026-08-26): Devin remains a CLI provider family
for install, version, path, and auth discovery, but generated execution config
must not create its non-executable `cli/native` target. Selecting Devin during
bootstrap creates only `agent/acp` (`devin acp`) and routes Devin there by
default. Selecting Aider keeps it in setup discovery but does not create any
execution target because its CLI has no machine-readable contract. Setup
scanning remains independent of configured execution targets.

Aider amendment (2026-09-05): [ADR-037](./037-adopt-meta-muse-as-an-executable-cli-provider-and-retire-aider.md)
retires Aider entirely. The install-tier-only arrangement described above no longer
exists in the runtime; the adapter, install knowledge, and packaged installers are
deleted, and Meta Muse takes its place as an executable CLI provider family. This
record and the 2026-08-09 Aider probe stay as the history of why.

Diagnostics amendment (2026-08-26): recurring light health checks must not
create provider-owned ACP sessions. They verify the launch command only;
explicit `probe=live` diagnostics own initialize and session bootstrap.

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

The question this ADR would settle is not *whether* to recognize the four CLIs — the upstream suite already carries install flows for them on their supported hosts — but **at what tier** they enter the runtime, and **what the runtime is allowed to claim about them** before anyone has probed their execution contract.

## Decision

This ADR proposes that `cats-runtime` adopt `grok`, `devin`, `cline`, and `aider` as first-class CLI provider **families**, landing them at the install/check/setup tier first. Session execution adapters are gated behind per-CLI probe evidence and ship as explicit refusals only until a machine-readable invocation contract exists. Grok and Cline have now satisfied that native CLI gate, and Devin has a verified ACP agent profile; Aider has not.

Specifically:

1. **Four new provider ids** join `KNOWN_PROVIDERS`: `grok`, `devin`, `cline`, `aider`. They append to the CLI-family segment after `kiro` and before `ollama` / `openclaw` in `PROVIDER_ORDER`. Existing providers keep their relative order, while the two non-CLI providers move four absolute positions later in the dashboard.
2. **Install packs follow the upstream install method**, not a house style: `grok`, `devin`, and `aider` register through `createNativeInstall(...)`; `cline` registers through `createGenericNpmKnowledge(...)` against the `cline` npm package.
3. **Execution adapters begin as refusal stubs** until a machine-readable invocation contract is known. A provider is promoted only by a complete live probe. Once promoted, version drift uses the best-known adapter under ADR-035 instead of reverting to a refusal stub.
4. **Compatibility evidence is not an execution allowlist.** Grok uses `grok-cli-streaming-json-1.0.0` as fixture provenance and the best-known adapter for later or unknown versions. Exact version inequality alone never refuses execution.
5. **Aider is modeled as non-interactive credential evidence, not env-key readiness.** Its `auth` block sets `interactive: false` and carries common BYO-model env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`), with `docsUrl` pointing at `https://aider.chat/docs/llms.html`. Provider setup may report the names of non-empty variables visible to the runtime, but their presence does not prove that Aider's selected model is usable and their absence does not prove that Aider is unconfigured: Aider can also load `.env`, `.aider.conf.yml`, command-line credentials, or a local model. Until a provider-specific non-interactive auth probe exists, Aider auth remains `unknown` and provider setup must not render a "sign in" affordance.
6. **Devin is modeled as install-complete-but-auth-unverified by default.** Because upstream deliberately strips the trailing `devin setup` from both official installers, a successful install never implies a usable CLI. Devin's knowledge entry carries `requiresShellRestart: true` plus an explicit manual step (`devin setup`) in `notes`, and provider setup surfaces that step without claiming whether it has subsequently been completed. A future non-interactive Devin auth probe is required before the runtime may report auth as ready.
7. **Grok registers only the `grok` binary.** The upstream installer also drops an `agent` / `agent.exe` alias next to it; the runtime does not add `agent` as a PATH candidate. `agent` is a generic name with a high collision probability on a developer PATH, and a false positive there would report Grok as installed on a machine that has some unrelated `agent` binary.
8. **Devin's classification is probe-gated, not assumed.** Upstream documents Devin CLI as an interactive terminal coding agent with a Kanban surface for parallel tasks, which reads as a session provider. If a probe shows it only orchestrates remote Devin sessions and does not execute locally, it is reclassified as a management adapter under ADR-023 and removed from `KNOWN_PROVIDERS` in a follow-up ADR. This ADR registers it as a CLI family on the strength of the upstream description and accepts that reversal risk explicitly.
9. **Quick/Full pack membership stays upstream metadata.** The runtime treats the supported platform/provider pairs as installable; pack membership (`native_cli_pack`) is carried by `cats-platform` setup-asset metadata, matching how the existing twelve are handled. Cline is installable through packaged setup on macOS and Linux only until its official Windows support or a reviewed Windows execution probe exists.
10. **The Pi package rename is corrected in the same slice.** `src/core/provider-install/knowledge.ts` moves to `@earendil-works/pi-coding-agent`. This is not scope creep: it is the same "runtime provider knowledge drifted from the upstream installer suite" defect the rest of this ADR exists to fix, and leaving it means Pi upgrades silently no-op forever.
11. **Install visibility and product executability remain separate.** The runtime dashboard, diagnostics, and provider-setup surfaces may list all four, but `cats-platform` adds a provider to its shared execution catalog only with a working runtime adapter. Grok and Cline qualify through their native adapters, Devin qualifies through ACP, and Aider does not.
12. **Generated config exposes only executable targets.** Bootstrap still probes the installed `devin` and `aider` binaries directly for setup evidence. It writes only `backends.agent.providers.devin.instances.acp` with `args: ['acp']` for Devin and routes there by default; it writes no detect-only `backends.cli.providers.devin` block. Aider has no verified execution surface, so generated config writes no Aider target at all.
13. **Light ACP health is non-mutating.** Dashboard polling may verify that the configured ACP launch command exists and accepts a bounded help probe, but only an explicit live diagnostic may perform ACP initialize and create a bootstrap session.

This project has not shipped a stable release. Per the pre-release policy in `AGENTS.md`, no aliases, shims, or deprecation windows are owed for any of the above.

## Rationale

### Why register provider ids now instead of "just porting the install scripts"

The install scripts are not a standalone surface. Every consumer of an installer result — provider-setup UI, `GET /setup-state`, the desktop CLI inventory probe, `providers.yaml` bootstrap, diagnostics — is keyed by provider id. A script that installs `grok` with no `grok` provider id produces a binary the entire product is structurally blind to. The provider id *is* the porting.

### Why install-tier first, with execution gated

The runtime has one honest position on a CLI it has not run: say so. ADR-025 already commits this project to manual-first, evidence-driven provider evolution, and ADR-032 / PLAN-033 established the working pattern — Antigravity is a registered family whose `buildSpawnArgs` throws, and whose session scanner was never written because no one had probed `agy`'s session layout.

Guessing an execution contract is worse than refusing one. A fabricated `--output-format json` flag produces a provider that spawns, fails opaquely, and lands the failure in the user's session history as a runtime bug rather than an unsupported-provider message.

Meanwhile the install tier needs no guessing at all: the binary names, install URLs, install directories, PATH entries, upgrade semantics, and auth flows are all directly readable from the upstream installer scripts, which are the same scripts these users already run.

### Why the four take slots after `kiro`

`PROVIDER_ORDER` drives runtime dashboard layout. Appending to the CLI-family segment preserves the relative order of every existing provider and keeps all CLI families ahead of the API/local-provider entries. It does shift `ollama` and `openclaw` four absolute positions later; tests and documentation must state that explicitly rather than claiming no position changes. `cats-platform` mirrors only providers whose adapters have crossed the execution evidence gate, which now includes Grok.

### Why Aider gets a different auth model rather than being forced into the existing one

Every current provider either stores a credential from an interactive login or reads a single vendor key. Aider is BYO-model and has no single login flow, but the selected credential may come from process environment, `.env`, `.aider.conf.yml`, command-line input, or no key at all for a local model. Rendering an interactive "sign in to Aider" step would be a lie, while equating any ambient key with readiness would be another lie. The runtime therefore records only non-secret credential evidence until an Aider-specific probe can validate the effective configuration.

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

- All four providers appear in runtime setup. Grok and Cline run through their fixture-backed best-known adapters, Devin runs through its verified ACP agent profile, and Aider remains absent from product execution selectors with an actionable refusal.
- Sixteen exhaustive maps across two repos each grow by four entries; the diff is wide even though it is shallow.
- Devin may be reclassified later, which would mean removing a provider id that briefly existed. Accepted per the rationale above.
- Registering `cline` in the npm pack means the platform npm installer inherits whatever install-script handling upstream needed (`npm 12+` blocks package install scripts by default and `Install-NodeCLITools.ps1` passes `--allow-scripts`); the platform side must mirror that or Cline may install without a working shim.

### Neutral

- Runtime model catalogs stay empty until enumerated by live evidence. Grok now exposes the sole observed id `grok-4.5`; Devin, Cline, and Aider retain empty catalogs and default sentinels outside the platform execution catalog.
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

- Each CLI's execution adapter arrives as its own small slice, gated on a research note under `docs/research/`, rather than as one four-provider batch. Grok is the first completed example; they share no stream contract.
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
- [xAI enterprise authentication and `XAI_API_KEY`](https://docs.x.ai/build/enterprise)
- [Aider API key and configuration sources](https://aider.chat/docs/config/api-keys.html)
- [Cline CLI installation and supported platforms](https://docs.cline.bot/getting-started/installing-cline)
- [npm install and global `--allow-scripts`](https://docs.npmjs.com/cli/install/)
- environment-bootstrap commits `cb5efc7` (Grok), `d131535` (Cline), `216ef96` (Devin), `54992d6` (Aider), `05be416` (Quick-mode trim), `bef3411` (`--full` shell checkers), `0d1831d` (honest install/check exit codes), `cfe7785` + `75bd6ca` (Pi npm package rename)
- cats-platform ADR-109 (packaged setup side of the same adoption)

---

*Proposal prepared: 2026-08-07*
*Decision status: Grok subset approved 2026-08-08; remaining providers pending User approval*
