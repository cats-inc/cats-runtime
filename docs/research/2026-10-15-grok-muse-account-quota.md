# Grok and Muse CLI-only account quota evidence

Date: 2026-10-15 (Asia/Taipei). Scope: implementation and verification, without
version bumps, publication or changes to the installed Desktop.

## Grok: verified billing read, current numeric allowance unavailable

Installed Grok 1.0.52 (`0920c8169e27`) accepts `agent stdio`, ACP `initialize`
with protocolVersion 1, then `_x.ai/billing` with empty params. Before login it
returned authentication required; after the owner logged in it returned billing
config. Cats sent no authenticate, session or prompt request.

The authenticated response contains `currentPeriod`, `billingPeriodStart`,
`billingPeriodEnd`, `isUnifiedBillingUser`, `onDemandCap`, `onDemandUsed` and
`prepaidBalance`. It omits **all** of `creditUsagePercent`, `monthlyLimit` and
`used`. Therefore the current live result is `unavailable`, with no numeric
observation. A weekly reset and separate spending balances do not establish
subscription usage. This is a verified query seam, not a seventh live numeric
provider; the previous five plus Muse have numeric success evidence.

The official Rust DTO preserves those fields as optional. The pager's missing
percentage fallback to 0.0 is a UI default, not evidence of zero subscription
consumption. A present legacy `Cent {}` explicitly defaults its `val` to zero;
an entirely missing Cent remains unknown. The collector prefers an explicit
0–100 `creditUsagePercent`; otherwise it derives a percentage only from present
legacy monthly used and positive limit values. Prepaid/on-demand billing is
never mapped as included subscription allowance. Source: `grok.billing`.

Primary sources, reviewed at upstream commit
`2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`:

- [CLI billing DTO](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/billing.rs)
- [Pager billing interpretation](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/src/app/effects/helpers.rs)
- [xAI subscription spending caps](https://docs.x.ai/x-subscription/spending-caps)
- [ProtoJSON presence rules](https://protobuf.dev/programming-guides/json/#presence-and-default-values)

## Muse: fresh Windows TUI supplies account allowance without a turn

Installed Muse 1.4.7-R6101.1 exports MSP `usage/read` and `usage/changed`, but
`usage/read` returns the last report held by that host process. A fresh
quota-only `serve --no-session-log --provider meta --disable-write --disable-shell`
process returned `{}` even after login and the owner's normal message. A
diagnostic ephemeral session also returned `{}`; no `turn/start` was sent.
That session path is not used by the collector.

A fresh native interactive CLI, launched in an empty owned temporary directory
with `--no-session-log --disable-write --disable-shell --trust-workspace`, does
initialize account allowance. Its built-in `/usage` reports Session Turns **0**,
zero tokens, and the same Current/Weekly allowance the owner pasted:

| Window | Used | Native reset label |
|--------|------|--------------------|
| Current | 0% | `at 7:27 AM` |
| Weekly | 0% | `Oct 19 at 8:00 AM` |

On Windows, ordinary pipes do not provide interactive input. The existing
Git-for-Windows `winpty.exe` with `-Xallow-non-tty -Xplain` does. The collector
waits three seconds after the Muse Code banner for account initialization, sends
the fixed `/usage` built-in and an additional Enter after 300 ms to complete
autocomplete selection. A full card arrived in about five seconds. It accepts
exactly one complete subscription card, exactly one Turns 0 field, and distinct
Current/Weekly percentage rows. Session counters never become account quota.
Source: `muse.tui.usage`.

Reset labels lack a complete date/timezone. Optional bounded `resetLabel` preserves
their text; `resetsAt` and `windowMinutes` remain null. No five-hour duration,
calendar year, timezone, ISO reset instant or countdown is inferred.

This slice supports **native Windows with an already-installed winpty helper**.
The helper is discovered from Git installation/PATH locations, never installed
or bundled. The existing Muse launcher resolver reads installation metadata to
locate the native binary; Cats does not read credential files. Custom startup
argv, WSL/Docker, macOS/Linux and missing helpers return unsupported without a
model fallback. CLI versions are provenance, never equality gates.

Primary sources:

- [Muse changelog: MSP usage/read is last observed host state](https://dev.meta.ai/docs/muse-code/changelog)
- [Muse interactive usage command](https://dev.meta.ai/docs/muse-code/interactive)
- [Muse subscription usage](https://dev.meta.ai/docs/muse-code/subscriptions)
- [winpty Windows terminal wrapper](https://github.com/rprichard/winpty/blob/master/README.md)
- [winpty non-TTY test switches](https://github.com/rprichard/winpty/issues/103)

## Bounds, integration and evidence

Both collectors reject custom argv, use an eight-second query deadline,
512-KiB combined stdout/stderr bound, cancellation and owned process cleanup.
Muse keeps stdin open while Windows taskkill reaps the wrapper/tree; early EOF
can otherwise orphan its agent. A fake EOF-exiting wrapper with a long-lived
descendant verifies cleanup. No raw account data or stderr is exported.

Authenticated live production collectors → isolated Runtime HTTP → compiled
Platform client returned Grok unavailable and Muse updated with two explicit
zero percentages and native reset labels. There was one read per CLI, zero
Runtime execution records, zero Runtime sessions, passive cached GETs and a
same-target cooldown that launched no second query. The owner performed login
and their normal Muse message; Cats sent no model work or provider HTTP requests.

Runtime focused tests cover both collectors, snapshot projection, HTTP routing
and refresh lifecycle. Host/SDK target gates and bounded source projection extend
to both providers; Usage buttons require advertised refresh capability. The
private candidate archive passed the production host renderer in isolated Edge:
Grok missing data, Muse zero/reset labels, permissions, passive opening, filters,
offline/stale/restart, narrow layout and disable revocation. Browser data are
fixtures; the authenticated CLI/HTTP/client probe above is the live evidence.

The v1 snapshot change is additive (`resetLabel` optional); no persisted format
or migration changes. Eventual release requires the next compatible SDK minor
for new observable provider support/field, and a new immutable Usage patch.
This source slice does not change version fields, Desktop pins or published bytes.
