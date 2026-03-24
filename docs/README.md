# Documentation Index

> This directory contains all project documentation.

## Root-Level Documents

These important documents live in the project root:

| Document | Status | Description |
|----------|--------|-------------|
| [PROGRESS.md](../PROGRESS.md) | Complete | Implementation status and work packages |
| [ROADMAP.md](../ROADMAP.md) | Complete | Roadmap and planned optimization tracks |

## Core Documents

| Document | Status | Description |
|----------|--------|-------------|
| [requirements.md](./requirements.md) | Template | Requirements specification |
| [architecture.md](./architecture.md) | Complete | Embedded runtime architecture, backend layering, and runtime-owned skill / compatibility / metering / session-maintenance / browser-preview seams |
| [api.md](./api.md) | Complete | Supported public HTTP contract, including skills, diagnostics, progress, guardrails, browser sessions/pages, preview surfaces, compatibility summaries, and session maintenance metadata |

## Development Guides

| Document | Status | Description |
|----------|--------|-------------|
| [setup-guide.md](./setup-guide.md) | Complete | Environment setup, startup contract, and diagnostics/compatibility basics |
| [testing.md](./testing.md) | Complete | Testing strategy |
| [deployment.md](./deployment.md) | Complete | Standalone and app-managed local deployment guidance |
| [release-guide.md](./release-guide.md) | Complete | npm packaging, release, and future trusted publishing workflow |
| [security-guidelines.md](./security-guidelines.md) | Template | Security policies |
| [mcp-config.md](./mcp-config.md) | Template | MCP server configuration |
| [services.md](./services.md) | Complete | Service registry and port assignments |
| [SCRIPT-STANDARDS.md](./SCRIPT-STANDARDS.md) | Template | Script standards and naming |

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
| [AGENT-GUIDE.md](./AGENT-GUIDE.md) | Complete | Project-specific agent notes |
| [terminology.md](./terminology.md) | Complete | AAIF, A2A, skills, compatibility, evidence, and runtime-project-memory terminology |
| [a2a/](./a2a/) | Template | A2A protocol examples and templates; some current examples still need A2A v1 alignment |
| [specs/](./specs/) | Complete | Feature specifications for WSL discovery, agent backend work, runtime-managed skills, scheduled wakeup substrate, provider compatibility/evidence, workspace substrate, executable delivery, session fork/context-transplant, usage metering/guardrails, setup diagnostic reporting, standalone provider bootstrap/generated-config direction, and advanced model catalog/selection contracts |
| [plans/](./plans/) | Complete | Implementation plans for WSL discovery, API/backend expansion, startup contract, runtime-managed skills, browser-preview substrate, provider compatibility/evidence, and metering/progress/guardrails |
| [decisions/](./decisions/) | Complete | Architecture Decision Records for packaging, install/check metadata, diagnostics, workspace substrate, delivery policy boundaries, runtime-owned metering/guardrails, LAN peer-sharing scope, standalone bootstrap/config boundaries, and advanced model-selection ownership |

**Legend**: Complete | Partial | Template

## Research

| Document | Status | Description |
|----------|--------|-------------|
| [research/](./research/) | Partial | Research notes and external sources, including Paperclip alignment notes, setup-diagnostic/report research, LAN peer-sharing exploration, a current maturity-gap assessment, and AAIF/A2A layering guidance |

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

## Current Documentation Gaps

The runtime's main contracts are now documented, but these areas still need
later passes:

- deeper browser-driver persistence, cleanup, and real-driver follow-ons beyond the current manual-driver substrate
- deeper API/local live-probe and model-discovery follow-ons
- project-specific security and MCP configuration docs beyond the inherited templates
- A2A examples once runtime-to-runtime collaboration surfaces stabilize

## Document Standards

- Use Markdown format
- Include a clear title and purpose at the top
- Keep documents focused and concise
- Update the "Last updated" date when modifying

---

*Last updated: 2026-03-25*
