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
| [PLAN-032](./PLAN-032-acp-agent-adapters-and-runtime-facade.md) | ACP Agent Adapters and Runtime ACP Facade | In Progress (Phase 4 Runtime HTTP/Stdio Facades Landed; Phase 5 Layering Baseline Landed; config/diagnostics follow-through continues) | [SPEC-025](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md), [ADR-031](../decisions/031-keep-acp-inside-agent-backend-and-model-runtime-acp-as-a-separate-facade.md), [ADR-026](../decisions/026-model-a2a-as-an-agent-backend-adapter.md) |
| [PLAN-031](./PLAN-031-align-runtime-build-output-under-build-runtime.md) | Align Runtime Build Output Under `build/runtime` | Completed | N/A |
| [PLAN-030](./PLAN-030-provider-setup-workflow-rail-and-workspace-split.md) | Provider Setup Workflow Rail and Workspace Split | Completed | [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md), [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md), [ADR-027](../decisions/027-adopt-a-playground-derived-dark-runtime-ui-shell-with-sidebar-surface-switching.md) |
| [PLAN-028](./PLAN-028-truthful-provider-refusal-rate-limit-and-overload-surfacing.md) | Truthful Provider Refusal, Rate-Limit, and Overload Surfacing | Draft | [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md), [SPEC-007](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md), [ADR-017](../decisions/017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md) |
| [PLAN-027](./PLAN-027-kilo-cli-provider-support-and-consumption.md) | Independent Kilo CLI Provider Support and Product Consumption | Completed | [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md), [SPEC-018](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md), [SPEC-023](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md) |
| [PLAN-026](./PLAN-026-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md) | Verified Advanced Provider Catalogs and Manual-Refresh Discovery | Completed | [SPEC-023](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md), [ADR-029](../decisions/029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md) |
| [PLAN-025](./PLAN-025-executable-packaging-and-publish-follow-through.md) | Executable Packaging and Publish Follow-Through | Completed (Repo-Owned Pre-Publish Prep and Publish-Workflow Skeleton Landed) | [ROADMAP OPT-15](../../ROADMAP.md), [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md), [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md) |
| [PLAN-024](./PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md) | Runtime Skill Library, Setup Diagnostics, and Wakeup Follow-Through | Completed | [SPEC-013](../specs/SPEC-013-internal-skill-library-and-role-taxonomy.md), [SPEC-015](../specs/SPEC-015-runtime-setup-diagnostic-report.md), [SPEC-012](../specs/SPEC-012-scheduled-wakeup-substrate.md) |
| [PLAN-023](./PLAN-023-a2a-layering-and-collaboration-artifact-alignment.md) | A2A Layering and Collaboration Artifact Alignment | Completed (Pilot Collaboration Baseline and Repo-Owned Rewrite Landed) | [SPEC-006](../specs/SPEC-006-a2a-protocol-project-memory-and-skill-layering.md), [ADR-010](../decisions/010-separate-a2a-protocol-project-memory-and-skill-packages.md) |
| [PLAN-022](./PLAN-022-stdio-mcp-proxy-to-primary-runtime.md) | Stdio MCP Proxy to the Primary Runtime | Completed | [SPEC-022](../specs/SPEC-022-stdio-mcp-proxy-to-primary-runtime.md), [ADR-028](../decisions/028-proxy-stdio-mcp-to-the-primary-runtime-http-surface.md) |
| [PLAN-021](./PLAN-021-provider-evolution-evidence-and-capability-probes.md) | Provider Evolution Evidence and Capability Probes | Completed | [SPEC-021](../specs/SPEC-021-provider-evolution-evidence-and-capability-probes.md), [ADR-025](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md), [ADR-026](../decisions/026-model-a2a-as-an-agent-backend-adapter.md) |
| [PLAN-020](./PLAN-020-pluggable-execution-strategy-substrate.md) | Pluggable Execution Strategy Substrate | Completed | [SPEC-020](../specs/SPEC-020-pluggable-execution-strategy-substrate.md), [ADR-024](../decisions/024-own-pluggable-execution-strategies-as-runtime-session-local-substrate.md) |
| [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md) | Shared Runtime UI Foundation for Dashboard, Playground, and Provider Setup | In Progress (Shared Shell, HTML Emit, and Manual Repair Landed) | [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md), [ADR-027](../decisions/027-adopt-a-playground-derived-dark-runtime-ui-shell-with-sidebar-surface-switching.md) |
| [PLAN-018](./PLAN-018-advanced-provider-model-catalog-and-selection-schema.md) | Advanced Provider Model Catalog and Selection Schema | Completed | [SPEC-018](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md), [ADR-022](../decisions/022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md) |
| [PLAN-017](./PLAN-017-lan-peer-discovery-and-execution-routing-v0.md) | LAN Peer Discovery and Execution Routing v0 | Completed | [SPEC-016](../specs/SPEC-016-lan-peer-discovery-and-execution-routing-v0.md), [ADR-019](../decisions/019-scope-first-lan-peer-sharing-to-execution-only.md) |
| [PLAN-013](./PLAN-013-browser-preview-substrate-v0.md) | Browser Preview Substrate v0 | Completed | [ADR-011](../decisions/011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md), [cats SPEC-020](../../../cats-platform/docs/specs/SPEC-020-embedded-preview-surfaces-for-runtime-artifacts-and-services.md) |
| [PLAN-014](./PLAN-014-worktree-isolation-execution-layer.md) | Worktree Isolation Execution Layer | Completed | [SPEC-008](../specs/SPEC-008-workspace-substrate-init-audit-and-update.md), [SPEC-011](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md) |
| [PLAN-016](./PLAN-016-management-adapter-subsystem.md) | Management Adapter Subsystem | Completed | [SPEC-019](../specs/SPEC-019-runtime-owned-management-adapters-for-forge-and-deployment-control-planes.md), [ADR-023](../decisions/023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers.md) |
| [PLAN-015](./PLAN-015-mcp-mutation-tools-and-stdio-facade.md) | MCP Mutation Tools and Stdio Facade | Completed | [cats ADR-008](../../../cats-platform/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md), [cats SPEC-015](../../../cats-platform/docs/specs/SPEC-015-cat-capability-registry-and-runtime-skill-mcp-mapping.md), [cats SPEC-021](../../../cats-platform/docs/specs/SPEC-021-contextual-mcp-profiles-and-lazy-tool-activation.md) |
| [PLAN-012](./PLAN-012-session-maintenance-hooks-and-cleanup-discipline.md) | Session Maintenance Hooks and Cleanup Discipline | Completed | [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md), [SPEC-011](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md) |
| [PLAN-011](./PLAN-011-workspace-hydration-and-runtime-skill-reentry.md) | Workspace Hydration and Runtime Skill Re-entry | Completed | [SPEC-005](../specs/SPEC-005-runtime-managed-skills-v0.md), [SPEC-008](../specs/SPEC-008-workspace-substrate-init-audit-and-update.md) |
| [PLAN-010](./PLAN-010-session-discipline-and-run-inspector.md) | Session Discipline and Run Inspector Contracts | Completed | [SPEC-003](../specs/SPEC-003-agent-backend.md), [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md), [SPEC-011](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md) |
| [PLAN-029-provider-compatibility-and-evidence-engine](./PLAN-029-provider-compatibility-and-evidence-engine.md) | Provider Compatibility and Evidence Engine | In Progress (Core Delivered; Follow-Ons Remain) | [SPEC-007](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md) |
| [PLAN-008-runtime-managed-skills-v0](./PLAN-008-runtime-managed-skills-v0.md) | Runtime-Managed Skills v0 | Completed | [SPEC-005](../specs/SPEC-005-runtime-managed-skills-v0.md) |
| [PLAN-009](./PLAN-009-usage-metering-progress-and-guardrails.md) | Usage Metering, Provider-Agnostic Progress, and Guardrails | Completed | [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md) |
| [PLAN-007](./PLAN-007-stream-event-discriminated-union.md) | StreamEvent Discriminated Union Cleanup | Completed | N/A |
| [PLAN-005](./PLAN-005-provider-model-catalog-and-discovery.md) | Provider Model Catalog and Discovery | Completed | [SPEC-004](../specs/SPEC-004-provider-model-catalog-and-discovery.md) |
| [PLAN-006](./PLAN-006-standalone-and-app-managed-startup-contract.md) | Standalone and App-Managed Startup Contract | Completed | N/A |
| [PLAN-004](./PLAN-004-agent-backend.md) | Agent Backend for OpenClaw and Future Agent SDK Runtimes | Completed | [SPEC-003](../specs/SPEC-003-agent-backend.md) |
| [PLAN-003](./PLAN-003-api-backend.md) | API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama | In Progress (Provider-Specific Optimizations Remain) | [SPEC-002](../specs/SPEC-002-local-tool-runtime.md) (shared local tool runtime slice) |
| [PLAN-002](./PLAN-002-provider-instance-review-followups.md) | Provider Instance Review Follow-ups | Completed | N/A |
| [PLAN-001](./PLAN-001-wsl-discovery-policy.md) | WSL Discovery Policy and Dashboard Visibility | Completed | [SPEC-001](../specs/SPEC-001-wsl-discovery-policy.md) |
| [000-template](./000-template.md) | Template | - | - |
<!-- Add new plans above this line -->

## Governance Notes

- `PLAN-003` is broader than `SPEC-002`, but it is the canonical delivery
  track for the shared local tool runtime slice that `SPEC-002` describes.
- `PLAN-024` collected the important follow-through for `SPEC-012`,
  `SPEC-013`, and `SPEC-015`; that follow-through is now complete.
- `PLAN-023` is complete for the current `SPEC-006` pilot scope: the repo-owned
  collaboration rewrite and split-safe sibling alignment are landed, while any
  broader production-default adoption remains a separate governance decision.
- `PLAN-027` is complete: Kilo is already landed as an independent CLI provider
  across runtime config, compatibility/setup truth, native session routes, and
  packaged/product consumption. Its only submodule-derived input was
  `environment-bootstrap` install/check knowledge; `project-bootstrap` had no
  Kilo-specific extraction scope.

## For AI Agents

1. **Link to spec**: Always reference the related SPEC document
2. **Update progress**: Mark tasks complete as you work
3. **Log updates**: Add entries to the Progress Log section

---

*See also: [specs/](../specs/) for feature specifications*
*Last updated: 2026-04-15*
