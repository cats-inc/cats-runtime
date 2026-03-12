# Documentation Index

> This directory contains all project documentation.

## Root-Level Documents

These important documents live in the project root:

| Document | Status | Description |
|----------|--------|-------------|
| [PROGRESS.md](../PROGRESS.md) | ? Active | Implementation status and work packages |
| [ROADMAP.md](../ROADMAP.md) | ? Active | Roadmap and planned optimization tracks |

## Core Documents

| Document | Status | Description |
|----------|--------|-------------|
| [requirements.md](./requirements.md) | ?? Template | Requirements specification |
| [architecture.md](./architecture.md) | ? Active | Embedded runtime architecture and layering |
| [api.md](./api.md) | ? Active | Supported public HTTP contract |

## Development Guides

| Document | Status | Description |
|----------|--------|-------------|
| [setup-guide.md](./setup-guide.md) | ? Active | Environment setup |
| [testing.md](./testing.md) | ? Active | Testing strategy |
| [deployment.md](./deployment.md) | ?? Template | Deployment instructions |
| [security-guidelines.md](./security-guidelines.md) | ?? Template | Security policies |
| [mcp-config.md](./mcp-config.md) | ?? Template | MCP server configuration |
| [services.md](./services.md) | ? Active | Service registry and port assignments |
| [SCRIPT-STANDARDS.md](./SCRIPT-STANDARDS.md) | ?? Template | Script standards and naming |

## Scripts

The `scripts/` directory contains platform-specific scripts for your project:

| Directory | Platform | Purpose |
|-----------|----------|---------|
| `scripts/windows/` | Windows | PowerShell scripts (.ps1) |
| `scripts/linux/` | Linux | Bash scripts (.sh) |
| `scripts/macos/` | macOS | Bash scripts (.sh) |

Add your project-specific automation scripts here.

## AAIF Documents

| Document | Status | Description |
|----------|--------|-------------|
| [AGENT-GUIDE.md](./AGENT-GUIDE.md) | ? Active | Project-specific agent notes |
| [terminology.md](./terminology.md) | ?? Template | AAIF/A2A/MCP terminology |
| [a2a/](./a2a/) | ?? | A2A agent card and task templates |
| [specs/](./specs/) | ? Active | Feature specifications, including WSL discovery planning |
| [plans/](./plans/) | ? Active | Implementation plans, including WSL discovery rollout |
| [decisions/](./decisions/) | ? Active | Architecture Decision Records |

**Legend**: ? Complete | ?? Template (needs content) | ?? Directory

## Research

| Document | Status | Description |
|----------|--------|-------------|
| [research/](./research/) | ?? | Research notes and external sources |

## Context-Driven Development

For complex features, use the spec-plan-implement workflow:

1. **Spec** (`specs/SPEC-NNN-title.md`): Define what to build and why
2. **Plan** (`plans/PLAN-NNN-title.md`): Define how to build it
3. **Implement**: Follow the plan, update progress

This ensures AI agents understand requirements before writing code.

## For AI Agents

When working on this project:

1. Check this index to understand what documentation exists
2. Create missing documents as needed
3. Update this index when adding new documents
4. Follow templates provided in each file

## Document Standards

- Use Markdown format
- Include a clear title and purpose at the top
- Keep documents focused and concise
- Update the "Last updated" date when modifying

---

*Last updated: 2026-03-13*
