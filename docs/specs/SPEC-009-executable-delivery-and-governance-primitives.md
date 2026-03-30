# SPEC-009: Executable Delivery and Governance Primitives

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented (Slice 1) |
| **Owner** | Codex |
| **Reviewer** | User / delivery-primitives workstream |

## Summary

`cats-runtime` already owns executable concerns such as sessions, tools,
provider adaptation, and preview surfaces. The suite now also needs a
runtime-owned way to execute delivery actions when products ask for them.

Those actions may range from artifact export to repo commit/push, PR/check
polling, and preview/deploy handoff. The runtime should execute these actions
through stable, machine-readable primitives without deciding which governance
level a workspace ought to use.

## Goals

- give products one reusable runtime surface for artifact, repo, preview, and
  CI-oriented delivery actions
- support both artifact-only and repo-backed workspaces
- expose capability gaps and blocked states in a machine-readable way
- keep delivery policy outside runtime while still letting runtime execute
  approved delivery actions

## Non-Goals

- owning workspace delivery policy or approval semantics
- forcing Git, GitHub, or CI onto all workspaces
- folding delivery behavior into workspace substrate tooling
- defining every future forge, preview, or deployment adapter in v1

## User Stories

- As a product host, I want to audit whether a workspace can support the
  requested delivery path before asking Cats to finalize work.
- As a Boss Cat, I want artifact-only outputs to be publishable without fake
  repo requirements.
- As an operator, I want repo-backed work to expose structured status about
  commit, push, PR, checks, and preview readiness.
- As a runtime maintainer, I want delivery execution to stay headless,
  machine-readable, and replaceable across providers.

## Requirements

### Functional Requirements

1. `cats-runtime` shall expose delivery-oriented headless capabilities in
   addition to session-oriented capabilities.
2. The first delivery capability set should support at least these operation
   classes:
   - delivery-target audit
   - artifact publication/export
   - repo status inspection
   - commit creation
   - branch push
   - optional PR/check and preview/deploy actions where integrations exist
3. Delivery operations shall accept machine-readable input and return
   machine-readable output.
4. Delivery operations shall remain non-interactive by default.
5. Delivery operations shall report whether an action is:
   - `ready`
   - `blocked`
   - `unsupported`
   - `degraded`
   - `completed`
6. Delivery audit should be able to inspect at least:
   - whether the workspace is a repo
   - current branch or detached state where applicable
   - dirty/clean working tree state where applicable
   - presence of configured remotes where applicable
   - whether preview-capable outputs or runtime surfaces already exist
   - whether known delivery integrations are available
7. Delivery primitives shall support artifact-only workspaces without requiring
   repo metadata.
8. Runtime delivery primitives shall be invocable from product hosts, runtime
   dashboards, and runtime-managed skills.
9. Runtime delivery primitives shall not decide which delivery mode is
   required. They consume requested actions or manifests and execute or report
   why execution is blocked.
10. Delivery results shall include structured warnings and capability gaps, for
    example:
    - missing Git repo
    - missing remote
    - missing forge authentication
    - missing CI integration
    - preview not available
11. Delivery actions that mutate repo or publish state should be approval-aware
    and expose whether hosts should ask for confirmation before apply.
12. Delivery primitives should be able to correlate outputs back to runtime
    session/workspace context when provided.
13. PR/check operations should remain optional capability families rather than
    mandatory assumptions for every runtime deployment.
14. Runtime delivery should leave room for pluggable forge and CI integrations
    rather than hardcoding GitHub as the only long-term target.
15. Delivery capability reporting should be visible to later dashboard or API
    surfaces.

### Non-Functional Requirements

- **Boundary integrity**: runtime executes requested actions; products own
  governance intent
- **Portability**: artifact-only workflows must work without repo-specific
  assumptions
- **Observability**: delivery status and blocked reasons must be easy to render
  in UIs
- **Replaceability**: forge, CI, and preview integrations should remain
  adapter-friendly

## Suggested Capability Families

- `artifact`
  - export files
  - register/publish artifact metadata
- `repo`
  - inspect repo state
  - create commit
  - push branch
- `review`
  - open PR
  - fetch PR status
  - wait for checks
- `preview`
  - register preview surface
  - poll preview health

The first slice does not need every family to be equally deep. It does need one
shared contract shape.

## Implemented Slice 1

The first runtime-owned delivery slice now ships with:

