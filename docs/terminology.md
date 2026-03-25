# Terminology

> Short definitions used in this project.

## Standards and Protocols

| Term | Meaning |
|------|---------|
| AAIF | Agentic AI Foundation; "the neutral and open foundation built on transparency, collaboration, and standardization to advance the public interest in agentic AI innovation." |
| AGENTS.md | "A simple, open format for guiding coding agents, used by over 60k open-source projects. Think of it as a README for agents." |
| MCP | Model Context Protocol; see modelcontextprotocol.io for the official description. In this project, MCP refers to agent-to-tool integration. |
| A2A | "An open protocol enabling communication and interoperability between opaque agentic applications." |
| Agent Card | The A2A capability and identity document that describes an agent's supported interfaces, skills, auth schemes, and interaction defaults. |
| Project Memory | Durable markdown-based repo knowledge such as progress, ADRs, specs, plans, architecture notes, and handoff state. |
| Skill Package | A repo-local `skills/<name>/SKILL.md` package plus supporting resources used for reusable procedural know-how. |
| Agent Skill | Capability metadata advertised through an A2A Agent Card. It is related to, but not identical with, a repo-local `SKILL.md` package. |

## Runtime Architecture

| Term | Meaning |
|------|---------|
| Session Provider | A turn-oriented execution backend such as a CLI, API, local-model, or agent runtime that owns session lifecycle, message execution, and often `resume` / `fork` semantics. |
| Control-Plane Adapter | A runtime-owned adapter for non-session operational systems such as forge, deployment, review, or release tooling. It exposes machine-readable actions without pretending to be a conversational runtime. |
| Service Caller | A non-human caller classification for automation pipelines, host-managed background workers, MCP-connected supervisors, or similar system-to-system runtime invocations. |

## Template Architecture

If your project does not use layered templates, you can remove this section.

| Term | Meaning |
|------|---------|
| Base | Core template layer that is always included. |
| Flavor | Optional add-on layer such as docker, github-actions, python, or nodejs. |
| Preset | Named combination of base + flavors for common project types. |

## Roles

| Term | Meaning |
|------|---------|
| Conductor | Orchestrates tasks and keeps README Current Status up to date. |
| Architect | Owns system design and tech stack decisions. |
| Security Specialist | Reviews security, compliance, and risk. |
| UX Lead | Oversees user experience and frontend standards. |
| Specialist | Executes assigned tasks and updates docs/tests as needed. |

## References

- Source: https://aaif.io
- Source: https://agents.md
- Source: https://modelcontextprotocol.io
- Source: https://github.com/a2aproject/A2A

---

Last updated: 2026-03-25
