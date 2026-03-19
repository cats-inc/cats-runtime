# SPEC-007: Provider Compatibility and Evidence Engine

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft (Pending Review) |
| **Owner** | Codex |
| **Reviewer** | User / runtime workstream |

## Summary

`cats-runtime` already owns provider execution for CLI, API, local, and agent
backends. For CLI-backed providers in particular, that responsibility already
includes more than simple process launching:

- spawn-argument construction
- provider-specific handshake behavior
- approval and auto-response handling
- stream parsing
- session and resume semantics

Today, much of that logic is still hardcoded per provider. That is workable for
initial support, but it is brittle when upstream CLIs change flags, event
formats, output schemas, or approval behavior.

The runtime needs a provider compatibility and evidence engine that can:

- preserve hard-won provider behavior knowledge over time
- fingerprint installed CLI/provider behavior before normal execution
- select the best compatible runtime profile for a provider target
- degrade safely when a provider version no longer matches known assumptions
- capture replayable evidence that speeds future compatibility fixes

This capability is required not only for normal message execution, but also for
runtime-owned setup, diagnostics, readiness probing, and any product wizard
that depends on runtime setup primitives.

## Goals

- reduce breakage when provider CLIs change flags, output formats, or protocol
  details
- preserve provider compatibility knowledge in structured, reviewable assets
- let runtime setup/diagnostics and normal execution share one compatibility
  engine
- support both declarative compatibility profiles and code-backed provider
  adapters
- capture redacted evidence bundles that can be replayed in tests and used to
  accelerate future fixes

## Non-Goals

- eliminating all handwritten provider adapters
- requiring every provider to use a pure declarative parser format
- putting LLM-driven guessing in the hot execution path
- replacing packaged product onboarding with a runtime-only UX
- making `environment-bootstrap` a runtime dependency

## User Stories

- As a runtime operator, I want provider readiness checks to fail clearly when a
  CLI version no longer matches known behavior.
- As a maintainer, I want compatibility fixes to start from structured evidence
  instead of from memory and ad hoc terminal transcripts.
- As a product host, I want runtime setup and diagnostics APIs to use the same
  compatibility logic as real session execution.

## Requirements

### Functional Requirements

1. `cats-runtime` shall fingerprint provider targets before or during setup,
   diagnostics, and execution paths where compatibility-sensitive behavior is
   required.
2. The fingerprint should be able to include, where available:
   - runtime provider family
   - backend kind and instance
   - CLI or tool version
   - runtime mode or environment kind
   - observable output or protocol signature
   - discovered feature or flag support
3. The runtime shall maintain provider behavior knowledge in runtime-owned
   assets.
4. Provider behavior knowledge shall be keyed by runtime provider family and be
   able to describe version-specific or signature-specific behavior.
5. The knowledge model shall be able to represent at least:
   - spawn hints and expected flags
   - output or protocol family
   - known quirks and breaking changes
   - resume/session semantics
   - parser/profile identifiers
   - failure signatures
   - compatibility notes for setup and diagnostics
6. Before normal CLI execution or provider setup verification, the runtime
   shall choose a compatibility profile based on the available fingerprint and
   knowledge records.
7. Compatibility profiles may be:
   - declarative
   - code-backed
   - hybrid
8. Stateful or protocol-heavy providers such as JSON-RPC-backed CLIs may
   continue to use handwritten adapters behind the selected compatibility
   profile.
9. The runtime shall not silently treat unknown provider behavior as known-good.
   If matching confidence is weak or parsing fails, the runtime shall surface a
   degraded compatibility result.
10. The compatibility engine shall emit explicit classifications such as:
    - `ready`
    - `degraded`
    - `unrecognized_protocol`
    - `unsupported_version`
    - `probe_failed`
11. On compatibility failure or unknown behavior, the runtime shall capture a
    redacted evidence bundle suitable for later replay and review.
12. Evidence bundles shall be able to include, where available:
    - provider family and instance
    - backend and runtime mode
    - detected version data
    - matched profile identifier
    - spawn args or probe command summary
    - stdout/stderr samples
    - exit code or failure classification
    - timestamp and platform metadata
13. The runtime shall provide a replay path so compatibility evidence can be
    turned into deterministic fixtures and regression tests.
