# SPEC-029: Provider Account Quota and Usage Snapshots

## Metadata

| Field | Value |
|-------|-------|
| Status | U1/passive-window slice implemented; active collectors and history deferred |
| Owner | cats-runtime |
| Implementation | Authenticated bounded snapshot and separate passive quota observations |
| Consumer | Usage via cats-platform |

## Summary

Implemented slice (2026-09-10): authenticated, no-store `GET /usage/snapshot`
with schemaVersion 1, runtime epoch, retained-memory coverage, null-vs-zero metrics,
per-currency costs, confidence, provider/instance/session grouping, incidents and
guardrails. Quota-only progress is retained separately. Existing fixture-backed
Claude fraction and Codex percentage reports become percentage/reset windows;
five-minute age, future skew and elapsed resets mark observations stale without
refilling them. Original timestamps prevent late cached results from appearing new.
No credential reads, provider calls, persistence, upstream refresh route or verified
account identity/linking is introduced. The most recent report per target is shown,
not a complete multi-account/multi-limit inventory. App polling reads memory only.

Provide a truthful, reusable snapshot of runtime-observed execution usage and
provider-reported account allowance. Add verified quota acquisition and later
durable history without moving budget policy or app presentation into runtime.

## Current Baseline

- RuntimeMeteringService observes result usage and error incidents.
- GET /diagnostics/runtime includes usage aggregates and guardrail/incident data.
- Provider diagnostics include target-specific incident/cooldown/block summaries.
- Session inspection exposes session metering.
- The central service retains at most 1,000 usage records and 100 incidents in memory.
- Optional runtimeUsage.quota metadata is preserved on records/events but is not
  a uniform balance/window schema or an aggregated account quota ledger.
- A quota-only signal without token/cost values is not sufficient for the current
  usage-record gate; the new account path must handle it independently.

No active account quota collector, universal remaining/reset API, or durable
metering history is claimed by this baseline.

## Goals

- A stable host-consumable read model with explicit coverage and freshness.
- Account allowances kept distinct from execution usage and guardrail incidents.
- Independent provider adapters with evidence-backed capabilities.
- Bounded cache, refresh, and eventual history behavior.

## Non-Goals

- Pricing every CLI or guessing missing subscription allowances.
- Product budget approvals, billing settlement, app installation, or dashboard UI.
- Synthetic model turns to discover quota.
- Universal provider coverage in the first quota release.

## Proposed Contract

The exact wire schema must be frozen with platform SPEC-115 before implementation.
The following data groups are required; they are not currently shipped fields.

| Group | Required meaning |
|-------|------------------|
| snapshot metadata | Schema version, generation time, runtime start/observation epoch |
| execution usage | Per-target/session aggregates, units/currencies, confidence |
| coverage | Collection start, requested/available period, memory/persisted mode, truncation/gaps/retention |
| provider targets | Provider/backend/instance identity and opaque account linkage when known |
| account observations | Account alias, related targets, status, source, observation/expiry times |
| quota windows | Limit/window identity, optional model scope, native unit, supported quantities and reset time |
| incidents/guardrails | Existing runtime restrictions represented separately from quota amounts |

A quota window may report used, limit, remaining, usedPercent, windowStartedAt,
and resetsAt independently. Missing values are null/absent, not fabricated zeroes.
A provider-reported percentage is useful even when an absolute limit is unknown.
Simple arithmetic may derive remaining/percentage only from compatible values for
the same account, limit, unit, and window, with the derivation identified.

Use the existing reported/aggregated/estimated/unknown confidence vocabulary where
applicable; do not silently relabel an estimate as provider-reported allowance.
Quota observation status and freshness are separate dimensions: available,
unsupported, unavailable, auth_required, or error; fresh/stale where data exists.

## Functional Requirements

1. Keep account observations separate from per-turn usage records, including
   quota-only providers that expose no token or cost numbers.
