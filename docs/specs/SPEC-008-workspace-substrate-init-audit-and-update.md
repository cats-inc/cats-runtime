# SPEC-008: Workspace Substrate Init, Audit, and Update

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft (Pending Review) |
| **Owner** | Codex |
| **Reviewer** | User / workspace-substrate workstream |

## Summary

Cats product workflows increasingly assume that multiple Cats may enter the
same workspace under Boss-Cat or system-layer coordination. Those Cats still
need workspace-local collaboration truth before they can work correctly:

- workspace rules
- project-memory entry points
- optional A2A-facing or skill-facing support files
- conservative update rules for existing repositories

This cannot rely solely on transient Boss instructions, and it should not rely
on each Cat improvising repo scaffolding with generic file-write tools.

`cats-runtime` therefore needs deterministic workspace-substrate tools that can:

- initialize collaboration substrate in an empty or near-empty repo
- audit an existing repo's substrate state
- propose or apply conservative substrate updates

These tools should reuse ideas and structure learned from `project-bootstrap`,
but they should ship as runtime-owned functionality rather than direct
dependencies on that repo.

## Goals

- establish a deterministic collaboration substrate across workspaces
- let Boss Cat, specialist Cats, and product hosts rely on one runtime-owned
  substrate engine
- support empty-repo bootstrap and existing-repo audit/update flows
- require previewable, diffable, approval-friendly changes for existing repos
- keep skills as orchestration and policy guidance, not as the only source of
  substrate generation

## Non-Goals

- reproducing the full `project-bootstrap` preset and flavor system in the
  first slice
- generating full language/framework app scaffolds such as Python API or Node
  application templates
- silently overwriting human-customized repo files
- replacing runtime-managed skills with a substrate-only tool story
- defining every future AAIF/A2A file variant in this spec

## User Stories

- As a Boss Cat, I want a new empty workspace to gain collaboration rules
  before I assign specialist Cats into it.
- As a specialist Cat, I want the workspace to contain real collaboration docs
  and not just temporary system prompts.
- As an operator, I want existing repos to be audited and updated
  conservatively, with previews and approval instead of surprise overwrites.
- As a runtime maintainer, I want one deterministic substrate engine that can
  be called by skills, dashboards, and product hosts.

## Requirements

### Functional Requirements

1. `cats-runtime` shall expose workspace-substrate operations for:
   - `init-workspace`
   - `audit-workspace`
   - `update-workspace`
2. These operations shall be available as runtime-owned headless capabilities.
   They may later be surfaced through APIs, dashboard actions, or runtime-owned
   local tools.
3. The first slice shall focus on collaboration substrate files and repo memory
   structure rather than full language/framework project scaffolding.
4. The substrate model shall be informed by AAIF/A2A layering already accepted
   in `cats-runtime`.
   - protocol layer
   - project memory layer
   - skill layer
5. The substrate model shall be able to generate or manage, at minimum, a
   baseline set of collaboration entry points. Initial candidates include:
   - `AGENTS.md`
   - agent-specific files such as `CLAUDE.md`, `GEMINI.md`, `CODEX.md` when
     enabled by the selected substrate profile
   - `docs/AGENT-GUIDE.md`
   - `docs/terminology.md`
   - `PROGRESS.md`
   - optional `docs/a2a/` starter artifacts when A2A-facing collaboration is
     enabled
6. The exact generated file set should be profile-driven and parameterizable
   rather than hardcoded to one monolithic template.
7. `init-workspace` shall support empty or near-empty workspaces.
8. `init-workspace` shall be able to accept structured inputs such as:
   - target workspace path
   - selected substrate profile
   - optional repo-shape or collaboration hints, such as monorepo vs.
     single-project layout, documentation conventions, or technology labels
     used to tune collaboration docs without scaffolding application code
   - enabled agent set
   - whether A2A starter artifacts should be included
   - whether the operation is preview-only or apply
9. `audit-workspace` shall inspect an existing workspace and classify substrate
   status.
   The classification should be able to distinguish at least:
   - `missing`
   - `partial`
   - `present`
   - `drifted`
   - `conflicting`
10. `audit-workspace` shall report concrete findings rather than only a boolean
    compliance result.
11. `update-workspace` shall use audit findings plus the selected substrate
    profile to build a deterministic proposal for convergence.
12. For existing repositories, dry-run or proposal mode shall be the default
    safe path.
13. Workspace-substrate operations shall support previewable file actions such
    as:
    - create
    - update
    - skip
    - warn
    - write sidecar or review copy when overwrite would be unsafe
14. For conflicting existing files, the first slice should prefer sidecar or
    review-copy strategies over blind overwrite.
15. Workspace-substrate operations shall be able to return a structured action
    plan or diff summary before apply.
16. The deterministic substrate engine shall not require `project-bootstrap` to
    be present at runtime.
17. Templates, checklists, and merge policies ported from internal bootstrap
    work shall live as runtime-owned assets or code.
18. Runtime-managed skills may invoke these tools, but the skills shall not be
    the authoritative source of generated substrate content.
19. Product shells such as `cats-inc` may layer richer UX on top of these
    tools, but they shall not need to duplicate substrate-generation logic.
20. The substrate tools should remain approval-friendly for Boss Cat or owner
    control flows.
21. Workspace-substrate operations shall follow an explicit authorization
    model.
    - `init-workspace` apply operations are restricted to Boss Cat,
      system-layer control flows, or owner-approved actions
    - `audit-workspace` is read-only and may be invoked by any Cat, Boss Cat,
      product host, or operator flow
    - `update-workspace` may generate a proposal broadly, but apply operations
      require Boss Cat or owner approval
