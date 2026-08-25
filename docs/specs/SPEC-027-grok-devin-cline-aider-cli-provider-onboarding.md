# SPEC-027: Grok, Devin, Cline, and Aider CLI Provider Onboarding

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress — Grok 1.0.0 and Cline 3.0.51 execute via CLI; Devin executes via the verified devin-acp agent profile; Aider is install-tier only, execution refused on settled evidence |
| **Owner** | User |
| **Reviewer** | User |

Compatibility policy amendment: [ADR-035](../decisions/035-never-block-provider-execution-on-exact-cli-version.md)
supersedes every exact-version execution gate in this onboarding spec.

Bootstrap routing amendment (2026-08-26): selecting Devin generates only its
verified `agent/acp` execution target. The setup scanner continues to inspect
the CLI binary without exposing the non-executable `cli/native` target.

## Summary

`environment-bootstrap` installs four AI coding CLIs that this spec onboards as runtime provider families: Grok CLI (xAI), Devin CLI (Cognition), Cline, and Aider. It covers install knowledge, check metadata, config bootstrap, diagnostics, dashboard/playground/setup surfaces, and evidence-gated execution. Grok and Cline now have fixture-backed native adapters, Devin executes through the verified `devin-acp` agent profile, and Aider remains install-tier only. Fixture versions are provenance rather than execution allowlists.

It is the runtime counterpart to `cats-platform` SPEC-112, which owns packaged installer helpers, the setup-provider inventory, desktop host wiring, and promotion of each working adapter into the product execution catalog. ADR-033 captures the underlying decision.

## Goals

- Register `grok`, `devin`, `cline`, and `aider` in `KNOWN_PROVIDERS`, `PROVIDER_ORDER`, and every exhaustive `Record<ProviderName, …>` the compiler surfaces.
- Give each an accurate `ProviderInstallKnowledge` entry derived from the upstream installer scripts: binary name, install method, install command, expected paths, PATH hints, prerequisites, and auth model.
- Model Aider's BYO-key auth as non-interactive credential evidence rather than a login flow or an env-var readiness claim.
- Model Devin's stripped `devin setup` step as an explicit post-install manual action, so presence never implies auth readiness and completion is not guessed.
- Probe only the `grok` binary, never its `agent` alias.
- Promote providers to native execution after probing their contracts; fixture versions record provenance, while later versions use the best-known adapter without an exact-version gate.
- Extend `config/providers.yaml.example` and generated bootstrap with executable defaults: Grok and Cline keep their CLI-family config, Devin gets only `agent/acp` and routes there by default, and install-only Aider gets no execution target.
- Surface all four in the dashboard, playground, and provider-setup with distinct badge tokens; expose only the live-enumerated `grok-4.5` id for Grok and no fabricated ids for the remaining providers.
- Correct the Pi npm package name to `@earendil-works/pi-coding-agent`, matching upstream `cfe7785`.

## Non-Goals

- Implementing additional session discovery or history import beyond each provider's separately verified execution contract. Those remain per-CLI follow-up slices gated on research notes.
- Treating fixture-recorded versions as execution allowlists. Compatibility evidence may warn about drift but must not block solely on version inequality.
- Adding unverified bundled model ids. Grok exposes the live-enumerated `grok-4.5`; the remaining providers keep their default sentinels.
- Adding ACP profiles beyond Devin's separately verified profile.
- Deciding Devin's final classification (CLI session provider vs. ADR-023 management adapter). This spec registers it as a CLI family and records the reversal condition.
- Adopting upstream's Quick/Full mode split as a runtime concept.
- Packaged installer helpers and desktop host wiring — owned by `cats-platform` SPEC-112.
- Adding a provider to `cats-platform`'s shared product execution catalog before its runtime adapter works. Grok joins with its adapter; the other three remain excluded.

## User Stories

- As a developer who ran `full-install.ps1`, I want the runtime dashboard to show Grok, Devin, Cline, and Aider as detected so my setup report reflects what is actually on my machine.
- As a Cats Desktop user, I want to install Grok from provider setup without leaving the app, the same way I install Claude or Cursor.
- As an Aider user, I want provider setup to show non-secret credential evidence it can actually observe, without declaring unobserved keys missing or offering a sign-in button that does not exist.
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
2. `PROVIDER_ORDER` in `src/core/providerCatalog.ts` shall append the four to the CLI-family segment after `kiro` and before `ollama`. Existing providers keep their relative order; `ollama` and `openclaw` move four absolute positions later.
3. Every exhaustive `Record<ProviderName, …>` shall gain the four entries. The compiler enumerates these; the known set at time of writing is `src/core/provider-install/knowledge.ts`, `src/core/providerEventCapabilities.ts`, `src/backends/cli/config.ts` (command config, runtime-mode defaults, instance maps, clone helpers), and `src/core/compatibility/providerEvolutionEntry.ts`.

