# SPEC-027: Grok, Devin, Cline, and Aider CLI Provider Onboarding

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | User |
| **Reviewer** | User |

## Summary

`environment-bootstrap` now installs four AI coding CLIs that `cats-runtime` does not recognize: Grok CLI (xAI), Devin CLI (Cognition), Cline, and Aider. This spec defines how each becomes a registered CLI provider family in the runtime — install knowledge, check metadata, config bootstrap, diagnostics, dashboard/playground/setup surfaces — while their session-execution contracts stay unimplemented until probed.

It is the runtime counterpart to `cats-platform` SPEC-112, which owns packaged installer helpers, the shared product provider catalog, and desktop host wiring. ADR-033 captures the underlying decision.

## Goals

- Register `grok`, `devin`, `cline`, and `aider` in `KNOWN_PROVIDERS`, `PROVIDER_ORDER`, and every exhaustive `Record<ProviderName, …>` the compiler surfaces.
- Give each an accurate `ProviderInstallKnowledge` entry derived from the upstream installer scripts: binary name, install method, install command, expected paths, PATH hints, prerequisites, and auth model.
- Model Aider's BYO-key auth as non-interactive env-var readiness rather than a login flow.
- Model Devin's stripped `devin setup` step as an explicit post-install manual action, so presence never implies readiness.
- Probe only the `grok` binary, never its `agent` alias.
- Ship refusal-stub execution adapters that name the missing evidence, following `AntigravityProvider`.
- Extend `config/providers.yaml.example` and the generated-config bootstrap so each family gets a `cli/native` instance.
- Surface all four in the dashboard, playground, and provider-setup with distinct badge tokens and no fabricated model ids.
- Correct the Pi npm package name to `@earendil-works/pi-coding-agent`, matching upstream `cfe7785`.

## Non-Goals

- Implementing session execution, stream parsing, session discovery, or history import for any of the four. Those are per-CLI follow-up slices gated on research notes.
- Adding compatibility profiles in `src/core/compatibility/knowledge.ts`. Presence-only evidence is the intended state.
- Adding bundled model ids to `curatedModelCatalog` / `providerAdvancedKnowledge`. Only `<provider>-default` sentinels are exposed.
- Adding ACP profiles for any of the four.
- Deciding Devin's final classification (CLI session provider vs. ADR-023 management adapter). This spec registers it as a CLI family and records the reversal condition.
- Adopting upstream's Quick/Full mode split as a runtime concept.
- Packaged installer helpers, desktop host wiring, and the shared product catalog — owned by `cats-platform` SPEC-112.

## User Stories

- As a developer who ran `full-install.ps1`, I want the runtime dashboard to show Grok, Devin, Cline, and Aider as detected so my setup report reflects what is actually on my machine.
- As a Cats Desktop user, I want to install Grok from provider setup without leaving the app, the same way I install Claude or Cursor.
- As an Aider user, I want provider setup to tell me which API keys my environment is missing rather than offering a sign-in button that does not exist.
- As a Devin user, I want provider setup to tell me I still need to run `devin setup`, because the installer intentionally skipped it.
- As a runtime maintainer, I want a session attempt against an unprobed provider to fail with a message that says what evidence is missing, not with a spawn error.
- As a Pi user, I want `pi` upgrades to actually upgrade, instead of silently no-oping against an abandoned package name.

## Problem Statement

The runtime's provider knowledge is the single source of truth for "which CLIs exist". Four CLIs now exist on every machine provisioned by the upstream suite, and the runtime does not model any of them. The consequences are concrete:

- `GET /setup-state` scans only the twelve known families, so a machine with Grok installed reports the same inventory as one without.
- `desktop/host/cliInventoryProbe.ts` maps desktop provider ids onto runtime ids; a desktop entry with no runtime counterpart can never report `installed: true`.
- `providers.yaml` bootstrap (ADR-021) generates instances from `KNOWN_PROVIDERS`, so no config block can exist for the four.
- Provider setup has no install affordance, so packaged Cats Desktop cannot offer these CLIs at all.

