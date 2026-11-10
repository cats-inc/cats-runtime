# ADR-050: Separate Provider Session Persistence from Product History

## Status

Accepted for implementation, 2026-11-11. Implemented in isolated worktrees after
the owner's instruction to proceed; scoped tests, independent review and Windows
native acceptance are recorded in PLAN-052. Publication remains separate.

## Context

ChatGPT Desktop displays Cats-created Codex threads from the user's existing
Codex profile. Catlas creates independent sessions for title and assist jobs;
closing their workers preserves their native histories. Bot also replaces a
healthy native conversation after a process restart even though Runtime keeps
the original mapping on disk. Instruction envelopes become native previews.

Product conversations, Runtime session records and provider-native histories
have different lifetimes. Suppressing all persistence would break conversation
resume; sharing one background thread would break Catlas input isolation.

## Decision

1. Runtime owns an explicit, optional provider-session persistence policy.
   Existing requests remain persistent. Codex maps an ephemeral request to
   thread/start.ephemeral and verifies the returned value before any model turn.
   Other providers advertise support only after their implementation is verified.
2. Ephemeral means no resumable provider-native history. Runtime metering,
   execution receipts and product-owned history retain their existing policies;
   this is not a general data-erasure promise.
3. Platform requests ephemeral Codex sessions for independent Catlas jobs,
   including bounded advice that uses a second turn for host-operation feedback.
   Prompt and navigation jobs continue to have separate histories.
4. Persistent conversations reuse their existing Runtime identity and native
   thread across worker and host restarts, subject to unchanged execution policy
   and product identity. A process exit is not evidence that native history is
   missing. Bot first uses its existing attachment and Runtime resume endpoint.
5. ADR-006's provider_session_unavailable remains terminal. Product owners alone
   decide when to replace a missing native conversation and supply the handoff.
   Transport/auth failures do not authorize replacement or replay.
6. Products supply recognizable labels; the Codex adapter owns thread/name/set.
   Retain the existing instruction envelope: the current native turn schema has
   no developerInstructions override, so moving session instructions would change
   per-turn precedence. That separate change needs its own acceptance. Codex
   baseInstructions are not replaced.

## Consequences

- Catlas jobs stop accumulating native conversations without sharing untrusted
  inputs across jobs. Persistent chats keep their own context and identifiers.
- An ephemeral worker cannot be resumed after exit, including MCP-triggered
  recycle or Runtime restart. Every automatic respawn path must enforce this.
- Consumers need persistence capability/readback checks: an old Runtime must not
  silently accept an unknown option and create a persistent Catlas conversation.
- Existing histories stay intact. Historical cleanup and relocating CODEX_HOME
  are separate changes, not prerequisites for this repair.

## Alternatives considered

| Alternative | Assessment |
| --- | --- |
| One permanent Catlas thread | Mixes independent prompt/navigation inputs and accumulates stale context; conflicts with Platform SPEC-131. |
| One thread per Bot process | Loses identity on restart and mixes multiple note conversations. |
| Archive/delete every job afterwards | Leaves a discovery window, fails on crashes, and makes deletion part of the inference success path. |
| Separate provider home | Couples history isolation to authentication, config, plugins and native tools; requires a separate product design. |
| Change originator/threadSource | Source classification is not an upstream guarantee that ChatGPT hides a thread. |

## References

- [SPEC-041](../specs/SPEC-041-provider-session-retention-and-continuity.md)
- [PLAN-052](../plans/PLAN-052-codex-session-retention-and-continuity.md)
- [Investigation and native probe](../research/2026-11-11-codex-session-list-pollution.md)
- [ADR-006](006-agent-backend-and-shared-runtime-contracts.md)
