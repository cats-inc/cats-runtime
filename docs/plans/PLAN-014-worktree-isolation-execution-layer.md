# PLAN-014: Worktree Isolation Execution Layer

> Status: Completed
> Owner: Codex
> Related Specs: [SPEC-008](../specs/SPEC-008-workspace-substrate-init-audit-and-update.md), [SPEC-011](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md)

## Goal

Connect worktree-backed workspace isolation to the real runtime session
lifecycle so `cats-runtime` can prepare, resume, reset, delete, and fork
sessions against deterministic Git worktrees instead of treating workspaces as
shared-only or sandbox-only.

## Scope

- Add runtime-owned prepare/cleanup helpers for `shared`, `isolated`, and
  `worktree` execution surfaces
- Persist additive workspace isolation metadata in registry/session payloads
- Wire worktree preparation into create/resume/fork
- Wire merge-or-discard cleanup into reset/delete
- Leave additive lifecycle hook seams for later memory flush / compaction work

## Delivered

1. `src/core/workspace/sessionWorkspace.ts` now owns deterministic worktree
   preparation, cleanup, and merge/discard semantics.
2. Session contracts now persist `workspaceIsolation` plus
   `hydration.workspace.isolationMode`.
3. `src/http/routes/sessions.ts` now prepares or recreates worktrees during
   create/resume/fork and routes reset/delete through the same cleanup layer.
4. Session maintenance now exposes additive `pre_flush` hooks alongside the
   earlier `pre_reset` / `pre_compaction` seams, and reset/delete now accept
   explicit `preserve` worktree disposition for manual handling.
5. Vitest coverage now exercises direct helper behavior plus route-level
   worktree flows.
6. Delivery commit apply now materializes detached runtime-owned session
   worktrees onto a deterministic `cats/runtime/<session-id>` branch only when
   delivery needs it. Discard/orphan cleanup removes those reserved local refs;
   merge cleanup retains them for recovery.

## Watchpoints

- `merge` intentionally retains the session/worktree when the source repo is
  already dirty; runtime does not invent conflict resolution policy.
- Fork-time workspace copying is a conservative snapshot helper, not a full
  two-way sync protocol.
- Cleanup remains explicit lifecycle behavior; this slice does not add a
  background abandoned-worktree sweeper.

## Verification

- `npm run build`
- `npm test`

---

*Last updated: 2026-09-02*
