# PLAN-038: Provider Account Quota and Usage Snapshots

## Metadata

| Field | Value |
|-------|-------|
| Status | U1 and passive quota observation implemented; active collectors/history deferred |
| Owner | cats-runtime |
| Related spec | SPEC-029 |
| Related decision | ADR-038 |

## Related Spec

[SPEC-029](../specs/SPEC-029-provider-account-quota-and-usage-snapshots.md)

## Overview

Extend existing metering with explicit coverage, a separate account observation
model, verified collectors, and eventual persistence. Preserve execution guardrails
as a runtime subsystem and give the host a narrow, truthful data source.

## Implementation Phases

### Phase 0: Baseline and Contract

- [x] Inspect existing token/cost normalization, incidents, guardrails, and diagnostics.
- [x] Record the in-memory retention and quota metadata limitations.
- [x] Record the three-repository ownership decision and linked Usage plan.
- [x] Freeze DTO/route naming, null/unknown semantics, and source coverage with
      platform PLAN-106.
- [x] Define unverified account linkage, non-additive quota and per-currency aggregation rules.

### Phase 1: U1 Snapshot and Coverage

- [x] Expose current usage/incidents through a narrow read service with observation
      epoch, retained range, and truncation metadata.
- [x] Keep unsupported quota unavailable; expose only existing verified passive signal mappings.
- [ ] Verify cumulative/replayed usage normalization and currency separation.
- [x] Add HTTP/auth/redaction and host-consumer contract fixtures.
- [x] Keep existing diagnostic consumers aligned without claiming new history.

### Phase 2: Collector Evidence

- [x] Reuse the dated Claude/Codex stream probe and redacted provider fixtures for
      passive windows. No new paid/live probe was performed in this implementation.

- [ ] Investigate structured account-query seams for initial CLI families.
- [ ] Record source/auth/window/unit/scope evidence and redacted fixtures.
- [ ] Choose the first supported collectors from verified capability.
- [ ] Capture unsupported/auth-required/error cases and retry behavior.
- [ ] Follow version-drift policy; avoid exact fixture-version execution gates.

No provider account request or paid probe is performed by this implementation task.

### Phase 3: U2 Account Quota Service

- [x] Retain quota-only progress per target independently from token-bearing results;
      preserve original timestamps, reject older late snapshots, mark stale resets.
- [x] Keep cached reads independent from dashboard visibility and provider requests.

- [ ] Implement separate account/window storage, including quota-only observations.
- [ ] Link verified shared accounts to provider targets without duplicating allowance.
- [ ] Add cached reads, bounded scheduling, deduplicated refresh, timeout/cancellation,
      stale retention, and backoff.
- [ ] Expose the agreed snapshot and separately controlled explicit refresh route.
- [ ] Verify that app visibility/polling cannot amplify provider queries.
- [x] Keep account balance and execution-block transitions independent.

### Phase 4: U3 Durable History

- [ ] Select storage and retention limits, with a recorded decision if needed.
- [ ] Persist observations with stable identities and replay/deduplication semantics.
- [ ] Rehydrate restart-stable usage and expose coverage gaps.
- [ ] Add bounded historical reads only after persistence tests pass.

### Phase 5: Consumer Validation

- [x] Validate current usage and passive windows through the platform contract.
- [x] Verify Usage unknown/zero/stale and unverified account presentation with fixtures.
- [x] Document Claude/Codex passive support and unsupported active collection.
- [x] Run targeted service/HTTP tests and isolated cross-repository package checks.

`/usage/snapshot` is memory-only and authenticated. It exposes the most recent
supported passive observation per provider/instance/backend, not a complete
multi-account inventory. Cumulative/replay-safe durable history and verified shared
account linkage remain open; no historical totals are advertised.

## Work Areas

| Area | Work |
|------|------|
| src/core/usage | Snapshot, account observations, cache, retention, guardrail boundaries |
| Owning CLI/provider adapter layer | Verified provider query and normalization |
| src/core/types.ts | Agreed shared DTOs only |
| src/http/routes | Authenticated read and explicit refresh surfaces |
| docs/research | Provider evidence and redacted fixtures |
| cats-platform / cats-apps | Host bridge / presentation through their owning plans |

## Testing Strategy

Use deterministic provider fixtures and temporary runtime roots. Exercise quota-only
responses, null/zero distinctions, reset/model windows, account deduplication,
mixed currencies, memory truncation, restart persistence, stale caches, throttling,
cancellation, read-only access, and explicit guardrail transitions.
Live collector verification is a separately scoped activity with recorded evidence.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Account endpoints drift or do not exist | Capability evidence; explicit unsupported state |
| UI polling causes expensive provider work | Cached reads; runtime-owned bounded scheduling |
| Partial telemetry becomes a false billing ledger | Coverage/confidence and persistence gate |
| Shared account allowance counted per instance | Opaque account mapping and deduplication |

## Progress Log

| Date | Update |
|------|--------|
| 2026-09-10 | Baseline and ownership recorded; all new runtime implementation remains planned. |

*Created: 2026-09-10*
