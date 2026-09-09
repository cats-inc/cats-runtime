# Claude Code and Codex Rate-Limit Signal Probe — Claude Code 2.1.267, codex-cli 0.153.4

Date: 2026-09-10
Scope: the account-level quota signals that the installed CLIs already emit on their own
streams, so `cats-runtime` can answer "how much of my rate limit is used" without reading
any provider credential file. Follow-up to ADR-017, SPEC-010, and PLAN-009.
Host: Windows 11, `claude.exe` from the native installer and `codex` from npm (x86_64
vendor binary). Both CLIs were signed in through their own browser login; the runtime
process had no provider API key in its environment.

## Why this probe

The metering slice under `src/core/usage` records per-turn token usage and reacts to
rate-limit *errors*. It had no view of the account-level window state (5-hour and 7-day
utilization, reset times) that decides whether the next turn will even be accepted.

The obvious source for Claude, the OAuth usage endpoint behind Claude Code's `/usage`
screen, needs the token stored in `~/.claude/.credentials.json`. Reading that file is out
of bounds for this runtime: every existing auth check only tests whether an environment
variable is present or whether a probe's stderr matches a login-required pattern, and
nothing reads a credential's content. So the probe asked the narrower question: what do
the CLIs already say on the wire?

## Claude Code 2.1.267 — `rate_limit_event`

Command (with `CLAUDECODE` unset, as the worker pool does):

```
claude -p "Reply with the single word ok" --output-format stream-json --verbose --include-partial-messages --max-turns 1
```

Frame order observed: `system:init`, `system:status`, `rate_limit_event`, six
`stream_event` frames, `assistant`, `rate_limit_event`, `result:success`.

`rate_limit_event` appears before and after the API call. Its `rate_limit_info` carries:

- `status`: `allowed` here; the Agent SDK type also lists `allowed_warning` and `rejected`
- `rateLimitType` plus `resetsAt`: the constraining window (`five_hour`) and its reset
  time as Unix seconds
- `unifiedWindows.<name>.{utilization,resetsAt}`: `five_hour` and `seven_day` on the
  first frame; the second frame added `seven_day_overage_included`. Utilization is a
  0..1 fraction
- `overageStatus`, `overageDisabledReason`, `isUsingOverage`

`result` carries more than the token usage the adapter already read: `total_cost_usd`
(a list-price equivalent; `modelUsage[*].costBasis` is `"list"` on a subscription
account), `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`, and a per-model
`modelUsage` map with tokens, `costUSD`, and `contextWindow`.

Before this change `rate_limit_event` passed through the Claude adapter as an unhandled
raw frame (`reason: unhandled_claude_event`) and `total_cost_usd` was dropped.

## codex-cli 0.153.4 — `account/rateLimits/updated` and `account/rateLimits/read`

An app-server session was driven over stdio with `initialize`, `initialized`,
`thread/start` (`approvalPolicy: never`, `sandbox: read-only`), and `turn/start`.

Notification order during the turn: `thread/started`, `mcpServer/startupStatus/updated`,
`thread/status/changed`, `turn/started`, `item/started`, `item/completed`,
`item/agentMessage/delta`, `thread/tokenUsage/updated`, `account/rateLimits/updated`,
`turn/completed`.

`account/rateLimits/updated` arrives once per turn, in the same millisecond as
`thread/tokenUsage/updated`. `params.rateLimits` is a `RateLimitSnapshot`:

- `limitId`, `limitName`, `planType` (`pro` here)
- `primary` / `secondary`: `{ usedPercent, windowDurationMins, resetsAt }`, that is a
  percent (not a fraction), minutes, and Unix seconds. This account had only a
  10080-minute primary window on its default limit; a second limit id on the same account
  showed a 300-minute primary plus a 10080-minute secondary
- `credits: { hasCredits, unlimited, balance }`, `spendControlReached`, and
  `rateLimitReachedType` (null while allowed)

`account/rateLimits/read` (no params) returns the same snapshot on demand plus
`rateLimitsByLimitId`, reset-credit grants, and an `accountId`, and it does not consume a
model turn. The runtime does not call it yet; if it ever does, the account identifier
must stay out of runtime read models.

`thread/tokenUsage/updated` also carries more than the adapter read: `last` and `total`
each have `cachedInputTokens`, `cacheWriteInputTokens`, `reasoningOutputTokens`, and
`totalTokens`, and the notification carries `modelContextWindow`. `inputTokens` already
includes the cached tokens (`totalTokens = inputTokens + outputTokens`).

## What the runtime does with it now

- Both adapters emit a `progress` event with `metadata.kind: "quota"` and a flat
  `metadata.quota` record: primitive values only, ISO-8601 timestamps, plus `source` and
  `observedAt`.
- The latest snapshot rides on the turn's `result` as `metadata.runtimeUsage.quota`, the
  slot the metering service already stored for Copilot's `premiumRequests`.
- Metering aggregates (`byProviderInstance`, `bySession`) and per-target snapshots keep
  the latest `quota` value, so `GET /diagnostics/runtime` and
  `GET /diagnostics/providers` show the last known window state per provider instance.
- Claude `total_cost_usd` fills `result.usage.estimatedCost` / `currency`; Codex usage
  now keeps cache-read, cache-write, prompt-only, and total counts.

## What it deliberately does not do

- No credential file is read. Account quota only comes from frames the CLI emits on its
  own; nothing polls `account/rateLimits/read` or the Anthropic OAuth usage endpoint.
- No cooldown or incident is derived from `rejected` or `rateLimitReachedType`. That
  semantic was not observed live (it would require exhausting a real quota), and a wrong
  guess would block a provider instance for hours. Hosts can read
  `metadata.quota.status` / `rateLimitReachedType` and decide.
- `result.is_error` handling is unchanged; an error-shaped Claude `result` is still a
  `result` event.
- Gemini CLI is not a runtime provider family, so it was not probed.

## Redacted fixtures

- `fixtures/claude-2.1.267/stream-json.rate-limit.redacted.ndjson`: the complete
  12-frame capture. Session id, uuids, message ids, cwd, socket and shell paths, memory
  paths, and the tool / command / agent / skill / plugin / capability catalogs are
  replaced with placeholders. Token counts, costs, utilization fractions, and reset
  timestamps are kept verbatim because they are the evidence.
- `fixtures/codex-0.153.4/app-server.rate-limits.redacted.ndjson`: the three
  notifications that matter (`thread/tokenUsage/updated`, `account/rateLimits/updated`,
  `turn/completed`) with thread, turn, and message ids replaced.

`src/backends/cli/providers/claude.fixture.test.ts` and
`src/backends/cli/providers/codex.fixture.test.ts` pin the adapters to these captures.

## Action items

- [x] Normalize both signals into the shared quota contract (this change)
- [ ] Observe a real `allowed_warning` / `rejected` (Claude) and `rateLimitReachedType`
      (Codex) frame before deriving guardrails from them
- [ ] Decide whether a runtime-owned, opt-in `account/rateLimits/read` probe belongs in
      provider diagnostics (it costs no model turn but returns an account id)
