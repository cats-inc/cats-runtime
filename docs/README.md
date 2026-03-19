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
| [release-guide.md](./release-guide.md) | ? Active | npm packaging, release, and future trusted publishing workflow |
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
| [terminology.md](./terminology.md) | ? Active | AAIF, A2A, skills, and project-memory terminology |
| [a2a/](./a2a/) | ?? | A2A protocol examples and templates; some current examples still need A2A v1 alignment |
| [specs/](./specs/) | ? Active | Feature specifications, including WSL discovery, agent backend planning, the provider compatibility/evidence-engine direction, the workspace-substrate init/audit/update direction, and the executable delivery/governance primitives direction |
| [plans/](./plans/) | ? Active | Implementation plans, including WSL discovery, API/backend expansion, and the proposed standalone versus app-managed startup contract |
| [decisions/](./decisions/) | ? Active | Architecture Decision Records, including the proposed app-managed self-hosted runtime packaging direction, the accepted provider-install metadata manifest direction, the accepted lightweight runtime setup/diagnostics surface, the accepted workspace-substrate tooling direction, and the accepted executable-delivery-vs-policy split |

**Legend**: ? Complete | ?? Template (needs content) | ?? Directory

## Research

| Document | Status | Description |
|----------|--------|-------------|
| [research/](./research/) | ?? | Research notes and external sources, including Paperclip alignment notes, a current maturity-gap assessment, and AAIF/A2A layering guidance |

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

*Last updated: 2026-03-20*
