# Playground workspace retention and product deletion

Date: 2026-09-18

Status: Confirmed behavior and user concern; joint Runtime/Platform design pending

## User requirement and scope

The user reported that deleting generated files when Playground **Stop Chat** is
pressed does not match their expectations. Record the issue now; review the
solution together with `cats-platform` before changing lifecycle behavior.

The user's suggested distinction is that deleting a conversation in Cats
Chat/Code/Work should clean up its owned resources, while Playground lacks a
higher-level UI that manages successive rooms/sessions. Neither losing work on
stop nor accumulating unbounded abandoned data is an acceptable final design.

This note records evidence and a proposal, not an accepted architecture or an
implemented fix. No cleanup behavior changed as part of this documentation task.

## Confirmed current behavior

| Action or resource | Current behavior |
| --- | --- |
| Playground Stop Chat | Closes participant sessions, deletes the automatically created room workspace, and clears the visible chat and counters. |
| Automatically created workspace | `DELETE /playground/workspace/:id` recursively removes the directory, including generated files. |
| User-selected working directory | Playground does not create a managed workspace ID, so Stop Chat does not request workspace deletion. |
| Runtime participant session | `POST /sessions/:id/close` stops/detaches execution and retains registry/history; it is separate from session deletion. |
| Devin native session | ACP close does not request `session/delete`; retaining provider history does not preserve files removed from the workspace. |
| Playground transport recovery | Calls `close({ releaseWorkspace: false })`, preserving the shared workspace for the retry. |

The room workspace is supplied to participants as a shared `source` workspace.
Runtime session deletion normally retains source directories; deleting a single
participant from Dashboard is therefore not a substitute for managing the room's
workspace. The dedicated Playground workspace DELETE route currently validates
the ID and removes the directory without checking active/shared ownership.

## Historical cause

- Before Runtime commit `e1076edfa0984a20156ff2bd710160df333e365f`, Playground used
  the first participant's workspace as the shared directory. Closing the room
  closed sessions without a separate workspace DELETE request.
- That commit, **2026-03-31 14:24:37 +08:00**, titled
  `fix(runtime): align playground shared cwd semantics`, introduced a dedicated
  room-owned workspace, its create/delete endpoints, and deletion by default in
  `ChatRoom.close()`. Its tests explicitly cover workspace deletion.
- The April 7 HTML source move (`05ee66c`) did not introduce this behavior.
- Inference: releasing a room-owned temporary resource was coupled to stopping
  the room while fixing shared workspace ownership. The commit has no explanatory
  body, its GitHub commit-to-pulls lookup returned no associated PR, and the
  reviewed documents did not establish a requirement to discard generated files
  on Stop Chat. The intended retention policy cannot be inferred from that title.

## Existing Platform contract and limits of this review

[ADR-049](../../../cats-platform/docs/decisions/049-cascade-product-deletes-into-runtime-session-deletion.md)
and [SPEC-048](../../../cats-platform/docs/specs/SPEC-048-runtime-session-deletion-on-product-delete.md)
distinguish non-destructive stop/close/sleep from explicit product deletion.
They cover deleting chats, group member chats, and Cats; they do not establish
permission to delete arbitrary user directories.

[SPEC-034](../../../cats-platform/docs/specs/SPEC-034-room-owned-workspace-bootstrap-and-ownership.md)
is a draft describing room ownership separately from participant ownership:
closing a participant must not remove a shared room workspace. That ownership
model alone does not decide when room outputs may be discarded.

The inspected Platform implementation calls Runtime session deletion before
deleting a chat channel. Actual errors cancel the product delete, but a Runtime
`retained` result is recorded and permits product deletion; the shared navigation
UI has retained-session feedback. This differs from the older ADR/SPEC wording
that groups retained outcomes with failures. Reconcile this explicitly during
the lifecycle review; do not assume either document proves current behavior.
Complete Chat/Code/Work resource cleanup coverage has **not** been audited here.

## Proposed direction for joint review

1. **Stop execution without destroying work.** Stop Chat ends/detaches execution
   and keeps a durable room record, session links, workspace and outputs that the
   user can find again. Clearing the current screen is not deletion authority.
2. **Delete through the owning object.** Explicit conversation/room deletion
   requests cleanup of its owned sessions and managed resources through Runtime.
   Determine all owners/references before deleting shared data. User-selected
   directories remain user-owned; removing a conversation must not remove them.
3. **Give Playground a minimal room lifecycle.** Persist room identity and its
   resource links across page reloads and Runtime restarts. Provide recent rooms
   with access to their workspace and explicit cleanup, either in Playground or
   by reusing Dashboard. The UI location and resume guarantees remain undecided.
4. **Separate disposable data from deliverables.** Cache, failed empty setup and
   confirmed orphaned scratch data can have bounded retention rules. Generated
   outputs do not become garbage merely because a room is inactive or unpinned.
   Offer preservation/export and visible age/size information. Review a
   recoverable trash/grace period before permanent deletion; do not silently
   delete valuable work to satisfy a quota. No duration or quota is selected yet.
5. **Make incomplete cleanup recoverable.** Report retained resources and actual
   failures, keep enough ownership metadata for retry, and define partial-delete
   behavior. An active session or another owner's reference prevents reclamation.

Runtime should own resource identity, ownership checks and cleanup execution;
Platform should own Chat/Code/Work intent and presentation. Standalone Playground
needs an owner and management surface too, rather than treating process lifetime
as the lifetime of the user's work.

## Required follow-up before implementation

- Audit Chat, Code, Work and Playground action-to-resource mappings: cancel,
  close, archive, delete, participant removal, room deletion and crash recovery.
- Inventory room workspaces, session sandboxes/worktrees, provider-native
  histories, transcripts, artifacts and caches, including shared/external paths.
- Decide output retention, explicit deletion scope, recovery, cleanup visibility,
  and the treatment of Runtime `retained` outcomes across all callers.
- Plan migration for existing Playground directories/session references without
  guessing that unidentified directories are safe to delete.
- Validate that stop/reload/restart preserves accessible outputs; participant
  deletion cannot remove another participant's workspace; explicit room deletion
  cleans only owned resources; external folders survive; and failed cleanup can
  be inspected and retried.

## Evidence and validation

Read-only source/history review, no destructive reproduction and no behavior
test run for this documentation-only follow-up:

- Runtime: `src/http/ui/pages/playground.html` (`ChatRoom.start/close`,
  `stopChat`), `src/http/routes/sessions.ts` (workspace create/delete and session
  close/delete), `src/core/workspace/sessionWorkspace.ts`, and
  `src/backends/agent/adapters/acp/AcpAdapter.ts`.
- Platform: `src/products/chat/api/routeSessions.ts`,
  `src/products/chat/api/routeSupport.ts`, and
  `src/products/shared/renderer/hooks/useWorkspaceAppNavigationActions.ts`.
- History: `git show e1076ed` and its parent, plus the commit-to-pulls lookup.
- Runtime lifecycle contract:
  [SPEC-014](../specs/SPEC-014-session-maintenance-worktree-isolation-and-compaction-hooks.md).
