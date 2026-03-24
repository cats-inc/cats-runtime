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

The setup report feature needs a clear boundary before implementation starts.

## Decision

`cats-runtime` setup diagnostic reports will follow these rules:

1. Setup diagnostic reports are runtime-owned artifacts, but they are distinct
   from compatibility evidence bundles.
2. Report output paths must be resolved from runtime configuration:
   - use configured `dataDir` when present
   - otherwise use the same runtime fallback resolution pattern as other
     runtime-owned artifacts
3. The first implementation must not hardcode storage under `~/.cats-runtime`.
4. The first implementation keeps setup report artifacts as unsigned JSON.
5. Compatibility evidence bundles remain separate artifacts used for runtime
   maintenance, replay, and compatibility debugging.
6. Setup reports may reference related evidence bundles, but they do not replace
   the evidence bundle format.
7. First-run detection or setup-report marker state must live under the resolved
   runtime data directory or come from an explicit host-managed signal.
8. Any future signing, verification, or attestation model for either artifact
   type requires a separate ADR and implementation.

## Consequences

### Positive

- aligns the feature with current runtime config and packaging reality
- avoids baking a false home-directory contract into future setup tooling
- keeps operator-facing reports and maintainer-facing evidence bundles from
  collapsing into one confused artifact type
- keeps the first implementation smaller and easier to land

### Negative

- documentation and hosts must understand two related artifact types
- future signing work remains deferred
- first-run logic must be implemented carefully against resolved runtime paths

### Neutral

- this ADR does not choose the exact CLI flag or HTTP action shape
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
- [Research: First-Run Setup Diagnostic Report](../research/2026-03-24-setup-diagnostic-report.md)
- [ProviderCompatibilityService](../../src/core/compatibility/ProviderCompatibilityService.ts)

---

*Accepted: 2026-03-25*
*Decision makers: user + Codex*
