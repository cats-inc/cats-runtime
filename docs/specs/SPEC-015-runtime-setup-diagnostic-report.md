# SPEC-015: Runtime Setup Diagnostic Report

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User / runtime workstream |

## Summary

`cats-runtime` already owns provider readiness, compatibility probing, and
standalone diagnostics surfaces. It still lacks a bounded, shareable setup
report that works even when the HTTP server cannot start.

This spec defines a runtime-owned setup diagnostic report feature that:

- runs without requiring the normal server startup path
- resolves artifact paths from runtime config rather than a hardcoded home dir
- reuses the existing compatibility and discovery engine where possible
- emits a redacted operator-facing report distinct from compatibility evidence
  bundles

## Goals

- provide a one-shot setup and environment report for standalone runtime users
- let product hosts trigger the same diagnostic capability during onboarding
- reuse runtime-owned compatibility and discovery logic instead of duplicating
  probe code
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

## Requirements

### Functional Requirements

1. `cats-runtime` shall support an explicit diagnostic entry path that can run
   without starting the normal HTTP server.
2. The runtime may also expose an explicit post-startup action for regenerating
   the same report after the server is running.
3. The report output directory shall be resolved from runtime configuration:
   - use a configured `dataDir` when present
   - otherwise use the same fallback pattern as other runtime-owned artifacts
4. The setup report shall be written under:
   - `<resolved dataDir>/diagnostics/`
5. The runtime shall support a first-run detection mechanism that is based on:
   - runtime-owned marker/report state under the resolved data directory, or
   - an explicit host-managed signal
   The feature shall not rely on absence of `~/.cats-runtime/`.
6. The report shall include a platform snapshot layer with:
   - runtime version
   - process/platform architecture facts
   - resolved runtime path facts
   - basic writability or filesystem checks
7. The report shall include a dependency probe layer that reuses runtime-owned
   compatibility and discovery logic where practical, including:
   - configured provider readiness summaries
   - command presence/version facts
   - WSL discovery summary where supported
   - Docker summary where supported
   - git summary where supported
8. The report shall include a configuration validation layer with:
   - config parse status
   - provider instance counts or obvious config errors
   - port availability checks
   - runtime-owned path validation
9. The report shall emit a normalized issues list with stable codes and
   severities.
10. The report shall be explicitly redacted for sharing.
11. The feature shall keep setup reports separate from compatibility evidence
    bundles.
12. The report may include references to related compatibility evidence bundles,
    but shall not duplicate sensitive evidence content into the report.
13. Setup report artifacts shall be JSON and unsigned in the first slice.
14. The runtime shall tolerate partial success:
    - one failed probe shall not prevent writing the overall report
    - failed sections shall still produce structured issue entries
15. The CLI-triggered or startup-triggered path should print a concise summary
    to stdout/stderr while still writing the full report artifact.
16. The feature should support bounded retention or cleanup of older setup
    reports under the diagnostics directory.

### Non-Functional Requirements

- **Safety**: reports must redact secrets and tokens by default
- **Portability**: report generation must work with the same runtime config
  model used for standalone and host-managed startup
- **Maintainability**: probe logic should primarily reuse existing runtime-owned
  compatibility/discovery helpers
- **Operability**: report artifacts should be easy to locate and share

## Design Overview

```text
manual CLI / first-run hook / host action / HTTP action
                        |
                        v
              SetupDiagnosticService
                        |
      +-----------------+-----------------+
      |                 |                 |
      v                 v                 v
platform snapshot   dependency probes   config validation
      \                 |                 /
       \                |                /
        +---------------+---------------+
                        |
                        v
             redacted JSON report writer
                        |
                        v
        <resolved dataDir>/diagnostics/setup-report-*.json
```

The runtime should reuse `ProviderCompatibilityService` and related discovery
helpers for provider/dependency facts. The setup report is an operator-facing
aggregation layer above those lower-level signals.

## Artifact Model

The setup report and compatibility evidence bundles are related but distinct:

- compatibility evidence bundles support runtime maintenance and replay
- setup reports support operator troubleshooting and host onboarding

The setup report may contain:

- stable issue codes
- summarized readiness state
- references to supporting compatibility evidence artifact paths or IDs

The setup report should not become the new canonical evidence fixture format.

## Dependencies

- [ADR-014](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [SPEC-007](./SPEC-007-provider-compatibility-and-evidence-engine.md)
- [Research: First-Run Setup Diagnostic Report](../research/2026-03-24-setup-diagnostic-report.md)

## Open Questions

- [ ] Should the HTTP-triggered rescan be `POST /diagnostics/setup-report` or a
      different explicit action path?
- [ ] Should the CLI path emit a short text summary, a JSON summary, or both to
      stdout?
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
*Related Plan: TBD*
