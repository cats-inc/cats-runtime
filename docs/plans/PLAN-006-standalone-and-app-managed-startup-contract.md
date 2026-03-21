# PLAN-006: Standalone and App-Managed Startup Contract

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | Human review pending |

## Related Spec

N/A. This plan implements
[ADR-009](../decisions/009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup.md)
and aligns with existing runtime-boundary ADRs.

## Overview

`cats-runtime` already has the right high-level role: it is the runtime
boundary above provider-specific execution details and below product apps such
as `cats-inc`.

What it does not yet have is a sufficiently explicit startup contract for both
of the modes now required by product direction:

- **standalone mode** for direct local development, debugging, and independent
  operators
- **app-managed local mode** for hosts such as `cats-inc` or a future Electron
  shell that want to supervise `cats-runtime` as a child process

This plan formalizes the process-level contract needed for those two modes to
coexist without collapsing the runtime into product-app internals.

## Goals

1. Preserve `cats-runtime` as a separately packageable runtime boundary.
2. Make standalone startup explicit, predictable, and well-documented.
3. Make app-managed child-process startup explicit, predictable, and
   supervisor-friendly.
4. Keep product hosts on the process and HTTP boundary rather than
   source-importing runtime internals for production usage.
5. Clarify config, readiness, logging, data-dir, and shutdown behavior for both
   modes.

## Non-Goals for This Slice

- Merging `cats-runtime` into `cats-inc`
- Replacing the public HTTP contract with a different transport
- Reworking provider backends as part of the startup-contract work
- Shipping the Electron wrapper itself
- Solving every installer/distribution format in the same phase

## Phases

### Phase 1: Startup Contract Freeze

- [x] Freeze the supported runtime startup modes:
      - direct standalone invocation
      - child-process app-managed invocation
- [x] Define required and optional environment variables, config-file
      resolution, and data-dir ownership rules for each mode.
- [x] Define readiness semantics:
      - which endpoint is authoritative
      - what "ready" means versus "process started"
- [x] Define shutdown semantics and signal handling expectations for
      supervisor-managed use.
- [x] Define whether app-managed startup should use caller-assigned ports,
      default ports, or allow dynamic port assignment.

**Deliverables**: approved startup/readiness/shutdown contract for both modes.

### Phase 2: Executable and Packaging Hardening

- [ ] Confirm or add an explicit executable package entry suitable for direct
      runtime invocation.
- [ ] Curate published package contents so standalone runtime execution has the
      required built assets and config examples without shipping unnecessary
      development material.
- [ ] Add or tighten startup-time validation for missing config and unsupported
      environments.
- [ ] Decide whether current programmatic exports remain internal/dev-oriented
      surfaces or need clearer documentation as non-host integration helpers.

**Deliverables**: clearer runtime package entry and publish contract.

### Phase 3: Supervisor-Friendly Lifecycle Behavior

- [x] Ensure startup logs and readiness failure messages are machine-readable
      enough for local supervisors to act on them.
- [x] Ensure non-interactive child-process startup does not require a TTY.
- [x] Ensure graceful shutdown works when the runtime is terminated by a host
      process.
- [x] Define bounded cleanup behavior for session state, worker shutdown, and
      registry flushes during managed stop.
- [x] Define how runtime version/contract information is exposed to hosts for
      compatibility checks.

**Deliverables**: robust child-process behavior for app-managed local startup.

### Phase 4: Validation and Host Integration Guidance

- [x] Add tests that spawn `cats-runtime` as a real child process and wait on
      readiness.
- [x] Add tests for signal handling and managed shutdown behavior where
      practical.
- [x] Document the recommended host interaction model for `cats-inc` and future
      Electron wrappers.
- [x] Update setup/deployment docs to explain standalone versus app-managed
      startup.
- [ ] Record any follow-up gaps that belong in separate plans rather than
      expanding this slice.

**Deliverables**: verified runtime startup contract and clear host guidance.

## Candidate Code Areas

| File / Area | Action | Description |
|-------------|--------|-------------|
| `package.json` | Modify | Clarify executable package entry and publish contents |
| `src/index.ts` | Modify | Centralize startup mode handling and process-level messaging |
| `src/server.ts` | Review / Modify | Ensure start/close lifecycle is supervisor-friendly |
| `src/core/config.ts` | Modify | Formalize config and data-dir resolution rules |
| `src/http/routes/health.ts` | Review / Modify | Ensure readiness semantics are explicit enough for supervisors |
| `tests/` | Expand | Add child-process startup and shutdown coverage |
| `docs/setup-guide.md` | Update | Document runtime startup modes |
| `docs/deployment.md` | Update | Document app-managed local startup as a first-class supported mode |

## Technical Decisions to Lock During Implementation

- Product hosts should talk to `cats-runtime` over HTTP, not by importing
  runtime internals into the app process.
- Standalone and app-managed startup should share one runtime binary/package
  story rather than diverging into separate internal builds.
- Startup success must be defined by readiness, not merely by process launch.
- Child-process mode must remain non-interactive and automation-friendly.

## Testing Strategy

- **Unit Tests**: config resolution, startup-option parsing, and readiness-state
  helpers
- **Integration Tests**: spawn `cats-runtime`, wait for readiness, verify
  shutdown semantics
- **Manual Testing**:
  1. Start `cats-runtime` directly and confirm health/readiness behavior.
  2. Start `cats-runtime` through a supervisor script and confirm graceful
     attach/shutdown behavior.
  3. Verify failure messaging for missing config and occupied ports.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Hosts begin relying on in-process imports despite the ADR | High | Document and test the supported process/HTTP boundary clearly |
| Readiness remains too vague for supervisors | High | Define one authoritative readiness path and test against it |
| Startup contract work drifts into backend refactors | Medium | Keep provider-specific changes explicitly out of scope |
| Package contents for standalone use remain noisy or incomplete | Medium | Validate package curation with publish-style dry runs |
| Port/config ownership stays ambiguous between host and runtime | High | Freeze those rules in Phase 1 before coding |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-19 | Plan created from ADR-008 and follow-up review alignment |
| 2026-03-21 | Implemented startup contract version 1, readiness/diagnostics routes, and child-process shutdown coverage |
| 2026-03-21 | Follow-up hardening removed blocking diagnostics probes and fixed the start/close lifecycle race; Phase 2 packaging tasks remain open, so plan status stays In Progress |

---

*Created: 2026-03-19*
*Author: Codex*
