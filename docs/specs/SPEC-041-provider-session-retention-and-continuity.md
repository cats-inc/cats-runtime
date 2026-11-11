# SPEC-041: Provider Session Retention and Conversation Continuity

## Metadata

| Field | Value |
| --- | --- |
| Status | Implemented in worktrees; scoped and Windows native acceptance passed; unpublished |
| Owner | Runtime execution, with Platform and Bot consumer owners |
| Reviewer | Independent read-only review completed; findings fixed and regression-tested |
| Date | 2026-11-11 |
| Baseline | Runtime 36a112123b2df3dbbe0f775fe22ab459c206341f |
| Decision | [ADR-050](../decisions/050-separate-provider-session-persistence-from-product-history.md) |
| Delivery | [PLAN-052](../plans/PLAN-052-codex-session-retention-and-continuity.md) |

## Summary

Keep internal Codex jobs out of persisted native thread listings while retaining
one compatible native thread per real product conversation. ChatGPT Desktop
currently exposes repeated Catlas and Bot instruction envelopes. Runtime owns
native persistence and labeling; Platform classifies Catlas jobs; Bot fixes its
restart admission. This is a Codex-first change with explicit capability checks.

## Goals

- Repeated Catlas title, prompt and navigation jobs create no persisted Codex
  conversations, including failure/cancellation paths.
- Bot home and note conversations preserve Runtime and native thread identities
  across an ordinary process restart when their saved mapping is valid.
- Persistent Cats conversations have recognizable native names.
- Preserve permissions, current skills, MCP admission, telemetry, and the
  distinction between temporary failure and confirmed loss of native history.

## Non-goals

- Hiding all intentional Cats conversations from ChatGPT or changing ChatGPT UI.
- Sharing a thread between conversations, Cats, profiles, participants or jobs.
- Rewriting authentication/configuration, relocating the real CODEX_HOME, or
  modifying the user's Codex SQLite/session files.
- Automatically archiving/deleting existing histories or replaying interrupted
  work. This repair prevents new pollution; old records require separate scope.
- Changing media artifact retention or tool permissions. The separate Codex
  image runner remains an inventoried follow-up until its artifact collection
  contract is verified with ephemeral execution.

## Requirements

### R1. Explicit provider persistence

Additive create field: providerSessionPersistence, with values
persistent and ephemeral. Omission means persistent for existing callers and
stored records. A session's choice is immutable after creation. The same field
appears in Runtime session reads, spawn options and new persisted records.

Provider configuration exposes whether ephemeral sessions are supported for the
selected backend/instance. Codex CLI is the initial implementation. An explicit
ephemeral request on an unsupported target is rejected before work starts; it
must never silently become persistent. This policy is separate from the existing
Provider.ephemeral flag, which means a process is spawned per turn.

Runtime's request/readback says which policy was admitted. The adapter separately
verifies thread/start's thread.ephemeral is true before releasing turn/start.
A CLI that rejects or ignores the field fails that job without a persistent
fallback. No exact CLI-version allowlist is introduced.

### R2. Ephemeral lifecycle

- Each job uses a fresh thread. Multiple turns within that same live worker are
  allowed, so advice followed by a verified host result still works.
- While the original worker is alive it may accept the job's next turn. After
  close, cancellation, worker loss or Runtime restart, it cannot resume, fork,
  wake or silently respawn. Controls report that limit and execution entrypoints
  enforce it, including pool admission and MCP-triggered worker recycle.
- A closed ephemeral session stays available under existing Runtime history and
  metering rules. It cannot acquire a new native identity under the old Runtime ID.
- A transient network failure does not broaden persistence. A product may start
  a new job only under its existing retry/idempotency rules; a host operation
  that may already have executed is never repeated automatically.

### R3. Catlas consumer admission

Platform requests ephemeral mode for Codex-backed inferCatlasData and
inferCatlasAdvice. Existing sandbox/read-only, skill, MCP and strict-output
validation remain intact. Prompt-generation and navigation calls stay separate,
as required by Platform SPEC-131 FR-4.

Platform verifies support and create readback before sending any content. If an
older Runtime lacks the contract, automatic Catlas work keeps cached/builtin
content and records a bounded capability failure. Explicit help uses its current
failure presentation. It does not fall back to a persistent Codex job or switch
the selected provider. Non-Codex targets retain their established behavior.

### R4. Persistent Bot continuity

Bot already owns stable Runtime data storage and saves both session identities.
Runtime already reloads registered sessions as closed. The primary recovery path
therefore remains GET /sessions/:id followed by POST /sessions/:id/resume; no
global discovery or new native-ID import endpoint is needed for restart recovery.

