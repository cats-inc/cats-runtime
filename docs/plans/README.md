# Implementation Plans

> This directory contains implementation plans that define *how* to build features.

## Purpose

Implementation plans break down approved specifications into actionable tasks. They help:

- Coordinate work across multiple developers/agents
- Track progress through implementation phases
- Document technical decisions made during development

## When to Create a Plan

Create a plan when:

- A specification (SPEC) has been approved
- The feature requires multiple implementation phases
- Work needs to be coordinated across multiple contributors

## Workflow

```
1. Spec approved → Create plan
2. Break into phases → Define tasks
3. Implement → Update progress
4. Complete → Mark as done
```

## Naming Convention

```
PLAN-NNN-short-title.md

Examples:
PLAN-001-user-authentication.md
PLAN-002-api-rate-limiting.md
PLAN-003-database-migration.md
```

## Template

Use [000-template.md](./000-template.md) as the starting point for new plans.

## Index

| Plan | Title | Status | Related Spec |
|------|-------|--------|--------------|
| [PLAN-018](./PLAN-018-advanced-provider-model-catalog-and-selection-schema.md) | Advanced Provider Model Catalog and Selection Schema | Draft | [SPEC-018](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md), [ADR-022](../decisions/022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md) |
| [PLAN-013](./PLAN-013-browser-preview-substrate-v0.md) | Browser Preview Substrate v0 | Completed | [ADR-011](../decisions/011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md), [cats SPEC-020](../../../cats/docs/specs/SPEC-020-embedded-preview-surfaces-for-runtime-artifacts-and-services.md) |
| [PLAN-014](./PLAN-014-worktree-isolation-execution-layer.md) | Worktree Isolation Execution Layer | Completed | [SPEC-008](../specs/SPEC-008-workspace-substrate-init-audit-and-update.md), [SPEC-011](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md) |
| [PLAN-016](./PLAN-016-management-adapter-subsystem.md) | Management Adapter Subsystem | Completed | [SPEC-019](../specs/SPEC-019-runtime-owned-management-adapters-for-forge-and-deployment-control-planes.md), [ADR-023](../decisions/023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers.md) |
| [PLAN-015](./PLAN-015-mcp-mutation-tools-and-stdio-facade.md) | MCP Mutation Tools and Stdio Facade | Completed | [cats ADR-008](../../../cats/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md), [cats SPEC-015](../../../cats/docs/specs/SPEC-015-cat-capability-registry-and-runtime-skill-mcp-mapping.md), [cats SPEC-021](../../../cats/docs/specs/SPEC-021-contextual-mcp-profiles-and-lazy-tool-activation.md) |
| [PLAN-012](./PLAN-012-session-maintenance-hooks-and-cleanup-discipline.md) | Session Maintenance Hooks and Cleanup Discipline | Completed | [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md), [SPEC-011](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md) |
| [PLAN-011](./PLAN-011-workspace-hydration-and-runtime-skill-reentry.md) | Workspace Hydration and Runtime Skill Re-entry | Completed | [SPEC-005](../specs/SPEC-005-runtime-managed-skills-v0.md), [SPEC-008](../specs/SPEC-008-workspace-substrate-init-audit-and-update.md) |
| [PLAN-010](./PLAN-010-session-discipline-and-run-inspector.md) | Session Discipline and Run Inspector Contracts | Completed | [SPEC-003](../specs/SPEC-003-agent-backend.md), [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md), [SPEC-011](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md) |
| [PLAN-008-provider-compatibility-and-evidence-engine](./PLAN-008-provider-compatibility-and-evidence-engine.md) | Provider Compatibility and Evidence Engine | In Progress (First Slice Landed) | [SPEC-007](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md) |
| [PLAN-008-runtime-managed-skills-v0](./PLAN-008-runtime-managed-skills-v0.md) | Runtime-Managed Skills v0 | Completed | [SPEC-005](../specs/SPEC-005-runtime-managed-skills-v0.md) |
| [PLAN-009](./PLAN-009-usage-metering-progress-and-guardrails.md) | Usage Metering, Provider-Agnostic Progress, and Guardrails | Completed | [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md) |
| [PLAN-007](./PLAN-007-stream-event-discriminated-union.md) | StreamEvent Discriminated Union Cleanup | Draft | N/A |
| [PLAN-005](./PLAN-005-provider-model-catalog-and-discovery.md) | Provider Model Catalog and Discovery | Draft | [SPEC-004](../specs/SPEC-004-provider-model-catalog-and-discovery.md) |
| [PLAN-006](./PLAN-006-standalone-and-app-managed-startup-contract.md) | Standalone and App-Managed Startup Contract | In Progress | N/A |
| [PLAN-004](./PLAN-004-agent-backend.md) | Agent Backend for OpenClaw and Future Agent SDK Runtimes | In Progress | [SPEC-003](../specs/SPEC-003-agent-backend.md) |
| [PLAN-003](./PLAN-003-api-backend.md) | API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama | In Progress | N/A |
| [PLAN-002](./PLAN-002-provider-instance-review-followups.md) | Provider Instance Review Follow-ups | Completed | N/A |
| [PLAN-001](./PLAN-001-wsl-discovery-policy.md) | WSL Discovery Policy and Dashboard Visibility | Completed | [SPEC-001](../specs/SPEC-001-wsl-discovery-policy.md) |
| [000-template](./000-template.md) | Template | - | - |
<!-- Add new plans above this line -->

## For AI Agents

1. **Link to spec**: Always reference the related SPEC document
2. **Update progress**: Mark tasks complete as you work
3. **Log updates**: Add entries to the Progress Log section

---

*See also: [specs/](../specs/) for feature specifications*
*Last updated: 2026-03-25*
