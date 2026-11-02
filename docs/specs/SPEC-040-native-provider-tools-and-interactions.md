# SPEC-040: Native Provider Tools and Interactions

## Metadata

| Field | Value |
| --- | --- |
| Status | Approved; implementation in progress |
| Owner | Runtime provider execution |
| Reviewer | Independent review before merge |
| Baseline | `c6e575b6`; 2026-11-02 |
| Plan | [PLAN-051](../plans/PLAN-051-native-provider-tools-and-interactions.md) |
| Decision | [ADR-049](../decisions/049-use-native-control-protocols-for-hosted-provider-tools.md) |

## Summary

Let Antigravity, Grok and Muse perform work in Cats Bot using native file,
command tools, plus verified session MCP transports, with approvals delivered through the existing
Runtime interaction contract. The owner approved this direction and requested
isolated worktrees, careful planning and implementation on 2026-11-02.

## Goals

- A writable Bot can do work and invoke its own Cats tools.
- Approval, cancellation, resume and tool diagnostics describe the live worker.
- Retain explicit read-only and allowlist restrictions and existing transcripts.

## Non-Goals

- Unconditional permission bypass, replacing provider credentials or global config.
- Copying provider wire protocols into Bot or changing its serialized turn queue.
- Releasing packages or changing version fields as a side effect of implementation.

## Requirements

1. **R1 — Native transports.** Muse uses stable MSP over `muse serve` stdio;
   Grok uses ACP over a dedicated `grok agent --no-leader stdio` process;
   Antigravity uses Google's official ACP executable, distinct from third-party
   `agy-acp` and the raw `agy -p` stream. Probe protocol features, not exact
   version equality. An unavailable required feature produces a clear failure.
2. **R2 — Hosted work.** Enable native write and command tools under an admitted
   policy. Approval is separate from filesystem/network confinement. Never
   claim a narrower ceiling than the native implementation can enforce.
   Existing unhosted CLI invocation and bounded media adapters keep their
   contracts; existing explicit read-only/allowlist choices are not broadened.
   Each CLI instance explicitly selects `protocol: hosted`. The first hosted
   implementation admits only `mode: provider`, `maxAccess: full-access`,
   `network: true`: native approvals may authorize sandbox escape, and ACP
   does not provide sufficient effective-policy readback for host overrides.
   Native permission settings remain authoritative; this is not unconditional
   approval. A provider-configured read-only profile remains read-only.
3. **R3 — Session tools.** Deliver the existing loopback HTTP session MCP overlay
   at native session construction/resume. Do not replace the primary agent,
   write global config or persist credentials. Capability, delivery, discovery
   and successful invocation are distinct evidence. Muse/Grok inspect native
   configured names and refuse collisions. Antigravity session MCP stays disabled
   until a compatible official binary passes authenticated MCP and persistence
   checks; local tools/approvals remain available through its ACP adapter.
   No global configuration is rewritten.
4. **R4 — Live interactions.** Translate supported native approval/input requests
   into SPEC-039 interactions. An answer addresses the original request, with
   worker/turn isolation. Handle duplicates, denial, expiry, provider resolution
   and cancellation. Muse decisions include the current requirement identity;
   an updated approval invalidates the superseded request.
5. **R5 — Lifecycle.** Initialization and capability refresh do not send prompts.
   Resume does not replay historical output as a new answer or re-execute tools.
   Reject incompatible native histories explicitly so a host can preserve the
   transcript and use its existing handoff path. Never silently start fresh.
6. **R6 — Diagnostics.** Expose supported interaction kinds and actual policy/tool
   observations. Unobserved inventory, unavailable sandbox and missing executable
   remain explicit. Model/reasoning controls must reach the native protocol.
7. **R7 — Consumer.** Bot uses Runtime support and delivery evidence rather than
   a provider-name claim. A verified session-MCP target gets Cats Bot, eligible
   desktop and Boss Cat tools. An authenticated tools/list observation is required
   before Boss Cat tools are shown as connected. Missing tools have an actionable reason.
8. **R8 — Compatibility.** Keep public request shapes and profile/journal formats.
   Additive hosted capabilities stay within 0.6.x. Any discovered need to break
   config or stored-data contracts must be recorded with an upgrade/recovery
   path and deferred version boundary; publication remains separately authorized.

## Acceptance

| ID | Required evidence |
| --- | --- |
| A1 | Each protocol initializes without a model turn, selects the requested model and streams a turn once |
| A2 | Native tool availability and a session MCP call are checked with isolated fixtures; host read-only/allowlist admission is rejected without changing legacy restrictions |
| A3 | Allow/deny/cancel/timeout and stale/duplicate replies affect only the intended live request |
| A4 | Pending interaction retains the Bot gate; cancellation/restart never automatically reruns work |
| A5 | MCP authentication reaches only the intended child/session; no secret appears in argv, logs or persisted files |
| A6 | Existing Codex/Claude and legacy/media consumers pass affected regression suites |
| A7 | Native binary observations and scripted contract tests are reported separately, including unverified platforms/authenticated actions |

## Dependencies and Open Questions

- SPEC-035 session MCP and SPEC-039 interactions/policy.
- Native protocol and sandbox probes in PLAN-051 are release gates, not assumptions.
- Official Antigravity ACP installation/auth and history compatibility require
  executable evidence before advertising support for an existing `agy` target.
- The official Linux ARM64 1.4.5 executable aborts on this host's 16 KiB page
  size before ACP initialization (it requires 4 KiB). Protocol fixtures cover
  the adapter; real Google authentication/tools remain unverified here. The
  owner also reported broken X authorization and requested implementation to
  continue without desktop acceptance. Neither limitation is a passing test.

*Created: 2026-11-02*