14. Runtime-owned setup and diagnostics APIs shall consume the same
    compatibility engine used by normal execution flows.
15. The embedded dashboard may surface compatibility/readiness findings exposed
    by this engine.
16. `cats-runtime` shall not require `environment-bootstrap` to be present at
    runtime. Any reused knowledge must be ported into runtime-owned assets or
    code.
17. Any future LLM-assisted compatibility analysis shall be optional,
    review-oriented, and outside the hot execution path.

### Non-Functional Requirements

- **Safety**: unknown behavior should degrade explicitly rather than being
  silently misparsed
- **Testability**: evidence bundles should be easy to convert into replay
  fixtures and regression tests
- **Portability**: compatibility logic should work across native, WSL, Docker,
  and other runtime modes already supported by `cats-runtime`
- **Maintainability**: simple behavior changes should be expressible without
  forcing every fix into a custom code patch

## Design Overview

```text
provider target
     |
     v
fingerprint / probe
     |
     v
knowledge lookup
     |
     v
compatibility profile selection
     |
     +--> spawn strategy
     +--> parser strategy
     +--> approval / session semantics
     |
     v
normalized runtime events
     |
     +--> readiness / dashboard / setup APIs
     +--> execution paths
     |
     +--> on mismatch/failure -> redacted evidence bundle
                                   |
                                   v
                            replay fixtures/tests
```

## Provider Knowledge Direction

The first practical slice should treat provider behavior knowledge as a
structured runtime-owned knowledge base. This may live in configuration files,
compiled runtime resources, or a hybrid of both.

Illustrative shape:

```yaml
provider: claude
profiles:
  cli-1.0.x-stream-json:
    match:
      version: "^1.0.0"
      runtime_modes: ["native", "wsl"]
    spawn:
      args:
        - "-p"
        - "--input-format"
        - "stream-json"
        - "--output-format"
        - "stream-json"
    output:
      kind: "ndjson"
    known_quirks:
      - "partial assistant chunks arrive as content_block_delta"
```

Exact field names can change. The important design point is that compatibility
knowledge should become structured, reviewable, and runtime-owned.

## Profile-Driven, Not Schema-Only

The engine should be profile-driven, not schema-only.

That means:

- simple NDJSON or line-oriented providers may benefit from declarative parser
  or extractor rules
- stateful providers with handshake or approval protocols may still need
  code-backed adapters
- compatibility profile selection happens before those lower-level strategies
  run

This keeps the system flexible enough for providers such as `claude`, `codex`,
`copilot`, `kiro`, or future CLIs that do not share one simple stream grammar.

## Evidence Direction

Evidence should be treated as a first-class maintenance asset, not as incidental
logs.

Preferred direction:

- capture on compatibility mismatch, probe failure, or unknown protocol
- redact sensitive paths, secrets, and user content where practical
- store enough metadata to reproduce the failure meaningfully
- make replay into tests straightforward

## Dependencies

- [ADR-014](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR-013](../decisions/013-extend-provider-manifests-with-install-and-check-metadata.md)
- [ADR-009](../decisions/009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup.md)
- [ADR-005](../decisions/005-backend-neutral-runtime-and-api-backend.md)
- [cats-inc SPEC-023](../../../cats-inc/docs/specs/SPEC-023-packaged-setup-wizard-and-provider-installation.md)

## Open Questions

- [ ] Should provider knowledge live primarily in config files, compiled
      runtime resources, or a hybrid split?
- [ ] What evidence retention policy is appropriate for local runtime installs?
- [ ] How aggressive should automatic probing be before it starts becoming too
      expensive or noisy for normal startup?
- [ ] Should compatibility profiles be selectable only by exact fingerprint
      matches, or also by ranked best-fit fallback with operator-visible
      warnings?

## References

- [Architecture](../architecture.md)
- [API](../api.md)
- [Testing](../testing.md)
- [Provider interface](../../src/backends/cli/providers/types.ts)
- [WorkerProcess](../../src/backends/cli/pool/WorkerProcess.ts)
- [Claude CLI adapter](../../src/backends/cli/providers/claude.ts)
- [Codex CLI adapter](../../src/backends/cli/providers/codex.ts)

---

*Created: 2026-03-20*
*Author: Codex*
*Related Plan: TBD*
