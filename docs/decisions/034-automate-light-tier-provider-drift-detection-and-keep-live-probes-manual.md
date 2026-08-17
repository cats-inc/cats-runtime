# ADR-034: Automate light-tier provider drift detection and keep live probes manual

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

1. **A minimal provider automation registry lands before the watcher.** Each provider has one
   declarative manifest with its support tier, automation coverage, release sources, platform and
   channel scope, version scheme, and evidence provenance. Release sources are an array because
   one provider may ship through different stable/prerelease or platform-specific channels. The
   manifest becomes canonical for coordinates already represented by install knowledge; the
   implementation must consume or derive those values instead of copying them into a second flat
   table.
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
   never overwrites it. A single `verifiedVersion` must not stand in for all four dimensions.
4. **Surface-tier detection becomes automated where it is safely installable.** For eligible
   provider/platform/channel combinations, CI captures normalized command grammar from
   `--version`, `--help`, `<subcommand> --help`, and model-list help surfaces. It validates the
   argv profiles Cats actually emits, not only the presence of `helpTokens`, and stores candidate
   snapshots separately from accepted baselines. Raw help output may be retained as evidence but
   is not itself the stable comparison contract.
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
   becomes a typed loader over that registry as the consolidation progresses.
9. **Staleness is multi-dimensional and visible before it changes behavior.** Release,
   surface, catalog, and wire freshness are reported independently on `setup` and `diagnostics`.
   An installed CLI version differing from the latest accepted version is a warning, not by
   itself proof that advanced metadata is invalid. Any future entry-only degradation under
   ADR-029 rule 2 must be based on missing or inapplicable catalog/advanced evidence for that
   target, not on exact CLI-version inequality, and requires a separate specified gate.
10. **Detection and merge gating live in CI; desktop agents may schedule collection.** ChatGPT
    Work and Claude Cowork may run recurring changelog, documentation, interactive-picker, or
    candidate-PR workflows. Their observations enter the same evidence and candidate-PR path;
    deterministic validation and merge invariants remain repo-visible CI checks.

## Consequences

### Positive

- Upstream releases with a declared deterministic signal become visible within a day instead of
  when a user's machine breaks; uncovered providers remain visibly `not_automated`
- The cheapest and highest-frequency drift classes get covered first, with no credential or
  quota exposure
- Cats argv profiles and normalized help grammar become enforced contracts
- Candidate observations cannot silently become accepted baselines
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
- Consolidating four knowledge sources into a registry is a real refactor with migration risk
- Maintainers still review every candidate PR; toil is reduced, not eliminated

### Neutral

- ADR-025 is narrowed rather than reversed; its manual-first rule continues to govern the wire
  tier
- ADR-029's non-probing read paths are unchanged; nothing here makes routine reads hit upstream
- Interactive-picker model catalogs remain review-sourced even when a scheduled desktop agent
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

### Alternative 3: Host the automation in a desktop agent app (ChatGPT Work / Claude Cowork)

- **Pros**: current desktop-agent products can schedule recurring work, use local or connected
  context, read vendor docs behind a login, drive interactive TUI pickers, and prepare reviewable
  changes
- **Cons**: agent interpretation remains non-deterministic, local-resource availability varies by
  execution mode, and the products do not replace repo-owned validation and branch protection
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
*Revised: 2026-08-17 after Codex review*
*Decision makers: user + Claude + Codex*
