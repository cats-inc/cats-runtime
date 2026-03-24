# Research Log: First-Run Setup Diagnostic Report

Date: 2026-03-24
Topic: Dedicated logging mechanism for first-time installation and environment debugging
Last updated: 2026-03-25

## Sources

- Internal architecture review: `src/core/compatibility/ProviderCompatibilityService.ts`
- Internal startup flow: `src/index.ts`, `src/startup.ts`, `src/server.ts`
- Internal discovery: `src/backends/cli/discovery/wslDiscovery.ts`, `dockerDiscovery.ts`
- Internal config: `src/core/config.ts`, `src/backends/cli/config.ts`
- Internal diagnostics: `src/http/routes/diagnostics.ts`
- Existing diagnostics ADR/spec context:
  - `docs/decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md`
  - `docs/specs/SPEC-007-provider-compatibility-and-evidence-engine.md`

## Problem Statement

When users install `cats-runtime` directly, or consume it from a host such as
`cats`, they can hit environment failures before the HTTP server is usable:

- provider CLIs missing from `PATH`
- WSL distros stopped or inaccessible
- Docker unavailable
- wrong Node.js version
- malformed provider config
- unwritable data/session paths
- port conflicts

The current diagnostics are mostly HTTP-facing, so they are not enough when the
server fails to start. The runtime does already persist compatibility evidence,
but those bundles are runtime-maintenance artifacts, not a dedicated shareable
setup report.

## Current State

- **No logging library**: the project still intentionally uses direct
  stdout/stderr and lightweight structured runtime events.
- **Compatibility probing already exists**: `ProviderCompatibilityService`
  probes provider executables, versions, help tokens, auth state, and related
  readiness facts.
- **Evidence is already persisted**: compatibility evidence is written as
  redacted JSON bundles under a config-derived evidence directory, not a fixed
  home-directory path.
- **Evidence is not signed today**: the current implementation writes JSON
  payloads for review and replay; there is no artifact-signing contract yet.
- **No human-oriented setup snapshot exists**: there is still no one-shot report
  that combines platform facts, dependency probes, and config validation into a
  single shareable document.

## Reality Check Against Current Repo

### Storage Must Follow Runtime Config, Not `~/.cats-runtime`

The compatibility evidence directory is derived from runtime config:

- `options.evidenceDir`, if explicitly provided
- otherwise `config.dataDir`
- otherwise a fallback derived from `sessionBaseDir`

The setup report should follow the same rule and resolve its output under the
runtime's data directory, not under a hardcoded `~/.cats-runtime/...` path.

### Evidence Bundles and Setup Reports Are Different Artifacts

Compatibility evidence bundles are for runtime maintenance and regression
replay. A setup diagnostic report should be:

- more human-readable
- explicitly redacted for sharing
- broader than provider probes alone
- generated on demand or on first-run conditions

The report may reference compatibility evidence, but it should not pretend that
the evidence bundle itself is already the final operator-facing artifact.

### First-Run Detection Needs a Runtime-Owned Marker

Detecting first run via "absence of `~/.cats-runtime/`" is too brittle because
the runtime data path is configurable. First-run or onboarding detection should
instead use:

- a marker/report state under the resolved runtime data directory, or
- an explicit host-managed signal

## Proposed Design: Setup Diagnostic Report

A one-shot environment scan that produces a shareable, machine-parseable JSON
report. This is not a streaming log. It is a bounded snapshot designed for
setup and troubleshooting.

### Trigger Mechanisms

- **Auto on first run**: based on a runtime-owned marker or missing setup report
  state under the resolved runtime data directory
- **Manual CLI**: `cats-runtime diagnose` or equivalent entrypoint that can run
  without starting the HTTP server
- **Host-managed invocation**: `cats` or another consumer may call the same
  service during onboarding
- **Explicit HTTP action**: if exposed over HTTP after startup, use an explicit
  action endpoint that is allowed to write a report artifact

### Report Content — Three Layers

**Layer 1 — Platform Snapshot**

- Node.js version, `process.arch`, `process.platform`
- npm version and global prefix
- selected environment/path facts
- resolved runtime data/session paths
- basic disk/path writability facts

**Layer 2 — Runtime Dependency Probes**

Reuses existing compatibility and discovery logic where possible:

- configured provider readiness
- command presence and version facts
- auth/readiness summary
- WSL discovery summary
- Docker availability summary
- git availability summary

**Layer 3 — Configuration Validation**

- parseability of runtime config files
- provider instance count and obvious config errors
- port availability checks
- writability of runtime-owned directories

### Output Location

```text
<resolved runtime dataDir>/diagnostics/
  setup-report-YYYY-MM-DDTHH-mm-ss.json
```

If `dataDir` is not explicitly configured, the report path should use the same
fallback resolution pattern as other runtime-owned artifacts.

### Output Model

The report should include:

- generation metadata
- runtime version and resolved path context
- layered probe/config results
- a normalized issues list with severity and code
- redacted references to any related compatibility evidence bundles

### Sensitive Data Redaction

Reports are intended to be shareable:

- API keys and auth tokens are never written verbatim
- environment variable values are reduced to presence/absence or safe summaries
- user-specific path segments should be normalized where practical
- provider evidence references should point to artifacts without copying secret
  contents back into the report

### Separation from Compatibility Evidence

- setup reports are operator-facing diagnostic artifacts
- compatibility evidence bundles remain runtime-maintenance artifacts
- both artifact types may live under the runtime data directory
- both remain unsigned JSON artifacts for now
- any future artifact signing would require a separate ADR and implementation

### Implementation Direction

```text
src/core/diagnostics/
  SetupDiagnosticService.ts
  platformSnapshot.ts
  dependencyProbes.ts
  configValidation.ts
  reportWriter.ts
```

### Integration Points

- reuse `ProviderCompatibilityService`
- reuse WSL and Docker discovery helpers where appropriate
- add a manual CLI/entrypoint path that does not require server startup
- optionally expose an explicit HTTP action for on-demand regeneration after
  startup

## Design Decisions

- **Snapshot, not streaming log**: setup failures are easier to share and reason
  about as a point-in-time report
- **Config-derived storage**: artifact locations must follow runtime config
- **Redaction by default**: reports should be safe to attach to issue reports
- **Separate artifact roles**: do not collapse compatibility evidence bundles
  and setup reports into one artifact type
- **Unsigned JSON for now**: keep the first slice simple and aligned with the
  current evidence engine

## Effort Estimate

- platform snapshot: small
- dependency probes wrapper: medium
- config validation: small
- report writer and redaction: small
- CLI integration: small
- optional HTTP action: small
- total first slice: roughly 3-4 days

## Follow-Through Documents

- [SPEC-015](../specs/SPEC-015-runtime-setup-diagnostic-report.md)
- [ADR-020](../decisions/020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence.md)

## Action Items

- [x] Replace hardcoded `~/.cats-runtime` assumptions with config-derived
      runtime paths
- [x] Replace "signed artifacts" wording with current unsigned JSON reality
- [x] Draft SPEC-015 for the feature boundary
- [ ] Decide whether the CLI path should also print a concise human summary
- [ ] Decide retention/cleanup policy for generated reports
- [ ] Decide the exact HTTP action shape if an on-demand route is added

---

Logged by: Claude
Reality-checked and updated by: Codex
