# SPEC-006: A2A Protocol, Project Memory, and Skill Layering

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Pilot Slice 1 Landed; Bootstrap Extraction Open) |
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
- Validate `project-bootstrap` A2A inputs through real pilot repos before
  treating them as defaults
- Ensure any collaboration-template or update behavior still needed after repo
  split has a repo-owned equivalent rather than an upstream bootstrap
  dependency

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
12. Same-environment CLI agents shall all read `AGENTS.md` and their own
    agent-specific file before performing project work.
13. Same-environment CLI agents shall consult `docs/AGENT-GUIDE.md` before
    applying repo-specific collaboration rules.
14. The repo shall document when to use `docs/research/`, `docs/decisions/`,
    `docs/specs/`, and `docs/plans/` so durable state is not misplaced into
    protocol examples or skills.
15. Candidate A2A inputs imported from `project-bootstrap` shall be treated as
    pilot inputs until validated in real repos.
16. Any collaboration-template or update flow that `cats-runtime` still needs
    after repo split shall have a repo-owned implementation or asset baseline;
    `project-bootstrap` templates and initialize/update scripts shall not
    remain required dependencies.

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
- validate bootstrap-generated second-wave repos before considering merge-back

## Dependencies

- [ADR-010: Separate A2A Protocol Artifacts, Project Memory, and Skill Packages](../decisions/010-separate-a2a-protocol-project-memory-and-skill-packages.md)
- [SPEC-005: Runtime-Managed Skills v0](./SPEC-005-runtime-managed-skills-v0.md)
- existing `docs/a2a/` templates and `skills/` directory layout

## Implementation Tracking

- A dedicated implementation plan now exists in
  [PLAN-023](../plans/PLAN-023-a2a-layering-and-collaboration-artifact-alignment.md).
- `cats-runtime` now ships a pilot-owned A2A v1.0 example set under
  `docs/a2a/`, plus runtime-owned collaboration skills for `a2a-handoff` and
  `project-memory-sync`.
- `docs/AGENT-GUIDE.md`, `docs/README.md`, `docs/terminology.md`,
  `docs/specs/README.md`, and `docs/plans/README.md` now reflect the explicit
  protocol/project-memory/skill split.
- The repo-owned workspace substrate helper now also seeds the minimum starter
  family for `docs/README.md`, docs index readmes, `skills/README.md`, and
  `scripts/README.md`, so the split-safe collaboration baseline is no longer
  limited to AGENT/A2A files only.
- Second-wave validation against `project-bootstrap` tooling has been recorded
  in a dedicated research note; merge-back remains deferred.
- A follow-on slice under `PLAN-023` remains open to extract and rewrite the
  remaining collaboration-template and initialize/update semantics into
  repo-owned helpers before repo split.

## Open Questions

- [ ] Which exact A2A v1 example set should replace the current generic
      `task.*.example` files first: message send, task object, task status
      update, or artifact examples?
- [ ] Should `cats-runtime` eventually publish a real machine-readable Agent
      Card endpoint, or keep versioned docs/examples first?
- [ ] Which collaboration skills belong in `cats-runtime` itself versus
      higher-level products such as `cats`?
- [ ] Which minimum subset of `project-bootstrap/templates/base` and
      initialize/update semantics must become runtime-owned or sibling-shared
      before the repo split?

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
*Last updated: 2026-03-29*
*Related Plan: [PLAN-023](../plans/PLAN-023-a2a-layering-and-collaboration-artifact-alignment.md)*
