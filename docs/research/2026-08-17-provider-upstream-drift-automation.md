# Provider Upstream Drift Automation

Date: 2026-08-17
Topic: Automating how `cats-runtime` follows upstream changes across its 16 registered CLI provider families
Source: Internal architecture research over `src/core/compatibility/**`, `src/core/models/**`, `src/core/provider-install/**`, `src/backends/cli/providers/**`, `config/*.yaml.example`, and the repo's existing CI workflows
Summary: The runtime can already fingerprint an installed CLI (`--version`, `--help`, live probe), collect evolution evidence, and compare against a retained baseline. What it cannot do is learn that an upstream CLI released a new version, because nothing in any of the three repos reads a release feed. Every drift signal today requires the CLI to already be installed on a machine and a human to remember to probe it, and every fix requires editing hand-written TypeScript and cutting a runtime release. This note proposes a six-layer "provider knowledge supply chain" that automates the cheap deterministic tiers in CI, keeps quota-consuming live probes manual-first per ADR-025, and uses agent-hosted schedules (ChatGPT Work, Claude Cowork, or Claude Code cloud) as optional collectors, liveness monitors, and candidate-PR authors while deterministic validation and merge gating stay in CI.
Relevance: The runtime tracks 16 independently versioned CLI provider families with different execution and probe coverage. Without an upstream signal the runtime is structurally guaranteed to lag, and the lag is currently invisible to both maintainers and users.
Action Items:
- Record the automation boundary (light tier automated, live tier manual) in an ADR
- Add canonical release sources plus an automation coverage matrix, in compiled TypeScript so the first slice moves no packaging contract, deriving npm coordinates from `check.npmPackage`
- Separate observed candidates from capability-specific accepted evidence and baselines
- Add a scheduled watcher that reports version or upstream-artifact drift without treating observation as verification
- Persist per-source success across runs, publish a scheduler heartbeat, and monitor that heartbeat from an independent scheduler
- Deliver release observation to runtime only through a reviewed, versioned snapshot; CI artifacts and issues are not runtime inputs, and the snapshot's release-bounded freshness must be reported, not hidden
- Make catalog staleness visible in `setup`/`diagnostics` instead of silently serving stale truth, and separately correct the curated catalog entry already known to be wrong
- Audit which provider/platform/channel targets can be installed safely on CI runners before committing to surface baselines

## Problem

`cats-runtime` registers 16 CLI provider families (`src/backends/cli/providers/types.ts:24`):

`claude`, `codex`, `antigravity`, `cursor`, `copilot`, `opencode`, `kilo`, `goose`, `pi`,
`auggie`, `junie`, `kiro`, `grok`, `cline`, `devin`, `aider`

These families do not all have the same support level. Some are install-only, some refuse CLI
execution because no safe machine-readable contract exists, and the provider-evolution entrypoint
does not cover all 16. Automation therefore needs a per-tier coverage matrix rather than a single
boolean meaning "supported".

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
- **No accepted-baseline state.** Because baselines live in local artifacts, there is no
  mechanism that turns "upstream changed its `--help`" into a red CI check, and the latest
  matching wire artifact can become the next comparison baseline without an explicit accepted
  promotion step.

## Five Drift Classes

One mechanism cannot cover these; they differ in signal source, cost, and automatability.

### 1. Release drift — a new upstream release or artifact change exists

- Signal: npm dist-tags, GitHub releases/tags, PyPI, native installer version endpoints, or weak
  HTTP artifact fingerprints (ETag, Last-Modified, SHA-256) when no version endpoint exists
- Cost: near zero; no install, no auth, no quota
- Automatable: fully where a deterministic signal exists; otherwise weak-signal or manual

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
They need explicit source declarations — for example `aider` resolves to `aider-chat` on PyPI via
the uv installer, while a provider with only an installer script may need an artifact fingerprint
until a semantic version endpoint is available. A provider with no deterministic signal must be
reported as `not_automated`, not silently treated as current.

### 2. Surface drift — help surfaces or argv contracts changed

- Signal: canonicalized `--help` output plus Cats argv-contract checks
- Cost: requires the CLI installed, but no auth and no quota; deterministic
- Automatable: fully, for provider/platform/channel targets safely installable on a CI runner

