# PLAN-029: Provider Compatibility and Evidence Engine

> Renumbered from PLAN-008 to resolve duplicate numbering with PLAN-008-runtime-managed-skills-v0.

> Implementation plan for the first shipped slice of `SPEC-007`, focused on
> CLI-backed provider compatibility, replay-friendly evidence capture, and one
> shared runtime-owned compatibility engine consumed by diagnostics and
> execution.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Core Delivered; Follow-Ons Remain) |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / runtime workstream |

## Related Spec

- [SPEC-007: Provider Compatibility and Evidence Engine](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md)
- [ADR-013: Extend Provider Manifests with Install and Check Metadata](../decisions/013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-014: Keep Lightweight Provider Setup and Diagnostics in `cats-runtime`](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)

## Overview

`cats-runtime` already owns CLI execution, provider session semantics, and
runtime diagnostics. The first shipped slice now adds shared compatibility
assessment, degraded profile selection, and evidence capture, but provider
assumptions still partly live inside handwritten adapters and route-specific
checks. That makes the runtime brittle when upstream CLIs change:

- startup flags
- `--version` output
- stream grammar
- approval request shapes
- resume/session identifiers

The first delivery slice should not attempt a full declarative replacement of
every adapter. Instead, it should add a lightweight shared engine that can:

- fingerprint configured provider targets
- select a best-fit compatibility profile
- classify the result as `ready`, `degraded`, `unsupported_version`,
  `unrecognized_protocol`, or `probe_failed`
- capture replay-friendly redacted evidence when confidence is weak or probing
  fails
- feed the same result into setup/diagnostics and real execution paths

This keeps handwritten adapters in place, but moves compatibility knowledge and
failure evidence into runtime-owned assets and services.

## Scope

### In Scope

- add a runtime-owned compatibility knowledge base for CLI provider families
- add provider fingerprinting and compatibility profile selection
- add a shared compatibility service under `src/core/compatibility`
- add replay-friendly evidence bundle capture for degraded and failed probes
- wire compatibility checks into:
  - diagnostics routes
  - provider config/catalog surfacing where useful
  - CLI execution/session spawn paths
- cover the first provider families explicitly:
  - `claude`
  - `codex`
  - `gemini`
  - `copilot`
  - shared fallback handling for remaining CLI families
- expose machine-readable compatibility status and selected profile metadata
- add targeted regression tests and fixture-style replay coverage
- update docs, config example comments, and `PROGRESS.md`
- add an additive selector-oriented availability scope on
  `GET /diagnostics/providers` so truthful product selectors do not have to pay
  full operator diagnostics cost on every hot-path read

### Out of Scope

- runtime-owned usage metering or rate-limit policy
- rewriting every provider adapter into a pure declarative parser system
- making evidence analysis depend on an LLM in the hot path
- broad UI/dashboard redesign beyond surfacing the new contract
- turning `cats-runtime` into an installer executor

## Implementation Phases

### Phase 1: Knowledge Base and Core Contracts

- [x] Add shared compatibility types under `src/core/compatibility`
- [x] Define the provider-family manifest/profile shape
- [x] Encode first-wave compatibility knowledge for major CLI families
- [x] Add a fingerprint result shape that can represent:
      - version known / unknown
      - runtime mode
      - command resolution
      - observed output/protocol signature
      - detected feature hints
- [x] Define normalized result classes:
      - `ready`
      - `degraded`
      - `unsupported_version`
      - `unrecognized_protocol`
      - `probe_failed`

**Deliverables**: one runtime-owned compatibility vocabulary and manifest
direction that providers, diagnostics, and tests can share.

### Phase 2: Probe, Fingerprint, and Evidence Capture

- [x] Add a compatibility service that can probe a resolved provider target
- [x] Support version lookup and runtime-aware command probing without assuming
      version data is always available
- [x] Add protocol/signature fallback when version is unavailable or ambiguous
- [x] Add evidence capture helpers that persist redacted JSON bundles under a
      runtime-owned evidence directory
- [x] Make evidence bundles include enough data for replay/regression fixtures:
      - provider family
      - target/backend/runtime
      - selected profile
      - probe command summary
      - stdout/stderr samples
      - classification
      - timestamps/platform metadata