Separately, `provider-install/knowledge.ts` installs Pi from `@mariozechner/pi-coding-agent`. Upstream moved to `@earendil-works/pi-coding-agent` and documented why the old name is invisible to version checks: npm resolves a renamed package to its final published version and reports it as current forever, so `npm outdated -g` never flags it and every upgrade path skips it.

## Requirements

### Functional Requirements

#### Taxonomy

1. `KNOWN_PROVIDERS` in `src/backends/cli/providers/types.ts` shall gain `grok`, `devin`, `cline`, `aider`, appended after `kiro`.
2. `PROVIDER_ORDER` in `src/core/providerCatalog.ts` shall place the four after `kiro` and before `ollama`. No existing provider changes position.
3. Every exhaustive `Record<ProviderName, …>` shall gain the four entries. The compiler enumerates these; the known set at time of writing is `src/core/provider-install/knowledge.ts`, `src/core/providerEventCapabilities.ts`, `src/backends/cli/config.ts` (command config, runtime-mode defaults, instance maps, clone helpers), and `src/core/compatibility/providerEvolutionEntry.ts`.

#### Install knowledge

4. `grok` shall register via `createNativeInstall(...)`:
   - `familyLabel` "Grok CLI", `installPack` `native-cli`, `binaryName` `grok`, `defaultDocsUrl` `https://x.ai/cli`.
   - Windows command `irm https://x.ai/cli/install.ps1 | iex`; Unix command `curl -fsSL https://x.ai/cli/install.sh | bash`.
   - Expected paths: `~/.grok/bin/grok.exe` (Windows), `~/.grok/bin/grok` (macOS, Linux).
   - PATH hints shall target `~/.grok/bin`, not `~/.local/bin`.
   - Auth: interactive, hint naming `grok login`, `envVars: ['GROK_DEPLOYMENT_KEY']`, credential file noted as `~/.grok/auth.json`.
   - Notes shall record that the installer also creates an `agent` alias which the runtime intentionally ignores.
5. `devin` shall register via `createNativeInstall(...)`:
   - `familyLabel` "Devin CLI", `installPack` `native-cli`, `binaryName` `devin`, `defaultDocsUrl` `https://devin.ai/cli`.
   - Windows command `irm https://static.devin.ai/cli/setup.ps1 | iex`; Unix command `curl -fsSL https://cli.devin.ai/install.sh | bash`.
   - Expected paths: `%LOCALAPPDATA%\devin\cli\bin\devin.exe` (Windows), `~/.local/bin/devin` (macOS, Linux).
   - Windows notes shall record that the official installer is PowerShell-only (Git Bash and CMD fail), while the installed binary works from any shell.
   - Auth: interactive, hint naming `devin setup`, `envVars: []`.
   - Notes shall record that both official installers end by invoking `devin setup` and that packaged installers strip that call, so `devin setup` is a required manual step after every install.
6. `aider` shall register via `createNativeInstall(...)`:
   - `familyLabel` "Aider", `installPack` `native-cli`, `binaryName` `aider`, `defaultDocsUrl` `https://aider.chat/docs/llms.html`.
   - Windows command `irm https://aider.chat/install.ps1 | iex`; Unix command `curl -LsSf https://aider.chat/install.sh | sh`.
   - Expected paths: `~/.local/bin/aider.exe` (Windows), `~/.local/bin/aider` (macOS, Linux), reusing `createLocalBinPathHints('aider')`.
   - Auth: **`interactive: false`**, `requiredAfterInstall: true`, `envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']`, hint stating that Aider has no login and reads whichever model key the environment provides.
   - Notes shall record that the official installer bundles its own `uv` into `~/.local/bin` and then runs `uv tool install --force --python python3.12 --with pip aider-chat@latest`, so a separately installed newer `uv` may be shadowed depending on PATH order.
7. `cline` shall register via `createGenericNpmKnowledge('cline', 'Cline CLI', 'cline', …)` with `binaryName` `cline`.
8. `createGenericNpmKnowledge` currently derives `binaryName` through a hardcoded `provider === 'opencode'` check. It shall be refactored to take an explicit binary name so provider id and binary name are decoupled.
9. The Pi entry shall install `@earendil-works/pi-coding-agent`.

