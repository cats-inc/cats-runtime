# ADR-034: Automate light-tier provider drift detection, keep live probes manual-first, and separate observation from acceptance

## Status

Proposed

## Context

`cats-runtime` registers 16 independently versioned CLI provider families
(`src/backends/cli/providers/types.ts:24`). Registration is not the same as uniform execution or
probe support: some families are install-only, some execute through another backend, and not all
are eligible for every probe tier. Each can still change its model list, flags and output-format
contracts, stream event shapes, and install/auth flow on its own schedule.

ADR-025 established that provider evolution detection is manual-first and evidence-driven, and
ADR-029 established that advanced catalogs must be verified and manual-refresh. Both decisions
remain correct about what they were deciding — the runtime should not rewrite parser logic on its
own, and routine UI reads should not probe upstream.

Neither decision, however, covered how the runtime learns that an upstream release happened at
all. The consequence is now measurable:

- No code in `cats-runtime`, `cats-platform`, or `cats-one` reads any release feed. There is no
  npm registry, GitHub release, or PyPI lookup anywhere in the three repos.
- `cats-runtime/.github/workflows/` contains only `npm-publish.yml` and
  `release-preflight.yml`. There is no scheduled job.
- `config/curated-model-catalogs.yaml.example` still declares `cli: Claude`,
  `version: 2.1.112`, `last_updated: 2026-04-17`, describing its top entry as "Opus 4.7 with 1M
  context" — four months stale as of 2026-08-17, naming a superseded model generation, with no
  runtime surface reporting that staleness.
- `providerEvolutionProbe` baselines are retained under the runtime artifact root rather than in
  the repo, so drift cannot become a reviewable diff.

Every drift signal today therefore requires the CLI to already be installed on some machine and a
human to remember to probe it, and every correction requires editing hand-written TypeScript and
cutting a runtime release. Against 16 providers on roughly weekly cadence, that is structurally
guaranteed to lag, and the lag is invisible to maintainers and users alike.

The important observation is that "provider drift" is not one thing. It decomposes into five
classes with materially different costs, and the codebase already encodes the relevant
distinction: `CompatibilityProbeMode = 'light' | 'live'` and
`CompatibilityProbeKind = 'version' | 'help' | 'live'` in `src/core/compatibility/types.ts`.

Light probes need no auth, consume no provider quota, and are deterministic. Live probes need
credentials, consume quota, and are not. ADR-025's caution was really about the live tier.

## Decision

`cats-runtime` will automate provider drift detection at the light tier and keep the live tier
manual-first, with a single repo-owned declaration and an explicit acceptance state for provider
knowledge.

Specifically:

1. **A canonical release-source and coverage declaration lands before the watcher.** Each provider
   declares its release sources and its honest per-capability automation coverage, with a required
   reason for anything not automated. Release sources are an array because one provider may ship
   through different stable/prerelease or platform-specific channels. Coordinates already
   represented by install knowledge keep exactly one handwritten home; the declaration derives from
   them instead of copying them into a second flat table.

   The declaration's storage format is a packaging decision, not a stylistic one. `npm run build`
   is `clean:build` + `build:ui` + `tsc` and copies no assets, `package.json` `files` is an
   allowlist, and `tests/package-contract.test.ts` asserts that allowlist with `toEqual`. A
   runtime-loaded YAML tree therefore requires a build copy step, a `files` entry, a
   `package-contract` update, and — at the repo root — an `AGENTS.md` Project Structure Convention
   entry. The first slice therefore declares in compiled TypeScript, which requires none of those,
   and the YAML registry arrives with the knowledge consolidation in decision 8, carrying that
   packaging work explicitly.
2. **Release observation is automated wherever a deterministic signal exists.** A scheduled CI
   job resolves npm, GitHub, PyPI, installer-version, or HTTP-artifact signals and reports the
   latest observed state. Providers with no resolvable signal remain explicit as
   `not_automated`; they are not counted as current. Installer or documentation ETag,
   Last-Modified, and SHA-256 fingerprints may be used as weak change signals when no semantic
   version endpoint exists. This job installs no CLI and holds no credentials.