This is the sweet spot, but token presence alone is not the contract. A flag can remain visible
while moving to another subcommand, changing its accepted values, or becoming incompatible with
another flag. `helpTokens` in `compatibility/knowledge.ts` are useful seed assertions; the stable
CI contract is canonicalized help text plus tests of the argv profiles Cats actually emits.

Canonicalization is the right layer, and it is not the same as grammar extraction. Raw `--help`
diffs are genuinely too noisy for CI because ANSI codes, line endings, trailing whitespace, and
terminal width can churn. Remove only that presentation noise deterministically: strip ANSI,
normalize line endings, trim trailing whitespace, and pin `COLUMNS`. Preserve command, option,
accepted-value, and paragraph order, and do not aggressively unwrap or reflow content; ordering can
itself be meaningful evidence. Canonicalization reduces false positives but cannot promise zero
false negatives. Retain raw stdout beside the canonical diff, and make explicit provider-specific
argv contract assertions the hard gate. Extracting a command grammar instead means writing and
maintaining a help parser per CLI across 16 heterogeneous tools, and a bug in that parser can hide
exactly the upstream change the check exists to catch. Derive grammar for readability if it helps a
reviewer; diff the conservative canonical text. Baselines are scoped by platform and distribution
channel.

### 3. Wire drift — stream event types and payload shapes

- Signal: a real run through `providerEvolutionProbe`
- Cost: requires auth and consumes provider quota; non-deterministic
- Automatable: no — keep manual/opt-in

This is the class ADR-025 deliberately kept manual, and that judgment still holds.
Manual-first does not mean "latest artifact wins": failed, unreviewed, and rejected probe
artifacts must remain candidates. Only an explicitly accepted artifact pointer may become the
next wire baseline. A small credentialed self-hosted canary set remains an opt-in extension after
that promotion rule exists.

### 4. Model catalog drift — model list, labels, option sets

- Signal: frequently only an interactive TUI picker. `curated-model-catalogs.yaml.example`
  states its own provenance as "Source: claude /model picker and /effort output"
- Cost: needs an interactive session a CI runner cannot drive
- Automatable: partially — some providers expose `models` subcommands (OpenCode already has a
  runtime-owned `opencode models` seam); the rest need a human or a desktop agent

This is simultaneously the fastest-moving class and the most user-visible one. It is also not
reliably coupled to CLI releases: server-side availability, account entitlements, region, and
rollout cohort can change while the local CLI version stays fixed. Dynamic target-specific model
entries therefore remain separate from repo-owned verified advanced controls. An interactive
picker observation is candidate evidence with scope, not automatically global catalog truth.

### 5. Install/auth drift — install command, binary path, login flow

- Signal: upstream README/docs changes
- Cost: low frequency, but breaks onboarding hard when it happens
- Automatable: partially — doc-diff detection is feasible, interpretation is not

## Proposed Shape: A Provider Knowledge Supply Chain

Six layers with distinct owners and cadences. The repo is missing the canonical L0 automation
slice plus scheduled L1 and accepted L2 contracts.

### L0 — Registry: one declarative, machine-diffable declaration per provider

Start with the release-source and coverage subset, then migrate the remaining version-sensitive
facts behind the same loader. Together the two stages hold:

- support tier and automation coverage for release, install, surface, model, wire, and execution
- release sources as an array, including channel, platform, version scheme, prerelease policy,
  and npm/GitHub/PyPI/installer/HTTP-artifact coordinates
- install commands and path hints
- argv profiles and `helpTokens`
- the model / option catalog
- capability-specific acceptance and provenance: an accepted version range or baseline pointer,
  `verifiedAt`, `verifiedBy`, and `evidenceRefs`; candidate/rejected evidence stays alongside the
  accepted pointer until review promotes or closes it

Rationale: automation cannot safely edit a 1490-line TypeScript module, but it can safely replace
a declaration block, and CI can validate the result. What matters is that the target has no logic
in it — a flat source table is machine-editable whether it is YAML or TypeScript; the 1490-line
module is not, in either format.

