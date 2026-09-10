# ADR-038: Separate Execution Usage from Provider Account Quota

## Status

Accepted — ownership and data distinction approved on 2026-09-10.
The memory-only read contract and passive Claude/Codex window projection are now
implemented under PLAN-038. Active collectors, verified accounts and persistence remain planned.

## Context

The official Usage utility will live in cats-apps and run through the
cats-platform App host. Runtime already records result usage, classifies rate
limits/quota errors, and enforces execution guardrails under ADR-017.

Those observations are not an account allowance service. CLI token counts describe
execution consumption; an account quota may use requests, credits, percentages,
model-specific limits, or provider-defined windows and can include activity outside
Cats. An error saying quota is exhausted does not report the account's full limits.

The current central metering service is memory-backed with bounded records.
Its quota metadata extension, including Copilot premiumRequests, is not a uniform
account-balance or reset-window contract.

## Decision

1. Keep execution usage, account quota observations, incident detection, and their
   normalized data in cats-runtime. Apps and the platform must not duplicate
   provider CLI parsing or credential inspection.
2. Model execution usage and provider-account quota as separate data sets linked
   by provider targets and runtime-owned opaque account identity.
3. Preserve provider-native units, windows, limit/model scope, timestamps, and
   evidence/confidence. Unknown is distinct from a reported zero.
4. Never infer subscription remaining quota solely from accumulated tokens,
   default pricing tables, a successful CLI check, or absence of errors.
5. Quota collection is a runtime service that can operate while the dashboard is
   closed. The app reads cached normalized snapshots through the host.
6. Handle shared accounts explicitly: several runtime instances can reference one
   account observation; that allowance is not additive across instances.
7. Expose coverage and retention on usage reads. Add durable storage before
   promising complete historical trends or cross-restart aggregates.
8. Keep execution guardrail state separate from observed account allowance.
   Quota reset times and local cooldown expiry are different facts.
9. Product budget policy, approvals, and operator UI remain above runtime.
   Usage is an observational client and does not own execution decisions.

## Consequences

### Positive

- Usage and other consumers can reuse one provider-aware data source.
- The UI can honestly display partial/unknown data and shared account windows.
- Collection and execution restrictions remain available without an open app.

### Negative

- Runtime needs verified account-query adapters, account mapping, cache/backoff,
  coverage metadata, and later persistence.
- Some providers may remain unsupported or expose only partial balances.

### Neutral

- Existing diagnostic usage endpoints remain valid current observations.
- A reported premium-request count can be retained without being mislabelled as
  the total account allowance.
- A failed quota read does not itself prove that execution quota is exhausted.

## Alternatives Considered

### Query Provider CLIs Inside Usage

Would couple a renderer/package to credentials and provider drift. Rejected because
provider acquisition is already a runtime responsibility.

### Treat Tokens as Subscription Quota

Simple to aggregate but gives unsupported precision across providers and plans.
Rejected unless a provider explicitly defines the same unit/window relationship.

### Infer Quota Solely From Errors

Useful for reactive incidents, but cannot report allowance before exhaustion.
Retain incident detection while adding a separate account observation contract.

## References

- [ADR-017](017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [SPEC-010](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [SPEC-029](../specs/SPEC-029-provider-account-quota-and-usage-snapshots.md)
- [Apps SPEC-002](../../../cats-apps/docs/specs/SPEC-002-cats-usage-dashboard.md)
- [Platform ADR-114](../../../cats-platform/docs/decisions/114-separate-official-app-sources-and-coordinate-desktop-distribution.md)

*Decision made: 2026-09-10*