| Observed condition | Required behavior |
| --- | --- |
| Compatible attachment and live worker | Reuse it; a tick never disturbs a busy turn. |
| Compatible attachment; worker/Runtime restarted; record exists | Resume the same Runtime ID and native thread, with current host/MCP admission. |
| Legacy closed/failed attachment, no terminal evidence | Probe the saved Runtime ID before replacement; state alone is insufficient evidence of loss. |
| Timeout, unreachable Runtime, auth/policy error, or ambiguous failure | Preserve attachment and transcript; surface/back off under current product rules. No fresh session. |
| Confirmed native provider_session_unavailable, including Codex's archived thread/resume rejection | Keep old history and the user's archive choice; replace once with an explicit handoff and notice. Never unarchive automatically or respawn the terminal native ID. |
| Authoritative missing Runtime record | Apply the existing bounded product handoff path; raw native-ID import remains outside this slice. |
| Reset or incompatible provider/model/policy/config revision | Preserve existing deliberate fresh-session/retarget semantics and conversation isolation. |

Refreshing MCP descriptors after Runtime restart is mandatory: secret-bearing
descriptors are memory-only under SPEC-035. Startup and reconcile remain zero-turn
operations. Existing running work becomes interrupted and is not replayed.
One replacement cannot cause repeated replacements on later ticks before it has
successfully served a turn; HTTP and stream-level failures must share that fence.

### R5. Persistent names and instruction delivery

Optional sessionLabel on create/resume is product-owned plain text, trimmed and
bounded to 160 Unicode code points without C0/DEL controls, mapped by Codex to thread/name/set. Examples:
Cats Bot · bot name · note title; Cats Chat · conversation title · Cat name.
Labels contain no persona instructions, tokens or diagnostic paths. They do not
select or identify a session. Unsupported/failed naming is nonfatal and does not
start another thread or lose the pending user message.

Set a label on creation; resume may seed missing Runtime label metadata. Native
bootstrap only sets it when the returned thread has no name, preserving a name the
user changed in the native client. A live worker applies newly seeded metadata on
its next bootstrap. Name-set replies and unrelated notifications
must not be mistaken for bootstrap or turn replies.

The follow-up repair sends merged skill, session and per-turn instructions via
`thread/inject_items` as a developer message before the clean user input. Only
the matching successful object acknowledgement releases `turn/start`; an error,
malformed acknowledgement or timeout stops the worker. No instruction envelope
is inserted into the user message. Every overlay applies to the next turn and
supersedes earlier Runtime overlays. Clearing, including an empty cold-resume
turn, explicitly ends the old overlay. Inspection may bootstrap before a send;
the actual send still admits its current instructions. Preserve native base
instructions, selected model/effort, sandbox, skills and tool permissions.

### R6. Preserve current missing-session recovery

Runtime #214 / ADR-006 and Platform #398 / ADR-068 already define terminal
provider-session loss. Keep their typed errors, old-history access, correct cwd,
handoff and one-replacement protections. Ephemeral intentional expiry needs its
own non-resumable handling; do not pretend the CLI reported a lost durable thread.

### R7. Compatibility and data

Optional fields default to persistent; old sessions remain resumable. Plan an
additive Runtime 0.6.x contract and compatible Bot 0.5.x behavior correction,
subject to validation. This plan authorizes no version bump or publication.

Bot interprets existing attachment states and adds optional unavailableReason and
replacementPending fields. Legacy version-1 reads do not rewrite files; ordinary
updates retain the existing atomic persistence path. No mandatory format migration
or minor-line break is required. Integration used a built candidate verified
against all installed package files. The tracked Bot release pin still predates
#214 and must be refreshed from an exact committed Runtime revision before shipping.

## Acceptance

| Case | Observable result |
| --- | --- |
| Repeated Catlas success, invalid JSON, timeout and cancel | Zero new persisted native threads; separate job inputs; truthful receipts. |
| Two-turn Catlas operation feedback | One live ephemeral thread, no repeated host operation, no saved native thread. |
| Unsupported/ignored persistence setting | No model content sent and no persistent retry. |
| Ephemeral process exit, Runtime restart, MCP recycle, wake and fork | No silent respawn/resume; controls and routes agree. |
| Bot owner turns, heartbeat, idle sleep, normal restart and Runtime crash | Same two identities where resumable; no prompt sent by reconcile. |
| Multiple notes and simultaneous tick/send | Independent histories, one bind per conversation, no duplicate threads. |
| Native history missing versus temporary error | At most one safe replacement for confirmed loss; none for temporary errors. |
| Persistent labeling and instructions | Recognizable name; exact intended instruction delivery; ordinary turn/metering flow preserved. |

Native acceptance must include completed fixture/model turns; the already-run
zero-turn probe proves protocol admission only. Use isolated provider homes and
product profiles, then inspect organic user activity read-only for installed UI
acceptance. Do not create verification chats in the user's real profile.

## Dependencies and references

- [SPEC-035: Session MCP servers](SPEC-035-session-mcp-servers.md)
- [SPEC-039: Session capabilities](SPEC-039-provider-session-capabilities-and-interactions.md)
- [Native investigation](../research/2026-11-11-codex-session-list-pollution.md)
- Platform SPEC-131, ADR-140, SPEC-069 and PLAN-131 in cats-platform.
- Bot SPEC-001, ADR-001 and PLAN-012 in cats-bot.