**Storage format is a packaging decision here, not a style one.** `npm run build` is
`clean:build` + `build:ui` + `tsc`, and `scripts/build-runtime-artifacts.mjs` copies no assets at
all. `package.json` `files` is an allowlist, and `tests/package-contract.test.ts` asserts it with
`toEqual`. So a runtime-loaded YAML tree needs four things the repo does not have yet: a build copy
step, a `files` entry, a `package-contract` update, and — for a root `providers/` directory — an
`AGENTS.md` Project Structure Convention entry, since neither the Required nor the Optional list
includes one. Compiled TypeScript needs none of them.

Note also which precedent applies. `curatedModelCatalog.ts` is a YAML loader with a
`schema_version` gate, but it reads a *user-overridable* file from the runtime config tree with a
bundled `config/*.yaml.example` fallback — which is exactly why those three examples appear in
`files`. The registry is repo-owned truth, not user config, so it does not inherit that delivery
mechanism.

Therefore: the first slice declares release sources and coverage in TypeScript under
`src/core/provider-registry/`, which ships inside `build/runtime` and moves no packaging contract.
The YAML registry arrives with the knowledge migration, after surface baselines protect the
refactor, and it carries the four packaging items above as part of its own scope.

Either way the watcher must not introduce a second table for the seven existing npm coordinates:
`check.npmPackage` in `provider-install/knowledge.ts` stays the single handwritten home and the
registry derives from it, guarded by a reconciliation test.

`ProviderAdvancedCatalogSupport.provenance` already carries `manifestId` / `manifestVersion` /
`evidenceRefs`, so the provenance vocabulary is partly in place regardless of format.

### L1 — Watcher: cheap remote scheduled check

A daily GitHub Actions cron that, per provider:

- resolves the latest version from the declared feed
- records it as `latestObservedVersion` in the generated report and compares it against the
  capability-specific accepted release reference without mutating that acceptance
- fetches the changelog delta between the two versions when the upstream publishes one
- emits a `provider-watch-report.json` and opens or updates one issue per drifting provider,
  risk-tagged by keyword scan (`breaking`, `--`, `output-format`, `model`, `deprecat`,
  `rename`)
- reports `feed_error` and `not_automated` as explicit non-current coverage states
- reads schema-validated operational state from a pinned GitHub issue, preserves each source's
  `lastSuccessfulObservationAt` across failed runs, and updates only successful timestamps
- publishes `lastRunAt` as a scheduler heartbeat, because a GitHub Actions cron cannot detect that
  it never started
- renders a deterministic observation-snapshot candidate with schema version, source identity,
  observed value, observation time, report/run provenance, and checksum

No CLI installs, no credentials, no user machines. This single job converts "silently four
months behind" into "a daily report". The pinned issue is operational state, not provider truth:
run-scoped workflow artifacts remain the evidence bundle, and invalid issue state fails loudly.
An orphan branch has better write semantics and needs no bootstrap ceremony, but writing a ref
requires `contents: write`, which GitHub cannot scope to a single branch — so the issue is what
keeps the watcher on `contents: read` and structurally unable to edit declarations or accepted
references. That trade is why an explicit init/recovery path is a requirement here rather than a
nicety, and it flips once L4 candidate PRs give the watcher write access anyway.

Monitoring that heartbeat needs a host that is not the watcher's own scheduler. A purpose-built
dead-man's-switch service is the right tool; an agent-hosted schedule is a fallback, since it is
another scheduler with the same failure mode and no monitor above it. There is also a free interim:
an existing event-triggered workflow can warn when the heartbeat is stale. That is not a true
dead-man's switch — it needs repository activity to fire — but it costs nothing and keeps scheduler
liveness from sitting at `unknown` indefinitely.

**The report and issue do not flow directly into runtime reads.** A running installation must never
read workflow artifacts or mutable issue text. Instead an explicit maintainer command validates a
chosen report and renders a deterministic update to a compiled TypeScript snapshot under
`src/core/provider-registry/`. That source diff receives ordinary human review and merge; the
runtime then exposes the bundled snapshot value and age. Reviewing the snapshot confirms that the
observation and provenance were delivered intact — it does not accept release, surface, catalog, or
wire compatibility.

