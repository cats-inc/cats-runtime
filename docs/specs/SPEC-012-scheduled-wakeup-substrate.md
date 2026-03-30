# SPEC-012: Scheduled Wakeup Substrate

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented (Recurring Slice) |
| **Owner** | Codex |
| **Reviewer** | User / Team 4 |

## Summary

`cats-runtime` needs a lightweight runtime-owned wakeup substrate so upper-layer
products can ask the runtime to wake a known session later without pretending
that a full autonomous scheduler already exists.

This spec defines a lightweight runtime-owned wakeup substrate whose delivered
scope now includes a recurring follow-on slice:

- create, list, inspect, cancel, and trigger wake requests
- persist requests so scheduled wakeups survive runtime restart
- coalesce explicitly keyed duplicates and reject exact unkeyed duplicates
- run due wakeups through a bounded timer loop
- support UTC cron-like recurring wakeups with automatic re-arming
- surface additive wakeup metadata in existing session inspection/history

This is intentionally **not** a general scheduler, heartbeat system, or product
workflow engine.

## Goals

- define a stable runtime-owned wake request contract with:
  - `reason`
  - `target`
  - `scheduleAt`
  - `coalesceKey`
  - `status`
  - `metadata`
- let hosts create, inspect, cancel, and manually trigger wake requests over
  HTTP
- persist wake requests so due work is restart-safe
- provide a bounded in-process timer loop for scheduled requests
- make wakeup activity visible from existing session/history inspection without
  changing transcript semantics

## Non-Goals

- full heartbeat scheduling or company-level autonomy
- complex retry policy, non-UTC recurrence, or workflow-level orchestration
- background orchestration UI or approval policy
- product-owned room workflow logic
- provider/model catalog polling
- first-slice provider/bootstrap creation semantics for brand-new sessions

## First-Slice Scope

The first slice only supports:

- `target.kind = "session"`
- waking a known runtime/discovered session by `sessionId`
- ensuring the session is awake or resumable through existing runtime/session
  machinery

The first slice does **not** define a general "create a brand-new session later"
contract. Products can still use existing `POST /sessions` for immediate session
creation.

## Requirements

### Functional Requirements

1. The runtime shall expose a wake request contract containing `reason`,
   `target`, `scheduleAt`, `coalesceKey`, `status`, and optional `metadata`.
2. The runtime shall expose HTTP routes to create, list, inspect, cancel, and trigger
   wake requests.
3. The first slice shall support `target.kind = "session"` with a required
   `sessionId`.
4. Creating a wake request for an unknown session shall fail clearly.
5. Wake requests shall persist to runtime-owned local storage.
6. On runtime restart, persisted scheduled requests shall remain triggerable.
7. The runtime shall run a bounded timer loop that checks for due scheduled
   wakeups.
8. Each timer iteration shall process at most a bounded number of due requests.
9. A wake request with the same `target` and `coalesceKey` as an existing open
   request shall coalesce into the existing request instead of creating a new
   one.
10. An exact duplicate wake request without a `coalesceKey` shall be rejected
    clearly.
11. Terminal wakeup states shall include at least:
    - `triggered`
    - `cancelled`
    - `failed`
12. Non-terminal wakeup states shall include at least:
    - `scheduled`
    - `triggering`
13. Manual trigger shall be able to run before `scheduleAt`.
14. Triggering a wakeup shall record outcome metadata such as:
    - trigger source (`manual` or `timer`)
    - trigger timestamp
    - target session id
    - outcome (`resumed` or `already_awake`) when successful
    - error text when wake failed
15. Existing session inspection/history payloads shall include additive wakeup
    observability for the target session.
16. Wakeup observability should include at least:
    - whether a session has pending wakeups
    - pending count
    - next scheduled time
    - the latest wake request metadata
17. The wakeup contract may support additive recurrence metadata when the
    runtime can reschedule the same request deterministically after trigger.
18. The first recurrence slice shall accept only UTC five-field cron
    expressions and shall compute the next due time inside the runtime-owned
    wakeup service.

### Non-Functional Requirements

- The implementation should stay runtime-owned and lightweight.
- The timer loop should remain cheap enough for a normal single runtime
  instance.
- The runtime should not imply stronger scheduler guarantees than it actually
  implements.
- The implementation should reuse existing session resume/ensure-awake logic
  rather than inventing a second session lifecycle.

## Public Contract

### Create

```json
{
  "reason": "wake boss cat for reopened chat",
  "target": {
    "kind": "session",
    "sessionId": "session-123"
  },
  "scheduleAt": "2026-03-23T12:00:00.000Z",
  "coalesceKey": "chat:room-123:boss",
  "metadata": {
    "chatId": "room-123",
    "participantId": "boss-cat"
  }
}
```

### Request Shape

```json
{
  "id": "wake-123",
  "reason": "wake boss cat for reopened chat",
  "target": {
    "kind": "session",
    "sessionId": "session-123"
  },
  "scheduleAt": "2026-03-23T12:00:00.000Z",
  "coalesceKey": "chat:room-123:boss",
  "status": "scheduled",
  "metadata": {
    "chatId": "room-123",
    "participantId": "boss-cat"
  },
  "createdAt": "2026-03-23T11:55:00.000Z",
  "updatedAt": "2026-03-23T11:55:00.000Z",
  "attemptCount": 0,
  "coalescedCount": 0
}
```

## Design Notes

- Persistence uses a runtime-owned JSON store in the runtime data directory.
- Due wakeups are processed by a bounded interval loop, not by a full job
  runner.
- Recurring wakeups currently use a minimal UTC five-field cron parser rather
  than a general calendar/scheduler engine.
- Wakeup trigger delegates to existing session resume/ensure-awake machinery.
- Session/history payloads expose additive `wakeup` metadata rather than
  synthesizing transcript messages.

## Implementation Tracking

- The delivered wakeup substrate was implemented directly as runtime slices
  before a follow-through plan existed.
- Ongoing follow-through is now collected under
  [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md),
  with `PROGRESS.md` / `ROADMAP.md` still carrying the broader runtime status.
- The latest follow-through slice adds bounded due/failed request samples on
  runtime-wide wakeup diagnostics so operators can inspect backlog hotspots
  without first listing every retained request.
- Remaining follow-through is explicitly substrate-only: broader retry/backoff,
  future bootstrap-owned wake targets, and richer diagnostics may still land,
  but product workflow/orchestration policy remains out of scope for this spec.

## Dependencies

- `cats-platform/docs/specs/SPEC-016-chat-session-sleep-wake-lifecycle.md`
- `cats-platform/docs/specs/SPEC-026-explicit-mentions-and-dynamic-room-workflow-orchestration.md`
- `cats-platform/docs/decisions/024-separate-explicit-mentions-from-dynamic-room-workflow.md`
- `cats-runtime/docs/research/2026-03-19-paperclip-gap-assessment.md`

## Deferred Follow-Ups

- provider/bootstrap wake targets for not-yet-created sessions
- richer retry/backoff policy and broader recurrence semantics
- broader diagnostics beyond the current aggregate summary plus bounded due/failed request samples
- product-owned orchestration rules built on top of wakeup primitives

---

*Last updated: 2026-03-29*
*Related Plan: [PLAN-024](../plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md) (follow-through plan; initial substrate slice was implemented directly)*
