# SPEC-015: Runtime Setup Diagnostic Report

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Owner** | Codex |
| **Reviewer** | User / runtime workstream |

## Summary

`cats-runtime` already owns provider readiness, compatibility probing, and
standalone diagnostics surfaces. It still lacks a bounded, shareable setup
report that works even when the HTTP server cannot start.

This spec defines a runtime-owned setup diagnostic report feature that:

- runs without requiring the normal server startup path
- integrates with standalone bootstrap and repair flows instead of creating a
  separate first-run stack
- resolves artifact paths from runtime config rather than a hardcoded home dir
- reuses the existing compatibility and discovery engine where possible
- emits a redacted operator-facing report distinct from compatibility evidence
  bundles

## Goals

- provide a one-shot setup and environment report for standalone runtime users
- let product hosts trigger the same diagnostic capability during onboarding
- reuse runtime-owned compatibility and discovery logic instead of duplicating
  probe code
- keep the report aligned with the standalone bootstrap service layer and
  provider-setup direction
- keep report storage and retention aligned with runtime-owned `dataDir`
- make reports safe to share by default through redaction

## Non-Goals

- introducing a general-purpose logging subsystem
- replacing compatibility evidence bundles or replay fixtures
- hardcoding report output under `~/.cats-runtime`
- adding artifact signing in the first slice
- moving packaged host onboarding UX into `cats-runtime`

## User Stories

- As a standalone runtime operator, I want a setup report even when the server
  cannot start so that I can debug environment issues.
- As a host product, I want to invoke one runtime-owned diagnostic flow instead
  of rebuilding provider checks locally.
- As a maintainer, I want setup reports to reference compatibility evidence
  without conflating the two artifact types.

## Relationship to Bootstrap

This feature is part of the broader standalone setup story defined later in
bootstrap work. The setup diagnostic report is a bounded setup-time debug
artifact, not a separate onboarding system and not a general streaming log.

It should align with the same three-layer model:

1. **Provider universe**
   - runtime-owned knowledge about supported providers and checks
2. **Machine detection**
   - runtime-owned scan/probe results for the current machine
3. **Enabled config**
   - operator intent persisted in `providers.yaml`

The diagnostic report primarily aggregates the first two layers and then adds
config validation facts when enabled config exists or fails to parse. It must
remain usable even when enabled config is missing or invalid.

## Service Role Split

To avoid a parallel first-run stack, the service roles are:

- **bootstrap core services**
  - provider-universe read model
  - machine-detection/probe orchestration
  - setup-state persistence
  - enabled-config generation
- **`SetupDiagnosticService`**
  - consumes bootstrap core services
  - adds platform snapshot and config validation
  - applies redaction and report formatting
  - writes operator-facing setup reports under `data/diagnostics/`

`SetupDiagnosticService` may request a refresh through the shared
machine-detection service when needed, but it does not own the raw detection
subsystem or the canonical setup scan snapshot format.

## Requirements

### Functional Requirements

1. `cats-runtime` shall support an explicit diagnostic entry path that can run
   without starting the normal HTTP server.
2. The report generator shall be implemented as a shared runtime-owned setup
   aggregation/output service that can be reused by bootstrap/setup flows,
   future headless adapters, host-managed setup, and optional post-startup
   actions.
3. `SetupDiagnosticService` shall consume shared bootstrap/setup services for
   provider-universe knowledge, machine detection, and setup-state access; it
   shall not define a parallel machine-detection core.
4. The runtime may also expose an explicit post-startup action for regenerating
   the same report after the server is running.
5. The report output directory shall be resolved from runtime configuration:
   - use a configured `dataDir` when present
   - otherwise use the same fallback pattern as other runtime-owned artifacts
6. The setup report shall be written under:
   - `<resolved dataDir>/diagnostics/`
7. Bootstrap/setup flows may choose to trigger report generation based on
   runtime-owned setup state under the resolved data directory or an explicit
   host-managed signal. The report feature itself shall not rely on absence of
   `~/.cats-runtime/` and shall not become the sole owner of first-run
   detection.
8. The report shall include a platform snapshot layer with:
   - runtime version
   - process/platform architecture facts
   - resolved runtime path facts
   - basic writability or filesystem checks
9. The report shall include a dependency probe layer that reuses runtime-owned
   compatibility and discovery logic where practical, including:
   - provider-universe and machine-detection-based readiness summaries
   - configured-target readiness summaries when enabled config exists
   - command presence/version facts
   - WSL discovery summary where supported
   - Docker summary where supported
   - git summary where supported
10. The dependency probe layer shall remain usable when enabled config is
   missing, partial, or invalid.
11. The report shall include a configuration validation layer with:
   - config parse status
   - provider instance counts or obvious config errors
   - port availability checks
   - runtime-owned path validation
12. When a current runtime-owned scan snapshot is already available under
    `data/setup/`, the report generator should reuse or reference that snapshot
    instead of maintaining a separate raw detection artifact under
    `data/diagnostics/`.
13. The report shall emit a normalized issues list with stable codes and
   severities.
14. The report shall be explicitly redacted for sharing.
15. The feature shall keep setup reports separate from compatibility evidence
    bundles.
16. The report may include references to related compatibility evidence bundles,
    but shall not duplicate sensitive evidence content into the report.
