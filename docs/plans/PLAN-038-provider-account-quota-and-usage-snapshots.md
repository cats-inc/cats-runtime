# PLAN-038: Provider Account Quota and Usage Snapshots

## Metadata

| Field | Value |
|-------|-------|
| Status | Native Codex/Copilot/Claude/Antigravity explicit refresh implemented; Kiro auth/success verification and history deferred |
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

The follow-up Codex slice was explicitly authorized for CLI-only account reads.
Native Windows real-CLI validation succeeded without a thread/model turn; no
credential files or provider HTTP endpoints were accessed by Cats.

### Phase 2a: Explicit Codex Slice

- [x] Verify `initialize` → `initialized` → `account/rateLimits/read` over stdio.
- [x] Preserve the actual Codex limit/window duration and reported percentage.
- [x] Add separate POST, 8-second timeout, process cleanup, same-target coalescing,
      single active collector, 60-second success/failure cooldown and shutdown abort.
- [x] Retain previous data on failures; do not insert synthetic usage/session records.
- [x] Test bootstrap/auth, target validation, redaction, missing/zero values,
      malformed/oversized output, timeout, cancellation and passive polling.
- [x] Return unsupported before spawning for unverified WSL/Docker transports.
- [ ] Publish coordinated Runtime/SDK/Usage artifacts and validate installed delivery.

Validation (2026-09-11): 28 focused quota/metering/HTTP tests plus four targeted
server lifecycle cases passed; Runtime compiled. The existing close-during-startup
case caught an early-await regression: mark stopping synchronously before awaiting
collector cleanup. The corrected case passed and received independent review.
The built Usage/SDK/authenticated host/Runtime/real native CLI path passed in an
isolated browser/profile. WSL/Docker stdin limitations were independently reviewed
and gated before spawn. No release or installed update was requested for this slice.

PR preparation (2026-09-11): full Windows `npm test` passed: 208 test files passed,
2 skipped; 2,004 cases passed and 10 skipped. The owner authorized commit/push and
auto-merge PRs only; utility/Runtime/Desktop publication and installed updates remain
deferred.

### Phase 2b: Authorized Additional CLI Queries (2026-09-11)

Implement and verify Copilot first, then Claude and Kiro; investigate Antigravity
(`agy`) separately. Gemini CLI is retired and is not a candidate. Enable a collector
only after a quota-only invocation is verified against the installed CLI. CLI-owned
authentication is allowed; Cats must not read credentials, call provider HTTP APIs,
start a model turn, or use execution-token statistics as account allowance.

- [x] Copilot: verify CLI server `account.getQuota`, sanitize entitlement windows,
      and retain native units/unlimited semantics.
- [x] Claude: verify a non-model invocation of its built-in usage command before
      enabling automation; do not send `/usage` as a model prompt.
- [x] Kiro: inspect CLI/ACP and probe no-session account read; record auth failure.
- [ ] Kiro: obtain an authenticated success fixture and verify unit/window mapping before enabling.
- [x] Antigravity: verify standalone built-in `/usage` in `agy`, not Gemini CLI documentation.
- [x] Extend the permission-checked host/SDK/Usage path for verified collectors,
      with provider+instance isolation, tests, and independent review.
- [x] Record live evidence, supported environments, and any precise blockers.

This follow-up authorizes implementation and validation only, not publication,
version tags, or replacing the user's installed Desktop.

The [probe record](../research/2026-09-11-additional-cli-quota-queries.md) records
Copilot 1.0.83, Claude 2.1.267, Antigravity 1.2.0 and Kiro 2.21.2 evidence. Versions
are provenance, not allowlists. Independent review found and fixed execution-count
and status-only cache replacement, plus custom-argv launch risks. New collectors
reject custom arguments; last numeric observations retain their original timestamp.

### Phase 3: U2 Account Quota Service

- [x] Retain quota-only progress per target independently from token-bearing results;
      preserve original timestamps, reject older late snapshots, mark stale resets.
- [x] Keep cached reads independent from dashboard visibility and provider requests.

- [ ] Implement separate account/window storage, including quota-only observations.
- [ ] Link verified shared accounts to provider targets without duplicating allowance.
- [ ] Add cached reads, bounded scheduling, deduplicated refresh, timeout/cancellation,
      stale retention, and backoff.
- [x] Expose the bounded memory snapshot and separately controlled explicit refresh route.
- [x] Verify that app visibility/polling cannot amplify provider queries.
- [x] Keep account balance and execution-block transitions independent.

### Phase 4: U3 Durable History

- [ ] Select storage and retention limits, with a recorded decision if needed.
- [ ] Persist observations with stable identities and replay/deduplication semantics.
- [ ] Rehydrate restart-stable usage and expose coverage gaps.
- [ ] Add bounded historical reads only after persistence tests pass.

### Phase 5: Consumer Validation

- [x] Validate current usage and passive windows through the platform contract.
- [x] Verify Usage unknown/zero/stale and unverified account presentation with fixtures.
- [x] Document Claude/Codex passive support, four verified manual collectors and the Kiro gate.
- [x] Run targeted service/HTTP tests and isolated cross-repository package checks.

`/usage/snapshot` is memory-only and authenticated. It exposes the most recent
supported passive or explicit CLI observation per provider/instance/backend, not a complete
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
| 2026-09-11 | PR-only delivery authorized. Full Windows npm test passed (2,037 passed, 10 skipped, 0 failed); isolated the API-only peer fixture from real CLI diagnostics and settled aborted requests after an existing timeout surfaced. Independent delta review passed. No product-route/timeout change, tag, publication or installed update. |
| 2026-09-11 | Native Copilot/Claude/Antigravity queries, SDK 1.2 and Usage 0.2.0 implemented and independently reviewed. Focused tests and built-App browser checks passed; Kiro authentication/success mapping remains open. No release or installed update. |
| 2026-09-10 | Baseline and ownership recorded; all new runtime implementation remains planned. |

*Created: 2026-09-10*
