# PLAN-008: Provider Compatibility and Evidence Engine

> Implementation plan for the first shipped slice of `SPEC-007`, focused on
> CLI-backed provider compatibility, replay-friendly evidence capture, and one
> shared runtime-owned compatibility engine consumed by diagnostics and
> execution.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Compatibility Core and Manual Probe Slices Landed) |
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

### Out of Scope

- runtime-owned usage metering or rate-limit policy
- rewriting every provider adapter into a pure declarative parser system
- making evidence analysis depend on an LLM in the hot path
- broad UI/dashboard redesign beyond surfacing the new contract
- turning `cats-runtime` into an installer executor

## Implementation Phases

### Phase 1: Knowledge Base and Core Contracts

- [ ] Add shared compatibility types under `src/core/compatibility`
- [ ] Define the provider-family manifest/profile shape
- [ ] Encode first-wave compatibility knowledge for major CLI families
- [ ] Add a fingerprint result shape that can represent:
      - version known / unknown
      - runtime mode
      - command resolution
      - observed output/protocol signature
      - detected feature hints
- [ ] Define normalized result classes:
      - `ready`
      - `degraded`
      - `unsupported_version`
      - `unrecognized_protocol`
      - `probe_failed`

**Deliverables**: one runtime-owned compatibility vocabulary and manifest
direction that providers, diagnostics, and tests can share.

### Phase 2: Probe, Fingerprint, and Evidence Capture

- [ ] Add a compatibility service that can probe a resolved provider target
- [ ] Support version lookup and runtime-aware command probing without assuming
      version data is always available
- [ ] Add protocol/signature fallback when version is unavailable or ambiguous
- [ ] Add evidence capture helpers that persist redacted JSON bundles under a
      runtime-owned evidence directory
- [ ] Make evidence bundles include enough data for replay/regression fixtures:
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

- [ ] Route CLI diagnostics through the shared compatibility service instead of
      route-local ad hoc checks
- [ ] Reuse the same service before CLI execution/spawn so runtime turns do not
      bypass compatibility selection
- [ ] Feed the selected profile and classification into provider construction
      without rewriting every adapter
- [ ] Expose re-probe-friendly semantics:
      - cache reuse for normal paths
      - explicit force refresh from diagnostics/API query when requested
      - automatic refresh when cached compatibility is stale or missing

**Deliverables**: one compatibility engine shared by diagnostics and execution.

### Phase 4: Public Contract, Docs, and Regression Coverage

- [ ] Extend the diagnostics/provider route payloads with machine-readable
      compatibility metadata and degraded-path explanations
- [ ] Add targeted unit tests for:
      - profile selection
      - version/fingerprint fallback
      - evidence redaction and persistence
      - replay from captured bundles/fixtures
- [ ] Add integration tests for diagnostics and session execution behavior
- [ ] Update `docs/api.md`, `docs/architecture.md`, and `docs/setup-guide.md`
- [ ] Update `PROGRESS.md` with the delivered compatibility/evidence slice

**Deliverables**: shipped contract, replay foundation, and synchronized docs.

### Phase 5: Deferred Follow-Ons

- [ ] Expand first-class manifests and live probes for more provider families
- [ ] Add host-facing explicit re-probe/write-back APIs beyond query-flag
      refresh
- [ ] Revisit whether compatibility knowledge should move from TypeScript-owned
      manifests into runtime-owned config assets or a hybrid split
- [x] Add offline evidence triage tooling and review workflow helpers
- [ ] Layer future rate-limit/metering detection onto the same compatibility
      knowledge base without coupling the initial slice

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
| `tests/*` | Modify/Create | Compatibility, evidence, diagnostics, and execution regressions |
| `config/providers.yaml.example` | Modify | Document compatibility/evidence-related config where relevant |
| `docs/api.md` | Modify | Document compatibility payloads and re-probe semantics |
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

## Testing Strategy

- **Unit Tests**:
  - provider fingerprint normalization
  - profile ranking and fallback selection
  - classification mapping
  - evidence redaction and artifact naming
  - replay from captured evidence fixtures
- **Integration Tests**:
  - diagnostics route compatibility payloads
  - default-target aggregate health behavior with compatibility states
  - CLI session spawn behavior when compatibility is `ready`, `degraded`, or
    unsupported
- **Manual Testing**:
  - run `GET /diagnostics/providers` with and without `force=1`
  - inspect emitted evidence bundles after a forced mismatch/failure
  - verify first-wave providers still spawn normally on known-good configs

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Compatibility service becomes a second parser stack parallel to adapters | High | Keep adapters authoritative for stream parsing and use profiles to select/parameterize them |
| Probe latency slows normal runtime paths | Medium | Cache compatibility results and keep probe commands short/timeout-bound |
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
| 2026-03-27 | Core compatibility delivery is now complemented by manual provider-evolution follow-through: transport-neutral evidence collection, retained baseline-compare artifacts with review summaries, CLI/manual artifact list-read flows, and additive latest-artifact summaries on `/diagnostics/providers` and `/providers/config` all reuse the same runtime-owned compatibility substrate |
| 2026-03-27 | Offline evidence triage follow-through landed for retained provider-evolution artifacts: repeated `--probe-classification` filters now let operators focus list/read flows on `upgrade`, `regression`, `schema_change`, or `semantic_drift_suspected` review classes without adding a new host-facing probe route |
| 2026-03-27 | Manual review workflow helpers now let operators update retained provider-evolution artifact classifications, summary text, highlights, and external references in place via CLI without rerunning a probe or adding a public write route |
| 2026-03-27 | `/diagnostics/providers` now also exposes additive per-target `metering` snapshots from the shared runtime-owned metering service so operators can distinguish compatibility/setup drift from recent rate-limit incidents and active cooldown/block guardrails without changing the compatibility cache or adding a second route |

---

*Created: 2026-03-23*
*Author: Codex*
*Last updated: 2026-03-27*