#### Execution refusal

10. Four provider classes shall be added under `src/backends/cli/providers/`, each implementing `Provider` with `ephemeral = true` and `capabilities: { resume: false, fork: false, permissions: false }`.
11. `buildSpawnArgs` shall throw a message naming the provider, stating that its subprocess/stream contract has not been probed, and directing the user to install it through setup and add a verified compatibility profile first.
12. `parseStreamLine` shall return a `raw` event for non-empty lines and `null` otherwise.
13. `WorkerPool.createProvider` shall construct them by name, and its unknown-provider error string shall list all sixteen families.

#### Capability and evolution metadata

14. `src/core/providerEventCapabilities.ts` shall gain conservative entries for the four, declaring no capability that has not been observed.
15. `src/core/compatibility/providerEvolutionEntry.ts` shall register the four so evidence capture has a home, without asserting a stream profile.
16. `src/core/compatibility/knowledge.ts` shall gain **no** profiles for the four.

#### Config

17. `src/backends/cli/config.ts` shall add `grokPath`, `devinPath`, `clinePath`, `aiderPath`, defaulting to the bare binary names and overridable via `GROK_PATH`, `DEVIN_PATH`, `CLINE_PATH`, `AIDER_PATH`.
18. Default runtime mode for all four shall be `native`.
19. `config/providers.yaml.example` shall gain routing defaults and `backends.cli.providers.<id>.instances.native` blocks with `command:` set to `grok`, `devin`, `cline`, `aider` respectively.

#### Surfaces

20. `src/http/ui/shared.ts` and `src/http/ui/tailwind.runtime.css` shall define badge tokens for the four. Proposed values, chosen to stay inside the existing brightness band while remaining mutually distinguishable and distinct from the twelve in use: `--grok #e5e7eb` (xAI monochrome), `--devin #38bdf8` (sky-400), `--cline #34d399` (emerald-400), `--aider #f97316` (orange-500). Final values are an open question below.
21. `src/http/ui/pages/index.html` shall list the four in its provider dropdown and `PROVIDER_ORDER`.
22. `src/http/ui/pages/playground.html` shall list the four in `PROVIDERS` and expose only `grok-default`, `devin-default`, `cline-default`, `aider-default` sentinels.
23. `src/http/ui/generated/runtimeTailwind.ts` and `public/*.html` shall be regenerated, not hand-edited.
24. Provider-setup shall render Aider's env-key readiness without a sign-in affordance, and Devin's `devin setup` as a manual step.

#### Documentation

25. `docs/setup-guide.md` shall document install commands, binary locations, and auth for all four.
26. A research note under `docs/research/` shall record the probe results and remaining gaps.

### Non-Functional Requirements

- No network calls are added to any check path. Detection stays PATH lookup plus expected-path fallback.
- Refusal messages must be actionable: name the provider, the missing evidence, and the next step.
- Provider-setup and dashboard render time must not regress measurably with sixteen families.

## Acceptance Criteria

- [ ] `KNOWN_PROVIDERS` contains sixteen families and `npm run typecheck` passes with every exhaustive map filled.
- [ ] `buildProviderInstallCatalogView` returns correct install/check/auth/path metadata for all four on windows, macos, and linux execution platforms.
- [ ] With `grok` on PATH, `GET /setup-state` reports `grok` available; with only an unrelated `agent` binary on PATH, it does not.
- [ ] Aider's catalog view reports `auth.interactive === false` and a non-empty `envVars` list.
- [ ] Devin's catalog view carries the `devin setup` manual step.
- [ ] Starting a session against any of the four yields the refusal message, not a spawn error.
- [ ] Bootstrapping a fresh `providers.yaml` produces `cli/native` instances for all four.
- [ ] Dashboard and playground render all four with distinct badges and no fabricated model ids.
- [ ] Pi's install knowledge names `@earendil-works/pi-coding-agent`.
- [ ] `npm test` passes.

## Technical Design

### Provider knowledge shape

All four reuse the existing `ProviderInstallKnowledge` contract from ADR-013. Three additions are needed:

- `createGenericNpmKnowledge` gains an explicit `binaryName` parameter, replacing the `provider === 'opencode'` special case.
- `createLocalBinPathHints` is reused for Aider; Grok needs a new hint builder for `~/.grok/bin` and Devin needs a Windows-specific hint for `%LOCALAPPDATA%\devin\cli\bin` (the same shape Kiro already uses for `%LOCALAPPDATA%\Kiro-Cli`).
- The `auth` block's existing `interactive?: boolean` is already sufficient for Aider; what changes is that provider-setup must actually branch on it.

### Refusal adapters

`AntigravityProvider` is the template. Each new class is roughly twenty lines and carries a message specific to its own missing evidence — for example, Aider's names its lack of a documented machine-readable output mode, while Devin's names the unresolved local-execution-vs-remote-orchestration question.

### Detection contract per CLI

- **Grok** — `grok` on PATH, else `~/.grok/bin/grok{,.exe}`. The `agent` alias is out of scope by decision.
- **Devin** — `devin` on PATH, else `%LOCALAPPDATA%\devin\cli\bin\devin.exe` on Windows, `~/.local/bin/devin` elsewhere. Versions live under `$XDG_DATA_HOME/devin/cli/_versions` on Unix; the runtime checks the stable shim, not the version tree.
- **Cline** — npm global resolution, same as Codex/Copilot/Kilo.
- **Aider** — `aider` on PATH, else `~/.local/bin/aider{,.exe}`.

All four support `--version` and `--help` per the upstream check scripts, which is the only execution the runtime performs at this tier.

## Dependencies

- `cats-platform` SPEC-112 for packaged installer helpers, shared product catalog, and desktop host wiring. Runtime taxonomy must land first, because the desktop inventory probe maps onto runtime ids.
- `environment-bootstrap` remains the upstream source of truth for install commands and paths.

## Risks

- **An upstream installer changes its URL or install directory.** Mitigation: the knowledge entries cite the upstream script that sourced them, so reconciliation is a diff rather than a re-investigation.
- **Devin turns out to be a control-plane tool.** Mitigation: recorded reversal condition in ADR-033; the install tier remains valid either way.
- **Badge tokens collide visually with existing providers.** Mitigation: the open question below asks for confirmation before the tokens are frozen into generated Tailwind.
- **Adding four families widens provider-order assertions across both repos.** Mitigation: append-only ordering keeps existing indices stable.
- **Aider may have no automatable output at all.** Mitigation: the refusal stub is the correct terminal state if so; the install tier still delivers value.

## Open Questions

- [ ] Are the proposed badge token values acceptable, or should the palette be picked alongside the platform provider catalog?
- [ ] Should `GROK_DEPLOYMENT_KEY` appear in `.env.example`, or stay out because it is an enterprise-only path?
- [ ] Does Devin CLI execute locally or orchestrate remote sessions? Resolves its ADR-023 classification.
- [ ] Does any of the four expose a machine-readable output mode (`--output-format`, `--json`, `--print`)? Determines which gets an execution adapter first.
- [ ] Does Cline's CLI require the `--allow-scripts` handling upstream applies for `npm 12+`?
- [ ] Should the runtime model Aider's per-key readiness granularly (which key is present) or as a single "at least one key present" boolean?

## Related

- [ADR-033: Adopt Grok, Devin, Cline, and Aider as CLI provider families](../decisions/033-adopt-grok-devin-cline-aider-as-cli-provider-families.md)
- [PLAN-034: Grok, Devin, Cline, and Aider CLI Provider Onboarding](../plans/PLAN-034-grok-devin-cline-aider-cli-provider-onboarding.md)
- [SPEC-026: Antigravity CLI Provider Replacing Gemini CLI](./SPEC-026-antigravity-cli-provider-replacing-gemini.md)
- [SPEC-017: Standalone provider bootstrap and generated config](./SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [SPEC-021: Provider evolution evidence and capability probes](./SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- cats-platform SPEC-112

---

*Created: 2026-08-07*
*Author: User, with Claude support*
