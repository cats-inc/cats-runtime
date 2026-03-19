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
- support hot CLI updates and re-probing without requiring every operator to
  restart the runtime manually

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
3. The runtime shall support fingerprints where version data is unavailable,
   ambiguous, or unreliable.
   - fingerprinting shall be able to continue with version set to unknown
   - profile selection shall be able to fall back to output-signature,
     feature-detection, or protocol-family matching
4. The runtime shall maintain provider behavior knowledge in runtime-owned
   assets.
5. Provider behavior knowledge shall be keyed by runtime provider family and be
   able to describe version-specific or signature-specific behavior.
6. The knowledge model shall be able to represent at least:
   - spawn hints and expected flags
   - approval or confirmation handling patterns
   - output or protocol family
   - tool-result parsing patterns
   - known quirks and breaking changes
   - resume/session semantics
   - session resume token or identifier extraction hints
   - parser/profile identifiers
   - failure signatures
   - error categorization hints
   - compatibility notes for setup and diagnostics
7. Before normal CLI execution or provider setup verification, the runtime
   shall choose a compatibility profile based on the available fingerprint and
   knowledge records.
8. Compatibility profile selection should prefer ranked best-fit fallback with
   operator-visible warnings over exact-match-only behavior.
   - semver ranges, feature hints, and protocol signatures may all contribute
     to the ranking
   - exact matches remain valid, but minor version bumps should not force an
     automatic hard failure when the behavior still appears compatible
9. Compatibility profiles may be:
   - declarative
   - code-backed
   - hybrid
10. Stateful or protocol-heavy providers such as JSON-RPC-backed CLIs may
   continue to use handwritten adapters behind the selected compatibility
   profile.
11. The runtime shall not silently treat unknown provider behavior as known-good.
   If matching confidence is weak or parsing fails, the runtime shall surface a
   degraded compatibility result.
12. The compatibility engine shall emit explicit classifications such as:
    - `ready`
    - `degraded`
    - `unrecognized_protocol`
    - `unsupported_version`
    - `probe_failed`
13. The runtime shall expose explicit re-probe paths so hot CLI updates can be
    detected without requiring a full runtime restart.
    Re-probing should be possible at least:
    - on new session creation when cached compatibility data is stale or absent
    - from an explicit dashboard or API action
    - after a detected compatibility mismatch or probe failure
14. On compatibility failure or unknown behavior, the runtime shall capture a
    redacted evidence bundle suitable for later replay and review.
15. Evidence bundles shall be able to include, where available:
    - provider family and instance
    - backend and runtime mode
    - detected version data
    - matched profile identifier
    - spawn args or probe command summary
    - stdout/stderr samples
    - exit code or failure classification
    - timestamp and platform metadata
16. The runtime shall provide a replay path so compatibility evidence can be
    turned into deterministic fixtures and regression tests.
17. The compatibility subsystem shall define an evidence-to-fix feedback loop.
    At minimum, the workflow shall support:
    - human review of captured evidence
    - optional tool-assisted or LLM-assisted analysis outside the hot path
    - updating runtime-owned knowledge or compatibility profiles
    - validating those updates with replay fixtures or regression tests before
      shipping
18. Runtime-owned setup and diagnostics APIs shall consume the same
    compatibility engine used by normal execution flows.
19. The embedded dashboard may surface compatibility/readiness findings exposed
    by this engine.
20. `cats-runtime` shall not require `environment-bootstrap` to be present at
    runtime. Any reused knowledge must be ported into runtime-owned assets or
    code.
21. Any future LLM-assisted compatibility analysis shall be optional,
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
      output_signatures:
        - kind: "json-line"
          fields: ["type", "session_id"]
    spawn:
      args:
        - "-p"
        - "--input-format"
        - "stream-json"
        - "--output-format"
        - "stream-json"
    approvals:
      mode: "none"
    output:
      kind: "ndjson"
      tool_result:
        pattern: "content_block_delta"
      resume:
        session_id_path: "$.session_id"
    errors:
      categories:
        auth:
          stderr_contains: ["authentication", "login required"]
        rate_limit:
          stderr_contains: ["rate limit", "too many requests"]
    known_quirks:
      - "partial assistant chunks arrive as content_block_delta"
      - "resume token is exposed as session_id on init/result frames"
  cli-version-unknown:
    match:
      version: "unknown"
      output_signatures:
        - kind: "json-line"
          fields: ["type", "message"]
    selection:
      warning: "best-fit fallback because version could not be determined"
```

Exact field names can change. The important design point is that compatibility
knowledge should become structured, reviewable, and runtime-owned.

## Version Detection and Fallback

Version detection should be treated as useful but unreliable, not as a hard
precondition.

Known realities include:

- some CLIs do not expose a stable `--version` flag
- some output version strings in inconsistent formats
- some can only reveal meaningful runtime details after partial initialization
  or authentication

The compatibility engine should therefore support:

- exact version matching when it is available and trustworthy
- semver-range matching when it is available but broader matching is safer
- signature or feature-based fallback when version is unknown
- explicit warnings when the runtime is operating on a best-fit rather than a
  strongly identified exact match

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

## Hot Update and Re-Probe Direction

The compatibility engine should assume that local CLIs can change while
`cats-runtime` remains running.

That means the runtime should not require a full restart just to notice that:

- a CLI was upgraded
- a CLI was replaced with a different build
- a previously known provider now produces a different protocol signature

Re-probe may be cached, but the cache must be refreshable through explicit or
runtime-managed triggers.

## Evidence Direction

Evidence should be treated as a first-class maintenance asset, not as incidental
logs.

Preferred direction:

- capture on compatibility mismatch, probe failure, or unknown protocol
- redact sensitive paths, secrets, and user content where practical
- store enough metadata to reproduce the failure meaningfully
- make replay into tests straightforward

## Evidence-to-Fix Loop

The intended maintenance loop is:

1. runtime captures a redacted evidence bundle
2. a maintainer reviews the bundle, optionally with tool assistance
3. runtime-owned knowledge or compatibility profiles are updated
4. replay fixtures or regression tests validate the new behavior
5. the updated profile ships back into `cats-runtime`

Tooling may assist parts of this loop, including offline LLM analysis, but the
approval and merge step should remain reviewable by humans.

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
