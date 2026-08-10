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
| [architecture.md](./architecture.md) | Complete | Embedded runtime architecture, backend layering, runtime-owned skill / compatibility / metering / session-maintenance / browser-preview seams, and the ACP vs A2A protocol stack |
| [api.md](./api.md) | Complete | Supported public HTTP contract, including skills, diagnostics, progress, guardrails, browser sessions/pages, preview surfaces, compatibility summaries, session maintenance metadata, and the bounded ACP facade |

## Development Guides

| Document | Status | Description |
|----------|--------|-------------|
| [setup-guide.md](./setup-guide.md) | Complete | Environment setup, startup contract, and diagnostics/compatibility basics |
| [testing.md](./testing.md) | Complete | Testing strategy |
| [deployment.md](./deployment.md) | Complete | Standalone and app-managed local deployment guidance |
| [release-guide.md](./release-guide.md) | Complete | npm packaging, release, and repo-owned trusted publishing readiness workflow |
| [security-guidelines.md](./security-guidelines.md) | Partial | Runtime-specific secret/auth boundaries are documented, but deeper project-specific hardening guidance still needs follow-through |
| [mcp-config.md](./mcp-config.md) | Partial | Current MCP facade ownership, transport, auth, and representative tool coverage are documented, but the full tool inventory and host setup patterns still need a later pass |
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
| [terminology.md](./terminology.md) | Complete | AAIF, ACP, A2A, skills, compatibility, evidence, control-plane adapter, and runtime/project/protocol layering terminology |
| [a2a/](./a2a/) | Complete | Pilot-owned A2A v1.0 example set for future adapter work; standards-aligned docs, not a claim of a live A2A endpoint today |
| [specs/](./specs/) | Complete | Feature specifications for runtime capabilities and future delivery tracks, including advanced provider-catalog truthfulness, human-curated CLI catalog inputs, manual-refresh discovery follow-through, and the new ACP agent-adapter/runtime-facade direction; see `specs/README.md` for the full list |
| [plans/](./plans/) | Complete | Implementation plans for WSL discovery, API/backend expansion, startup contract, runtime-managed skills, browser-preview substrate, provider compatibility/evidence, metering/progress/guardrails, truthful provider-refusal surfacing, provider advanced-catalog hardening, independent Kilo CLI provider support, the setup workflow-rail / workspace-split follow-through, and ACP staging |
| [decisions/](./decisions/) | Complete | Architecture Decision Records for packaging, install/check metadata, diagnostics, workspace substrate, delivery policy boundaries, runtime-owned metering/guardrails, LAN peer-sharing scope, standalone bootstrap/config boundaries, advanced model-selection ownership, management-adapter boundaries, provider-evolution evidence boundaries, conservative verified provider-catalog policy, and ACP layering |

**Legend**: Complete | Partial | Template

## Research

| Document | Status | Description |
|----------|--------|-------------|
| [research/](./research/) | Partial | Research notes and external sources, including Paperclip alignment notes, setup-diagnostic/report research, LAN peer-sharing exploration, workspace contract terminology/semantics, a current maturity-gap assessment, AAIF/A2A layering guidance, ACP alignment notes, a CLI provider event-capability audit, provider-evolution evidence framing, and trusted-publishing readiness notes |

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
- fuller project-specific security hardening and MCP host-configuration coverage beyond the current baseline docs
- a live A2A server/Agent Card surface; the current A2A files are still pilot-owned examples rather than active endpoints
- `cats`-side follow-through so the first-wave pilot exists in both main repos instead of `cats-runtime` alone

## Document Standards

- Use Markdown format
- Include a clear title and purpose at the top
- Keep documents focused and concise
- Update the "Last updated" date when modifying

---

*Last updated: 2026-04-20*