**Deliverables**: shared probe/fingerprint/evidence primitives with deterministic
bundle structure.

### Phase 3: Shared Runtime Integration

- [x] Route CLI diagnostics through the shared compatibility service instead of
      route-local ad hoc checks
- [x] Reuse the same service before CLI execution/spawn so runtime turns do not
      bypass compatibility selection
- [x] Feed the selected profile and classification into provider construction
      without rewriting every adapter
- [x] Expose re-probe-friendly semantics:
      - cache reuse for normal paths
      - explicit force refresh from diagnostics/API query when requested
      - automatic refresh when cached compatibility is stale or missing

**Deliverables**: one compatibility engine shared by diagnostics and execution.

### Phase 4: Public Contract, Docs, and Regression Coverage

- [x] Extend the diagnostics/provider route payloads with machine-readable
      compatibility metadata and degraded-path explanations
- [x] Add targeted unit tests for:
      - profile selection
      - version/fingerprint fallback
      - evidence redaction and persistence
      - replay from captured bundles/fixtures
- [x] Add integration tests for diagnostics and session execution behavior
- [x] Update `docs/api.md`, `docs/architecture.md`, and `docs/setup-guide.md`
- [x] Update `PROGRESS.md` with the delivered compatibility/evidence slice

**Deliverables**: shipped contract, replay foundation, and synchronized docs.

### Phase 5: Deferred Follow-Ons

- [ ] Expand first-class manifests and live probes only when additional
      provider families become runtime-critical beyond the current major CLI
      coverage
- [x] Add host-facing explicit re-probe/write-back APIs beyond query-flag
      refresh
- [ ] Revisit whether compatibility knowledge should move from TypeScript-owned
      manifests into runtime-owned config assets or a hybrid split
- [x] Add offline evidence triage tooling and review workflow helpers
- [ ] Layer future rate-limit/metering detection onto the same compatibility
      knowledge base without coupling the initial slice
- [x] Add additive `scope=availability` support on `GET /diagnostics/providers`
      for selector hot paths instead of forcing them to hydrate the full
      operator diagnostics payload
- [x] Implement that selector-oriented scope by reusing
      `collectProviderDiagnostics(..., { includeArtifacts: false })` and the
      existing shared compatibility engine rather than inventing a second truth
      stack
- [x] Preserve cheap top-level `probe` and aggregated `summary` on that scope
      so selector callers keep zero-cost context while stripping operator-grade
      per-target decoration
- [x] Keep the selector-oriented scope intentionally small:
      - retain target identity (`provider`, `instance`, `backend`,
        `defaultTarget`)
      - retain `availability`
      - omit operator-grade `config`, `checks`, `setup`, `compatibility`,
        `metering`, `compatibilityEvidence`, `providerEvolution`, and
        `reprobe`
- [ ] Revisit selector-oriented timeout and any short-lived diagnostics cache
      alongside that scope so the new hot path complements the existing
      5-minute compatibility cache instead of pretending the full diagnostics
      pipeline is already cached