- HTTP routes:
  - `POST /delivery/audit`
  - `POST /delivery/artifacts/publish`
  - `POST /delivery/repo/status`
  - `POST /delivery/repo/commit`
  - `POST /delivery/repo/push`
- Local-tool primitives:
  - `audit-delivery-target`
  - `publish-artifacts`
  - `inspect-repo-status`
  - `create-commit`
  - `push-branch`
- Shared machine-readable result fields:
  - `action`
  - `state`
  - `contract`
  - `authorization`
  - `approval`
  - `capabilities`
  - `blockedReasons`
  - `capabilityGaps`
  - `warnings`
  - `repo`
  - `artifacts`
  - `previewSurfaces`

Slice-1 boundaries:

- runtime supports artifact-only delivery without fake repo requirements
- repo-backed flows currently stop at repo inspect / commit / push
- preview metadata is normalized as runtime-owned preview surfaces derived from
  artifacts and services
- PR/check and preview/deploy integrations remain explicit future seams, not
  hidden assumptions in the first slice

## Conceptual Model

Implemented runtime-side shape:

```ts
type DeliveryState =
  | 'ready'
  | 'blocked'
  | 'unsupported'
  | 'degraded'
  | 'completed';

interface RuntimeDeliveryRequest {
  action:
    | 'audit-delivery-target'
    | 'publish-artifacts'
    | 'inspect-repo-status'
    | 'create-commit'
    | 'push-branch';
  workspacePath?: string;
  sessionId?: string;
  artifactIds?: string[];
  apply?: boolean;
  authorization?: {
    actorRole?: string;
    approved?: boolean;
  };
  context?: Record<string, unknown>;
}

interface RuntimeDeliveryResult {
  action: RuntimeDeliveryRequest['action'];
  state: DeliveryState;
  contract: {
    mode: 'preview' | 'apply';
    applyRequested: boolean;
    applyDecision: 'not_requested' | 'read_only_operation' | 'blocked' | 'applied';
  };
  approval: {
    required: boolean;
  };
  capabilities: Record<string, { state: 'ready' | 'blocked' | 'unsupported' | 'degraded' }>;
  blockedReasons: Array<Record<string, unknown>>;
  capabilityGaps: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  repo: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  previewSurfaces: Array<Record<string, unknown>>;
}
```

Commit creation is intentionally safe by default: apply uses the existing Git
index unless the caller explicitly opts in to `repo.stageAll: true`.

## Flow

```text
cats or other host
  delivery intent / requested action
            |
            v
cats-runtime delivery audit or action
            |
            +--> capability probe
            +--> adapter-specific execution
            +--> preview/artifact integration
            |
            v
structured delivery result
  state + warnings + blocked reasons + outputs
```

## Design Rules

1. Delivery execution should reuse runtime-owned filesystem, session, and
   preview context when possible.
2. Repo-backed execution should remain adapter-friendly rather than assuming
   one forge vendor forever.
3. Artifact publication should remain useful even when repo delivery is
   unsupported or blocked.
4. Runtime delivery is not the same as workspace substrate. `AGENTS.md`
   generation and CI/check execution should not share one tool contract.
5. If CI-related file scaffolding ever exists, it should be treated as an
   optional delivery-support capability, not as the defining purpose of
   substrate tools.

## Dependencies

- [ADR-016](../decisions/016-own-executable-delivery-primitives-not-delivery-policy.md)
- [ADR-015](../decisions/015-own-workspace-substrate-tools-in-cats-runtime.md)
- [ADR-011](../decisions/011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md)
- [cats ADR-022](../../../cats-platform/docs/decisions/022-own-workspace-delivery-policy-in-product.md)
- [cats SPEC-024](../../../cats-platform/docs/specs/SPEC-024-chat-delivery-policy-and-governance-levels.md)

## Open Questions

- [x] Which delivery action names should be part of the first stable HTTP/API
      surface versus exposed first only through runtime-local tools?
      First slice now freezes audit, artifact publish/export, repo status,
      commit, and push in both HTTP and local-tool form.
- [ ] Should PR and CI integration start as a single combined capability family
      or as separate adapters from the first slice?
- [ ] Which artifact-publication actions need normalized metadata first:
      reports/documents only, or also binary outputs such as slide decks?

## References

- [Architecture](../architecture.md)
- [API](../api.md)
- [ADR-011](../decisions/011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md)
- [cats Paperclip Control-Plane Analysis](../../../cats-platform/docs/research/paperclip-control-plane-analysis.md)

---

*Created: 2026-03-20*
*Author: Codex*
*Related Plan: TBD*