3. **Observation and acceptance are separate states.** A newly observed release is a candidate,
   not verified provider knowledge. Release, surface, catalog, and wire knowledge each carry
   their own accepted evidence and may progress through `candidate`, `accepted`, or `rejected`
   independently. The accepted pointer remains active while a candidate is reviewed; observation
   never overwrites it. A single `verifiedVersion` must not stand in for all four dimensions. An
   unset accepted reference is a reportable "not yet accepted" state, never "current".

   Absence of a signal is likewise never coverage. Operational watcher state persists the last
   successful observation for every source across runs; a failed resolution preserves the prior
   success time instead of replacing it with the failure time. The watcher also publishes a
   scheduler heartbeat. Per-source staleness detects broken feeds, while a monitor that does not
   share the watcher's scheduler checks that heartbeat, so a GitHub Actions cron that never ran
   cannot certify itself as healthy. The durable answer is a purpose-built dead-man's-switch
   service with a named owner; an agent-hosted schedule is a fallback, because it is itself a
   scheduler with the same never-ran failure mode and no monitor of its own. An in-repo check on an
   existing event-triggered workflow is a valid interim, since it costs nothing and catches a dead
   cron whenever the repository sees activity. Until an alert path is tested, missed-run detection
   is explicitly `unknown`, not covered.

   CI artifacts and issues are not runtime inputs. The watcher additionally renders a
   deterministic, versioned observation-snapshot candidate containing source status, observed
   value, observation time, report provenance, and checksum. An explicit maintainer command imports
   that candidate into a reviewed TypeScript snapshot under `src/core/provider-registry/`; only the
   merged snapshot is compiled into the runtime and consumed by freshness reporting. Reviewing this
   snapshot confirms provenance and delivery, not compatibility acceptance.

   The accepted limitation is recorded rather than glossed: snapshot freshness is bounded by the
   runtime release cadence, so between releases an installation will often be reporting an
   observation old enough that the only honest state is "too old to know". That is why snapshot age
   is a first-class reported state rather than a footnote, and why the later knowledge-pack
   delivery slice — integrity-checked, rollback-capable, and refreshable without a release —
   supersedes this bridge rather than merely extending it.
4. **Surface-tier detection becomes automated where it is safely installable.** For eligible
   provider/platform/channel combinations, CI captures `--version`, `--help`,
   `<subcommand> --help`, and model-list help surfaces, and validates the argv profiles Cats
   actually emits rather than only the presence of `helpTokens`. Candidate snapshots are stored
   separately from accepted baselines.

   The comparison contract is **conservatively canonicalized** help output — ANSI stripped, line
   endings normalized, trailing whitespace removed, and terminal width pinned — not an extracted
   command grammar. Commands, options, accepted-value lists, and paragraphs retain their original
   order, and the canonicalizer does not aggressively unwrap or reflow content. Canonicalization
   reduces presentation-only false positives; it does not claim zero false negatives. Raw stdout is
   retained beside the canonical diff, and explicit provider-specific argv contract assertions are
   the hard gate. A grammar extractor is a 16-CLI parser project whose own bugs could mask exactly
   the upstream changes this decision exists to catch. Derived grammar may be published as readable
   enrichment alongside the canonical text; it does not become the diff target.
5. **Wire-tier detection stays manual-first, per ADR-025.** Live probes and
   `providerEvolutionProbe` runs remain explicit, operator-initiated actions. A credentialed
   self-hosted scheduled run is permitted only as an explicit opt-in, never as a default, and
   never on end-user machines. Failed, unreviewed, or rejected artifacts are never eligible to
   become the next baseline; baseline promotion requires an explicit accepted pointer.
6. **Automation never mutates parser logic or promotes capabilities.** Automated output is
   limited to declarative knowledge and reports. Anything touching adapter parsing produces an
   issue with the evidence bundle, not a patch. This restates ADR-025 rule 4 and keeps it
   binding.