#### Install knowledge

4. `grok` shall register via `createNativeInstall(...)`:
   - `familyLabel` "Grok CLI", `installPack` `native-cli`, `binaryName` `grok`, `defaultDocsUrl` `https://x.ai/cli`.
   - Windows command `irm https://x.ai/cli/install.ps1 | iex`; Unix command `curl -fsSL https://x.ai/cli/install.sh | bash`.
   - Expected paths: `~/.grok/bin/grok.exe` (Windows), `~/.grok/bin/grok` (macOS, Linux).
   - PATH hints shall target `~/.grok/bin`, not `~/.local/bin`.
   - Auth: interactive, hint naming `grok login`, `envVars: ['XAI_API_KEY']`, credential file noted as `~/.grok/auth.json`.
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
   - Auth: **`interactive: true`**, `requiredAfterInstall: true`, `envVars: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']`, hint stating that Aider reads credentials from environment, `.env`, `.aider.conf.yml`, and its own `~/.aider/oauth-keys.env`, so environment variables alone do not prove readiness.
     > **Corrected 2026-08-09 by the 0.86.2 probe.** This originally specified `interactive: false` on the assumption that Aider is purely BYO-key. It is not: running Aider without a credential starts an OpenRouter browser sign-in and persists the result to `~/.aider/oauth-keys.env`. The probe host had no model env var set anywhere yet Aider reached the model from that store. See `docs/research/2026-08-09-aider-cli-probe.md`.
   - Notes shall record that the official installer bundles its own `uv` into `~/.local/bin` and then runs `uv tool install --force --python python3.12 --with pip aider-chat@latest`, so a separately installed newer `uv` may be shadowed depending on PATH order.
7. `cline` shall register via `createGenericNpmKnowledge('cline', 'Cline CLI', 'cline', …)` with `binaryName` `cline`, supported for packaged install on macOS and Linux. Windows install metadata shall remain unsupported until Cline officially supports Windows or a reviewed Windows install-and-execution probe is recorded.
8. `createGenericNpmKnowledge` currently derives `binaryName` through a hardcoded `provider === 'opencode'` check. It shall be refactored to take an explicit binary name and optional supported-platform overrides so provider id, binary name, and install support are decoupled.
9. The Pi entry shall install `@earendil-works/pi-coding-agent`.

#### Execution adapters

10. Four provider families shall be registered. Native execution is enabled only after a machine-readable invocation contract is known; once enabled, version drift alone never reverts the provider to a refusal adapter.
11. Grok 1.0.0 shall execute through `streaming-json`, expose resume, fork, and whitelist permission compilation, parse native text/thought/tool/error/end records, and terminate its subprocess on cancellation even when no terminal record arrives.
12. Grok compatibility shall use `grok-cli-streaming-json-1.0.0` as the fixture-backed baseline and best-known adapter for later or unknown versions. Version inequality alone shall never refuse execution. A non-empty `--tools` list is the only supported permission boundary: default exposes only probed `read_file`, empty explicit whitelists refuse, and `search_replace` requires `read_file`.
13. `WorkerPool.createProvider` shall construct them by name, and its unknown-provider error string shall list all sixteen families.

#### Capability and evolution metadata

14. `src/core/providerEventCapabilities.ts` shall describe Grok's observed native text, reasoning, tool, result, and derived-progress events; entries for the other three remain conservative.
15. `src/core/compatibility/providerEvolutionEntry.ts` shall register the four so evidence capture has a home, without asserting a stream profile.
16. `src/core/compatibility/knowledge.ts` shall keep fixture provenance separate from execution eligibility. Executable providers use feature probes, minimum baselines where applicable, and best-fit profiles rather than exact-version allowlists.

#### Config

17. `src/backends/cli/config.ts` shall add `grokPath`, `devinPath`, `clinePath`, `aiderPath`, defaulting to the bare binary names and overridable via `GROK_PATH`, `DEVIN_PATH`, `CLINE_PATH`, `AIDER_PATH`.
18. Default runtime mode for all four shall be `native`.
19. `config/providers.yaml.example` shall give Grok and Cline `backends.cli.providers.<id>.instances.native` blocks. Devin shall instead have only `backends.agent.providers.devin.instances.acp`, launch the detected `devin` command with `args: ['acp']`, and route to `agent/acp` by default. Aider shall remain setup-visible but have no generated execution target until a machine-readable contract is verified.

