# ADR 010: Separate A2A Protocol Artifacts, Project Memory, and Skill Packages

## Status

Accepted

## Date

2026-03-19

## Context

`cats-runtime` already carries several agent-facing layers:

- `AGENTS.md` and `docs/AGENT-GUIDE.md` for local operating rules
- `docs/a2a/` for protocol-facing examples
- repo markdown such as `PROGRESS.md`, ADRs, specs, and plans for durable
  project memory
- `skills/` for reusable `SKILL.md` capability packages

Recent review against the latest official AAIF, `AGENTS.md`, A2A, and Agent
Skills sources surfaced an important ambiguity:

- the local SOP around A2A is still directionally reasonable
- but the example files under `docs/a2a/` are currently closer to internal
  pseudo-schemas than to the official A2A v1 shapes
- and there is growing pressure to treat `SKILL.md` as the place where all
  collaboration knowledge should live

That pressure is understandable but dangerous. These layers do different jobs:

- A2A defines interoperability contracts between agents and runtimes
- repo markdown preserves durable project memory and handoff state
- `SKILL.md` packages hold reusable procedural know-how

Without an explicit separation, the project risks:

- presenting non-standard internal examples as public A2A guidance
- overloading skills with protocol truth and long-lived state
- eroding the value of markdown docs as institutional memory across sessions

## Decision

`cats-runtime` will adopt a formal three-layer collaboration model:

1. **Protocol layer**
   - owns external interoperability artifacts
   - includes A2A-facing Agent Card examples, auth/discovery guidance, and
     message/task/artifact examples aligned to the official A2A version the
     project targets
   - lives primarily under `docs/a2a/` and runtime API documentation
2. **Project memory layer**
   - owns durable repository knowledge
   - includes `PROGRESS.md`, ADRs, specs, plans, architecture notes,
     requirements, handoff notes, and similar markdown records
   - remains the canonical shared memory surface for humans and agents working
     in this repo
3. **Skill layer**
   - owns reusable procedural capability packages
   - lives under `skills/` as `SKILL.md` packages plus supporting resources
   - may teach an agent how to consume protocol artifacts or update project
     memory, but does not replace either layer as the source of truth

This decision also establishes the following boundary rules:

1. `docs/AGENT-GUIDE.md` remains a local SOP and orientation guide. It is not
   the normative definition of the A2A wire contract.
2. `docs/a2a/` must contain standards-aligned examples for the official A2A
   version the project claims to follow. Generic custom payload examples should
   not masquerade as A2A examples.
3. Repo markdown documents remain the canonical place for durable progress,
   architectural intent, and handoff state. They should not be collapsed into
   protocol schemas or buried inside skills.
4. `SKILL.md` packages may encode repeatable workflows such as handoff
   preparation, memory synchronization, or A2A participation guidance, but they
   are not the authoritative definition of Agent Card fields, message formats,
   or runtime task status models.
5. If a repo-local skill is exposed externally through A2A, that exposure must
   be an explicit mapping from internal skill package to external Agent Card
   metadata, not an assumption that the two artifacts are identical.

## Consequences

### Positive

- Prevents protocol drift by giving `docs/a2a/` a clear standards-aligned role.
- Preserves markdown docs as durable project memory instead of treating them as
  temporary prompt fragments.
- Gives `SKILL.md` a precise and useful role as procedural know-how.
- Makes future `cats-inc` and other consumer integrations easier because
  protocol truth, memory, and skills are no longer conflated.

### Negative

- The project now has three collaboration surfaces to maintain instead of one.
- Some existing `docs/a2a/` examples will need follow-on revision to align with
  A2A v1.
- Teams will need discipline to avoid copying state between markdown docs and
  skills.

### Neutral

- This decision does not require immediate runtime endpoint changes.
- This decision does not prevent future generation of protocol artifacts from
  internal sources, as long as the public artifacts remain standards-aligned.

## Alternatives Considered

### Alternative 1: Put A2A Collaboration Knowledge Mostly into `SKILL.md`

- **Pros**: One discoverable place for agents to learn workflows.
- **Cons**: Blurs protocol truth, long-lived state, and procedural guidance into
  one artifact type.
- **Why rejected**: Skills are good for know-how, not for authoritative
  interoperability contracts or durable project memory.

### Alternative 2: Treat Repo Markdown as Sufficient and Skip Formal A2A Artifacts

- **Pros**: Minimal additional maintenance.
- **Cons**: Leaves no standards-aligned public examples and weakens external
  interoperability.
- **Why rejected**: `cats-runtime` is explicitly a runtime boundary and should
  not rely on private conventions alone.

### Alternative 3: Collapse Project Memory into A2A Metadata

- **Pros**: More machine-readable on paper.
- **Cons**: A2A artifacts are not a substitute for architectural records,
  progress logs, and work-package memory.
- **Why rejected**: The repo needs rich human-readable institutional memory
  beyond protocol metadata.

## References

- [Research: AAIF, A2A, and skill layering](../research/2026-03-19-aaif-a2a-and-skills-layering.md)
- [SPEC-005: Runtime-Managed Skills v0](../specs/SPEC-005-runtime-managed-skills-v0.md)
- [AAIF](https://aaif.io/)
- [AGENTS.md](https://agents.md/)
- [A2A Latest Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Definitions](https://a2a-protocol.org/latest/definitions/)
- [A2A What's New in v1](https://a2a-protocol.org/latest/whats-new-v1/)
- [A2A Releases](https://github.com/a2aproject/A2A/releases)
- [Agent Skills](https://agentskills.io/home)

---

*Decision made: 2026-03-19*
*Decision makers: Codex with user approval*
