# SPEC-029: Provider Account Quota and Usage Snapshots

## Metadata

| Field | Value |
|-------|-------|
| Status | Explicit native Codex/Copilot/Claude/Antigravity refresh implemented; Kiro verification and history deferred |
| Owner | cats-runtime |
| Implementation | Authenticated bounded snapshot and separate passive quota observations |
| Consumer | Usage via cats-platform |

## Summary

### Explicit CLI refresh (Codex 2026-09-10; additional providers 2026-09-11)

- `POST /usage/refresh` accepts only `{provider, instance:string}`, where provider
  is `codex`, `copilot`, `claude`, or `antigravity`, for a configured CLI target.
  It works during bootstrap, behind runtime authentication.
- For Codex, run the configured CLI's `app-server` over stdio: await `initialize`, send
  `initialized`, then `account/rateLimits/read`. Never start a thread/model turn,
  read local credentials, or issue a provider HTTP request from Cats.
- Return `{status, nextRefreshAt, snapshot}`. Status is `updated`, `cooldown`,
  `busy`, `auth_required`, `unsupported`, `unavailable`, `timeout`, or `error`.
  Preserve the previous observation on failure. A successful read with no numeric
  windows is unavailable, not an invented zero.
- Prefer the `codex` bucket in `rateLimitsByLimitId`; otherwise retain the reported
  primary bucket and its limit ID. Do not aggregate different model limits.
- Bound each query to 8 seconds plus process cleanup; coalesce same-target reads,
  allow one collector at a time, and cool down each target for 60 seconds after
  every attempt. Shutdown aborts and reaps active queries. Polling remains passive.
- Platform requires separate `runtime.telemetry.refresh` permission and the
  version-bound `usage.refreshQuota` SDK operation. Usage offers a capability-gated
  explicit button, original observation/reset times, and sanitized failure text.
- Evidence: [official App Server protocol](https://learn.chatgpt.com/docs/app-server).
  Add protocol fixtures, timeout/cancellation/auth/redaction tests and a real CLI
  quota-only probe before claiming the collector works.
- Native Windows was verified with the actual installed CLI. Native macOS/Linux
  use the same stdio protocol; platform CI/acceptance remains separate. WSL and
  Docker return `unsupported` without spawning: their current bootstrap launcher
  consumes stdin. No CLI version equality gate is imposed.

Additional collectors use CLI-owned authentication exclusively:

| Provider | Quota-only invocation | Interpretation |
|----------|-----------------------|----------------|
| Copilot | `--headless --no-auto-update --stdio`; `connect` (SDK `ping` fallback), then `account.getQuota` | Request entitlement, used/remaining, explicit unlimited; never session `premiumRequests` |
| Claude Code | Safe-mode stream-json controls: `initialize`, then `get_usage` with `skip_behaviors:true` | Utilization is 0–100, unlike passive fractions; fixed reported five-hour/seven-day windows |
| Antigravity (`agy`) | Standalone `--print /usage --output-format text` built-in report | Separate model-pool weekly/five-hour windows; not Gemini CLI |

These three collectors reject nonempty custom `command.args` before spawning:
prompt/resume/stream or slash-disabling flags are not a verified quota-only launch.
They share bounded pipes, 512-KiB aggregate stdout/stderr, timeout, cancellation,
hidden Windows launch and owned process-tree cleanup. No raw stderr leaves Runtime.
Kiro's no-session `_kiro/account/getUsage` probe returned an auth-related failure;
success payload/window semantics remain unverified, so no Kiro collector is enabled.
See the [dated probe and limitations](../research/2026-09-11-additional-cli-quota-queries.md).

SDK 1.2 adds `quota.refreshSupported` plus nullable native `used`, `limit`,
`remaining`, `unit` (`percent`/`requests`/`credits`) and `unlimited` per window.
Unlimited is not 100% or a negative limit. No reset date is invented: an elapsed
Copilot `resetDate` stays elapsed/stale even after a successful RPC. Unknown-source
execution counters and status-only passive reports cannot replace account numbers
or refresh their observation timestamp. Nonempty reports still represent the latest
report, not a merged historical inventory of every previously seen window.

Implemented slice (2026-09-10): authenticated, no-store `GET /usage/snapshot`
with schemaVersion 1, runtime epoch, retained-memory coverage, null-vs-zero metrics,
per-currency costs, confidence, provider/instance/session grouping, incidents and
guardrails. Quota-only progress is retained separately. Existing fixture-backed
Claude fraction and Codex percentage reports become percentage/reset windows;
five-minute age, future skew and elapsed resets mark observations stale without
refilling them. Original timestamps prevent late cached results from appearing new.
That original slice did not introduce provider calls. Explicit Codex reads above
now add a separately authorized path, but no credential reads, persistence or
verified account identity/linking. The most recent report per target is shown,
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

Only the four verified native CLI paths above are collected on demand. No universal
remaining/reset API or durable metering history is claimed.

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

The v1 snapshot and explicit-refresh wire schema are frozen with platform SPEC-115.
The following groups describe the broader target; verified accounts and durable
coverage remain later work.

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

`GET /usage/snapshot` reads memory only. `POST /usage/refresh` performs the explicit
CLI read described above. The returned snapshot retains its v1 schema; active
quota has a provider-specific allowlisted source, scope `provider_account_query`,
and an optional sanitized `limitId`. It is not execution-token history.

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
