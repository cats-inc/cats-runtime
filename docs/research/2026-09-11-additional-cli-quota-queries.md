# Additional CLI Quota Queries

Date: 2026-09-11 (Asia/Taipei; raw observation timestamps are UTC)

## Boundary

The owner initially authorized sequential implementation/verification of other CLI
queries, then authorized commit/push and auto-merge PRs. Neither request authorizes
publication or an installed Desktop update. Cats may run a provider CLI with
its own authentication. Cats must never read login credentials and then issue its
own provider HTTP request. No model prompt, session creation, login RPC, real Cats
profile, or background monitor was used in these probes. CLI-owned auth/cache/log
housekeeping is not a Cats account API integration.

## Verified Windows Native Collectors

| CLI | Read seam | Live observation (not a permanent balance) |
|-----|-----------|-------------------------------------------|
| Copilot 1.0.83 | CLI server `account.getQuota` | Premium interactions: used 0 / entitlement 1,500; chat/completions unlimited |
| Claude Code 2.1.267 | `get_usage` control, `skip_behaviors:true` | Five-hour used 0%; seven-day used 6% (94% remaining) |
| Antigravity 1.2.0 (`agy`) | Standalone `--print /usage` text report | Latest Gemini model pool weekly 75% remaining; Claude/GPT pool weekly 100%; separate five-hour reports |

### Copilot

