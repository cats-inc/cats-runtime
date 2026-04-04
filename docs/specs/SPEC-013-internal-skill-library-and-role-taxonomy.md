# SPEC-013: Internal Skill Library and Role Taxonomy

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Owner** | Codex |
| **Reviewer** | User / skills workstream |

## Summary

`cats-runtime` already has a runtime-managed skills execution slice, but it
does not yet define the content-library structure needed to support a broad
internal skill pool.

This specification defines the runtime-owned skill-library taxonomy and package
shape needed for:

- orchestration and coordination roles
- company/work role families
- companion role families
- advanced programmer role families

The key boundary is:

- the skill library is content and metadata
- runtime-managed skill execution remains a separate subsystem

This lets the project grow a large internal skill pool without conflating role
taxonomy with execution semantics.

External role libraries may be used as inspiration or mirrored reference
material during authoring, but the shipped runtime library must remain owned by
this repo and must not depend on a sibling/submodule role catalog at runtime.

## Goals

- define one internal library layout for runtime-owned skill content
- support families for orchestrator/coordinator, Work roles, companion roles,
  and Code-oriented advanced programmers
- give future products a stable catalog to reference without forcing product
  schemas into runtime
- keep the library compatible with runtime-managed skill validation,
  materialization, and reporting

## Non-Goals

- implementing the full execution engine in this spec
- defining product UI for browsing the skill library
- requiring every skill to be automatically runnable from day one
- importing or depending on external role libraries at runtime

## User Stories

- As a runtime maintainer, I want a stable place to put skill content that is
  broader than a handful of example skills.
- As a product integrator, I want to request well-known role families without
  inventing ad hoc naming for every future Cat.
- As a skill author, I want role packages to follow one predictable manifest
  and directory structure.

## Requirements

### Functional Requirements

1. `cats-runtime` shall host an internal skill library inside the repo.
2. The library shall support at least these top-level families:
   - `orchestration`
   - `work`
   - `chat`
   - `code`
3. The first library slice shall include role definitions for at least:
   - orchestrator / coordinator
   - CEO
   - sales
   - product manager
   - project manager (`waterfall`, `agile` variants allowed)
   - UX
   - art designer
   - architect
   - coder
   - automation tester
   - code reviewer / QA
   - marketer
   - HR
   - secretary
   - intern
   - multiple companions
   - advanced programmer variants
4. Each library skill package shall remain compatible with the existing
   runtime-managed skill validator:
   - repo-local directory
   - `SKILL.md`
   - parseable frontmatter
   - non-empty instructions
5. The library shall support additional metadata beyond the current minimum
   validation bar.
   Candidate fields include:
   - `family`
   - `role`
   - `productTags`
   - `deliveryHints`
   - `recommendedCompanions`
   - `capabilityTags`
6. The library shall define canonical naming and slug rules so future role
   additions remain deterministic.
   - runtime resolution should accept canonical family-qualified ids such as
     `work/product-manager`
   - authors should prefer globally unique slugs for execution-critical skills
     because some runtime delivery targets may flatten packages during
     materialization
7. The library shall distinguish:
   - reusable base skills
   - role-specialized skills
   - optional composition/bundle metadata
8. The library shall remain runtime-owned content, not product-owned
   companion-box data or project memory.
9. The library shall be usable by later product mappings without forcing one
   product-specific taxonomy into runtime route contracts.
10. The library shall support manifest-level version/fingerprint metadata so
    later materialization and resume flows can report exactly what was applied.
11. External role catalogs may be mirrored or referenced during authoring, but
    the runtime-resolved skill library shall remain local to `cats-runtime`.

### Non-Functional Requirements

- **Taxonomy stability**: families and slugs should not drift casually
- **Execution separation**: content structure must remain separable from
  materialization and adapter injection
- **Extensibility**: future role families should not require a schema reset
- **Portability**: the library should work for CLI, API, and agent backends

