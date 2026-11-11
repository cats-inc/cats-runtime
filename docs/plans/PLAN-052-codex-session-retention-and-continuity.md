# PLAN-052: Codex Session Retention and Conversation Continuity

## Metadata

| Field | Value |
| --- | --- |
| Status | Implemented and locally validated; unpublished; release pins pending |
| Owner | Runtime execution, with Platform and Bot consumer owners |
| Reviewer | Independent read-only review completed; findings fixed and regression-tested |
| Date | 2026-11-11 |

## Related Spec

[SPEC-041](../specs/SPEC-041-provider-session-retention-and-continuity.md),
[ADR-050](../decisions/050-separate-provider-session-persistence-from-product-history.md)
and the [native investigation](../research/2026-11-11-codex-session-list-pollution.md).
Consumer plans are Platform PLAN-132 and Bot PLAN-013 in their own repositories.

## Overview

Stop Catlas background jobs from becoming saved Codex conversations, and resume
the same native thread for a compatible Bot conversation after restart. Deliver
the persistence contract in Runtime, consume it in Platform, repair Bot binding,
then add recognizable names. Instruction routing is a separately testable change.
Existing native histories remain intact. No release or version bump is included.

Each checkout was fetched and fast-forwarded before creating its own
`.claude/worktrees/codex-session-retention` on `fix/codex-session-retention`.