7. **Automated knowledge changes land as candidate pull requests, never direct commits.** A
   candidate PR must pass schema validation, `npm run typecheck`, and the affected provider's
   fixture tests, and requires human merge.
8. **Version-sensitive provider knowledge converges on the declarative registry.** The facts
   currently spread across `compatibility/knowledge.ts`, `provider-install/knowledge.ts`,
   `models/curatedModelCatalog.ts`, and `models/providerAdvancedKnowledge.ts` move behind
   per-provider manifests carrying capability-specific acceptance and provenance. TypeScript
   becomes a typed loader over that registry as the consolidation progresses. That consolidation
   owns the packaging work named in decision 1, and it must not treat `config/*.yaml.example` as
   its precedent: those are user-overridable templates resolved through
   `resolveRuntimeCuratedModelCatalogPath`, whereas the registry is repo-owned truth.
9. **Staleness is multi-dimensional and visible before it changes behavior.** Release,
   surface, catalog, and wire freshness are reported independently on `setup` and `diagnostics`.
   An installed CLI version differing from the latest accepted version is a warning, not by
   itself proof that advanced metadata is invalid. Any future entry-only degradation under
   ADR-029 rule 2 must be based on missing or inapplicable catalog/advanced evidence for that
   target, not on exact CLI-version inequality, and requires a separate specified gate.

    Deferring that gate does not license shipping data already known to be wrong. Content the
    watcher exposes as stale — starting with the four-month-old Claude curated catalog entry — is
    corrected as reviewed content regardless of when the degradation gate lands.
10. **Detection and merge gating live in CI; agent-hosted schedules may collect and prepare.**
    ChatGPT Work scheduled tasks, Claude Cowork scheduled tasks, and Claude Code cloud jobs may run
    recurring changelog, documentation, interactive-picker, or candidate-PR workflows. Their
    observations enter the same evidence and candidate path; deterministic validation and merge
    invariants remain repo-visible CI checks. Every collector declares whether it runs locally or
    remotely and publishes a delivery receipt into the shared operational state. Local schedules
    are covered only while their required machine and app are available; remote schedules are not
    described as desktop-dependent.

    Claude Code cloud is the preferred default when this project's repo-native workflow needs to
    run tests and prepare a branch or pull request and that service is available and permitted.
    ChatGPT Work or Claude Cowork may be the better host when connected tools, account-scoped
    documents, or interactive context are the deciding requirement. Host choice is an operational
    deployment decision, never part of the correctness boundary. A missed collector run is detected
    through decision 3's durable receipt and independent scheduler-heartbeat checks.

## Consequences

### Positive

- Upstream releases with a declared deterministic signal become visible within a day instead of
  when a user's machine breaks; uncovered providers remain visibly `not_automated`
- The cheapest and highest-frequency drift classes get covered first, with no credential or
  quota exposure
- Cats argv profiles and canonicalized help surfaces become enforced contracts
- Candidate observations cannot silently become accepted baselines, and a broken or missed check
  cannot masquerade as a passing one
- Runtime freshness has an explicit, reviewed input instead of implicitly depending on ephemeral
  CI artifacts or mutable issue text
- The first slice ships inside the existing compiled artifact, so it moves no packaging contract
- ADR-029's degradation rule can be enforced against catalog-specific evidence without treating
  every CLI version change as a capability regression
- Declarative knowledge is safely machine-editable, which is the precondition for any further
  automation
- Existing evidence machinery (`providerEvolution`, `providerEvolutionProbe`,
  `retainedArtifacts`, `/diagnostics/providers/evidence`) is reused rather than duplicated

### Negative

- CI now installs upstream CLIs, adding a supply-chain and rate-limit surface that has to be
  contained
- Coverage is deliberately partial and platform-specific: providers without a deterministic feed
  or safe unattended install stay visibly manual at the affected tier