#### Surfaces

20. Once Proposed Decision D1 is approved, `src/http/ui/shared.ts` and `src/http/ui/tailwind.runtime.css` shall define badge tokens for the four using its approved values:
    - `--grok: #e5e7eb` (gray-200)
    - `--devin: #38bdf8` (sky-400)
    - `--cline: #e879f9` (fuchsia-400)
    - `--aider: #60a5fa` (blue-400)
21. `src/http/ui/pages/index.html` shall list the four in its provider dropdown and `PROVIDER_ORDER`.
22. `src/http/ui/pages/playground.html` shall list the four in `PROVIDERS`, expose verified `grok-4.5` for Grok, and keep `devin-default`, `cline-default`, and `aider-default` sentinels for the unprobed providers.
23. `src/http/ui/generated/runtimeTailwind.ts` and `public/*.html` shall be regenerated, not hand-edited.
24. Provider-setup shall render Aider credential evidence with auth remaining unverified and no sign-in affordance, and shall render Devin's `devin setup` as a manual step without claiming that it has been completed.
25. Per Proposed Decision D3, Aider auth shall remain `unknown` at this tier. The runtime may report `detectedEnvVars` containing only the names of configured, non-empty variables visible in its injected environment; it shall never return values, declare absent variables missing, infer the selected model, or treat any detected variable as proof of readiness.
26. `ProviderAuthSummary` and the setup-state read model shall gain the additive `detectedEnvVars: string[]` field. `ProviderCompatibilityService` shall accept an injected environment for deterministic tests and shall populate this field without reading or returning secret values.

#### Documentation

27. `docs/setup-guide.md` shall document install commands, binary locations, and auth for all four.
28. A research note under `docs/research/` shall record the probe results and remaining gaps.

### Non-Functional Requirements

- No network calls are added to any check path. Detection stays PATH lookup plus expected-path fallback.
- Refusal messages must be actionable: name the provider, the missing evidence, and the next step.
- Provider-setup and dashboard render time must not regress measurably with sixteen families.

## Acceptance Criteria

- [ ] `KNOWN_PROVIDERS` contains sixteen families and `npm run typecheck` passes with every exhaustive map filled.
- [ ] `buildProviderInstallCatalogView` returns correct install/check/auth/path metadata for all four on windows, macos, and linux execution platforms.
- [ ] With `grok` on PATH, `GET /setup-state` reports `grok` available; with only an unrelated `agent` binary on PATH, it does not.
- [x] Aider's catalog view reports `auth.interactive === true`, its configured evidence keys, and auth status `unknown` rather than `ready` or `missing`.
- [ ] Aider setup summaries report only detected variable names from an injected test environment, never values; an empty detection list is not treated as missing auth.
- [ ] Devin's catalog view carries the `devin setup` manual step.
- [ ] Starting Grok parses the authenticated native stream, tools, errors, cancellation, resume, and fork across fixture and forward-drift versions; Cline follows the same best-known-adapter policy, while providers with no machine-readable execution contract retain their evidence-based refusal.
- [ ] Bootstrapping a fresh `providers.yaml` produces `cli/native` for Grok and Cline, only executable `agent/acp` for Devin, and no execution target for install-only Aider.
- [ ] Dashboard and playground render all four with distinct badges, verified `grok-4.5`, and no fabricated model ids.
- [ ] Pi's install knowledge names `@earendil-works/pi-coding-agent`.
- [ ] `npm test` passes.

## Technical Design

### Provider knowledge shape

All four reuse the existing `ProviderInstallKnowledge` contract from ADR-013. Three additions are needed:

- `createGenericNpmKnowledge` gains an explicit `binaryName` parameter, replacing the `provider === 'opencode'` special case.
- `createLocalBinPathHints` is reused for Aider; Grok needs a new hint builder for `~/.grok/bin` and Devin needs a Windows-specific hint for `%LOCALAPPDATA%\devin\cli\bin` (the same shape Kiro already uses for `%LOCALAPPDATA%\Kiro-Cli`).
- The `auth` block's existing `interactive?: boolean` prevents a false sign-in affordance, but the summary contract also needs additive `detectedEnvVars` evidence plus an injected environment. Evidence and readiness remain separate.

### Evidence-gated adapters

Grok's native parser and spawn contract are tied to the complete Grok 1.0.0
fixture set as provenance. Per ADR-035, it and every other executable provider
continue with the best-known adapter across version drift; only concrete missing
or unsafe capabilities justify a pre-spawn refusal.

### Detection contract per CLI

