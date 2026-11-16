# ADR-055: Let the Owner Grant Computer Use, Shell and File Approvals Once

Date: 2026-11-16
Status: Accepted
Related: [ADR-048](048-bridge-provider-interactions-and-report-effective-session-capabilities.md),
[ADR-049](049-use-native-control-protocols-for-hosted-provider-tools.md),
[ADR-054](054-drive-kimi-code-through-print-mode-stream-json.md) decision 11.

## Context

ADR-054 decision 11 made every Kimi Code tool call that Kimi does not consider safe arrive as an approval
card. That includes each computer-use step. The owner rejected this in practice: while Kimi drives the
mouse and windows, the owner cannot keep taking the mouse back to click a card.

The owner decided on 2026-11-16:

- Computer use, shell commands and file writes are approved once, for one of two periods: the whole
  conversation, or a set time such as 30 minutes.
- Grants are used only by turns the owner starts in person. Turns started by Telegram, heartbeats or
  schedules cannot use them, and their cards wait for the owner as before.
- Safety then comes from stopping, not from per-step clicks. Hosts show that a grant is in force and
  offer a Stop that revokes the grant and cancels the turn. Kimi Computer Use additionally lets a
  physical Escape interrupt its input.
- Cats' own desktop control (`cats-desktop`) keeps its per-action approvals and per-app grants for now.

## Decision

1. **Runtime holds the grant.** A standing grant belongs to one Runtime session.
   - It is kept in memory only and survives that session's worker respawns.
   - It ends when the owner revokes it, when it expires, when the session is removed, or when Runtime
     restarts.
   - Providers' own "allow for this session" or "always" options are never selected, so no native rule
     is persisted and a revoke takes effect at once.
2. **Categories come from the adapter.** A prompt can carry `grantCategory`: `computer_use`, `command`
   or `file`.
   - The adapter sets it only when the prompt's first choice approves that one action.
   - Categories are separate, so a computer-use grant never approves a shell command, and prompts
     without a category stay per call.
   - Hosted ACP tags `execute` as `command` and `edit` as `file`.
   - Kimi's `kimi-cu-win` plugin tools are tagged `computer_use`.
   - The target advertises the categories it tags in `interactions.standingGrants`.
3. **The card creates the grant.** A response may add `standingGrant`, either `{ until: 'session' }` or
   `{ until: 'time', durationMs }` (1 minute to 24 hours).
   - It is accepted only with `accept`, only with the prompt's one-action choice, and only on a
     categorized prompt.
   - That card is answered as usual, and the grant is added for its category.
4. **The host decides per send.** `POST /sessions/:id/messages` uses grants only with
   `standingGrants: true`.
   - Without it, matching prompts become cards as before.
   - A host sets it only for turns its owner started. Wakeups, MCP, ACP and peer sends never set it.
5. **An answered prompt is never shown.** While a send may use a grant and its category is granted,
   Runtime answers with the one-action choice after the adapter has recorded the request.
   - The host sees only a `responding` and then a `resolved` receipt with reason `standing_grant`,
     never `pending`. Waiting states, bubbles and notices therefore do not fire.
6. **Stop.** `DELETE /sessions/:id/interactions/grants` (optionally `?category=`) revokes grants and
   returns the snapshot.
   - Cancelling the turn ends the provider process. For Kimi, ending `kimi acp` also ends the plugin's
     `node-repl.exe` and its JavaScript cell (checked on Windows with a 120-second cell).
   - The interaction snapshot lists `standingGrants` so hosts can show them.

## Consequences

- An owner-started Kimi session can work on the desktop for as long as the owner chose without further
  clicks, while every other trigger still waits for the owner.
- A grant allows unattended actions in its category for its whole period. Stop and Escape are the
  remaining control, so hosts must make the grant visible and Stop reachable without the mouse.
- Codex, Claude Code and Muse prompts carry no category yet and stay per call. Adding one is an
  adapter change under this decision.
- Grants do not survive a Runtime restart or a new Runtime session; the next matching prompt asks again.
- No persisted format changes. Hosts that ignore the new fields keep today's behavior.
