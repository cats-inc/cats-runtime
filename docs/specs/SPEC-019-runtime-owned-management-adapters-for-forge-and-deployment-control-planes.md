# SPEC-019: Runtime-Owned Management Adapters for Forge and Deployment Control Planes

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

`cats-runtime` already owns session execution, delivery primitives, preview
surfaces, runtime-managed skills, and an additive MCP facade. The next gap is
management-type tooling such as GitHub CLI and Zeabur CLI for pull-request,
check, deployment, and preview workflows.

Those tools do not behave like session providers:

- they do not expose `resume`, `fork`, or turn-stream contracts
- they do not naturally fit `providers.yaml` model-provider routing
- they are control-plane tools, not conversational runtimes

This spec defines a runtime-owned management-adapter layer for review/forge and
deployment/control-plane actions. `gh` and `zeabur` are the first motivating
adapters, but the public contract should remain runtime-owned,
machine-readable, and vendor-replaceable.

## Goals

- keep management-type CLIs inside `cats-runtime` without forcing them into the
  session-provider model
- extend the existing runtime-owned delivery and preview seams with review and
  deployment capabilities
- keep `gh` / `zeabur` as implementation details behind stable runtime
  contracts
- expose management actions through headless HTTP, local-tool, and MCP seams
- preserve approval-aware mutation behavior and explicit capability-gap
  reporting

## Non-Goals

- making `gh`, `zeabur`, or similar tools appear as AI session providers
- exposing raw vendor CLI arguments as the public product/runtime contract
- moving product governance, approval UX, or release policy into `cats-runtime`
- solving installer execution or full onboarding UX for every management tool
- requiring every future forge, deploy host, or cloud provider in the first
  slice

## User Stories

- As a product host, I want runtime-owned PR and check actions so I do not need
  to shell out to `gh` directly.
- As a product host or runtime-managed skill, I want to request deployment and
  preview actions through stable runtime contracts instead of vendor-specific
  command strings.
- As a runtime maintainer, I want to swap CLI-based and API-based management
  implementations without breaking upper-layer product contracts.
- As an operator, I want management readiness and blocked states to be visible
  without pretending they are AI provider-model diagnostics.

## Requirements

### Functional Requirements

1. `cats-runtime` shall introduce management adapters as a runtime-owned
   control-plane capability family distinct from session backends.
2. Management adapters shall not be modeled as entries in
   `routing.providers` or `backends.cli.providers`.
3. The first slice shall support at least two management domains:
   - `review`
   - `deployment`
4. The first slice shall allow GitHub CLI and Zeabur CLI as candidate adapter
   implementations without hardcoding them as the only long-term vendors.
5. `cats-runtime` shall define stable machine-readable action contracts for
   management operations. Raw CLI flags and command syntax shall remain adapter
   implementation details.
6. The `review` domain shall support at least these operations:
   - `audit_review_target`
   - `open_pull_request`
   - `inspect_pull_request`
   - `wait_review_checks`
7. The `deployment` domain shall support at least these operations:
   - `audit_deployment_target`
   - `create_deployment`
   - `inspect_deployment`
   - `read_deployment_logs`
8. Deployment actions that yield preview or service URLs shall reuse the
   runtime preview-surface schema instead of inventing vendor-specific preview
   payloads.
9. Management actions shall be invocable through headless runtime APIs first.
   Runtime-managed local tools, MCP tools, dashboard actions, and runtime
   skills may layer on top of the same contracts later.
10. Runtime-managed skills may orchestrate management actions, but skills shall
    not become the execution owner for those actions.
11. Mutating management actions shall be approval-aware and shall follow the
    same general preview/apply discipline already used by workspace substrate
    and delivery primitives where that discipline fits the action.
12. Runtime authorization inputs for management actions shall remain
    product-neutral.
    - the runtime may accept generic actor or caller classification
    - the runtime may accept an opaque approval reference or attestation token
    - the runtime shall not require product-specific role names such as Cats
      personas in the public contract
13. Product governance remains outside runtime.
    - product hosts decide when approval is required
    - runtime requests may carry caller-asserted approval metadata
    - the runtime may validate that required authorization metadata is present,
      but it shall not become the owner of higher-level approval policy
14. Management results shall return machine-readable state using the same
    readiness vocabulary already familiar in runtime delivery flows:
    - `ready`
    - `blocked`
    - `unsupported`
    - `degraded`
    - `completed`
15. Management results shall also report structured warnings, blocked reasons,
    and capability gaps such as:
    - missing authentication
    - missing repository metadata
    - missing linked deployment project
    - unsupported branch protection or review state
    - unsupported adapter capability
16. Management actions shall be able to correlate outputs back to runtime
    workspace, session, artifact, service, and preview context when such
    context exists.
17. Management actions shall not require fake session transcripts or fake
    provider session ids. Long-running actions may use operation ids, polling
    metadata, or resumable status handles instead.
18. `cats-runtime` shall expose management-adapter readiness diagnostics and
    install/auth guidance without mixing those adapters into AI provider-model
    catalogs.
19. If `cats-runtime` exposes install or check metadata for management
    adapters, that metadata shall live in a management-adapter catalog or
    diagnostics namespace separate from model-provider install truth.
20. Management adapter implementations may use local CLI execution, remote API
    calls, or a hybrid of both. The public runtime contract shall remain stable
    across transport changes.
21. Management adapter configuration shall live in a dedicated runtime-managed
    config/catalog surface rather than piggybacking on model-provider routing.
