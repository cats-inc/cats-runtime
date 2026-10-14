# Kiro V3 explicit account quota read

Date: 2026-10-14 (Asia/Taipei). Implementation and validation only; no version bump,
publication, installed App replacement or Desktop update.

## Verified read

The owner reported working Kiro login and requested connecting quota. Installed
native Windows CLI reports `kiro-cli-chat 2.31.0`; V3 is the selected engine, not
an exact CLI-version requirement. Its `acp --help` documents
`--agent-engine v3 --auth-method cli`. The [official ACP documentation](https://kiro.dev/docs/cli/acp/)
documents JSON-RPC over stdio; the account extension below is verified from the
installed CLI, not assumed to be a standard ACP method.

Send only `initialize` (protocolVersion 1; file/terminal capabilities disabled),
await its result, then `_kiro/account/getUsage` with empty params. No
`authenticate`, `session/new`, `session/prompt`, token-file read or Cats-owned
provider HTTP request is used. CLI owns its auth/cache housekeeping.

Two bounded probes succeeded in about 5.9 and 2.0 seconds before cleanup. The
first sandbox-identity read failed auth; the reads under the owner's logged-in
Windows identity succeeded. Successful results have `success:true` and
`data.usageBreakdowns` with one `resourceType:"CREDIT"` bucket, numeric
`used`/`limit`, `hasLimit:true`, a rounded integer `percentage` and a
`billingCycleReset` calendar date. Bonus/add-on arrays were empty. Personal
balances, plan identity and raw stderr are not retained here.

## Normalization and boundaries

- Source: `kiro.account.getUsage`; scope: `provider_account_query`.
- Preserve decimal credits. Remaining is `max(0, limit - used)`; percent is
  computed from the same native bucket when limit is positive, rather than the
  CLI's rounded percentage. Over-limit usage remains visible; percent caps at 100.
- Missing/invalid usage, missing/unknown resources and duplicate credit buckets
  remain unavailable. A missing limit remains unknown. `hasLimit:false` does
  not prove unlimited entitlement. A zero limit does not authorize division by zero.
- Preserve valid `YYYY-MM-DD` as optional window `resetsOn`. Leave
  `resetsAt` and duration null; do not invent a timezone, midnight instant or
  monthly duration. Usage labels it as a reported date with exact time unavailable.
  The optional field is additive within snapshot schemaVersion 1 and SDK v1;
  existing timestamp-only windows retain their existing shape.
- Bonus/add-on credits, overage billing and other resource types are not mapped:
  their nonempty payload semantics have no success fixture in this slice.
- Native transports only; WSL/Docker and custom startup args fail before spawn.
  Windows is live-verified; macOS/Linux use shared native transport but are untested live.
- Shared 8-second deadline, bounded pipes, process cleanup, one active collector,
  per-target 60-second cooldown and failure retention remain unchanged. Cached
  GET/polling never invokes the CLI; account quota never creates execution records.

## Evidence and validation

The redacted deterministic fixture is
`tests/fixtures/provider-captures/kiro-2.31.0/account-usage.success.redacted.json`.
It projects the successful response shape; credit quantities and reset date are
replaced with test values and identity/billing fields are removed.

- Runtime: TypeScript check/build and 66 focused tests across eight files passed,
  including quota-only sequencing, auth/RPC/server-request refusal, invalid/zero
  limits, malformed output, timeouts/cancel, snapshot isolation and HTTP routing.
- Apps: six focused Usage tests passed, including Kiro capability/button, decimal
  quantities, date-only label and deterministic source-free package construction.
- Production collector → authenticated isolated Runtime HTTP → compiled Platform
  client succeeded with exactly one CLI query, zero sessions and zero execution
  observations. Passive GETs did not query; the second POST returned cooldown.
  Native quantities and date-only reset survived the host projection.
- Independent read-only review found no P1/P2 issues in collector, Runtime,
  Platform gates/SDK/projection and Usage rendering. Platform 22 focused host/renderer/client tests, server build, renderer typecheck
  and whole test-fixture typecheck passed. The latter used the checkout's existing
  mobile dependencies via an ignored worktree junction.

## Related contracts

- [SPEC-029](../specs/SPEC-029-provider-account-quota-and-usage-snapshots.md)
- [PLAN-038](../plans/PLAN-038-provider-account-quota-and-usage-snapshots.md)
- [Earlier auth failure](2026-09-11-additional-cli-quota-queries.md#kiro-investigated-not-enabled)