The cost of this bridge is real and should stay visible rather than be discovered later. Snapshot
freshness is bounded by the runtime release cadence, so between releases an installation often has
nothing better to say than "too old to know", and the bridge itself costs an import command,
checksum validation, a snapshot module, and a recurring review step. It is worth it only because it
establishes the reviewed-delivery contract that L5 then upgrades: the knowledge-pack channel is
integrity-checked, rollback-capable, and refreshes without a release. Until then, snapshot age must
be reported as a first-class state, never smoothed into "no drift".

### L2 — Contract probe: isolated light probes with committed baselines

A CI matrix that installs pinned and candidate versions for eligible platform/channel targets and
runs light probes only (`--version`, `--help`, `<subcommand> --help`, `models --help`). It retains
raw stdout as evidence and commits the canonicalized form as the comparison baseline. CI compares
against an explicit accepted baseline:

- an explicit provider-specific argv contract assertion fails for a command Cats emits → hard
  failure
- canonical help text changed in any other way → informational candidate
- model listing changed → catalog patch candidate

Coverage will be partial. Some of the 16 cannot be installed unattended in a container (paid
accounts, IDE-coupled distributions, interactive installers). The exact set is an open input
that needs a per-provider audit; it must not be assumed.

### L3 — Wire probe: existing evolution probe, unchanged policy

Keep `providerEvolutionProbe` manual-first. Add three capabilities:

- emit baselines in a committable form so wire-level drift can also become a reviewable diff
- promote a reviewed artifact explicitly; failed, unreviewed, and rejected artifacts cannot
  replace the accepted pointer
- allow a self-hosted runner holding real credentials to run the top few providers on a
  schedule, as an explicit opt-in rather than a default

### L4 — Triage: agent-generated candidate PRs, never direct commits

A job that consumes the L1/L2 report and produces a pull request:

- model catalog drift → record scoped candidate evidence (`observedCliVersion`, observation time,
  target/account/region scope where known) and propose a model-block change without moving the
  accepted catalog pointer
- flag drift → propose the argv profile change plus the adapter fixture update as a surface
  candidate, without moving the accepted surface baseline
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

## Where Agent-Hosted Scheduled Work Fits