22. The management-adapter layer shall remain adapter-friendly so future
    GitLab, Vercel, Cloudflare, or other control-plane integrations can plug in
    without redefining the contract around `gh` or `zeabur`.
23. Review-oriented long-running actions such as `wait_review_checks` shall
    expose explicit execution semantics rather than pretending to be normal
    short request/response reads.
    - the contract should describe timeout behavior
    - the contract should describe polling or resumable operation semantics
    - webhook-only assumptions shall remain out of scope unless the runtime
      explicitly adopts them later
24. Product governance remains outside runtime. `cats-runtime` executes the
    requested management action, reports capability gaps and blocked states, and
    does not infer whether a workspace must use GitHub or a specific deployment
    host.

### Non-Functional Requirements

- **Boundary integrity**: management adapters must remain distinct from
  session-provider routing and from prompt/session execution contracts
- **Observability**: management actions must be easy to inspect and render in
  hosts and dashboards
- **Replaceability**: CLI-vs-API implementation details should remain swappable
  behind one runtime contract
- **Security**: mutating management actions must remain approval-aware and
  explicit about auth, target, and workspace scope
- **Truthfulness**: the runtime must not fake a chat/session model for tools
  that are fundamentally command-oriented control-plane adapters

## Design Overview

### Layering

The intended split is:

- session providers/backends:
  - conversational or agentic execution runtimes
  - own turn streaming, `resume`, `fork`, and session lifecycle
- management adapters:
  - command-oriented forge/deploy/release control-plane capabilities
  - own action contracts, capability gaps, and operation status
- runtime-managed skills:
  - orchestration content and delivery
  - may request management actions but do not own execution semantics
- MCP tools:
  - additive external access surface for runtime capabilities
  - should call runtime-owned management actions, not shell out directly

### Flow

```text
cats / runtime skill / MCP caller
            |
            v
runtime management action
            |
            v
management adapter registry
            |
            +--> gh CLI / GitHub API
            +--> zeabur CLI / Zeabur API
            +--> future adapters
            |
            v
structured runtime result
  state + warnings + blocked reasons + outputs + preview surfaces
```

### Illustrative Contract Shape

Illustrative runtime-side shape:

```ts
type RuntimeManagementDomain = 'review' | 'deployment';

interface RuntimeManagementRequest {
  domain: RuntimeManagementDomain;
  action: string;
  adapter?: string;
  workspacePath?: string;
  sessionId?: string;
  apply?: boolean;
  authorization?: {
    actorClass?: 'system' | 'owner' | 'operator' | 'service';
    approvalRef?: string;
  };
  target?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

interface RuntimeManagementResult {
  domain: RuntimeManagementDomain;
  action: string;
  state: 'ready' | 'blocked' | 'unsupported' | 'degraded' | 'completed';
  adapter?: string;
  contract: {
    mode: 'preview' | 'apply';
    applyRequested: boolean;
    applyDecision: 'not_requested' | 'blocked' | 'applied' | 'read_only_operation';
  };
  blockedReasons: Array<Record<string, unknown>>;
  capabilityGaps: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  outputs?: Record<string, unknown>;
  previewSurfaces?: Array<Record<string, unknown>>;
  operation?: Record<string, unknown>;
}
```

Exact field names may evolve. The architectural point is:

- runtime owns the public contract
- adapters own vendor execution details
- skills and MCP reuse the same runtime capability instead of inventing a
  second shell-command layer
- approval metadata stays product-neutral even when the runtime needs
  authorization context for mutating operations

## Dependencies

- [SPEC-009: Executable Delivery and Governance Primitives](./SPEC-009-executable-delivery-and-governance-primitives.md)
- [SPEC-005: Runtime-Managed Skills v0](./SPEC-005-runtime-managed-skills-v0.md)
- [ADR-016: Own executable delivery primitives, not delivery policy](../decisions/016-own-executable-delivery-primitives-not-delivery-policy.md)
- [ADR-014: Keep lightweight provider setup and diagnostics in
  `cats-runtime`](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)

## Open Questions

- [ ] Should the first public HTTP surface live under additive
      `/delivery/review/*` and `/delivery/deploy/*` routes, or should it start
      under a dedicated `/management/*` namespace?
- [ ] Should management-adapter configuration live in a dedicated
      `config/management.yaml`, or in a broader future generated runtime config
      file that spans multiple control-plane subsystems?
- [ ] How much install/auth diagnostic behavior should reuse the current
      provider-install knowledge machinery versus a separate management-adapter
      diagnostic subsystem?
- [ ] Should `wait_review_checks` use a bounded long-poll request, a resumable
      operation id, or both in the first slice?
- [ ] If mutating management actions require approval metadata, should the
      runtime expect only an opaque approval reference, or also a caller-asserted
      approval flag for compatibility with existing delivery-style contracts?

## References

- [Architecture](../architecture.md)
- [API](../api.md)
- [ADR-005: Introduce a backend-neutral runtime facade for CLI and API
  backends](../decisions/005-backend-neutral-runtime-and-api-backend.md)
- [ADR-016: Own executable delivery primitives, not delivery
  policy](../decisions/016-own-executable-delivery-primitives-not-delivery-policy.md)
- [ADR-018: Separate skill-library content from runtime execution
  engine](../decisions/018-separate-skill-library-content-from-runtime-execution-engine.md)

---

*Created: 2026-03-25*
*Author: Codex*
*Related Plan: TBD*