The [official SDK usage documentation](https://github.com/github/copilot-sdk/blob/main/docs/features/usage-and-billing.md)
exposes an account quota read independent of session statistics. The
[official SDK client](https://github.com/github/copilot-sdk/blob/main/nodejs/src/client.ts)
and installed SDK confirm Content-Length JSON-RPC framing, headless stdio launch,
`connect`, and the `ping` fallback for a missing connect method. The only account
RPC sent is `account.getQuota`; account/auth retrieval and session methods are not used.

Map `usedRequests`, `entitlementRequests`, `remainingPercentage`, `resetDate`, and
the unlimited flag. `-1` entitlement means unlimited, not a usable numeric limit.
Remaining requests are `max(0, limit - used)` only when both values are known.
The live `resetDate` was already elapsed at observation time; preserve it and mark
the report stale. Do not invent a monthly boundary or claim a reliable future reset.

Repeatability: the first read succeeded, but two later reads reached the production
8-second deadline. A bounded diagnostic then completed in 7.4 seconds: CLI connect
took about 1.8 seconds and `account.getQuota` returned at about 7.3 seconds. The
next ordinary collector read succeeded within the unchanged 8-second budget
(7.7 seconds including cleanup), reporting the same 0/1,500 entitlement facts at
2026-09-10T20:34:15.506Z. Runtime correctly marked the elapsed-reset report stale.
This proves the read seam, not guaranteed latency or a reliable reset timestamp;
timeouts remain explicit and preserve the last observation without auto-retrying.

### Claude Code

The installed binary's embedded control schema and
[Anthropic Agent SDK type definitions](https://app.unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.220/files/sdk.d.ts)
expose experimental `get_usage`. Send `initialize`, await success, then send
`get_usage` with `skip_behaviors:true`. Safe mode disables custom hooks/MCP/skills;
tools are empty, session persistence is disabled, and no user frame is sent.
Do not use `--bare`: it changes authentication behavior.

Map only fixed `rate_limits` windows: `five_hour`, `seven_day`,
`seven_day_oauth_apps`, `seven_day_opus`, and `seven_day_sonnet`. Utilization is
already 0–100; passive `rate_limit_event` instead uses a fraction. A missing reset
stays null. Session cost, model usage, subscription details and behavior history
are discarded. Dynamic `model_scoped` and extra-usage billing fields are not yet
mapped; do not claim complete model/billing coverage. Missing rate limits are
unavailable; an explicitly ineligible API-key account is unsupported.

The final ordinary read at 2026-09-10T20:22:36.981Z again reported seven-day used
6% and five-hour used 0%. Its in-memory Runtime snapshot retained zero execution
observations and no sessions; querying quota did not create model usage records.

### Antigravity

The [official headless contract](https://antigravity.google/docs/cli/headless/)
distinguishes standalone built-in `/usage` reports from model prompts and rejects
these commands in stream-json sessions. The
[usage command documentation](https://antigravity.google/docs/cli/commands/usage)
explains model-pool quota refresh. Run only the separate text invocation with an
8-second deadline; never use a user stream frame or `--disable-slash-commands`.

The live text has four tab-separated fields: model-pool label, weekly/five-hour
remaining label, percentage, ISO reset. Map each recognized pool/window separately;
reject duplicate buckets and invalid/missing percentages/dates. Preserve the CLI's
reported precision. Gemini is a model-pool name here, not the retired Gemini CLI.
Unrecognized text is unavailable, never parsed as an LLM's estimate.

The initial read showed weekly Gemini-pool remaining 78%. The final ordinary read
at 2026-09-10T20:22:41.340Z reported weekly 75% and five-hour 83%; Claude/GPT pools
were 100% in both windows. These are separate timestamped observations, not stable
fixtures or cross-pool totals. The in-memory Runtime snapshot had zero execution
observations and no sessions.

## Kiro: Investigated, Not Enabled

Installed Kiro 2.21.2 supports ACP. The [official ACP reference](https://kiro.dev/docs/cli/acp/)
documents CLI stdio and command extensions. Installed TUI code routes v2 `/usage`
through session-bound commands and v3 through `_kiro/account/getUsage`.
The installed help provides `acp --agent-engine v3 --auth-method cli` so auth stays
inside the CLI rather than being supplied by Cats.

No-session initialize/account-read probes were bounded to 8 seconds, then 30
seconds for startup verification. The latter initialized and returned
`success:false` with an auth-related message. No credentials/message body were
exported, no login attempted, and no success balance obtained. A future enablement
requires the owner to establish working CLI authentication plus a real success
fixture proving credit/window mapping. Do not fall back to reading its token store,
creating a chat session, or treating execution credits as remaining allowance.

## Runtime / Host / App Acceptance

- New collectors refuse nonempty custom argv before spawning. Prompt/resume or
  alternate-mode flags are not verified safe quota-only configurations.
- Native Windows is live-verified. Linux/macOS share native transports but were
  not live-tested here. WSL/Docker fail before spawning due to stdin limitations.
- Pipes have a combined 512-KiB budget; NDJSON and byte-counted frames handle
  fragmented input. Errors are sanitized. Timeout/abort ends stdin and reaps owned
  processes; there are no recurring probes or long-lived conversation log streams.
- Cached GET/polling never invokes a collector. Explicit queries retain one-active
  collector, same-target coalescing and provider/backend/instance cooldown isolation.
- Unknown execution quota fields and no-number passive events cannot erase the
  latest usable account report or renew its timestamp. Reports are not summed.
- SDK 1.2 carries refresh capability, native quantities and unlimited semantics.
  Usage 0.2.0 is an unreleased built package. Existing Desktop release pins remain
  unchanged; a later coordinated release must pin the new App hash and Runtime revision.

Deterministic redacted cases live beside the collectors in `src/backends/cli/usage`.
They cover wire-only request sequences, invalid/missing/zero/unlimited values,
auth/unsupported errors, output bounds, timeout/cancel and process cleanup.
Cross-layer tests additionally cover account-cache retention, disabled/version-bound
permissions, private-field projection, and same-named instances across providers.

## Final Validation

- Runtime: TypeScript check and 60 focused tests across eight files passed,
  including the existing Codex collector, three new collectors, cache and HTTP.
- Platform: server/renderer/test typechecks, server and production web builds,
  21 host/renderer/client tests and the bundled-SDK sidecar regression passed.
- Apps: six tests, documentation links and deterministic package build passed.
- Built Usage 0.2.0 passed authenticated isolated-host browser checks with both
  standalone and production renderers. Each new button reached its exact provider;
  native quantities, unlimited, filtering, stale/offline state, restart, mobile
  width, CSP and disable/revocation were exercised. Browser numbers are fixtures;
  the live CLI observations above were verified separately, not against the user's
  installed Desktop or real Cats profile.
- Independent review completed after correcting custom-argv launch safety,
  account-cache replacement and the renderer's old Codex-only forwarding gate.
  Final focused review reported no remaining P1/P2 findings.

Local artifact: `cats-apps/build/quota-validation/usage-0.2.0.catsapp`, SHA-256
`830898204f36e3752ed97a895f2774cc6bc5a41f36324b5d52c6ea561133bca2`.
Native macOS/Linux live validation, publication, installer updates and persistent
monitoring remain outside this delivery. Required GitHub checks remain the merge
gate; a later release must run its separately authorized packaging gates.

## PR-only Delivery Follow-up

The initial simultaneous full-suite runs exposed two existing fixture timeouts:
Runtime peer-stream routing and Platform Telegram file-store restart. The new
quota cases passed. Platform's Telegram case passed in isolation and the complete
serial `npm test` rerun passed: 4,546 passed, 5 skipped, 0 failed. No Platform
assertion, timeout or production change was needed for that rerun.

Runtime's peer case also failed by itself. Its API-only fixture retained default
CLI instances, so startup diagnostics still ran installed CLIs' version/help
probes and enabled native watchers. Explicitly emptying every known provider map
removed the legacy-instance fallback. A new fixture assertion protects that
boundary; all four peer cases then passed in about 1.5 seconds of test execution.
The failure path now releases its execution gate, aborts/settles pending requests
and closes both servers without a secondary unhandled socket rejection. The
original success-path assertions and timeouts remain intact, and independent
delta review passed. These changes are test-only, not a product routing change.

The complete Windows Runtime `npm test` rerun passed after that fixture fix:
211 files passed, 2 skipped; 2,037 tests passed, 10 skipped, 0 failed, and no
unhandled errors. The command also completed its normal runtime/UI build gate.
The local validation commands completed and their runners exited; no recurring
quota monitor was started for this delivery.
