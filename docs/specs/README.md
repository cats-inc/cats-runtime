# Feature Specifications

> This directory contains feature specifications that define *what* to build and *why*.

## Purpose

Specifications define requirements before implementation begins. They help:

- Clarify what needs to be built
- Get stakeholder approval before coding
- Prevent scope creep during implementation
- Ensure AI agents understand requirements fully

## When to Create a Spec

Create a spec when:

- Adding a new feature with multiple components
- Making changes that affect multiple files or systems
- The feature requires user/stakeholder approval
- Requirements need to be documented for future reference

## Workflow

```
1. Identify need → Create spec
2. Define requirements → Get approval
3. Create plan → Implement
4. Mark as implemented
```

## Naming Convention

```
SPEC-NNN-short-title.md

Examples:
SPEC-001-user-registration.md
SPEC-002-payment-integration.md
SPEC-003-notification-system.md
```

## Template

Use [000-template.md](./000-template.md) as the starting point for new specs.

## Index

| Spec | Title | Status | Related Plan |
|------|-------|--------|--------------|
| [SPEC-025](./SPEC-025-acp-agent-adapters-and-runtime-facade.md) | ACP Agent Adapters and Runtime ACP Facade | In Progress | [PLAN-032](../plans/PLAN-032-acp-agent-adapters-and-runtime-facade.md) |
| [SPEC-024](./SPEC-024-curated-cli-catalog-pack-and-evidence-overlay.md) | Curated CLI Catalog Input and Runtime Evidence Overlay | Draft | TBD |
| [SPEC-023](./SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md) | Verified Advanced Provider Catalogs and Manual-Refresh Discovery | In Progress (Safety, Cache-First Reads, and Entry-Scoped Controls Landed) | [PLAN-026](../plans/PLAN-026-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md) |
| [SPEC-022](./SPEC-022-stdio-mcp-proxy-to-primary-runtime.md) | Stdio MCP Proxy to the Primary Runtime | Completed | [PLAN-022](../plans/PLAN-022-stdio-mcp-proxy-to-primary-runtime.md) |
| [SPEC-021](./SPEC-021-provider-evolution-evidence-and-capability-probes.md) | Provider Evolution Evidence and Capability Probes | In Progress (Core Manual-First Slices Landed) | [PLAN-021](../plans/PLAN-021-provider-evolution-evidence-and-capability-probes.md) |
| [SPEC-020](./SPEC-020-pluggable-execution-strategy-substrate.md) | Pluggable Execution Strategy Substrate | Implemented | [PLAN-020](../plans/PLAN-020-pluggable-execution-strategy-substrate.md) |
| [SPEC-019](./SPEC-019-runtime-owned-management-adapters-for-forge-and-deployment-control-planes.md) | Runtime-Owned Management Adapters for Forge and Deployment Control Planes | Implemented (Slice 1) | [PLAN-016](../plans/PLAN-016-management-adapter-subsystem.md) |
| [SPEC-018](./SPEC-018-advanced-provider-model-catalog-and-selection-schema.md) | Advanced Provider Model Catalog and Selection Schema | Implemented | [PLAN-018](../plans/PLAN-018-advanced-provider-model-catalog-and-selection-schema.md) |
| [SPEC-017](./SPEC-017-standalone-provider-bootstrap-and-generated-config.md) | Standalone Provider Bootstrap and Generated Config | In Progress (Bootstrap Core, Shared Shell, HTML Emit, and Package Baseline Landed) | [PLAN-019](../plans/PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md) |
| [SPEC-016](./SPEC-016-lan-peer-discovery-and-execution-routing-v0.md) | LAN Peer Discovery and Execution Routing v0 | Implemented | [PLAN-017](../plans/PLAN-017-lan-peer-discovery-and-execution-routing-v0.md) |
| [SPEC-015](./SPEC-015-runtime-setup-diagnostic-report.md) | Runtime Setup Diagnostic Report | Implemented | [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md) |
| [SPEC-014](./SPEC-014-session-maintenance-worktree-isolation-and-compaction-hooks.md) | Session Maintenance, Worktree Isolation, and Compaction Hooks | Implemented (Maintenance and Runtime Compaction Slices) | [PLAN-012](../plans/PLAN-012-session-maintenance-hooks-and-cleanup-discipline.md), [PLAN-014](../plans/PLAN-014-worktree-isolation-execution-layer.md) |
| [SPEC-013](./SPEC-013-internal-skill-library-and-role-taxonomy.md) | Internal Skill Library and Role Taxonomy | Implemented | [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md) |
| [SPEC-012](./SPEC-012-scheduled-wakeup-substrate.md) | Scheduled Wakeup Substrate | Implemented (Recurring Slice) | [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md) |
| [SPEC-011](./SPEC-011-session-fork-and-context-transplant-primitives.md) | Session Fork and Context-Transplant Primitives | Implemented (Slice 1) | [PLAN-010](../plans/PLAN-010-session-discipline-and-run-inspector.md), [PLAN-012](../plans/PLAN-012-session-maintenance-hooks-and-cleanup-discipline.md) |
| [SPEC-010](./SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md) | Usage Metering, Rate-Limit Detection, and Execution Guardrails | In Progress (First Slice Landed) | [PLAN-009](../plans/PLAN-009-usage-metering-progress-and-guardrails.md) |
| [SPEC-009](./SPEC-009-executable-delivery-and-governance-primitives.md) | Executable Delivery and Governance Primitives | Implemented (Slice 1) | [PLAN-015](../plans/PLAN-015-mcp-mutation-tools-and-stdio-facade.md) |
| [SPEC-008](./SPEC-008-workspace-substrate-init-audit-and-update.md) | Workspace Substrate Init, Audit, and Update | Implemented (First Slice) | [PLAN-014](../plans/PLAN-014-worktree-isolation-execution-layer.md) |
| [SPEC-007](./SPEC-007-provider-compatibility-and-evidence-engine.md) | Provider Compatibility and Evidence Engine | In Progress (Second Slice Landed) | [PLAN-029-provider-compatibility-and-evidence-engine](../plans/PLAN-029-provider-compatibility-and-evidence-engine.md) |
| [SPEC-006](./SPEC-006-a2a-protocol-project-memory-and-skill-layering.md) | A2A Protocol, Project Memory, and Skill Layering | Implemented (Pilot Collaboration Baseline Landed; Production-Default Adoption Deferred) | [PLAN-023](../plans/PLAN-023-a2a-layering-and-collaboration-artifact-alignment.md) |
| [SPEC-005](./SPEC-005-runtime-managed-skills-v0.md) | Runtime-Managed Skills v0 | Implemented | [PLAN-008-runtime-managed-skills-v0](../plans/PLAN-008-runtime-managed-skills-v0.md) |
| [SPEC-004](./SPEC-004-provider-model-catalog-and-discovery.md) | Provider Model Catalog and Discovery | Implemented (Core Slice) | [PLAN-005](../plans/PLAN-005-provider-model-catalog-and-discovery.md) |
| [SPEC-003](./SPEC-003-agent-backend.md) | Agent Backend for External Agent Runtimes | Implemented | [PLAN-004](../plans/PLAN-004-agent-backend.md) |
| [SPEC-002](./SPEC-002-local-tool-runtime.md) | Shared Local Tool Runtime | Implemented (Shared Tool Runtime Slice) | [PLAN-003](../plans/PLAN-003-api-backend.md) (shared local tool runtime slice) |
| [SPEC-001](./SPEC-001-wsl-discovery-policy.md) | WSL Discovery Policy and Dashboard Status | Implemented | [PLAN-001](../plans/PLAN-001-wsl-discovery-policy.md) |
| [000-template](./000-template.md) | Template | - | - |
<!-- Add new specs above this line -->

## Governance Notes

- `SPEC-002` is delivered through the shared local tool runtime slice inside
  `PLAN-003`; the plan remains broader than this one spec.
- `SPEC-012`, `SPEC-013`, and `SPEC-015` were implemented directly in their
  first slices; the later follow-through collected under `PLAN-024` is now
  complete.
- `SPEC-006` is implemented for the current pilot scope through `PLAN-023`:
  the repo-owned collaboration rewrite and split-safe sibling alignment are in
  repo, while broader production-default adoption remains a separate governance
  question.

## For AI Agents

1. **Before implementing**: Create spec for complex features
2. **Get approval**: Wait for review before proceeding to implementation
3. **Link to plan**: Reference the related PLAN document when created

---

*See also: [plans/](../plans/) for implementation plans*
*Last updated: 2026-04-15*
