# Codex CLI explicit account quota read

## Scope and sources

Follow-up to the passive signal probe, authorized by the owner on 2026-09-10:
query through the CLI only. Do not read local CLI credentials or reuse them in
direct provider API requests.

- [Official App Server documentation](https://learn.chatgpt.com/docs/app-server),
  consulted 2026-09-10: initialization handshake and `account/rateLimits/read`.
- Locally installed `codex-cli 0.154.0`, native Windows. Version is provenance,
  not an execution allowlist. No exact-version gate was added.

## Verified protocol

1. Spawn the configured `codex app-server` with piped stdio and no visible shell.
2. Send `initialize`, await its response, then notify `initialized`.
3. Send `account/rateLimits/read`; do not send `thread/start` or `turn/start`.
4. Prefer `rateLimitsByLimitId.codex` when present; otherwise retain the reported
   primary bucket. Preserve its limit ID, primary/secondary window duration,
   used percentage, and reset time. Strip account identifiers and all other fields.
5. End stdin and wait for process exit; terminate an unresponsive child tree.

The direct CLI read succeeded. A subsequent source-free Usage 0.1.1 archive,
Desktop-style offline staging, SDK 1.1, authenticated temporary Platform profile,
real Runtime route/service and headless Edge test also succeeded. Opening the
App performed zero CLI queries; clicking once performed exactly one account read.
The rendered progress value matched `100 - usedPercent`. Runtime session count
and execution-usage observations remained zero. Real account percentages, reset
dates, account IDs, credentials and payloads are deliberately not recorded here.

This account returned one primary seven-day window, not an assumed five-hour
window. Other plans may return different windows; missing windows are not filled
in. No absolute token allowance can be inferred from a percentage.

## Failure and transport boundaries

- Deterministic CLI fixtures cover initialized ordering, missing/zero/invalid
  values, sanitized RPC/auth/unsupported errors, server-request refusal, oversized
  or malformed streams, timeout, cancellation and process completion.
- Runtime fixtures cover coalescing, global single-query concurrency, a 60-second
  per-target cooldown, failure retention and shutdown cancellation.
- App/host fixtures cover separate refresh permission, authentication/CSRF route
  policy, target validation, version/hash/access revocation and cache-only polling.
- Windows native is live-verified. Native macOS/Linux use the stdio transport but
  were not executed in this local validation. WSL/Docker return unsupported before
  launch: their current heredoc bootstrap consumes stdin, and remote cwd/cleanup
  require separate verification.
- API-key login does not imply a ChatGPT subscription allowance. Login or service
  failures remain unavailable/auth-required/error, not zero quota.
- No installed Desktop was changed, restarted or released. Test processes and
  temporary profiles were closed/removed; local build artifacts remain for handoff.

## Related contracts

- [SPEC-029](../specs/SPEC-029-provider-account-quota-and-usage-snapshots.md)
- [PLAN-038](../plans/PLAN-038-provider-account-quota-and-usage-snapshots.md)
- [ADR-038](../decisions/038-separate-execution-usage-from-provider-account-quota.md)