- Consolidating four knowledge sources into a registry is a real refactor with migration risk, and
  it carries packaging work (build copy step, `files` allowlist, `package-contract`, structure
  convention) that the first slice deliberately avoids rather than solves
- Capability-specific degradation is deferred to its own SPEC, so ADR-029 rule 2 stays
  under-enforced in the interim and only warnings cover the gap
- Until knowledge-pack delivery lands, users receive the latest reviewed observation snapshot only
  when they update the runtime, so between releases the reported observation is frequently stale;
  diagnostics must expose that snapshot age rather than imply currency
- Maintainers still review every candidate PR; toil is reduced, not eliminated

### Neutral

- ADR-025 is narrowed rather than reversed; its manual-first rule continues to govern the wire
  tier
- ADR-029's non-probing read paths are unchanged; nothing here makes routine reads hit upstream
- Interactive-picker model catalogs remain review-sourced even when an agent-hosted schedule
  performs the collection

## Alternatives Considered

### Alternative 1: Keep everything manual, as today

- **Pros**: zero new infrastructure; no new CI surface; no risk of automated bad data
- **Cons**: demonstrably fails — the shipped curated catalog is four months stale and names a
  superseded model generation, with no surface reporting it
- **Why rejected**: the status quo already produced untruthful shipped data, which is exactly
  what ADR-029 set out to prevent

### Alternative 2: Fully automatic self-adaptation, including parser updates

- **Pros**: no maintainer in the loop; fastest possible convergence on upstream changes
- **Cons**: requires parser-safety and rollout guarantees the runtime does not have; a bad
  automated adapter change breaks execution for every user of that provider
- **Why rejected**: same reasoning ADR-025 already accepted; nothing has changed to make this
  safe

### Alternative 3: Host the automation entirely in an agent-scheduled task

- **Pros**: current agent products can schedule recurring work, use local or connected context,
  read vendor docs behind a login, drive interactive TUI pickers where local execution is
  available, and prepare reviewable changes
- **Cons**: agent interpretation remains non-deterministic, local-resource availability varies by
  execution mode, remote availability is subject to product and workspace policy, and no agent host
  replaces repo-owned validation and branch protection
- **Why rejected as the gate**: correctness invariants must remain deterministic and repo-visible.
  Accepted instead under decision 10 as a scheduled secondary collector and candidate-PR author

### Alternative 4: Reuse `src/core/wakeup/cron.ts` for maintenance scheduling

- **Pros**: a scheduling substrate already exists in the runtime
- **Cons**: that substrate is product-facing session wakeup; maintenance CI running inside the
  shipped runtime would put maintainer tooling on end-user machines
- **Why rejected**: wrong layer, and it contradicts ADR-025's exclusion of continuous background
  probing on end-user machines

## References

- [ADR-013: Extend provider manifests with install and check metadata](./013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-025: Keep provider evolution detection manual-first and evidence-driven](./025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR-029: Keep advanced provider catalogs verified and manual-refresh](./029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md)
- [2026-08-17 Provider Upstream Drift Automation](../research/2026-08-17-provider-upstream-drift-automation.md)
- [2026-03-27 Provider Evolution Evidence Framework](../research/2026-03-27-provider-evolution-evidence-framework.md)
- [SPEC-021: Provider evolution evidence and capability probes](../specs/SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- [SPEC-023: Verified advanced provider catalogs and manual-refresh discovery](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
- [PLAN-036: Provider upstream drift watch and staleness surfacing](../plans/PLAN-036-provider-upstream-drift-watch-and-staleness-surfacing.md)

---

*Proposed: 2026-08-17*
*Revised: 2026-08-18 after follow-up review added a reviewed runtime observation snapshot, durable source state, an independent scheduler heartbeat, conservative help canonicalization, and execution-mode-aware agent scheduling; a fourth pass kept the snapshot bridge on the owner's call and recorded its release-bounded freshness as an accepted limitation*
*Decision makers: user + Claude + Codex*
