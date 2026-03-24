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
| [SPEC-019](./SPEC-019-runtime-owned-management-adapters-for-forge-and-deployment-control-planes.md) | Runtime-Owned Management Adapters for Forge and Deployment Control Planes | Draft | TBD |
| [SPEC-018](./SPEC-018-advanced-provider-model-catalog-and-selection-schema.md) | Advanced Provider Model Catalog and Selection Schema | Draft | TBD |
| [SPEC-017](./SPEC-017-standalone-provider-bootstrap-and-generated-config.md) | Standalone Provider Bootstrap and Generated Config | Draft | TBD |
| [SPEC-016](./SPEC-016-lan-peer-discovery-and-execution-routing-v0.md) | LAN Peer Discovery and Execution Routing v0 | Draft | TBD |
| [SPEC-015](./SPEC-015-runtime-setup-diagnostic-report.md) | Runtime Setup Diagnostic Report | Draft | TBD |
| [SPEC-014](./SPEC-014-session-maintenance-worktree-isolation-and-compaction-hooks.md) | Session Maintenance, Worktree Isolation, and Compaction Hooks | Draft (Pending Review) | TBD |
| [SPEC-013](./SPEC-013-internal-skill-library-and-role-taxonomy.md) | Internal Skill Library and Role Taxonomy | Draft (Pending Review) | TBD |
| [SPEC-012](./SPEC-012-scheduled-wakeup-substrate.md) | Scheduled Wakeup Substrate | In Progress (First Slice Landed) | TBD |
| [SPEC-011](./SPEC-011-session-fork-and-context-transplant-primitives.md) | Session Fork and Context-Transplant Primitives | Draft (Pending Review) | TBD |
| [SPEC-010](./SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md) | Usage Metering, Rate-Limit Detection, and Execution Guardrails | In Progress (First Slice Landed) | [PLAN-009](../plans/PLAN-009-usage-metering-progress-and-guardrails.md) |
| [SPEC-009](./SPEC-009-executable-delivery-and-governance-primitives.md) | Executable Delivery and Governance Primitives | Draft (Pending Review) | TBD |
| [SPEC-008](./SPEC-008-workspace-substrate-init-audit-and-update.md) | Workspace Substrate Init, Audit, and Update | Draft (Pending Review) | TBD |
| [SPEC-007](./SPEC-007-provider-compatibility-and-evidence-engine.md) | Provider Compatibility and Evidence Engine | In Progress (First Slice Landed) | [PLAN-008-provider-compatibility-and-evidence-engine](../plans/PLAN-008-provider-compatibility-and-evidence-engine.md) |
| [SPEC-006](./SPEC-006-a2a-protocol-project-memory-and-skill-layering.md) | A2A Protocol, Project Memory, and Skill Layering | Approved | TBD |
| [SPEC-005](./SPEC-005-runtime-managed-skills-v0.md) | Runtime-Managed Skills v0 | In Progress (First Slice Landed) | [PLAN-008-runtime-managed-skills-v0](../plans/PLAN-008-runtime-managed-skills-v0.md) |
| [SPEC-004](./SPEC-004-provider-model-catalog-and-discovery.md) | Provider Model Catalog and Discovery | Approved | [PLAN-005](../plans/PLAN-005-provider-model-catalog-and-discovery.md) |
| [SPEC-003](./SPEC-003-agent-backend.md) | Agent Backend for External Agent Runtimes | Approved | [PLAN-004](../plans/PLAN-004-agent-backend.md) |
| [SPEC-002](./SPEC-002-local-tool-runtime.md) | Shared Local Tool Runtime | Approved | [PLAN-003](../plans/PLAN-003-api-backend.md) |
| [SPEC-001](./SPEC-001-wsl-discovery-policy.md) | WSL Discovery Policy and Dashboard Status | Implemented | [PLAN-001](../plans/PLAN-001-wsl-discovery-policy.md) |
| [000-template](./000-template.md) | Template | - | - |
<!-- Add new specs above this line -->

## For AI Agents

1. **Before implementing**: Create spec for complex features
2. **Get approval**: Wait for review before proceeding to implementation
3. **Link to plan**: Reference the related PLAN document when created

---

*See also: [plans/](../plans/) for implementation plans*
*Last updated: 2026-03-25*
