# PLAN-009: Usage Metering, Provider-Agnostic Progress, and Guardrails

> Implementation plan for the first shared runtime slice of usage telemetry,
> incident detection, execution guardrails, and provider-agnostic progress
> events.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / metering workstream |

## Related Specs

- [SPEC-010: Usage Metering, Rate-Limit Detection, and Execution Guardrails](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [SPEC-025: Budget Policy, Override Flows, and War-Room Dashboard](../../../cats-platform/docs/specs/SPEC-025-budget-policy-override-flows-and-war-room-dashboard.md)

## Overview

The first slice should stay runtime-owned and additive.

`cats-runtime` will gain one shared metering subsystem that:

- normalizes per-turn usage into a runtime contract
- records machine-readable incidents for rate limits and quota failures
- enforces minimal warn / block / cooldown guardrails without importing
  product-level budget policy
- upgrades CLI progress parsing so hosts can consume one `progress` event shape
  across Junie and other providers

The implementation should avoid broad wire-format churn. Existing `result`,
`error`, and session payloads stay compatible; richer usage, incident, and
guardrail facts are added through runtime-owned diagnostics and additive event
metadata.

## Scope

### In Scope

- shared `RuntimeUsageRecord`, incident, and guardrail contracts in
  `src/core/types.ts`
- a runtime-owned metering service under `src/core/usage/`
- normalized usage observation from streamed turn events
- rate-limit / quota incident detection from API and CLI execution paths
- minimal preflight guardrails:
  - warn on configured session token thresholds
  - block on configured session token thresholds
  - cooldown on detected provider-instance rate limits
- additive diagnostics surfacing for usage, incidents, cooldowns, and active
  guardrail state
- provider-agnostic `progress` events for at least:
  - `junie`
  - `pi`
  - `goose`
  - `copilot`

### Out of Scope

- company/workspace budget policy
- approval / override orchestration
- provider compatibility profile selection
- large-scale `StreamEvent` redesign beyond what the new progress contract
  requires
- forcing exact cost data where providers do not expose it

## Implementation Phases

### Phase 1: Core Contracts and Metering Service

- [x] Add shared runtime metering, incident, guardrail, and progress contract
      types in `src/core/types.ts`
- [x] Add `src/core/usage/RuntimeMeteringService.ts` plus small helpers for
      normalization, incident detection, and aggregate reads
- [x] Extend runtime config parsing with additive guardrail knobs only for the
      first slice
- [x] Wire the metering service into runtime bootstrap and app context

**Deliverables**: shared types exist, runtime owns one metering service, and
the guardrail configuration surface is defined.

### Phase 2: Runtime Observation and Guardrails

- [x] Observe streamed turn usage and latency in `src/http/routes/messages.ts`
- [x] Normalize API/local progress and incident metadata in
      `src/backends/api/runtime/ApiBackendManager.ts`
- [x] Detect and persist rate-limit / quota incidents from API transport
      failures and CLI/agent error events
- [x] Enforce warn / block / cooldown preflight results before turn execution
      begins
- [x] Surface guardrail outcomes machine-readably to hosts and dashboards

**Deliverables**: runtime records usage and incidents across backends, applies
minimal guardrails, and exposes additive machine-readable results.

### Phase 3: Provider-Agnostic CLI Progress

- [x] Normalize Junie progress onto first-class `progress` events
- [x] Extend Pi to emit normalized reasoning / tool / execution progress
- [x] Extend Goose to emit normalized execution/tool progress
- [x] Extend Copilot to emit normalized reasoning / tool / session progress
- [x] Keep provider-native details additive in `metadata.native`

**Deliverables**: multiple CLI providers emit one runtime-owned progress
contract without forcing consumers to parse provider-native raw payloads.

### Phase 4: Verification and Documentation

- [x] Update tests for progress, metering, diagnostics, and guardrail behavior
- [x] Update `docs/api.md`, `docs/architecture.md`, `README.md`, `PROGRESS.md`,
      and `ROADMAP.md`
- [x] Link `SPEC-010` to this plan and record status in plan/progress docs
- [x] Run targeted build and Vitest coverage for the touched runtime surfaces

**Deliverables**: docs match the shipped contract and the new runtime behavior
has regression coverage.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/types.ts` | Modify | Add runtime usage, incident, guardrail, and progress contract types |
| `src/core/usage/RuntimeMeteringService.ts` | Create | Shared runtime metering, incident, and guardrail state |
| `src/core/usage/incidentDetection.ts` | Create | Shared incident normalization and cooldown helpers |
| `src/backends/cli/config.ts` | Modify | Add additive first-slice guardrail config parsing |
| `src/http/app.ts` | Modify | Inject metering service into app context |
| `src/server.ts` | Modify | Bootstrap the metering service |
| `src/http/routes/messages.ts` | Modify | Observe usage/latency and enforce preflight guardrails |
| `src/http/routes/diagnostics.ts` | Modify | Surface usage, incidents, cooldowns, and guardrail summaries |
| `src/backends/api/runtime/ApiBackendManager.ts` | Modify | Normalize progress and error/incident metadata for API/local turns |
| `src/backends/cli/junie/*` | Modify | Convert Junie raw progress into normalized progress events |
| `src/backends/cli/pi/*` | Modify | Emit normalized Pi progress and richer usage hints |
| `src/backends/cli/goose/*` | Modify | Emit normalized Goose progress and richer usage hints |
| `src/backends/cli/providers/copilot.ts` | Modify | Emit normalized Copilot progress and richer usage hints |
| `tests/*.test.ts` | Modify | Cover diagnostics, progress, incidents, and guardrails |
| `docs/plans/README.md` | Modify | Index the new plan |
| `docs/specs/README.md` | Modify | Link `SPEC-010` to the new plan |

## Technical Decisions

- Keep the first slice additive. Prefer richer diagnostics and event metadata
  over broad payload replacement.
- Put normalized usage / incident / guardrail contracts in `src/core`, not in
  a backend-specific module.
- Let runtime own execution guardrails only; product layers still own budget
  policy and override semantics.
- Prefer honest confidence flags (`reported`, `aggregated`, `estimated`,
  `unknown`) over fabricated precision.
- Keep provider-native progress details nested under runtime-owned metadata
  instead of exposing raw provider payloads as the public contract.

## Testing Strategy

- **Unit Tests**:
  - incident classification and cooldown derivation
  - metering aggregation and guardrail evaluation
  - Junie / Pi / Goose / Copilot progress normalization
- **Integration Tests**:
  - `POST /sessions/{id}/messages` warning, block, and cooldown behavior
  - `GET /diagnostics/runtime` and `GET /diagnostics/health` metering payloads
  - API/local incident detection and progress streaming
- **Manual Testing**:
  - stream a CLI-backed turn and verify normalized `progress` payloads
  - force a configured token block and verify the host-facing response
  - force a rate-limit incident and verify cooldown diagnostics

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Progress normalization breaks existing consumers that inspect raw Junie metadata | Medium | Keep event type additive and preserve provider-native detail under `metadata.native` |
| Guardrails become product-policy shaped instead of runtime-execution shaped | High | Limit config to thresholds/cooldowns and avoid approval or routing policy |
| CLI incident detection is noisy because some providers only expose free-form text | Medium | Start with conservative signatures and persist evidence summaries for debugging |
| Diagnostics payload grows too large | Medium | Keep aggregates summarized and recent incidents bounded |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created and implementation started |
| 2026-03-23 | Delivered first-slice usage metering, incident/guardrail surfacing, and provider-agnostic progress across Junie, Pi, Goose, Copilot, and API/local transports |

---

*Created: 2026-03-23*
*Author: Codex*