- **Grok** — `grok` on PATH, else `~/.grok/bin/grok{,.exe}`. The `agent` alias is out of scope by decision.
- **Devin** — `devin` on PATH, else `%LOCALAPPDATA%\devin\cli\bin\devin.exe` on Windows, `~/.local/bin/devin` elsewhere. Versions live under `$XDG_DATA_HOME/devin/cli/_versions` on Unix; the runtime checks the stable shim, not the version tree.
- **Cline** — npm global resolution, same as Codex/Copilot/Kilo.
- **Aider** — `aider` on PATH, else `~/.local/bin/aider{,.exe}`.

All four support `--version` and `--help` per the upstream check scripts, which is the only execution the runtime performs at this tier.

## Dependencies

- `cats-platform` SPEC-112 for packaged installer helpers, setup-provider inventory, and desktop host wiring. Runtime taxonomy must land first, because the desktop inventory probe maps onto runtime ids. The runtime UI no longer blocks on the platform product catalog.
- `environment-bootstrap` remains the upstream source of truth for install commands and paths.

## Risks

- **An upstream installer changes its URL or install directory.** Mitigation: the knowledge entries cite the upstream script that sourced them, so reconciliation is a diff rather than a re-investigation.
- **Devin turns out to be a control-plane tool.** Mitigation: recorded reversal condition in ADR-033; the install tier remains valid either way.
- **Badge tokens collide visually with existing providers.** Mitigation: Proposed Decision D1 supplies candidate values based on an audit of the live palette, which caught an exact collision in the first draft. The residual risk is Grok's lightness-differentiated grey sitting near two existing greys; User review before the tokens are frozen into generated Tailwind is the cheapest place to catch it.
- **Adding four families widens runtime provider-order assertions.** Mitigation: appending to the CLI segment preserves relative order, while tests explicitly account for the four-position shift of `ollama` and `openclaw`.
- **Aider may have no automatable output at all.** Mitigation: the refusal stub is the correct terminal state if so; the install tier still delivers value.
- **Aider credential evidence is mistaken for readiness.** Mitigation: status remains `unknown`, detected names are informational only, and values never leave the process environment.

## Proposed Decisions

> **Proposed by Claude on 2026-08-07.** The User approved the Grok-only implementation slice on 2026-08-08, including the Grok-specific effects of these decisions. The remaining Devin, Cline, and Aider proposals still require User review.

### D1 — Badge palette

**Proposal**: `--grok #e5e7eb` (gray-200), `--devin #38bdf8` (sky-400), `--cline #e879f9` (fuchsia-400), `--aider #60a5fa` (blue-400). These values are owned by the runtime UI. Grok is executable and present in the platform catalog; refusal-only providers remain excluded.

**Why**: The first draft proposed `--cline #34d399`, which is an exact collision with `--codex`. Auditing the live palette in `src/http/ui/shared.ts` showed the existing fourteen tokens already occupy almost the whole Tailwind-400 band: orange, emerald, violet, pink, indigo, purple, rose, lime, stone, cyan, amber, teal, slate, red. Only sky, blue, and fuchsia remain unused, and `#60a5fa` (blue-400) is specifically free because PLAN-033 deliberately vacated it when Antigravity moved off the old Gemini blue to violet.

That leaves three clean hues for four providers, so Grok takes a lightness-differentiated near-white rather than a fourth hue. This is brand-true for xAI's monochrome identity, and it separates from `--pi` (warm grey) and `--ollama` (cool grey) by lightness rather than hue. It is the weakest of the four assignments and the most likely reviewer target.

Devin and Aider hold the adjacent sky/blue pair, which is the other soft spot; they are non-adjacent in provider order with Cline's fuchsia between them, so they do not sit side by side in the dashboard.

Precedent for prioritizing distinguishability over brand fidelity: PLAN-033 Phase 1 moved Antigravity to violet-400 specifically because keeping Google's blue was visually identical to the badge it replaced.

**Follow-on finding**: with eighteen providers, the single-lightness-band palette is at capacity. A nineteenth provider cannot be assigned a clean 400-band hue. The palette needs a second lightness band or a designed token system before the next provider lands — worth its own small follow-up rather than another ad-hoc pick.

### D2 — `XAI_API_KEY` in `.env.example`

**Proposal**: No. It lives only in the provider's `auth.envVars` in `knowledge.ts`, where provider setup can surface it. The same rule excludes `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` from `.env.example` for Aider.

