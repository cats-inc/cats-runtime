# SPEC-006: A2A Protocol, Project Memory, and Skill Layering

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

`cats-runtime` needs a clear rule for where agent-to-agent collaboration truth
should live. Today the repo has protocol examples, markdown project docs, and
`SKILL.md` packages, but their responsibilities are not formally separated.

This specification defines a three-layer model:

- A2A protocol artifacts for interoperability
- markdown project memory for durable repo knowledge
- `SKILL.md` packages for reusable procedural know-how

The first goal is not to implement more runtime features immediately. The first
goal is to stop mixing these concerns so that future A2A support, Boss Cat
coordination, and skills can evolve without erasing project memory or drifting
away from standards.

## Goals

- Define which collaboration knowledge belongs in A2A artifacts, markdown docs,
  and `SKILL.md` packages
- Keep `cats-runtime` aligned with A2A v1 terminology and artifact shape
- Preserve repository markdown as durable institutional memory for humans and
  agents
- Give skills a precise role in handoff and collaboration workflows
- Create a clear follow-on path for upgrading `docs/a2a/` examples

## Non-Goals

- Implementing a full A2A server in this spec
- Replacing existing docs with generated machine-readable artifacts
- Turning every piece of repo process into a skill
- Solving `cats` product-side routing or Boss Cat behavior in this spec
- Defining a complete plan for every future skill package

## User Stories

- As a runtime maintainer, I want to know whether a collaboration rule belongs
  in `docs/a2a/`, `docs/`, or `skills/` so that artifacts stay coherent.
- As an upstream product integrator, I want standards-aligned protocol examples
  instead of repo-specific pseudo-schemas.
- As an agent author, I want reusable skills that tell me how to perform
  handoff and state sync without losing durable project memory.
- As a reviewer, I want to distinguish protocol drift from normal doc updates.

## Requirements

### Functional Requirements

1. `cats-runtime` shall treat A2A protocol artifacts, markdown project memory,
   and `SKILL.md` packages as three distinct collaboration layers.
2. `docs/a2a/` shall be reserved for standards-aligned A2A-facing artifacts and
   explanatory notes about transport, auth, discovery, and supported version
   scope.
3. Future example files under `docs/a2a/` shall align to the official A2A
   version the project targets and shall not use custom generic task schemas
   while being labeled as A2A examples.
4. `docs/AGENT-GUIDE.md` may keep an A2A collaboration checklist, but it shall
   present itself as local SOP rather than the normative A2A protocol contract.
5. Repo markdown such as `PROGRESS.md`, ADRs, specs, plans, architecture docs,
   and handoff notes shall remain the canonical durable project memory layer.
6. Project memory docs shall continue to store progress, architectural intent,
   open questions, operational notes, and handoff state even if some of that
   knowledge is also summarized elsewhere.
7. `skills/` shall be used for reusable procedural capability packages, such as
   how an agent should prepare an A2A handoff or update memory docs after task
   completion.
8. Skills shall reference or consume project memory docs where appropriate
   rather than duplicating long-lived state inside `SKILL.md`.
9. If an internal skill is advertised externally through A2A, that mapping
   shall be explicit and selective. External A2A `AgentSkill` metadata and
   internal `SKILL.md` packages shall not be assumed to be the same artifact.
10. `docs/terminology.md` shall define the key terms needed to keep the three
    layers distinct, including at least `Agent Card`, `Project Memory`, and
    `Skill Package`.
11. When external standards research materially influences protocol direction,
    the project should log the finding under `docs/research/` before or along
    with the resulting ADR/spec updates.

### Non-Functional Requirements

- **Standards alignment**: A2A-facing examples should be traceable to official
  A2A documentation and versioned expectations.
- **Clarity**: A contributor should be able to decide the right layer for a
  change without guessing.
- **Durability**: Project memory must remain readable and useful across sessions
  even when protocol or skills evolve.
- **Maintainability**: Skills should stay focused on workflows, not become a
  second uncontrolled documentation system.

## Design Overview

### Three-Layer Model

| Layer | Primary Purpose | Canonical Location | Examples |
|-------|------------------|--------------------|----------|
| Protocol | External interoperability | `docs/a2a/`, API docs | Agent Card, auth/discovery notes, message/task/artifact examples |
| Project Memory | Durable repo knowledge | `PROGRESS.md`, ADRs, specs, plans, architecture docs | status, decisions, work packages, handoff context |
| Skill | Reusable procedural know-how | `skills/<name>/SKILL.md` | `a2a-handoff`, `project-memory-sync`, role-specific workflows |

### Practical Rule of Thumb

Use this decision order:

1. If another agent or runtime must interoperate with us over a protocol, put
   it in the **protocol layer**.
2. If humans and agents need durable shared context about the repo, put it in
   the **project memory layer**.
3. If an agent needs reusable instructions for how to perform work using the
   first two layers, put it in the **skill layer**.

### Suggested Follow-On Work

This spec intentionally stops at layering and artifact ownership. Expected
follow-on tasks include:

- replace current pseudo-A2A examples with A2A v1-aligned examples
- add one or more collaboration skills such as `a2a-handoff` and
  `project-memory-sync`
- clarify which runtime capabilities should eventually be reflected in an
  external Agent Card

## Dependencies

- [ADR-010: Separate A2A Protocol Artifacts, Project Memory, and Skill Packages](../decisions/010-separate-a2a-protocol-project-memory-and-skill-packages.md)
- [SPEC-005: Runtime-Managed Skills v0](./SPEC-005-runtime-managed-skills-v0.md)
- existing `docs/a2a/` templates and `skills/` directory layout

## Open Questions

- [ ] Which exact A2A v1 example set should replace the current generic
      `task.*.example` files first: message send, task object, task status
      update, or artifact examples?
- [ ] Should `cats-runtime` eventually publish a real machine-readable Agent
      Card endpoint, or keep versioned docs/examples first?
- [ ] Which collaboration skills belong in `cats-runtime` itself versus
      higher-level products such as `cats`?

## References

- [Research: AAIF, A2A, and skill layering](../research/2026-03-19-aaif-a2a-and-skills-layering.md)
- [AGENTS.md](https://agents.md/)
- [A2A Latest](https://a2a-protocol.org/latest/)
- [A2A Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Definitions](https://a2a-protocol.org/latest/definitions/)
- [Agent Skills](https://agentskills.io/home)

---

*Created: 2026-03-19*
*Author: Codex*
*Related Plan: TBD*