## Proposed Taxonomy

### Family: `orchestration`

Examples:

- `orchestrator`
- `coordinator`
- `dispatcher`
- `incident-commander`

### Family: `work`

Examples:

- `ceo`
- `sales`
- `product-manager`
- `project-manager-waterfall`
- `project-manager-agile`
- `ux`
- `art-designer`
- `architect`
- `coder`
- `automation-tester`
- `code-reviewer`
- `qa`
- `marketer`
- `hr`
- `secretary`
- `intern`

### Family: `chat`

Examples:

- `companion-gentle`
- `companion-playful`
- `companion-guardian`
- `companion-mentor`

### Family: `code`

Examples:

- `advanced-programmer-backend`
- `advanced-programmer-frontend`
- `advanced-programmer-systems`
- `advanced-programmer-runtime`

## Suggested Package Shape

```text
skills/
  orchestration/
    coordinator/
      SKILL.md
      assets/
      examples/
  work/
    product-manager/
      SKILL.md
  chat/
    companion-gentle/
      SKILL.md
  code/
    advanced-programmer-runtime/
      SKILL.md
```

The exact on-disk layout may evolve, but the library should preserve:

- family grouping
- stable skill slug
- package-local assets
- optional manifest metadata

## Suggested Metadata

Illustrative frontmatter:

```yaml
name: product-manager
description: Guides product framing, prioritization, and scope control.
family: work
role: product_manager
productTags:
  - work
capabilityTags:
  - prioritization
  - requirements
deliveryHints:
  - instructions
  - filesystem
```

## Relationship to Runtime-Managed Skills

This spec does not replace `SPEC-005`.

Instead:

- this spec defines the content library and taxonomy
- `SPEC-005` defines how runtime resolves, materializes, injects, and reports
  requested skills

The expected flow is:

```text
product/runtime request
   |
   v
skill library lookup
   |
   v
resolved library package(s)
   |
   v
runtime-managed skill execution flow
```

## Implementation Tracking

- The internal skill-library taxonomy landed directly through the runtime
  skills workstream before a dedicated follow-through plan existed.
- The later hardening/publish-discipline follow-through that lived under
  [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md),
  is now complete, with `PROGRESS.md` still carrying only the broader runtime
  truth.
- Follow-through now also projects catalog fingerprint/cache/guard truth through
  runtime diagnostics so hosts and operators can inspect shipped-library state
  without importing the catalog internals directly.
- The shipped-library verification gate now also requires runtime-owned
  `skills/` packages to explicitly declare the richer frontmatter promised in
  `skills/README.md` instead of relying on catalog-derived defaults.
- Remaining follow-through is now explicitly limited to publish/lint
  discipline, reference-authoring workflow, and later bundle/composition
  metadata rather than more discovery-safety work.

## Dependencies

- [SPEC-005](./SPEC-005-runtime-managed-skills-v0.md)
- [cats SPEC-019](../../../cats-platform/docs/specs/SPEC-019-product-skill-profiles-and-runtime-skill-manifests.md)

## Open Questions

- [ ] Should bundle composition be expressed as standalone runtime manifests or
      as metadata inside family packages?
- [ ] Which companion variants should be base library content versus
      product-owned response-profile overlays?
- [ ] Should Work role families carry recommended orchestration relationships
      such as `reportsTo` or `worksWith`, or remain flat in the first slice?

## References

- [SPEC-005: Runtime-Managed Skills v0](./SPEC-005-runtime-managed-skills-v0.md)
- [cats SPEC-019: Product Skill Profiles and Runtime Skill Manifests](../../../cats-platform/docs/specs/SPEC-019-product-skill-profiles-and-runtime-skill-manifests.md)

---

*Created: 2026-03-24*
*Author: Codex*
*Last updated: 2026-04-04*
*Related Plan: [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md) (follow-through plan; initial slice was implemented directly)*