**Why**: `.env.example` labels its credential block "API/local provider credentials" — it documents keys **the runtime itself** consumes for API and local backends, not keys a CLI subprocess reads from the ambient environment. `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are there because Anthropic and OpenAI API backends exist, not because Claude Code and Codex CLIs read them. Grok has no API backend in scope, so adding its key would imply a runtime-consumed credential that does not exist.

Revisit if an xAI API backend ever lands, at which point it belongs in `.env.example` for that reason rather than this one.

### D3 — Aider credential evidence, not readiness

**Proposal**: Do not derive readiness from ambient key presence. Keep Aider auth `unknown` at the install/check tier and report only `detectedEnvVars` as optional, non-secret evidence.

**Why**: Aider can obtain credentials from process environment, `.env`, `.aider.conf.yml`, command-line arguments, and its own `~/.aider/oauth-keys.env`, and it can use local models without an API key. An ambient key is therefore neither necessary nor sufficient for the effective model to work. Reporting detected names is useful evidence; calling that evidence readiness or calling unobserved names missing would be false.

**Confirmed 2026-08-09 by the 0.86.2 probe**, which found a concrete counterexample to the readiness-from-env-vars model this decision rejected: a host with no model API key set in either the shell or the Windows user environment, and no `~/.aider.conf.yml`, still reached the model — Aider read an `OPENROUTER_API_KEY` it had written to `~/.aider/oauth-keys.env` during an undocumented first-run browser sign-in. An env-only readiness check would have called that fully working host not ready. The oauth store is added to the enumerated sources above. See `docs/research/2026-08-09-aider-cli-probe.md`.

### D4 — Which CLI gets an execution adapter first

**Decision**: Grok went first. The completed probe confirmed native machine-readable output and closed its full lifecycle contract.

**Why**: Grok is the only one of the four that upstream promoted into **Quick** mode (`05be416`), which is the owner's own curated core set — the strongest available demand signal. Ordering by demand rather than by implementation convenience means the first adapter is also the first one anyone uses.

### D5 — Cline and `--allow-scripts` under npm 12+

**Proposal**: For npm versions that expose the global-install `allow-scripts` policy, apply the exact upstream allowlist during Cline install. Older npm versions that do not expose the option keep their existing script behavior. P4 records the exact allowlist and feature-detection boundary but does not decide whether the policy applies.

**Why**: npm's global-install form requires an explicit package allowlist, while older npm releases may not recognize the option at all. Mirroring the upstream list when the feature exists avoids silently skipped lifecycle scripts without breaking older hosts. P4 remains a transcription and compatibility check rather than a product decision.

## Probe Items

These are facts to be captured, not decisions to be made. They gate execution adapters only; the install/check tier proceeds without them. See PLAN-034 Phase 1.

- [ ] **P1** — Does Devin CLI execute locally or orchestrate remote sessions? Resolves its ADR-023 classification. Default until answered: registered as a CLI family, install/check tier only, per ADR-033 §8.
- [x] **P2 (Grok)** — Grok 1.0.0 exposes native `streaming-json` plus Messages-compatible streaming output; the native format backs the adapter. Other providers remain open.
- [x] **P3 (Grok)** — Resume and fork were exercised by returned session id; Cats does not scan or import Grok's private session storage. Other providers remain open.
- [ ] **P4** — Capture the exact upstream Cline allowlist and the npm feature-detection boundary. Documentation and compatibility coverage only; Proposed Decision D5 already defines the policy.
- [x] **P5 (Grok)** — Captured `grok 1.0.0 (3cd0d0cbce)`, help, and model-list output. Other providers remain open.

## Related

- [ADR-033: Adopt Grok, Devin, Cline, and Aider as CLI provider families](../decisions/033-adopt-grok-devin-cline-aider-as-cli-provider-families.md)
- [PLAN-034: Grok, Devin, Cline, and Aider CLI Provider Onboarding](../plans/PLAN-034-grok-devin-cline-aider-cli-provider-onboarding.md)
- [SPEC-026: Antigravity CLI Provider Replacing Gemini CLI](./SPEC-026-antigravity-cli-provider-replacing-gemini.md)
- [SPEC-017: Standalone provider bootstrap and generated config](./SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [SPEC-021: Provider evolution evidence and capability probes](./SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- [xAI enterprise authentication and `XAI_API_KEY`](https://docs.x.ai/build/enterprise)
- [Aider API key and configuration sources](https://aider.chat/docs/config/api-keys.html)
- [Cline CLI installation and supported platforms](https://docs.cline.bot/getting-started/installing-cline)
- [npm install and global `--allow-scripts`](https://docs.npmjs.com/cli/install/)
- cats-platform SPEC-112

---

*Created: 2026-08-07*
*Author: Claude draft for User review*
