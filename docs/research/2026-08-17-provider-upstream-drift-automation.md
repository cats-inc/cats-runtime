# Provider Upstream Drift Automation

Date: 2026-08-17
Topic: Automating how `cats-runtime` follows version updates across its 16 supported CLI providers
Source: Internal architecture research over `src/core/compatibility/**`, `src/core/models/**`, `src/core/provider-install/**`, `src/backends/cli/providers/**`, `config/*.yaml.example`, and the repo's existing CI workflows
Summary: The runtime can already fingerprint an installed CLI (`--version`, `--help`, live probe), collect evolution evidence, and compare against a retained baseline. What it cannot do is learn that an upstream CLI released a new version, because nothing in any of the three repos reads a release feed. Every drift signal today requires the CLI to already be installed on a machine and a human to remember to probe it, and every fix requires editing hand-written TypeScript and cutting a runtime release. This note proposes a four-tier "provider knowledge supply chain" that automates the cheap deterministic tiers in CI, keeps quota-consuming live probes manual per ADR-025, and treats desktop agent features (ChatGPT Work / Claude Cowork) as an optional human-context collector rather than as the scheduler or the gate.
Relevance: The runtime supports 16 independently versioned CLI providers whose release cadence is roughly weekly. Without an upstream signal the runtime is structurally guaranteed to lag, and the lag is currently invisible to both maintainers and users.
Action Items:
- Record the automation boundary (light tier automated, live tier manual) in an ADR
- Add release-feed coordinates for every provider and a scheduled watcher that reports version drift
- Make catalog staleness visible in `setup`/`diagnostics` instead of silently serving stale truth
- Audit which providers can be installed in a CI container before committing to help-surface baselines

## Problem

`cats-runtime` integrates 16 CLI provider families (`src/backends/cli/providers/types.ts:24`):

`claude`, `codex`, `antigravity`, `cursor`, `copilot`, `opencode`, `kilo`, `goose`, `pi`,
`auggie`, `junie`, `kiro`, `grok`, `cline`, `devin`, `aider`

Each ships on its own schedule and can change:

- its model list, model labels, and per-model option sets (effort/reasoning levels)
- its CLI flags, subcommands, and output-format contracts
- its stream event types and payload shapes
- its install command, binary location, and auth flow

The runtime encodes assumptions about all four. Those assumptions are correct on the day they
are written and decay silently afterwards.

## Current State: Where Version-Sensitive Knowledge Lives

Five separate locations, four of them hand-written TypeScript:

- `src/core/compatibility/knowledge.ts` — per-provider argv profiles
  (`--output-format stream-json`, `--include-partial-messages`, …), `helpTokens`,
  `supportedVersions`, `minVersionMajor`, live-probe args
- `src/core/provider-install/knowledge.ts` — install commands, `check.npmPackage`, binary
  path hints per platform, auth error patterns
- `src/core/models/curatedModelCatalog.ts` + `config/curated-model-catalogs.yaml.example` —
  curated model / option catalog, YAML, human-writable
- `src/core/models/providerAdvancedKnowledge.ts` (1490 lines) — verified advanced manifests,
  controls, presets, entry defaults
- `src/backends/cli/providers/*.ts` — the 16 adapters themselves: argv assembly and stream
  parsing

What already exists on the detection side is genuinely substantial and should not be rebuilt:

- `ProviderCompatibilityService` performs `version` / `help` / `live` probes and produces a
  `CompatibilityFingerprint` with a normalized semver `CompatibilityVersionFingerprint`, and
  classifies results including `unsupported_version`
- `src/core/compatibility/providerEvolution.ts` owns a transport-neutral evidence collector
- `src/core/compatibility/providerEvolutionProbe.ts` captures a capability snapshot per run and
  compares it against a prior baseline artifact (added/removed event types, schema changes,
  frequency drops)
- `src/core/compatibility/retainedArtifacts.ts` handles artifact retention and pruning
- `cats-runtime --probe-provider-evolution` is a working manual entrypoint
  (`src/startup.ts:262`)
- `GET /diagnostics/providers/evidence` and `/diagnostics/providers/evidence/:id` expose
  retained evidence, and the same reads are mirrored as MCP tools

The gap is not observation capability. The gap is that **every signal is anchored to local
observation of an already-installed CLI**.

## Evidence of the Gap

- `config/curated-model-catalogs.yaml.example` declares `cli: Claude`, `version: 2.1.112`,
  `last_updated: 2026-04-17`, and describes the top entry as "Opus 4.7 with 1M context". As of
  this note that data is four months old and names a superseded model generation. Nothing in
  the runtime reports that it is stale.
