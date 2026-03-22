# ADR-015: Own Workspace Substrate Tools in `cats-runtime`

> Keep deterministic workspace collaboration-substrate initialization, audit,
> and update inside `cats-runtime`, while skills and product shells orchestrate
> when those tools should run.

## Status

Accepted

## Date

2026-03-20

## Context

The Cats product direction now assumes a stronger multi-Cat collaboration
workflow:

- a `Boss Cat` may recruit specialist Cats into a workspace
- those Cats still need to inspect the actual workspace before acting
- the workspace itself should carry durable collaboration rules and project
  memory, not just temporary Boss instructions

That implies a workspace-level collaboration substrate:

- `AGENTS.md` and agent-specific instruction files
- durable project memory entry points and collaboration docs
- optional A2A-facing and skill-facing support files where relevant

Today, the closest existing source is `project-bootstrap`, which is:

- owned internally
- a useful authoring and template source
- broader than the Cats runtime problem
- not something the shipped Cats stack should directly depend on

Another tempting shortcut would be to leave workspace bootstrap entirely to
`SKILL.md` plus generic local file tools. That is insufficient for the
consistency requirement that matters most here:

- cross-workspace structure should be enforceable
- changes should be deterministic and previewable
- updates should be reviewable before overwrite
- multiple Cats should not each reinvent substrate files ad hoc

The project needs an explicit answer for where these workspace-substrate
capabilities belong.

## Decision

`cats-runtime` will own deterministic workspace-substrate tools for:

- `init-workspace`
- `audit-workspace`
- `update-workspace`

This decision includes:

1. `cats-runtime` owns the executable workspace-substrate contract.
   - deterministic file-generation and audit logic
   - preview/diff/proposal generation
   - update/merge policy for existing repos
2. These tools are part of the runtime boundary and may be exposed through:
   - headless runtime APIs
   - runtime-managed local tools
   - lightweight dashboard/operator surfaces
3. The tools should focus on the collaboration substrate, not the full generic
   project scaffolding space.
   First-slice scope is repo collaboration and project-memory structure, not
   full language/framework preset generation.
4. `project-bootstrap` is treated as an internal authoring and template source,
   not a shipped runtime dependency.
   - selected templates, merge policies, and checklists may be ported into
     runtime-owned assets or code
   - the runtime should not depend on invoking `project-bootstrap` directly
5. Skills remain important, but their role is orchestration rather than
   deterministic substrate generation.
   - skills decide when to invoke the tools
   - skills interpret tool results and decide next steps
   - skills do not replace the tools as the source of filesystem truth
6. Product shells such as `cats` may package these runtime capabilities
   into richer UX, but they should not become the canonical owner of substrate
   generation logic.
7. Update behavior for existing repositories must be conservative.
   - proposal/diff-first
   - approval-aware
   - sidecar or review-copy behavior for conflicting local customizations when
     in-place overwrite would be unsafe
8. Workspace-substrate operations follow a single-point authorization model.
   - `init-workspace` apply operations are reserved for Boss Cat,
     system-layer flows, or owner-approved actions
   - `audit-workspace` is read-only and may be invoked broadly to hydrate
     local collaboration context
   - `update-workspace` may generate proposals broadly, but apply operations
     require Boss Cat or owner approval
9. Workspace-local collaboration rules remain the default authority for Cats.
   - `AGENTS.md` and related project-memory docs take precedence over transient
     Boss Cat instructions by default
   - explicit override requests require owner approval before Cats may treat
     the transient instruction as authoritative

## Rationale

- keeps collaboration substrate generation near the runtime boundary that
  already owns setup, diagnostics, and execution-time context
- gives all Cats and product shells one deterministic substrate engine instead
  of many ad hoc prompt-driven variants
- preserves skills as procedural know-how without overloading them with
  structure-authority responsibilities
- allows internal bootstrap knowledge to be ported selectively without making a
  side project a hard prerequisite for Cats delivery

## Consequences

### Positive

- workspace collaboration rules become enforceable across empty and existing
  repos
- audit/init/update behavior can be dry-run, diffed, and approved consistently
- multi-Cat workflows gain one authoritative way to establish workspace
  conventions before specialist work begins
- runtime-managed skills can call these tools instead of rebuilding substrate
  logic from scratch

### Negative

- `cats-runtime` grows another control-plane capability beyond provider setup
  and compatibility
- the project must define substrate templates, update policies, and conflict
  handling carefully
- some generic functionality now exists both in `project-bootstrap` and in
  runtime-owned descendants until selective upstreaming happens later

### Neutral

- this ADR does not require the first slice to reproduce the full
  `project-bootstrap` preset system
- this ADR does not prevent future upstreaming of generic improvements back
  into `project-bootstrap`
- this ADR does not require every workspace to be bootstrapped automatically
  without approval

## Alternatives Considered

### Alternative 1: Depend on `project-bootstrap` Directly at Runtime

- **Pros**: reuses existing templates and scripts immediately
- **Cons**: couples the shipped Cats stack to an internal side project and to a
  broader scaffolding system than the runtime actually needs
- **Why rejected**: `project-bootstrap` should be a knowledge source, not a
  delivery prerequisite

### Alternative 2: Keep Workspace Bootstrap Mostly in Skills

- **Pros**: maximizes contextual flexibility for agents
- **Cons**: weakens deterministic structure enforcement and makes drift between
  Cats more likely
- **Why rejected**: skills are the right orchestration layer, not the right
  source of deterministic substrate generation

### Alternative 3: Make `cats` Own Workspace Substrate Generation

- **Pros**: one product shell could present a polished UX
- **Cons**: leaves standalone runtime use cases without the same capability and
  pushes workspace-level execution support above the runtime boundary
- **Why rejected**: the runtime should own the reusable headless capability

### Alternative 4: Keep Workspace Bootstrap Fully Manual

- **Pros**: smallest implementation surface
- **Cons**: inconsistent repo structure, weaker multi-Cat coordination, and no
  reliable enforcement across workspaces
- **Why rejected**: the product direction explicitly wants shared substrate
  rules that survive beyond one Cat's temporary prompt

## References

- [ADR-014](./014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR-010](./010-separate-a2a-protocol-project-memory-and-skill-packages.md)
- [SPEC-005](../specs/SPEC-005-runtime-managed-skills-v0.md)
- [SPEC-006](../specs/SPEC-006-a2a-protocol-project-memory-and-skill-layering.md)
- [SPEC-008](../specs/SPEC-008-workspace-substrate-init-audit-and-update.md)
- [cats SPEC-019](../../../cats/docs/specs/SPEC-019-product-skill-profiles-and-runtime-skill-manifests.md)
- [project-bootstrap README](../../../project-bootstrap/README.md)

---

*Accepted: 2026-03-20*
*Decision makers: user + Codex*

