# Codex Native Session Listings Expose Cats Internal Jobs

Date: 2026-11-11. Research complete; implementation and model-turn acceptance
remain pending under [PLAN-052](../plans/PLAN-052-codex-session-retention-and-continuity.md).

## Observations

The supplied screenshot and a new read-only native window capture both showed
many ChatGPT Desktop entries beginning with the Catlas or Bot instruction
envelope. The installed package path identified ChatGPT 26.1103.7773.0; the
provider CLI was codex-cli 0.167.0. An initially available computer-use surface
only exposed Firefox, and sandboxed Win32 queries returned no ChatGPT handle.
A scoped approved read-only host query and PrintWindow capture reached the
existing ChatGPT window without clicking or sending input.

A read-only query of the native thread index found 58 unarchived Catlas records
and 15 unarchived records matching the reported Bot persona. Their originator
was cats-runtime. Workspace attribution separated Platform-managed Catlas jobs
from the Bot's own workspace. There were 19 matching Catlas records in the
preceding 24 hours. These are bounded matching counts, not all Cats activity.
Raw prompts, paths, screenshots and database rows are kept out of this repository.

## Source findings after updating main

| Repository | Source baseline | Finding |
| --- | --- | --- |
| cats-runtime | 36a112123b2df3dbbe0f775fe22ab459c206341f | Codex uses app-server; bootstrap omits ephemeral, instructions prefix the user text, and close retains history. Registry reload preserves native IDs. #214 adds terminal provider_session_unavailable handling. |
| cats-platform | 5610d09cc9b88d8541d72df0e35f03291aba1f61 | inferCatlasData creates a fresh session per job and closes it afterwards. SPEC-131 requires prompt/navigation isolation. #398 preserves product handoff when native history is genuinely gone. |
| cats-bot | eb16f2db99f76f82c216b5026c0009e616d45f02 | Startup/runtime exit marks attachments closed; binder creates for closed, while sleeping resumes. The same Runtime data directory and both IDs already persist. The vendored Runtime is still the earlier 1bbba8d0 candidate. |

Bot's primary fix does not require importing native IDs: resume its preserved
Runtime record first. A missing Runtime registry entry remains a separate case.
The Codex image runner also uses persistent exec; its generated-image collection
needs separate validation before changing that path's persistence.

## Local protocol evidence

Generated 0.167.0 app-server schemas expose:

- ThreadStartParams: ephemeral, developerInstructions and baseInstructions.
- ThreadResumeParams: threadId and developerInstructions.
- TurnStartParams: threadId, but no developerInstructions override.

At 2026-11-11 03:32 Asia/Taipei, a child app-server using a new isolated
CODEX_HOME and workspace completed this zero-inference probe:

| Probe | Result |
| --- | --- |
| thread/start with ephemeral: true | Accepted; returned thread.ephemeral true and path null. |
| thread/list in that isolated profile | The ephemeral thread was absent. |
| thread/name/set on a separate persistent fixture thread | Accepted with an empty success object. |
| Model turns / real profile writes | Zero / none. |

The child exited after stdin closed. This does not establish persistence behavior
after a completed model turn, ChatGPT rendering of future labels, image output
availability, or cross-platform behavior. Those are explicit acceptance gates.

## Completed implementation acceptance, 2026-11-11

Windows, installed Codex CLI 0.167.0, using disposable Runtime and Codex homes.
Only the existing login file was copied for the bounded model calls; each copy
was removed in `finally` and its absence verified. The real Codex home, ChatGPT
index and existing conversations were never modified by the probes. Raw IDs and
local paths remain in private workspace evidence.

| Acceptance | Observed result |
| --- | --- |
| Built Runtime adapter, two native ephemeral turns | Same native ID; both completed; absent from native thread/list, read-only SQLite thread identities and rollout files after worker shutdown. |
| Persistent native turn followed by process restart and resume | Same native ID; one saved thread and rollout; product name retained despite a different label supplied on resume. |
| Built Platform client and both Catlas inference paths over the exact Runtime candidate | Two separate data jobs plus one advice job; four completed turns; advice feedback reused its job; one in-memory host operation; zero saved native threads or rollouts after Runtime shutdown. |
| Bot host restart with real candidate Runtime and fixture CLI | Home and note each retained both Runtime/native IDs; restart and reconcile sent zero model turns; the next sends resumed each separate identity. |

The first native-name assertion incorrectly compared SQLite `title` (the first
message preview) with the custom name. The existing fixture was rechecked without
additional model calls using native `thread/list`: `name` was correct and remained
unchanged after resume. Codex stores that custom name in its name index. This
distinction is why UI-facing names must be checked through the native protocol,
not inferred from the first-message column.

Runtime candidate: baseline `36a112123b2df3dbbe0f775fe22ab459c206341f` plus this
uncommitted implementation, packaged as `cats-inc-cats-runtime-0.6.2.tgz`.
SHA-256: `256fb37a5b218fc9137910969a5d3b4c1e77a138f09273d8caa6018b0d087a76`.
The sorted `src` path/content-hash manifest has SHA-256
`ad007a2848162ec3fdbcbd1bffdaa6e6ddf94dfe18aec1a654b018cf74ce472d`.
All 1,513 package files installed in the Bot worktree matched the packed source
files byte-for-byte. This is local candidate evidence, not a hosted commit or
published dependency pin. Platform's real client/Catlas probe used that same
installed package through an isolated managed Runtime.

Independent read-only review found and resolved session-key policy mismatch,
ephemeral peer-routing admission, stale Bot reconciliation evidence and unsealed
stream-failure presentation. Regression fixtures cover these, unsupported/ignored
admission, temporary errors, partial output and cancellation/invalid-output cleanup.
Native failure/cancel variants, macOS/Linux and newly packaged Desktop/Bot UI were
not exercised by these bounded native success probes. No real history cleanup,
instruction-routing change or Codex image-runner change is included.

## Primary sources

- [Codex App Server](https://learn.chatgpt.com/docs/app-server), read 2026-11-11:
  native resume, name-setting, history/listing and ephemeral fork semantics.
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), read
  2026-11-11: exec persistence controls.
- Installed codex exec --help and generated app-server schemas at 0.167.0.

Source classification and a successful close are not evidence that an upstream
client hides the native record. The proposal uses actual non-persistence for
internal jobs and identity continuity for real conversations.
