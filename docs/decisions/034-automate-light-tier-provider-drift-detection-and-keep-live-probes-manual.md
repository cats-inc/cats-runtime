# ADR-034: Automate light-tier provider drift detection and keep live probes manual

## Status

Proposed

## Context

`cats-runtime` integrates 16 independently versioned CLI provider families
(`src/backends/cli/providers/types.ts:24`). Each can change its model list, its flags and
output-format contracts, its stream event shapes, and its install/auth flow on its own schedule.

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
manual, with a single repo-owned source of truth for provider knowledge.

Specifically:

1. **Release-tier detection becomes fully automated.** Every provider declares machine-readable
   release-feed coordinates (npm package, GitHub repository, PyPI project, or installer version
   endpoint). A scheduled CI job resolves the latest upstream version, compares it against the
   recorded verified version, and reports drift. This job installs no CLI and holds no
   credentials.
2. **Surface-tier detection becomes automated where it is containerizable.** For providers that
   install unattended in a container, CI captures light probe output (`--version`, `--help`,
   `<subcommand> --help`) into committed baseline files and fails when a flag the runtime
   actually passes disappears from `--help`. The declared `helpTokens` in
   `src/core/compatibility/knowledge.ts` are the contract this check enforces.
3. **Wire-tier detection stays manual-first, per ADR-025.** Live probes and
   `providerEvolutionProbe` runs remain explicit, operator-initiated actions. A credentialed
   self-hosted scheduled run is permitted only as an explicit opt-in, never as a default, and
   never on end-user machines.
4. **Automation never mutates parser logic or promotes capabilities.** Automated output is
   limited to declarative knowledge and reports. Anything touching adapter parsing produces an
   issue with the evidence bundle, not a patch. This restates ADR-025 rule 4 and keeps it
   binding.
5. **Automated knowledge changes land as candidate pull requests, never direct commits.** A
   candidate PR must pass schema validation, `npm run typecheck`, and the affected provider's
   fixture tests, and requires human merge.
6. **Version-sensitive provider knowledge converges on one declarative registry.** The facts
   currently spread across `compatibility/knowledge.ts`, `provider-install/knowledge.ts`,
   `models/curatedModelCatalog.ts`, and `models/providerAdvancedKnowledge.ts` move behind
   per-provider declarative manifests carrying provenance (`observedVersion`, `verifiedAt`,
   `verifiedBy`, `evidenceRefs`). TypeScript becomes a typed loader over that registry.
7. **Staleness is a visible runtime state, not a silent default.** When the locally fingerprinted
   CLI version does not match a verified version, the runtime degrades advanced metadata to
   entry-only per ADR-029 rule 2 and surfaces the delta on `setup` and `diagnostics`.
8. **Detection and gating live in CI.** Interactive or judgment-heavy collection — reading
   upstream changelogs, transcribing an interactive model picker — may be performed by desktop
   agent sessions, but only as an input that writes back through the same candidate-PR path.
   Scheduling and gating invariants do not live in a consumer application.

## Consequences

### Positive

- Upstream releases become visible within a day instead of when a user's machine breaks
- The cheapest and highest-frequency drift classes get covered first, with no credential or
  quota exposure
- `helpTokens` stop being documentation and become an enforced contract
- ADR-029's degradation rule becomes enforceable because a verified-version reference finally
  exists
- Declarative knowledge is safely machine-editable, which is the precondition for any further
  automation
- Existing evidence machinery (`providerEvolution`, `providerEvolutionProbe`,
  `retainedArtifacts`, `/diagnostics/providers/evidence`) is reused rather than duplicated

### Negative

- CI now installs upstream CLIs, adding a supply-chain and rate-limit surface that has to be
  contained
- Coverage is deliberately partial: providers that cannot install unattended in a container get
  release-tier detection only
- Consolidating four knowledge sources into a registry is a real refactor with migration risk
- Maintainers still review every candidate PR; toil is reduced, not eliminated

### Neutral

- ADR-025 is narrowed rather than reversed; its manual-first rule continues to govern the wire
  tier
- ADR-029's non-probing read paths are unchanged; nothing here makes routine reads hit upstream
- Interactive-picker model catalogs remain human-sourced, because no CI runner can reach them

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

- **Pros**: can read vendor docs behind a login and drive interactive TUI pickers, which CI
  cannot; no repo credentials needed
- **Cons**: non-deterministic, no repo-visible audit trail, no CI gating, and dependent on a
  consumer app session staying signed in
- **Why rejected as the host**: correctness invariants must not depend on a consumer app
  session. Accepted instead in the narrow role of decision 8 — an optional collector whose
  output enters through the same candidate-PR path

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
*Decision makers: user + Claude*