- [ ] Document the additive selector-oriented scope across `docs/api.md`,
      `docs/mcp-config.md`, and host-facing integration notes once it lands

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/compatibility/*` | Create | Compatibility types, manifests, probe service, cache, and evidence helpers |
| `src/core/config.ts` | Modify | Surface resolved runtime paths/config needed by the compatibility service |
| `src/backends/cli/config.ts` | Modify | Add compatibility/evidence runtime config inputs if needed |
| `src/backends/cli/providers/types.ts` | Modify | Extend provider contract for profile-aware compatibility selection |
| `src/backends/cli/providers/*` | Modify | Apply selected compatibility profile in first-wave adapters |
| `src/backends/cli/pool/WorkerPool.ts` | Modify | Route CLI execution through shared compatibility selection |
| `src/backends/cli/pool/WorkerProcess.ts` | Modify | Consume selected compatibility/evidence result before spawn |
| `src/http/routes/diagnostics.ts` | Modify | Replace route-local CLI checks with compatibility engine output |
| `src/http/routes/providers.ts` | Modify | Surface compatibility metadata where useful for hosts/dashboard |
| `src/http/providerDiagnostics.test.ts` | Modify | Cover selector-oriented `scope=availability` semantics once landed |
| `tests/*` | Modify/Create | Compatibility, evidence, diagnostics, and execution regressions |
| `config/providers.yaml.example` | Modify | Document compatibility/evidence-related config where relevant |
| `docs/api.md` | Modify | Document compatibility payloads and re-probe semantics |
| `docs/mcp-config.md` | Modify | Keep MCP provider diagnostics wording aligned with the full-vs-selector diagnostics split |
| `docs/architecture.md` | Modify | Document compatibility/evidence service placement |
| `docs/setup-guide.md` | Modify | Document diagnostics/re-probe/evidence behavior |
| `PROGRESS.md` | Modify | Track the delivered slice |

## Technical Decisions

- Start with a TypeScript-owned runtime manifest for compatibility knowledge so
  the first slice can ship quickly without adding a second user-managed config
  file.
- Keep handwritten provider adapters; add profile-aware hooks instead of
  replacing them wholesale.
- Treat version detection as useful but optional. Unknown version can still
  produce `degraded` when the runtime has a best-fit profile.
- Capture evidence only on degraded/failing compatibility paths, not on every
  successful turn.
- Keep evidence capture local, redacted, and JSON-based so fixtures can be
  checked into tests without depending on external tooling.
- Keep the current operator-grade `GET /diagnostics/providers` payload as the
  default diagnostics surface, but make any selector-oriented availability read
  model additive rather than replacing the richer operator contract.
- Be precise about cache boundaries: the shipped runtime already has a bounded
  compatibility assessment cache, but it does not yet have a broad cache for
  the full diagnostics payload assembly path.

## Testing Strategy

- **Unit Tests**:
  - provider fingerprint normalization
  - profile ranking and fallback selection
  - classification mapping
  - evidence redaction and artifact naming
  - replay from captured evidence fixtures
- **Integration Tests**:
  - diagnostics route compatibility payloads
  - selector-oriented `scope=availability` payload shape and field omission
  - default-target aggregate health behavior with compatibility states
  - CLI session spawn behavior when compatibility is `ready`, `degraded`, or
    unsupported
- **Manual Testing**:
  - run `GET /diagnostics/providers` with and without `force=1`
  - once landed, compare `GET /diagnostics/providers?scope=availability`
    against the default operator-grade route on a cold start
  - inspect emitted evidence bundles after a forced mismatch/failure
  - verify first-wave providers still spawn normally on known-good configs

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Compatibility service becomes a second parser stack parallel to adapters | High | Keep adapters authoritative for stream parsing and use profiles to select/parameterize them |
| Probe latency slows normal runtime paths | Medium | Cache compatibility results and keep probe commands short/timeout-bound |
| Truthful selector hot paths still time out because they reuse the full diagnostics payload | High | Add a narrower additive `scope=availability`, reuse `includeArtifacts: false`, and keep any selector cache bounded and complementary to the existing compatibility cache |
| Evidence bundles capture secrets or host-specific noise | High | Redact env-like strings, truncate stdout/stderr samples, and avoid raw prompt capture |
| First-wave support is too thin for non-major providers | Medium | Return explicit degraded/fallback metadata for generic profiles instead of pretending strong support |
| Async compatibility checks force broad route churn | Medium | Prefer bounded spawn-time integration and route reuse over whole-runtime API rewrites |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created to stage the first compatibility/evidence-engine delivery slice before implementation |
| 2026-03-23 | First compatibility slice landed with cached assessments, degraded profiles, and redacted evidence bundles; remaining work stays in follow-on phases |
| 2026-03-23 | Second slice deepened CLI `live` probes, expanded first-class family coverage, exposed stale-cache/reprobe metadata to hosts, and tightened cross-platform remediation hints without turning the runtime into a full setup wizard |
| 2026-03-27 | The redacted compatibility evidence bundles captured on degraded CLI assessments now have matching manual-first retained list/read helpers via `cats-runtime --list-compatibility-evidence` and `--read-compatibility-evidence <artifactId>`, keeping offline operator review out of the public HTTP surface |
| 2026-03-27 | The same retained compatibility evidence flow now also accepts repeated `--probe-classification` filters, so offline triage can focus on `probe_failed`, `unsupported_version`, `degraded`, or `unrecognized_protocol` bundles without starting the HTTP server or adding a new route |
| 2026-03-27 | Retained compatibility evidence list/read flows now also accept additive `--probe-parser` and `--probe-profile` selectors so operators can narrow offline triage to one parser/profile family without rerunning a probe or adding a public route |
| 2026-03-27 | Retained compatibility evidence list/read flows now also accept additive `--probe-runtime <native|wsl|docker>` filtering so operators can narrow offline triage to one CLI runtime mode across mixed local, WSL, and container-backed installs without adding a new route |
| 2026-03-27 | Core compatibility delivery is now complemented by manual provider-evolution follow-through: transport-neutral evidence collection, retained baseline-compare artifacts with review summaries, CLI/manual artifact list-read flows, and additive latest-artifact summaries on `/diagnostics/providers` and `/providers/config` all reuse the same runtime-owned compatibility substrate |
| 2026-03-27 | Offline evidence triage follow-through landed for retained provider-evolution artifacts: repeated `--probe-classification` filters now let operators focus list/read flows on `upgrade`, `regression`, `schema_change`, or `semantic_drift_suspected` review classes without adding a new host-facing probe route |
| 2026-03-27 | Manual review workflow helpers now let operators update retained provider-evolution artifact classifications, summary text, highlights, and external references in place via CLI without rerunning a probe or adding a public write route |
| 2026-03-27 | `/diagnostics/providers` now also exposes additive per-target `metering` snapshots from the shared runtime-owned metering service so operators can distinguish compatibility/setup drift from recent rate-limit incidents and active cooldown/block guardrails without changing the compatibility cache or adding a second route |
| 2026-03-27 | Retained CLI compatibility evidence now has the same bounded latest-artifact read model on `/diagnostics/providers` and `/providers/config`, so hosts can inspect the most recent degraded parser/profile evidence without shelling out to manual list/read commands or adding a new route |
| 2026-03-27 | OpenCode compatibility follow-through now validates the same `models --help` seam that the shared model-catalog service uses for dynamic `opencode models` discovery, so live diagnostics can distinguish a healthy native-session install from one that lacks the runtime-owned model-listing contract |
| 2026-03-27 | Host-facing retained compatibility evidence follow-through landed on the diagnostics surface: `GET /diagnostics/providers/evidence` now lists bounded redacted compatibility bundles with provider/instance/classification/parser/profile/runtime filters, and `GET /diagnostics/providers/evidence/:artifactId` re-reads a specific retained artifact without forcing operators back to the CLI-only list/read flow |
| 2026-03-27 | Host-facing explicit re-probe follow-through also landed: `POST /diagnostics/providers/reprobe` now runs a forced compatibility refresh for selected targets with optional `light`/`live` mode, so operators no longer need to overload `GET /diagnostics/providers?force=1` for write-like reprobe actions |
| 2026-03-27 | MCP read-model follow-through landed for retained compatibility evidence: `list_compatibility_evidence_artifacts` and `read_compatibility_evidence_artifact` now reuse the same bounded diagnostics list/read surfaces and filters over HTTP JSON-RPC and stdio, so orchestrator-style hosts can inspect degraded parser/profile evidence without shelling out to CLI helpers or inventing an MCP-only evidence path |
| 2026-03-27 | MCP write follow-through also landed for explicit compatibility refresh: `reprobe_provider_diagnostics` now reuses `POST /diagnostics/providers/reprobe` over HTTP JSON-RPC and stdio, so orchestrator-style hosts can request a bounded forced refresh without overloading the read-only diagnostics tool or inventing a second reprobe path |
| 2026-03-28 | Backlog reality check: phases 1-4 are now effectively complete. The remaining plan work is limited to optional breadth expansion for new provider families, a possible future move from TypeScript-owned manifests into runtime-owned assets, and deeper coupling of rate-limit/metering knowledge back into the compatibility engine itself. |
| 2026-04-08 | Selector-hot-path follow-through landed: `GET /diagnostics/providers?scope=availability` now reuses `collectProviderDiagnostics(..., { includeArtifacts: false })`, preserves cheap top-level `probe`/`summary` context, strips per-target operator-grade decoration down to target identity plus `availability`, and gives truthful selector callers a lighter read model without inventing a second truth stack. |

---

*Created: 2026-03-23*
*Author: Codex*
*Last updated: 2026-04-08*
