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
| [SPEC-010](./SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md) | Usage Metering, Rate-Limit Detection, and Execution Guardrails | Draft (Pending Review) | TBD |
| [SPEC-009](./SPEC-009-executable-delivery-and-governance-primitives.md) | Executable Delivery and Governance Primitives | Draft (Pending Review) | TBD |
| [SPEC-008](./SPEC-008-workspace-substrate-init-audit-and-update.md) | Workspace Substrate Init, Audit, and Update | Draft (Pending Review) | TBD |
| [SPEC-007](./SPEC-007-provider-compatibility-and-evidence-engine.md) | Provider Compatibility and Evidence Engine | Draft (Pending Review) | TBD |
| [SPEC-006](./SPEC-006-a2a-protocol-project-memory-and-skill-layering.md) | A2A Protocol, Project Memory, and Skill Layering | Approved | TBD |
| [SPEC-005](./SPEC-005-runtime-managed-skills-v0.md) | Runtime-Managed Skills v0 | Draft | TBD |
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
*Last updated: 2026-03-20*