| Repository | Baseline | Consumer dependency |
| --- | --- | --- |
| cats-runtime | 36a112123b2df3dbbe0f775fe22ab459c206341f | Includes terminal missing-provider-session handling (#214). |
| cats-platform | 5610d09cc9b88d8541d72df0e35f03291aba1f61 | Includes bounded product conversation replacement (#398). |
| cats-bot | eb16f2db99f76f82c216b5026c0009e616d45f02 | Vendored Runtime 0.6.2-1bbba8d0 predates #214; integrated tests need a new exact candidate. |

## Implementation Phases

### P0. Evidence and design

- [x] Inspect the reported native UI and attribute repeated records read-only.
- [x] Update all three main checkouts and create isolated worktrees.
- [x] Trace Catlas create/close and Bot startup/binder/reconcile behavior.
- [x] Verify ephemeral admission and name-setting with zero model turns in an
      isolated Codex home. This is not completed-turn acceptance.
- [x] Record the proposed contract, consumer plans and acceptance boundaries.

### P1. Runtime persistence contract

- [x] Add the optional persistence field to create, session readback, saved
      records and spawn options; preserve persistent defaults for old callers/data.
- [x] Advertise support for the selected provider/backend and reject unsupported
      explicit requests. Keep process-per-turn Provider.ephemeral separate.
- [x] Send Codex thread/start.ephemeral and verify the effective response before
      any queued turn, including bootstrap triggered by capability refresh.
- [x] Make ephemeral worker loss terminal without treating it as native-history
      corruption. Enforce the rule in resume/fork/wake/send/MCP recycle and controls.
- [x] Keep Runtime receipts/history and existing provider_session_unavailable
      behavior. Add old-record and failed-admission fixtures.

**Gate:** ignored/rejected policy never sends model content or falls back to a
persistent job; a live ephemeral worker still supports two turns.

### P2. Platform Catlas consumption

- [x] Implement Platform PLAN-132: transport fields/capability readback and both
      inferCatlasData and inferCatlasAdvice paths.
- [x] Keep separate prompt/navigation histories, sandbox and validation rules;
      allow the existing bounded second advice turn in the same live worker.
- [x] Fail capability admission before inference on old Runtime. Preserve cached
      or builtin content and current explicit-help failure behavior.

**Gate:** repeated title/assist jobs leave zero saved native threads after
completed turns, invalid output, cancellation and worker failure.

### P3. Bot restart continuity

- [x] Implement Bot PLAN-013: probe and resume the saved Runtime attachment on
      restart, including old closed/failed records with no terminal evidence.
- [x] Rehydrate current host/MCP descriptors; preserve bind coalescing and
      provider/model/config identity. Reconcile starts no model turn.
- [x] Separate typed native loss, missing registry entries and temporary errors;
      carry terminal evidence through both HTTP and event-stream paths.
- [x] Keep one bounded handoff for confirmed loss and prevent replacement churn
      before the new attachment has served a successful turn.

**Gate:** restart, idle sleep and ordinary heartbeat retain both IDs. Temporary
failures create zero replacements; intentional resets still create a new session.
This correction can be developed using the existing resume contract, but integrated
acceptance must use the new Runtime candidate.

### P4. Native names and instruction delivery

- [x] Define bounded product labels and add Runtime create/resume transport with
      nonfatal, correlated thread/name/set replies. Naming never creates a thread.
- [x] Seed names for owned persistent conversations; preserve native user renames
      and avoid repeated name writes on ticks/resume.
- [x] Retain existing instruction delivery after schema inspection found no
      per-turn developerInstructions override. A separate change must establish
      precedence, clearing and refresh semantics; baseInstructions stay untouched.
- [x] If native per-turn semantics cannot preserve current precedence, retain the
      compatible turn path and document the limitation. Naming can ship separately.

### P5. Integrated acceptance and review

- [x] Build/package the exact Runtime candidate and consume it in isolated
      Platform/Bot profiles. Record source revision and artifact digest; stale
      vendored packages or node_modules do not count as integration evidence.
- [x] Complete scoped fixtures, type/build checks and isolated native model-turn
      tests. Capture thread IDs/counts only in private evidence; commit redactions.
- [x] Inspect installed ChatGPT during organic user activity read-only; do not
      manufacture acceptance chats in the user's real profile.
- [x] Obtain independent review and update governing specs, consumer guides and
      these phase statuses to match actual evidence. Publication stays separate.

## Files to Create/Modify

| Area | Existing entrypoints | Planned work |
| --- | --- | --- |
| Public/internal contract | src/core/types.ts; src/http/routes/sessions.ts | Optional fields, validation, capability/readback and lifecycle errors. |
| Codex protocol | src/backends/cli/providers/codex.ts | Ephemeral bootstrap verification, naming and separately verified instruction routing. |
| Lifecycle | src/backends/cli/pool/SessionRegistry.ts; WorkerPool.ts; sessionView.ts | Persistence, reload defaults, non-resumable expiry and truthful controls. |
| Wake/maintenance | src/core/runtime/ | Enforce the same rule outside HTTP entrypoints. |
| Consumer integration | Platform PLAN-132; Bot PLAN-013 | No provider-native protocol in either product. |

## Testing Strategy

- Runtime: extend Codex bootstrap/capability/protocol fixtures, SessionRegistry,
  WorkerPool, sessionView, session wake/MCP and HTTP tests around real lifecycle
  boundaries. Retain missing-provider-session regressions from #214.
- Platform: Catlas curation/title/advice and unsupported-runtime fixtures; retain
  Chat session lifecycle/rotation regressions from #398.
- Bot: startup, runtime exit, binder/life/queue fixtures and real vendored Runtime
  restart integration; assert exact identities and create/resume counts.
- Native: isolated home, one completed ephemeral job then listing/restart checks;
  a two-turn job; a persistent conversation resumed after host restart; failures
  and recognizable labels. Do not infer cross-OS success from Windows results.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Old Runtime ignores a new JSON field | Consumer checks support and admitted create readback before send. |
| Old CLI ignores ephemeral | Verify native bootstrap; fail without a durable retry. |
| Closed/failed means many different things | Probe saved identity; only explicit terminal evidence permits replacement. |
| MCP descriptors disappear on restart | Host supplies fresh descriptors; secrets remain memory-only. |
| Name/instruction responses consume a pending turn | Separate RPC correlation and inventory-first fixtures. |
| New required saved state breaks upgrade | Prefer optional defaults; otherwise require the full protected migration and minor boundary. |
| Image runner has a different output contract | Track separately; do not alter its persistence without artifact recovery acceptance. |

## Validation and delivery boundary

- `npm run build` passed. The initial focused Runtime pass covered 11 files /
  200 tests; the final changed HTTP/continuity suites passed 17 tests after review
  fixes and strengthened fixtures. These counts overlap; they are not additive.
- Platform server build and scoped UI-test bundle completed. Catlas/client
  fixtures passed 56 tests; Chat resume/rotation/client parsing passed 32 tests.
- Bot type checks passed. Initial focused core suites passed 62 tests; the final
  changed lifecycle/presentation/continuity, real-Runtime integration and docs
  boundary selection passed 37 tests. Counts overlap.
- Native Runtime acceptance completed four bounded Codex turns. Platform's
  actual client/Catlas over the exact candidate completed another four turns in
  three independent jobs, including two-turn feedback and one in-memory operation.
  Native listings, read-only SQLite and rollouts confirmed zero saved Catlas jobs.
  Persistent naming/resume retained one identity. See the research entry for
  exact artifact/source digests and the native-title assertion correction.
- Independent review is complete. Session-key policy conflicts, peer routing,
  late Bot probes and stream presentation exits have regression coverage.
- Real installed applications were inspected only during diagnosis. No packaged
  Desktop/Bot was installed or updated; macOS/Linux and native failure/cancel
  acceptance are not claimed. Failure/cancel behavior has scoped fixtures.

The original slice retained the instruction envelope; the native instruction
delivery follow-up below supersedes that choice after additional acceptance.
The separate image runner and old-history cleanup remain out of scope.
No version bump or publication is part of this implementation; the owner separately
authorized commit, PR and squash auto-merge through `cnr`.
Before shipping, commit/merge Runtime and refresh the consumers' exact source and
artifact pins through their normal release procedures. Bot's tracked vendor pin
remains unchanged; local integration used `--no-save --package-lock=false` and
verified all 1,513 candidate package files. No mandatory data migration is needed.

## Progress Log

### Native instruction delivery follow-up (2026-11-11)

Installed Desktop/Bot feedback showed that naming alone left instruction
envelopes in native first-message previews. The adapter now admits a scoped
developer item through `thread/inject_items` before each instructed turn, with
an explicit clear boundary after clearing or cold resume. Matching ACK, rejection
and timeout share the worker's bounded protocol admission. Model/effort and
native base instructions are unchanged. No persisted-data schema changes.

Windows Codex 0.167.0 acceptance used disposable profiles: two ephemeral turns
obeyed different developer instructions on the same ID with zero SQLite threads;
a persistent turn followed by a fresh-process resume obeyed updated instructions
on the same ID, with exactly one saved thread and a clean first user message and
title. A third cold-resume turn with cleared instructions returned the requested
ordinary arithmetic answer instead of an earlier marker. Five model turns
completed. Temporary login copies were deleted in
`finally` and absence checked. Real user history was untouched. This is headless
adapter/native acceptance, not an installed app update or macOS/Linux result.

The native probe also established that ephemeral `thread/resume` fails without
a rollout, and an accepted `collaborationMode.settings.developer_instructions`
did not affect the model's response in this CLI. Neither path is used by the fix.
The 227 focused Codex, worker, hosted ACP and Muse protocol tests passed,
including real child acknowledgement, rejection and ten-second no-ACK timeout.
Another 13 HTTP persistence/unavailable-session tests and Runtime typecheck
passed. Independent read-only review closed all findings before delivery.

### Archived resume follow-up (2026-11-11)

Installed Windows Desktop 0.15.0 reported Codex JSON-RPC -32600 `session <id>
is archived`, which the missing-rollout matcher did not classify. The adapter
now recognizes that exact archived message only on its matching thread/resume
bootstrap response. It preserves the archive choice and emits the existing
provider_session_unavailable signal, allowing the owning product's bounded
handoff instead of retrying the old ID. No public shape, data format, version
or release pin changed.

Reconstructed error fixtures (not claimed as raw native captures) and real-worker
HTTP regressions passed 18 tests: archived/start/fork/unrelated/auth-looking
classification, terminal marking, send/resume 410 and no stale-ID respawn.
Another 78 existing Codex protocol/persistence and worker-pool tests passed,
as did Runtime typecheck. The existing Platform rotation consumer suite passed
18 tests. Its local checkout lacked the UI contracts install, so its bundle
used the identical pinned public contracts artifact from the clean Bot install;
isolated workspace tests required execution outside the Windows sandbox.
Independent review found no remaining issues. Installed profiles were not modified.

| Date | Update |
| --- | --- |
| 2026-11-11 | Fresh worktrees, source tracing and zero-turn native probe completed. P1-P5 remain pending; no product source changed. |
| 2026-11-11 | Implemented Runtime, Platform and Bot slices; scoped/integration/native acceptance passed and independent review closed. Instruction transport deliberately retained. Release pin refresh and publication remain separate. |