- `grep -rn "registry.npmjs|api.github.com|releases/latest|npm view"` across `cats-runtime`,
  `cats-platform`, and `cats-one` returns exactly one hit, and it is a comment. No code reads
  any release feed.
- `cats-runtime/.github/workflows/` contains only `npm-publish.yml` and
  `release-preflight.yml`. There is no scheduled job of any kind.
- `providerEvolutionProbe` baselines are written under the runtime artifact root, not into the
  repo, so drift cannot show up as a reviewable diff in a pull request.

## Three Structural Gaps

- **No remote tier.** Detection requires the CLI to be installed and a human to run a probe.
  Most of these CLIs self-update, so the practical detection event is "a user's machine
  upgraded and something broke".
- **Knowledge is compiled into TypeScript.** Correcting one model id requires a runtime
  release. Against 16 providers on roughly weekly cadence, release-coupled knowledge can never
  keep up.
- **No committed golden baseline.** Because baselines live in local artifacts, there is no
  mechanism that turns "upstream changed its `--help`" into a red CI check.

## Five Drift Classes

One mechanism cannot cover these; they differ in signal source, cost, and automatability.

### 1. Release drift — a new upstream version exists

- Signal: npm dist-tags, GitHub releases/tags, PyPI, native installer version endpoints
- Cost: near zero; no install, no auth, no quota
- Automatable: fully

Feed coordinates are already partly in-repo. Seven providers carry `check.npmPackage` today via
`createGenericNpmKnowledge`:

- `codex` → `@openai/codex`
- `copilot` → `@github/copilot`
- `opencode` → `opencode-ai`
- `kilo` → `@kilocode/cli`
- `auggie` → `@augmentcode/auggie`
- `pi` → `@earendil-works/pi-coding-agent`
- `cline` → `cline`

The other nine (`claude`, `cursor`, `goose`, `junie`, `kiro`, `antigravity`, `grok`, `aider`,
`devin`) use native installers or other channels and currently declare only a `defaultDocsUrl`.
They need an explicit feed coordinate added — for example `aider` resolves to `aider-chat` on
PyPI via the uv installer, and `claude` installs from `claude.ai/install.sh` with no version
feed declared at all.

### 2. Surface drift — flags and subcommands renamed or removed

- Signal: `--help` text diff against a committed golden file
- Cost: requires the CLI installed, but no auth and no quota; deterministic
- Automatable: fully, for providers installable in a container

This is the sweet spot. `helpTokens` in `compatibility/knowledge.ts` already declares exactly
which flags the runtime depends on per provider, so "a flag we pass disappeared from `--help`"
is a mechanical check with a precise failure condition.

### 3. Wire drift — stream event types and payload shapes

- Signal: a real run through `providerEvolutionProbe`
- Cost: requires auth and consumes provider quota; non-deterministic
- Automatable: no — keep manual/opt-in

This is the class ADR-025 deliberately kept manual, and that judgment still holds.

### 4. Model catalog drift — model list, labels, option sets

- Signal: frequently only an interactive TUI picker. `curated-model-catalogs.yaml.example`
  states its own provenance as "Source: claude /model picker and /effort output"
- Cost: needs an interactive session a CI runner cannot drive
- Automatable: partially — some providers expose `models` subcommands (OpenCode already has a
  runtime-owned `opencode models` seam); the rest need a human or a desktop agent

This is simultaneously the fastest-moving class and the most user-visible one, and it is the
only class where CI genuinely cannot reach the source.

### 5. Install/auth drift — install command, binary path, login flow

- Signal: upstream README/docs changes
- Cost: low frequency, but breaks onboarding hard when it happens
- Automatable: partially — doc-diff detection is feasible, interpretation is not

## Proposed Shape: A Provider Knowledge Supply Chain

Six layers with distinct owners and cadences. L1 and L2 are what the repo is missing.

### L0 — Registry: one declarative, machine-diffable file per provider

Move the version-sensitive facts out of hand-written TypeScript into
`providers/<name>/manifest.yaml`, holding:

- release-feed coordinates (npm package, GitHub repo, PyPI project, installer version URL)
- install commands and path hints
- argv profiles and `helpTokens`
- the model / option catalog
- provenance: `observedVersion`, `verifiedAt`, `verifiedBy`, `evidenceRefs`