17. Setup report artifacts shall be JSON and unsigned in the first slice.
18. The runtime shall tolerate partial success:
    - one failed probe shall not prevent writing the overall report
    - failed sections shall still produce structured issue entries
19. The feature should support bounded retention or cleanup of older setup
    reports under the diagnostics directory.
20. The setup report artifact shall remain distinct from bootstrap scan
    snapshots under `data/setup/`; reports are operator-facing summary artifacts
    while setup snapshots remain runtime-owned discovery state.

### Non-Functional Requirements

- **Safety**: reports must redact secrets and tokens by default
- **Portability**: report generation must work with the same runtime config
  model used for standalone and host-managed startup
- **Maintainability**: probe logic should primarily reuse existing runtime-owned
  compatibility/discovery helpers and shared bootstrap/setup services
- **Operability**: report artifacts should be easy to locate and share

## Design Overview

```text
bootstrap flow / host action / optional CLI / HTTP action
                          |
                          v
         shared bootstrap/setup services
   (provider universe + machine detection + setup state)
                          |
                          v
                SetupDiagnosticService
      (aggregation + redaction + report writing)
                          |
      +-------------------+-------------------+
      |                   |                   |
      v                   v                   v
platform snapshot   scan snapshot reuse   config validation
   / env facts       or probe refresh      and issues model
                          |
                          v
        <resolved dataDir>/diagnostics/setup-report-*.json
```

The runtime should reuse `ProviderCompatibilityService` and related discovery
helpers for provider/dependency facts. `SetupDiagnosticService` is an
operator-facing aggregation/output layer above those lower-level signals and
should plug into the same shared setup/bootstrap service layer used by
standalone bootstrap instead of becoming a parallel detection system.

## Artifact Model

The setup report and compatibility evidence bundles are related but distinct:

- compatibility evidence bundles support runtime maintenance and replay
- setup reports support operator troubleshooting and host onboarding
- setup scan snapshots under `data/setup/` support bootstrap resumption and
  shared runtime discovery state

The setup report may contain:

- stable issue codes
- summarized readiness state
- references to supporting compatibility evidence artifact paths or IDs
- references to the scan snapshot used or refreshed for this report, when
  applicable
- additive runtime-owned read surfaces may list retained report summaries and
  fetch a specific retained report by `artifactId` without changing the on-disk
  report format

The setup report should not become the new canonical evidence fixture format.

## Implementation Tracking

- Slice 1 of this spec landed directly through the bootstrap/setup workstream
  before a dedicated follow-through plan existed.
- The follow-through that was later collected under
  [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md),
  is now complete, while `PROGRESS.md` / `ROADMAP.md` still carry the broader
  bootstrap/setup status outside this spec's bounded report contract.
- Setup reports and `GET /setup-state` now reuse the same repair-summary truth,
  and the non-server CLI path now surfaces that same next-action guidance
  without inventing a second setup stack.
- Packaged host aggregation work tracked in
  [cats-platform ADR-047](../../../cats-platform/docs/decisions/047-separate-bootstrap-diagnostics-by-layer-and-aggregate-in-the-host.md)
  and
  [cats-platform SPEC-045](../../../cats-platform/docs/specs/SPEC-045-cross-layer-bootstrap-and-onboarding-diagnostics.md)
  consumes these retained setup-report summaries and references as
  runtime-owned truth.
- That packaged aggregation direction does not currently require a new
  runtime-owned event/history route for setup diagnostics; first-slice
  chronology may still be derived by the host from existing runtime state
  transitions plus retained report timestamps or summaries.
- Remaining follow-through stays additive and coordinated with broader
  bootstrap/UI work; it does not depend on a shared-UI redesign to keep setup
  report truth accurate.

## Dependencies

- [ADR-014](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR-020](../decisions/020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence.md)
- [ADR-021](../decisions/021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it.md)
- [SPEC-007](./SPEC-007-provider-compatibility-and-evidence-engine.md)
- [SPEC-017](./SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [cats-platform ADR-047](../../../cats-platform/docs/decisions/047-separate-bootstrap-diagnostics-by-layer-and-aggregate-in-the-host.md)
- [cats-platform SPEC-045](../../../cats-platform/docs/specs/SPEC-045-cross-layer-bootstrap-and-onboarding-diagnostics.md)
- [Research: First-Run Setup Diagnostic Report](../research/2026-03-24-setup-diagnostic-report.md)

## Open Questions

- [ ] If a future CLI adapter is added, should it emit a short text summary, a
      JSON summary, or both to stdout?
- [ ] What retention policy should apply to older setup reports?
- [ ] Should setup reports reference compatibility evidence by absolute path,
      relative path, or generated artifact ID?

## References

- [API](../api.md)
- [Architecture](../architecture.md)
- [ADR-014](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [SPEC-007](./SPEC-007-provider-compatibility-and-evidence-engine.md)
- [ProviderCompatibilityService](../../src/core/compatibility/ProviderCompatibilityService.ts)
- [Research log](../research/2026-03-24-setup-diagnostic-report.md)

---

*Created: 2026-03-25*
*Author: Codex*
*Last updated: 2026-04-04*
*Related Plan: [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md) (follow-through plan; slice 1 was implemented directly)*
