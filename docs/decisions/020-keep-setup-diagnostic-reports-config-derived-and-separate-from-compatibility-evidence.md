# ADR-020: Keep Setup Diagnostic Reports Config-Derived and Separate from Compatibility Evidence

> Runtime-owned setup diagnostic reports should resolve paths from runtime
> configuration and remain a distinct operator-facing artifact from
> compatibility evidence bundles.

## Status

Accepted

## Date

2026-03-25

## Context

`cats-runtime` already owns lightweight provider setup and diagnostics, as
recorded in ADR-014, and it already persists compatibility evidence bundles for
provider readiness and replay-oriented maintenance.

Bootstrap planning later clarified a stronger standalone setup model:

- provider universe is runtime-owned knowledge and does not depend on config
- machine detection is runtime-owned discovery state and does not depend on
  config
- enabled config is operator intent stored in `providers.yaml`

That matters here because setup-time diagnostics should primarily aggregate the
first two layers and remain usable even when enabled config is missing or
invalid.

Recent research on a setup diagnostic report identified a valuable missing
feature: a shareable, one-shot report that helps users debug environment and
installation problems even when the runtime cannot finish normal server startup.

That same research also surfaced two incorrect assumptions that need to be
closed at the architecture level:

- report and evidence storage was described as if it always lived under
  `~/.cats-runtime/...`
- compatibility evidence was described as "signed artifacts" even though the
  current implementation persists unsigned JSON bundles

Current repo reality is:

- runtime-owned artifact paths are derived from runtime config such as `dataDir`
  and fallback path resolution, not from a fixed home-directory convention
- compatibility evidence is a runtime-maintenance artifact for review and replay
- no artifact-signing contract exists today

In this ADR, "config-derived" applies to path resolution and artifact
placement. It does not mean the report content requires a valid
`providers.yaml`; setup-time diagnostics must still work when enabled config is
missing or invalid.

The setup report feature needs a clear boundary before implementation starts.

## Decision

`cats-runtime` setup diagnostic reports will follow these rules:

1. Setup diagnostic reports are runtime-owned artifacts, but they are distinct
   from compatibility evidence bundles.
2. Setup diagnostic reports are bounded setup-time debug artifacts, not a
   general streaming logging subsystem.
3. Report output paths must be resolved from runtime configuration:
   - use configured `dataDir` when present
   - otherwise use the same runtime fallback resolution pattern as other
     runtime-owned artifacts
4. The first implementation must not hardcode storage under `~/.cats-runtime`.
5. The first implementation keeps setup report artifacts as unsigned JSON.
6. Compatibility evidence bundles remain separate artifacts used for runtime
   maintenance, replay, and compatibility debugging.
7. Setup reports may reference related evidence bundles, but they do not replace
   the evidence bundle format.
8. Setup diagnostic services should be reusable from bootstrap/setup flows,
   future headless adapters, host-managed onboarding, and optional post-startup
   actions instead of creating a separate first-run stack.
9. `SetupDiagnosticService` should act as an aggregation/output consumer of the
   shared bootstrap/setup services rather than becoming a parallel detection
   subsystem.
10. `SetupDiagnosticService` is not itself the bootstrap core service layer; it
    is an upper-layer projection over bootstrap core services.
11. The report feature does not own first-run detection by itself; bootstrap or
   host setup flows decide when to invoke it.
12. Runtime-owned setup scan snapshots under `data/setup/` remain separate from
    operator-facing setup reports under `data/diagnostics/`.
13. When current setup scan snapshots already exist, setup diagnostic reports
    should reuse or reference those snapshots instead of creating a second raw
    detection artifact stream under diagnostics.
14. Any future signing, verification, or attestation model for either artifact
   type requires a separate ADR and implementation.

## Consequences

### Positive

- aligns the feature with current runtime config and packaging reality
- avoids baking a false home-directory contract into future setup tooling
- keeps operator-facing reports and maintainer-facing evidence bundles from
  collapsing into one confused artifact type
- keeps setup diagnostics aligned with the newer bootstrap/service-layer model
- keeps raw machine-detection state and operator-facing report output from
  diverging into parallel artifacts
- keeps the first implementation smaller and easier to land

### Negative

- documentation and hosts must understand two related artifact types
- bootstrap/setup code now needs to integrate one more reusable service
- future signing work remains deferred
- first-run logic must be implemented carefully against resolved runtime paths

### Neutral

- this ADR does not choose the exact CLI flag or HTTP action shape
- this ADR does not require a CLI setup adapter in the first bootstrap slice
- this ADR does not prevent future artifact signing
- this ADR does not require the report format to be identical across all hosts,
  only that the runtime-owned artifact contract stays clear

## Alternatives Considered

### Alternative 1: Hardcode Setup Reports Under `~/.cats-runtime`

- **Pros**: easy to explain in examples
- **Cons**: conflicts with configurable runtime data paths and standalone/host
  deployment flexibility
- **Why rejected**: it would document the wrong contract

### Alternative 2: Reuse Compatibility Evidence Bundles as the Setup Report

- **Pros**: fewer artifact types
- **Cons**: evidence bundles serve a different maintenance/replay purpose and
  are not the right operator-facing shape
- **Why rejected**: it blurs report intent and makes redaction/UX boundaries
  messier

### Alternative 3: Add Artifact Signing in the First Slice

- **Pros**: stronger trust story
- **Cons**: adds scope and implementation complexity before the basic report
  feature exists
- **Why rejected**: the current runtime has no signing contract to extend yet

## References

- [ADR-014](./014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [SPEC-007](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md)
- [SPEC-015](../specs/SPEC-015-runtime-setup-diagnostic-report.md)
- [ADR-021](./021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it.md)
- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [Research: First-Run Setup Diagnostic Report](../research/2026-03-24-setup-diagnostic-report.md)
- [ProviderCompatibilityService](../../src/core/compatibility/ProviderCompatibilityService.ts)

---

*Accepted: 2026-03-25*
*Decision makers: user + Codex*