Rationale: automation cannot safely edit a 1490-line TypeScript module, but it can safely
replace a YAML block, and CI can schema-validate the result. There is precedent —
`curatedModelCatalog.ts` is already a YAML loader with a `schema_version` gate, and
`ProviderAdvancedCatalogSupport.provenance` already carries `manifestId` / `manifestVersion` /
`evidenceRefs`. The TypeScript becomes a typed loader over the registry rather than the
registry itself.

This is a refactor, so it should land *after* baselines exist to protect it, not before.

### L1 — Watcher: cheap remote scheduled check

A daily GitHub Actions cron that, per provider:

- resolves the latest version from the declared feed
- compares it against the recorded `observedVersion`
- fetches the changelog delta between the two versions when the upstream publishes one
- emits a `provider-watch-report.json` and opens or updates one issue per drifting provider,
  risk-tagged by keyword scan (`breaking`, `--`, `output-format`, `model`, `deprecat`,
  `rename`)

No CLI installs, no credentials, no user machines. This single job converts "silently four
months behind" into "a daily report".

### L2 — Contract probe: containerized light probes with committed baselines

A CI matrix that installs the pinned and latest versions in a container and runs light probes
only (`--version`, `--help`, `<subcommand> --help`, `models --help`), writing raw stdout to
`providers/<name>/baselines/<version>/`. CI diffs against the committed baseline:

- a flag the runtime passes disappeared from `--help` → hard failure
- new flags appeared → informational
- model listing changed → catalog patch candidate

Coverage will be partial. Some of the 16 cannot be installed unattended in a container (paid
accounts, IDE-coupled distributions, interactive installers). The exact set is an open input
that needs a per-provider audit; it must not be assumed.

### L3 — Wire probe: existing evolution probe, unchanged policy

Keep `providerEvolutionProbe` manual-first. Add only two capabilities:

- emit baselines in a committable form so wire-level drift can also become a reviewable diff
- allow a self-hosted runner holding real credentials to run the top few providers on a
  schedule, as an explicit opt-in rather than a default

### L4 — Triage: agent-generated candidate PRs, never direct commits

A job that consumes the L1/L2 report and produces a pull request:

- model catalog drift → update the manifest's model block, bump `observedVersion` / `verifiedAt`
- flag drift → propose the argv profile change plus the adapter fixture update
- anything touching parser code → open an issue with the evidence bundle and stop

Gate: schema validation, `npm run typecheck`, and the provider's fixture tests must pass, and a
human must merge. This removes the toil while preserving ADR-025's rule that the runtime does
not automatically rewrite parser logic or promote upstream event types without review.

### L5 — Delivery: knowledge pack outside the release cycle

Publish the registry as a separately versioned artifact that the runtime can refresh into
`~/.cats/runtime/config/`, with the bundled copy as fallback. The path already exists —
`resolveRuntimeCuratedModelCatalogPath` reads the runtime config tree and
`resolveBundledRuntimeConfigExamplePath` provides the fallback — so what is missing is a
downloader with a `schema_version` compatibility check, integrity verification, and rollback.
This is what lets a bad model id be corrected in hours instead of at the next release.

## The Automation Boundary

The codebase already draws the right line and it should be reused rather than reinvented:
`CompatibilityProbeMode = 'light' | 'live'` and
`CompatibilityProbeKind = 'version' | 'help' | 'live'` in `src/core/compatibility/types.ts`.

- **light** — no auth, no quota, deterministic → safe to automate in CI
- **live** — auth, quota, non-deterministic → stays manual/opt-in

Framing the automation this way means ADR-025 does not need to be reversed. It needs to be
narrowed: the manual-first rule was written about the wire tier, and it should be stated
explicitly that it was never about the release and surface tiers.

## Where Desktop Agent Features Fit

ChatGPT Desktop "Work" and Claude Desktop "Cowork" were considered as the automation host.
Assessment:

- **Good fit — changelog and doc reading.** A weekly task that reads 16 upstream changelogs and
  vendor model docs and diffs them against the registry. This is ordinary
  browse-and-summarize work, needs no repo credentials, and covers drift class 5 where
  interpretation matters more than determinism.
- **Good fit — the interactive picker problem.** Drift class 4 is the one CI structurally
  cannot reach, because the model list and effort options live inside a TUI picker. An agent
  with desktop/terminal access can drive the picker and transcribe it. This is the strongest
  argument for using these features at all.
- **Poor fit — scheduler or gate.** Non-deterministic, no repo-visible audit trail, no CI
  guarantee, and dependent on a consumer app's session staying signed in. Invariants must not
  live there.

Rule: **CI owns detection and gating; desktop agent features are an optional human-context
collector, and everything they observe is written back through a PR into the same
`providers/<name>/manifest.yaml`.** One source of truth regardless of who observed it.

