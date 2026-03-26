# Architecture Decision Records (ADR)

> This directory contains Architecture Decision Records for documenting significant technical decisions.

## Purpose

ADRs capture the context, decision, and consequences of architectural choices. They help:

- Future developers understand *why* decisions were made
- Prevent re-discussing settled decisions
- Create institutional memory across sessions and team members

## When to Create an ADR

Create an ADR when:

- Choosing a framework, library, or technology
- Making architectural decisions (patterns, structure)
- Deciding between multiple valid alternatives
- Making decisions that are difficult to reverse

## Naming Convention

```
ADR-NNN-short-title.md

Examples:
ADR-001-use-postgresql-database.md
ADR-002-adopt-hexagonal-architecture.md
ADR-003-jwt-authentication.md
```

## Template

Use [000-template.md](./000-template.md) as the starting point for new ADRs.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [025-keep-provider-evolution-detection-manual-first-and-evidence-driven](./025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md) | Keep provider evolution detection manual-first and evidence-driven | Proposed | 2026-03-27 |
| [024-own-pluggable-execution-strategies-as-runtime-session-local-substrate](./024-own-pluggable-execution-strategies-as-runtime-session-local-substrate.md) | Own pluggable execution strategies as a runtime session-local substrate | Proposed | 2026-03-26 |
| [023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers](./023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers.md) | Treat management CLIs as runtime-owned control-plane adapters, not session providers | Accepted | 2026-03-25 |
| [022-model-advanced-selection-as-entries-presets-and-provider-specific-controls](./022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md) | Model advanced selection as entries, presets, and provider-specific controls | Accepted | 2026-03-25 |
| [021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it](./021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it.md) | Treat `providers.yaml` as generated config and bootstrap without it | Accepted | 2026-03-25 |
| [020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence](./020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence.md) | Keep setup diagnostic reports config-derived and separate from compatibility evidence | Accepted | 2026-03-25 |
| [019-scope-first-lan-peer-sharing-to-execution-only](./019-scope-first-lan-peer-sharing-to-execution-only.md) | Scope first LAN peer sharing to execution-only | Accepted | 2026-03-25 |
| [018-separate-skill-library-content-from-runtime-execution-engine](./018-separate-skill-library-content-from-runtime-execution-engine.md) | Separate skill-library content from runtime execution engine | Draft (Pending Review) | 2026-03-24 |
| [017-own-usage-metering-rate-limit-detection-and-execution-guardrails](./017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md) | Own usage metering, rate-limit detection, and execution guardrails | Accepted | 2026-03-20 |
| [016-own-executable-delivery-primitives-not-delivery-policy](./016-own-executable-delivery-primitives-not-delivery-policy.md) | Own executable delivery primitives, not delivery policy | Accepted | 2026-03-20 |
| [015-own-workspace-substrate-tools-in-cats-runtime](./015-own-workspace-substrate-tools-in-cats-runtime.md) | Own workspace substrate tools in `cats-runtime` | Accepted | 2026-03-20 |
| [014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime](./014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md) | Keep lightweight provider setup and diagnostics in `cats-runtime` | Accepted | 2026-03-20 |
| [013-extend-provider-manifests-with-install-and-check-metadata](./013-extend-provider-manifests-with-install-and-check-metadata.md) | Extend provider manifests with install and check metadata | Accepted | 2026-03-20 |
| [012-separate-evidence-memory-and-retrieval-layers](./012-separate-evidence-memory-and-retrieval-layers.md) | Separate evidence, durable memory, and retrieval layers | Accepted | 2026-03-19 |
| [011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers](./011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md) | Add a runtime-owned browser and preview subsystem with pluggable drivers | Proposed | 2026-03-19 |
| [010-separate-a2a-protocol-project-memory-and-skill-packages](./010-separate-a2a-protocol-project-memory-and-skill-packages.md) | Separate A2A protocol artifacts, project memory, and skill packages | Accepted | 2026-03-19 |
| [008-runtime-owned-provider-model-catalog](./008-runtime-owned-provider-model-catalog.md) | Keep provider model catalog discovery runtime-owned | Accepted | 2026-03-19 |
| [007-docker-runtime-adapter](./007-docker-runtime-adapter.md) | Docker runtime adapter | Accepted | 2026-03-17 |
| [009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup](./009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup.md) | Keep `cats-runtime` separately packageable with app-managed local startup | Proposed | 2026-03-19 |
| [007-docker-runtime-adapter](./007-docker-runtime-adapter.md) | Docker runtime adapter | Accepted | 2026-03-17 |
| [006-agent-backend-and-shared-runtime-contracts](./006-agent-backend-and-shared-runtime-contracts.md) | Introduce an agent backend and shared runtime contracts | Accepted | 2026-03-17 |
| [005-backend-neutral-runtime-and-api-backend](./005-backend-neutral-runtime-and-api-backend.md) | Introduce a backend-neutral runtime facade for CLI and API backends | Accepted | 2026-03-16 |
| [004-file-backed-paths-are-host-resolved](./004-file-backed-paths-are-host-resolved.md) | Resolve file-backed provider paths on the host | Accepted | 2026-03-16 |
| [003-provider-instance-config](./003-provider-instance-config.md) | Move provider execution topology into file-based provider instances | Accepted | 2026-03-15 |
| [002-embed-cli-runtime](./002-embed-cli-runtime.md) | Embed the CLI runtime into `cats-runtime` | Accepted | 2026-03-11 |
| [001-agent-fleet-http-adapter](./001-agent-fleet-http-adapter.md) | Use an HTTP adapter around `agent-fleet` first | Superseded | 2026-03-11 |
| [000-template](./000-template.md) | Template | - | - |
<!-- Add new ADRs above this line -->

## For AI Agents

1. **Before making a decision**: Check this directory for existing relevant records
2. **After making a decision**: Create a new ADR using the template
3. **Update the index**: Add the new ADR to the table above

---

*Last updated: 2026-03-27*

*See also: [AGENTS.md](../../../AGENTS.md) for decision-making protocols*