2. Preserve the provider's quota windows and model-specific limits. No universal
   five-hour, daily, weekly, or monthly schedule may be assumed.
3. Normalize account identity to an opaque local ID plus sanitized display alias.
   Do not publish credentials, raw account payloads, or login-file paths.
4. Map several instances to one verified account where possible. Unknown identity
   remains unknown; no forced merge based only on a provider name.
5. Distinguish runtime activity coverage from provider-account activity, which may
   include other devices/tools. Neither source is a substitute for the other.
6. Reads return a cached snapshot. They do not fan out provider probes, spawn CLIs,
   log in, or consume model quota merely because the UI is polling.
7. Collector scheduling is runtime-owned, bounded, configurable, deduplicated per
   account/limit source, and independent from open dashboard sessions.
8. Preserve last known data on refresh failure with its original observation time,
   stale/error status, and a sanitized reason.
9. Apply per-source timeouts, cancellation, minimum refresh interval, and backoff.
   A transient quota-read 429 does not become a fabricated account-zero observation
   or automatically block unrelated execution.
10. Expose collector availability/auth requirements explicitly. Use existing
    authorized provider mechanisms; never implement login in a read endpoint.
11. Preserve the provider version-drift policy: record versions as evidence, not
    exact-version execution allowlists.
12. Retain usage provenance and avoid double-counting provider cumulative reports,
    stream replays, or resumed turns.
13. Separate costs by currency and quota counts by unit. Do not aggregate unrelated
    currencies, request units, or percentages into one numerical total.
14. Account reset time does not automatically clear an existing runtime block.
    Any guardrail state transition needs an explicit runtime-owned rule and evidence.
15. Historical reads require restart-stable records and retention/gap semantics.
    Before persistence exists, expose the bounded in-memory observation window.
16. New routes must use existing runtime authentication and diagnostics redaction
    conventions. Platform receives only the data its read-only app bridge needs.

## API Direction

A dedicated GET /usage/snapshot and a separate bounded POST /usage/refresh are
proposed for the normalized read and explicit refresh request. Neither route exists
yet. The first host slice may project existing diagnostics into a limited DTO with
account quota marked unavailable. Do not document a proposed route as callable.

A later history read is gated on persistence. Cache refresh requests return their
actual status; requesting refresh is not evidence of a fresh observation.

## Provider Evidence Gate

Before enabling a collector, record the specific account query seam, auth context,
raw-to-normalized mapping, quota unit/window semantics, observation scope, redacted
fixtures, error/timeout behavior, and supported runtime environments.

Select initial providers after those probes. Claude, Codex, Antigravity, Copilot,
and other CLI families are candidates, not a promised support matrix. Current CLI
execution token support is not proof of an account quota query capability.

## Acceptance

- Cached reads work without a provider process or network request.
- Unknown quota, reported zero, missing reset, stale data, and auth-required remain
  distinct through HTTP serialization.
- Two targets with one verified account reference one quota observation.
- Quota-only responses survive even when no usage tokens/cost are supplied.
- Runtime restart/record truncation is visible until a durable ledger is delivered.
- Fixtures exercise unit/currency separation, cumulative reports, cancellation,
  backoff, reset windows, and collector errors.
- No quota query is enabled merely on an assumed provider CLI command.

## Dependencies and Open Questions

- [ADR-038](../decisions/038-separate-execution-usage-from-provider-account-quota.md)
- [Platform SPEC-115](../../../cats-platform/docs/specs/SPEC-115-versioned-official-app-packages-and-telemetry-bridge.md)
- [Apps SPEC-002](../../../cats-apps/docs/specs/SPEC-002-cats-usage-dashboard.md)
- Choose initial verified collectors, bounded refresh intervals, and retention.
- Select the durable storage mechanism after measuring the observation workload.
- Freeze route/DTO versioning and the account-linkage policy before coding.

*Created: 2026-09-10*
*Related Plan: [PLAN-038](../plans/PLAN-038-provider-account-quota-and-usage-snapshots.md)*