Separately worth naming: for maintainer-side scheduling, a Claude Code scheduled cloud routine
against this repo fits better than either desktop feature, because it can open PRs and run
tests and is already in the project's toolchain. `src/core/wakeup/cron.ts` is *not* the right
host — that is product-facing session wakeup substrate, not maintenance CI.

## Runtime-Side Degradation Is Still Required

Repo automation shortens the window between an upstream release and runtime support. It cannot
eliminate it, and users will hit the window.

ADR-029 rule 2 already says unverified targets must degrade to conservative entry-only catalogs
instead of publishing guessed metadata. Today nothing feeds that rule a notion of "verified for
which version". With L1's `observedVersion` recorded per provider, the runtime can:

- compare the locally fingerprinted version against the verified version in the manifest
- degrade advanced metadata to entry-only when they do not match
- surface the delta as a warning on `setup` and `diagnostics`, alongside the existing
  `ProviderAdvancedCatalogSupport.provenance`

`CuratedModelCatalogEntry` already parses `version` and `lastUpdated` from the YAML
(`curatedModelCatalog.ts`), so the data needed for a staleness warning is loaded and simply
never compared against anything. That makes the visible-staleness slice unusually cheap.

## Recommended Sequencing

Ordered by value over cost:

1. **L1 watcher.** Feed coordinates for 16 providers, one script, one scheduled workflow. Purely
   additive, touches no runtime contract.
2. **Staleness visibility.** Wire the recorded upstream version and the already-parsed
   `version`/`lastUpdated` into `setup`/`diagnostics` provenance and warnings, and honor
   ADR-029 rule 2 against it.
3. **L2 help baselines and CI diff**, for the subset that installs unattended in a container.
4. **L0 registry consolidation** — the refactor, protected by the baselines from step 3.
5. **L4 agent triage into candidate PRs.**
6. **L5 knowledge pack delivery.**

Steps 1 and 2 are specified in PLAN-036. Steps 3–6 need their own SPEC before implementation.

## Risks

- **Automated catalog edits could ship a bad model id to users.** Mitigated by three
  independent gates: candidate PR with human merge, fixture tests, and a rollback-capable
  knowledge pack.
- **Installing 16 upstream CLIs in CI is a supply-chain and rate-limit surface.** Mitigated by
  containerized runs, pinned versions, `--help`-only invocation, and never injecting
  credentials into that job.
- **Upstream changelog quality is inconsistent** and several providers publish none. The watcher
  must be useful from the version string alone; changelog text is an enhancement, not a
  precondition.
- **Feed coordinates themselves drift** (a package gets renamed or a repo moves). A feed that
  fails to resolve must report loudly rather than silently reporting "no drift".

## Relationship to Existing Decisions

- ADR-025 keeps provider evolution detection manual-first and evidence-driven. This note does
  not contradict it: the wire tier stays manual, and no parser mutation becomes automatic. It
  narrows the scope to make clear that the release and surface tiers were never covered by that
  rule.
- ADR-029 keeps advanced catalogs verified and manual-refresh. This note supplies the missing
  input that makes its degradation rule enforceable, and does not make ordinary read paths
  probe upstream.
- ADR-013 already extended provider manifests with install and check metadata; the L0 registry
  is the continuation of that direction rather than a new concept.

## Recommended Next Step

Accept ADR-034 to fix the automation boundary, then execute PLAN-036 Phase 1 (release-feed
coordinates plus the scheduled watcher) as the first landing slice.

## Related

- [ADR-013 Extend provider manifests with install and check metadata](../decisions/013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-025 Keep provider evolution detection manual-first and evidence-driven](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR-029 Keep advanced provider catalogs verified and manual-refresh](../decisions/029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md)
- [ADR-034 Automate light-tier provider drift detection and keep live probes manual](../decisions/034-automate-light-tier-provider-drift-detection-and-keep-live-probes-manual.md)
- [PLAN-036 Provider upstream drift watch and staleness surfacing](../plans/PLAN-036-provider-upstream-drift-watch-and-staleness-surfacing.md)
- [2026-03-27 Provider Evolution Evidence Framework](./2026-03-27-provider-evolution-evidence-framework.md)
- [2026-04-07 Advanced Provider Manifest Baseline](./2026-04-07-advanced-provider-manifest-baseline.md)
- [SPEC-021 Provider evolution evidence and capability probes](../specs/SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- [SPEC-023 Verified advanced provider catalogs and manual-refresh discovery](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