ChatGPT Work, Claude Cowork, and Claude Code cloud were considered as automation hosts. Their
execution modes must not be conflated. ChatGPT desktop scheduled tasks can use a local project but
need the computer on and app running; ChatGPT web scheduled tasks run remotely with uploaded or
connected context. Claude Cowork supports remote scheduled tasks that continue when the computer
sleeps or the desktop app closes; a Cowork task explicitly requiring local files or apps instead
runs locally and inherits that machine dependency. Claude Code cloud jobs keep running with the
laptop closed, and Claude Code on the web can work against a GitHub repository and prepare
reviewable changes. See the current
[ChatGPT scheduled-tasks documentation](https://learn.chatgpt.com/docs/automations),
[Claude Cowork scheduled-tasks documentation](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork),
[Claude Code scheduling documentation](https://support.claude.com/en/articles/14554000-claude-code-power-user-tips),
and [Claude Code on the web](https://support.claude.com/en/articles/12618689-claude-code-on-the-web).
Assessment:

- **Good fit — scheduled changelog and doc reading.** A weekly task that reads 16 upstream
  changelogs and vendor model docs and diffs them against the registry. This is ordinary
  browse-and-summarize work and covers drift class 5 where interpretation matters more than
  determinism.
- **Good fit — the interactive picker problem.** Drift class 4 is the one CI structurally
  cannot reach, because the model list and effort options live inside a TUI picker. An agent
  with desktop/terminal access can drive the picker and transcribe it. This is the strongest
  argument for using these features at all.
- **Good fit — candidate issue or PR preparation.** Scheduled agent tasks can package
  observations, evidence links, and proposed declarative changes for review.
- **Poor fit — deterministic merge gate.** Agent interpretation is non-deterministic and does
  not replace schema validation, fixtures, branch protection, or repo-visible CI status.

There is one operational caveat that must not be waved through. Local schedules depend on their
machine and app; remote schedules depend on product availability, workspace policy, connected-tool
authorization, and the vendor's scheduler. Either mode can fail by simply not running. That is the
same failure mode this note works hard to eliminate for feeds — reporting "no drift" when the truth
is "no signal". Every collector therefore writes a delivery receipt into shared operational state,
and a separately hosted monitor checks the primary scheduler heartbeat. A collector or scheduler
with no independently observable liveness signal is not coverage.

Rule: **CI owns deterministic detection and gating; agent-hosted schedules may own recurring
judgment-heavy collection, independent liveness monitoring, and candidate preparation, and
everything they observe is written back through the same evidence/PR path.** One acceptance model
regardless of who observed it. Note that an agent-hosted schedule used as a liveness monitor is
only a fallback: it is another scheduler with the same never-ran failure mode, so a purpose-built
dead-man's-switch service remains the right tool for that particular job.

For maintainer-side scheduling that needs repo-native tests and branch or pull-request preparation,
Claude Code cloud is the preferred default when it is available and permitted for this repository.
That is a project deployment preference, not a universal product ranking. Reach for ChatGPT Work or
Claude Cowork when connected tools, account-scoped documents, or other remote context are the
deciding requirement; use a local task only for a flow that truly needs the local checkout or TUI.

`src/core/wakeup/cron.ts` is *not* the right host for any of these schedules — that is
product-facing session wakeup substrate, not maintenance CI.

## Runtime-Side Degradation Requires a Separate Evidence Gate

Repo automation shortens the window between an upstream release and runtime support. It cannot
eliminate it, and users will hit the window.

ADR-029 rule 2 already says unverified targets must degrade to conservative entry-only catalogs
instead of publishing guessed metadata. Today nothing feeds that rule capability-specific
applicability. A single exact CLI-version comparison is not sufficient: model availability can
move without a CLI release, while an unrelated patch release need not invalidate advanced
controls. With multi-dimensional acceptance, the runtime can:

- show release, surface, catalog, and wire freshness independently
- compare locally fingerprinted versions against accepted ranges or scoped baselines where that
  dimension actually depends on a CLI version
- keep dynamic, target-specific model entries separate from verified advanced controls
- surface candidate/unverified states as warnings on `setup` and `diagnostics`, alongside the
  existing `ProviderAdvancedCatalogSupport.provenance`
- apply future entry-only degradation only when catalog/advanced evidence is missing or
  inapplicable for the target, under a separately specified and tested gate

`CuratedModelCatalogEntry` already parses `version` and `lastUpdated` from the YAML
(`curatedModelCatalog.ts`), so the catalog-observation part of a staleness warning is loaded and
simply never compared against anything. The other dimensions still require the registry and
accepted evidence contract.

One thing this reasoning must not be allowed to imply. Concluding that version inequality is the
wrong degradation trigger is correct, but it says nothing about the datum that motivated the whole
investigation. The Claude curated entry is not merely *unverified against a new CLI* — it is known
to be wrong, four months old, and naming a superseded model generation. Correcting it is reviewed
content work, independent of any degradation gate, and it should not wait behind a deferred SPEC.
Deferring the automatic behavior is a design judgment; continuing to ship data we already know is
wrong is not.

## Recommended Sequencing

Ordered by value over cost:

1. **Release sources and coverage matrix.** Canonical release sources with channel/platform scope,
   honest per-capability coverage, and optional accepted references; declared in compiled
   TypeScript so it needs no packaging change, and derived from `check.npmPackage` so no second
   feed table exists.
2. **L1 watcher and liveness.** One script and scheduled workflow that produce observed candidates,
   preserve durable per-source success state, publish a heartbeat checked outside that scheduler,
   and render a reviewed observation-snapshot candidate without mutating acceptance.
3. **Multi-dimensional staleness visibility, plus the stale-catalog correction.** Warnings and
   provenance only for the runtime contract, sourced from the bundled reviewed snapshot with its
   age exposed; do not degrade on exact version mismatch. Separately, fix the Claude curated entry
   as content.
4. **L2 canonicalized help/argv baselines and CI diff**, for the subset that installs safely on the
   relevant runner OS.
5. **Accepted-baseline promotion, the candidate/rejected evidence store, and capability-specific
   degradation**, with their own SPEC.
6. **L4 agent triage into candidate PRs.**
7. **Full L0 knowledge consolidation — including its packaging work — and L5 knowledge-pack
   delivery.**

Steps 1–3 are specified in PLAN-036. Steps 4–7 need their own SPEC before implementation.

Note what moved between drafts here, because the ordering principle is easy to lose. An earlier
revision put the complete YAML registry — schema gate, loader, per-capability candidate/rejected
records, knowledge migration — at step 1, ahead of any upstream signal existing. That inverts
value over cost: the justification was avoiding a duplicated table of seven npm package names, and
the proportionate fix for that is to read `check.npmPackage` directly. Step 1 is a source table;
the registry refactor stays at step 7 where baselines protect it.

## Risks

- **Automated catalog edits could ship a bad model id to users.** Mitigated by three
  independent gates: candidate PR with human merge, fixture tests, and a rollback-capable
  knowledge pack.
- **Installing eligible upstream CLIs in CI is a supply-chain and rate-limit surface.** Mitigated
  by isolated OS-appropriate runners, pinned versions, `--help`-only invocation, and never
  injecting credentials into that job.
- **Upstream changelog and version-feed quality is inconsistent** and several providers publish
  neither. The watcher must expose `not_automated` coverage and may use HTTP artifact fingerprints
  as weak signals; changelog text is an enhancement, not a precondition.
- **Feed coordinates themselves drift** (a package gets renamed or a repo moves). A feed that
  fails to resolve must report loudly rather than silently reporting "no drift".
- **The primary scheduler cannot report that it never started.** Its `lastRunAt` heartbeat is
  checked from a host that is not that scheduler; an in-repo check on an event-triggered workflow
  covers the interim, and scheduler health stays `unknown` until an alert path is tested.
- **Ephemeral CI output is not a runtime data channel.** A deterministic report is imported into a
  reviewed, versioned TypeScript snapshot before runtime freshness can consume it. That snapshot is
  release-bundled, so its age must be reported as a first-class state; near-real-time refresh
  remains L5 scope.
- **One observation can be account- or region-specific.** Interactive model evidence carries its
  scope and stays candidate evidence until review determines whether it is safe to generalize.
- **A runtime-loaded data tree can silently miss packaging.** `package.json` `files` is an
  allowlist asserted by `tests/package-contract.test.ts`, and the build copies no assets, so a new
  YAML tree either ships broken or breaks that test. The first slice avoids this by staying in
  compiled TypeScript; the later registry slice must carry the packaging checklist as scope.
- **Deferring the degradation gate can quietly become "ship the wrong data".** The correct
  conclusion that CLI-version inequality is a bad trigger does not extend to data already known to
  be wrong. Content corrections stay on their own track, independent of the gate.
- **Rigor can invert the sequencing.** Every guarantee above is worth having, but adding them all
  before the first signal exists delays the report that motivated the work. Model the distinctions
  early as typed fields; build the enforcement machinery once there is something to enforce against.

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

Accept ADR-034 after review, then execute PLAN-036 Phase 0 (release sources plus the coverage
matrix, in compiled TypeScript, derived from `check.npmPackage`) before adding the scheduled
watcher.

## Related

- [ADR-013 Extend provider manifests with install and check metadata](../decisions/013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-025 Keep provider evolution detection manual-first and evidence-driven](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR-029 Keep advanced provider catalogs verified and manual-refresh](../decisions/029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md)
- [ADR-034 Automate light-tier provider drift detection, keep live probes manual-first, and separate observation from acceptance](../decisions/034-automate-light-tier-provider-drift-and-separate-observation-from-acceptance.md)
- [PLAN-036 Provider upstream drift watch and staleness surfacing](../plans/PLAN-036-provider-upstream-drift-watch-and-staleness-surfacing.md)
- [2026-03-27 Provider Evolution Evidence Framework](./2026-03-27-provider-evolution-evidence-framework.md)
- [2026-04-07 Advanced Provider Manifest Baseline](./2026-04-07-advanced-provider-manifest-baseline.md)
- [SPEC-021 Provider evolution evidence and capability probes](../specs/SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- [SPEC-023 Verified advanced provider catalogs and manual-refresh discovery](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)

---

*Revised: 2026-08-18 after follow-up review added durable watcher state, independent scheduler
heartbeat monitoring, reviewed runtime observation delivery, conservative help canonicalization,
and execution-mode-aware agent scheduling.*