22. Workspace-substrate operations shall expose enough metadata for hosts and
    skills to enforce the authorization model before apply.
23. Workspace-substrate behavior shall follow an explicit instruction
    precedence model.
    - workspace collaboration rules recorded in files such as `AGENTS.md` and
      related project-memory docs take precedence over transient Boss Cat
      instructions by default
    - Boss Cat may request an override only when the override is explicit and
      owner-approved
    - when a transient instruction conflicts with workspace substrate and no
      approved override exists, Cats shall treat the workspace substrate as the
      controlling source
24. The first slice shall standardize review-copy outputs on a fixed
    `*.bootstrap` suffix for conflicting file updates.

### Non-Functional Requirements

- **Determinism**: the same workspace state plus the same substrate profile
  should produce the same proposed actions
- **Safety**: existing human-customized files should not be overwritten
  silently
- **Observability**: audit and update results should be machine-readable and
  suitable for dashboard or product display
- **Portability**: the tools should work for local workspaces regardless of
  whether the runtime itself was launched standalone or host-managed

## Design Overview

```text
workspace path
    |
    v
substrate profile + options
    |
    +--> audit-workspace
    |       |
    |       v
    |   substrate findings
    |
    +--> init-workspace
    |       |
    |       v
    |   create proposal / apply
    |
    +--> update-workspace
            |
            v
      diffable action plan
            |
            +--> preview
            +--> approval
            +--> apply
```

## Suggested Conceptual Model

Illustrative runtime-side shapes:

```ts
interface WorkspaceSubstrateProfile {
  id: string;
  description: string;
  enabledAgents?: Array<'claude' | 'gemini' | 'codex'>;
  includeA2A?: boolean;
  files: WorkspaceSubstrateFileSpec[];
}

interface WorkspaceSubstrateAudit {
  status: 'missing' | 'partial' | 'present' | 'drifted' | 'conflicting';
  findings: WorkspaceSubstrateFinding[];
}

interface WorkspaceSubstrateAction {
  type: 'create' | 'update' | 'skip' | 'warn' | 'write_sidecar';
  path: string;
  reason: string;
  preview?: string;
  sidecarPath?: string; // e.g. AGENTS.md.bootstrap
  requiresApproval?: boolean;
}
```

Exact types may change. The important point is:

- the runtime owns substrate profiles
- audit returns structured findings
- init/update return structured action plans before apply

## Tool and Skill Relationship

The intended layering is:

- substrate tools own deterministic filesystem and audit behavior
- skills own when and why those tools should run
- Boss Cat and product hosts own policy, approval, and follow-on delegation
- workspace substrate remains the default collaboration authority unless an
  explicit approved override is in effect

Examples:

- a `workspace-bootstrap` skill may decide to run `audit-workspace` first
- a `workspace-bootstrap` skill may decide that an empty repo should use
  `init-workspace`
- the skill may then ask for approval or trigger downstream Cats after the
  substrate is ready
- a specialist Cat may run `audit-workspace` to hydrate local collaboration
  context, but should not unilaterally apply `init-workspace` or
  `update-workspace`

But the skill should not itself become the only source of `AGENTS.md`,
`docs/AGENT-GUIDE.md`, or related substrate content.

## Relationship to `project-bootstrap`

`project-bootstrap` remains a useful internal authoring source for:

- template structure ideas
- AAIF-compliant section ordering
- docs/checklist expectations
- conservative update patterns such as review-copy behavior

The first slice should adopt the same `*.bootstrap` review-copy convention
already validated in `project-bootstrap`, while keeping the implementation and
template assets runtime-owned.

The runtime should port only the collaboration-substrate pieces it actually
needs. The first slice should not try to embed:

- all language flavors
- all preset combinations
- the full generic bootstrap CLI surface

## Dependencies

- [ADR-015](../decisions/015-own-workspace-substrate-tools-in-cats-runtime.md)
- [ADR-014](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR-010](../decisions/010-separate-a2a-protocol-project-memory-and-skill-packages.md)
- [SPEC-005](./SPEC-005-runtime-managed-skills-v0.md)
- [SPEC-006](./SPEC-006-a2a-protocol-project-memory-and-skill-layering.md)
- [cats-inc SPEC-019](../../../cats-inc/docs/specs/SPEC-019-product-skill-profiles-and-runtime-skill-manifests.md)
- [project-bootstrap README](../../../project-bootstrap/README.md)

## Open Questions

- [ ] Which substrate profiles should exist in the first slice: one standard
      profile, or a small set such as `minimal`, `standard`, and
      `a2a-enabled`?
- [ ] What is the smallest default file set that still gives Cats reliable
      collaboration substrate in an existing repo?
- [ ] Should workspace-substrate actions be surfaced first as HTTP endpoints,
      runtime-local tools, or both together?

## References

- [Architecture](../architecture.md)
- [API](../api.md)
- [Testing](../testing.md)
- [project-bootstrap AGENTS](../../../project-bootstrap/AGENTS.md)
- [project-bootstrap AGENT-GUIDE](../../../project-bootstrap/docs/AGENT-GUIDE.md)
- [project-bootstrap A2A templates](../../../project-bootstrap/docs/a2a/README.md)

---

*Created: 2026-03-20*
*Author: Codex*
*Related Plan: TBD*
