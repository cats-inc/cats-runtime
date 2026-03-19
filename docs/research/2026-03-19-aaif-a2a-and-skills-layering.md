# Research Log: AAIF, A2A v1, and Skill Layering

Date: 2026-03-19
Topic: Latest AAIF/A2A direction and how it should relate to project memory and `SKILL.md`

## Sources

- https://aaif.io/
- https://openai.com/index/agentic-ai-foundation
- https://agents.md/
- https://a2a-protocol.org/latest/
- https://a2a-protocol.org/latest/specification/
- https://a2a-protocol.org/latest/definitions/
- https://a2a-protocol.org/latest/whats-new-v1/
- https://a2a-protocol.org/latest/roadmap/
- https://github.com/a2aproject/A2A/releases
- https://agentskills.io/home

## Summary

- AAIF currently acts as a neutral standards foundation and governance home for
  efforts such as `AGENTS.md` and MCP rather than defining a separate runtime
  wire protocol.
- `AGENTS.md` remains intentionally lightweight. The official guidance
  emphasizes predictable location and simple agent-facing instructions, not a
  rigid machine schema.
- A2A has now stabilized around v1.0.0. The official latest documentation
  centers on Agent Cards, messages, tasks, artifacts, status updates,
  authentication schemes, and extension points rather than generic custom
  payload templates.
- A2A `AgentSkill` is part of the external Agent Card model. It is descriptive
  interoperability metadata, not the same artifact as a repo-local `SKILL.md`
  package.
- `SKILL.md` is better treated as a reusable procedural capability package:
  instructions, resources, and optional scripts that help an agent perform
  work. It should not replace protocol contracts or durable project memory.

## Relevance to `cats-runtime`

- The current `docs/AGENT-GUIDE.md` A2A section is still useful as local SOP,
  but it is not enough to represent an A2A v1 contract by itself.
- The current `docs/a2a/agent-card.*.example` and `task.*.example` files are
  closer to internal pseudo-schemas than current A2A v1 examples. They should
  not be treated as standards-aligned public artifacts without revision.
- The repository's markdown documents still serve a different purpose from both
  A2A and skills: they are durable institutional memory for progress, design
  intent, constraints, and handoff state.

## Recommended Layering

1. Protocol layer:
   - A2A-facing Agent Card, auth, discovery, and message/task/artifact examples
   - machine-readable and standards-aligned
2. Project memory layer:
   - `PROGRESS.md`, ADRs, specs, plans, architecture notes, handoff docs
   - long-lived shared memory for humans and agents in this repo
3. Skill layer:
   - `SKILL.md` packages that teach agents how to read/update memory and how to
     participate in A2A handoff correctly
   - procedural know-how, not the source of protocol truth

## Action Items

- Record the three-layer separation in a new ADR and spec.
- Upgrade `docs/a2a/` examples to A2A v1 shapes in a follow-on change.
- Add or refine skills such as `a2a-handoff` and `project-memory-sync` only
  after the boundary between protocol and memory is explicit.

---

Logged by: Codex
