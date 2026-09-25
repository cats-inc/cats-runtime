# PLAN-041: Preview Skill Content Policy

Status: in progress, 2026-09-25. Runtime owns managed skill discovery, delivery and
retained-context admission. Platform owns Desktop staging and knowledge practice.
The cross-repository contract is
[PLAN-109](../../../cats-platform/docs/plans/PLAN-109-cats-self-development-and-catlas-practice.md),
[SPEC-117](../../../cats-platform/docs/specs/SPEC-117-cats-self-development-and-catlas-practice.md)
and [ADR-118](../../../cats-platform/docs/decisions/118-use-isolated-development-and-verified-practice-for-cats-improvement.md).

## Resume checkpoint

- Runtime worktree: `cats-runtime-preview-skills`, branch
  `feat/preview-content-policy`, base `a694104`.
- Platform worktree: `cats-platform-preview-skills`, branch
  `feat/preview-development-skills`, P0 contract commit `ef97dba8`.
- The owner authorized branch commits only. No main push/merge, version bump,
  publication or installed Desktop changes. Prior native-model approvals were
  consumed by the completed PLAN-110 runs; do not reuse them.
- P1 implements the policy below. Targeted validation and independent re-review
  passed. No preview supplement is shipped by P1 alone.
- Next P2 adds the three complete Runtime product skills, Desktop staging and
  actual preview/release/npm inventory and delivery checks. P3/P4 implement
  bounded practice and reviewed knowledge export in Platform.

## P1 behavior

The executing Runtime package owns `runtime-skills/content-profile.json`.
Schema 1 selects `release` or `preview`; missing means release and malformed
means an explicit error. Resolution stops at the executing package boundary.
Environment overrides or selected catalog roots cannot elevate that artifact.
Source carries preview eligibility; normal npm files omit that manifest and the
reserved `runtime-skills/preview/` subtree. Desktop staging must write its own
profile. Signing and update identity remain separate from content eligibility.

The ordinary library remains available in both profiles. Preview exclusion
covers discovery, explicit resolution, materialization and instruction rebuild,
including already populated caches and catalog roots rerooted through aliases.
Preview package identity covers its closed, bounded resource tree; links and
special files are rejected. Delivery verifies the selected identity after copy.

Before preview delivery, Runtime writes durable exposure intent under its
session base and a marker before materializing files into a workspace. Cleanup
cannot erase that intent. Workspace checks inspect lexical and physical
ancestors, including junctions and missing descendants. These markers describe
Runtime-delivered content; this policy is not a sandbox against arbitrary user
instructions or a user who edits the executing artifact and Runtime state.

Host-owned hydration provenance binds the Runtime session ID, content profile,
policy fingerprint and release compatibility. Caller hydration metadata cannot
override it. Clearing skills, failed delivery, reset, discovery by cwd and
duplicate native aliases cannot manufacture clean provenance. Fork copies
parent exposure intent before delivery, then binds its own native init ID;
the parent's native thread ID is only a fork input.

Release guards messages, resume/fork, spawn and run admission before provider
work. Unknown or preview-exposed retained contexts return HTTP 409 with code
`skill_content_profile_conflict` and a fresh-context recovery instruction.
Fresh release sessions can create, resume and fork normally. Peer content
profiles are not negotiated: both sender and receiver require clean context,
including the recipient workspace. Rejection occurs before busy/run state;
fresh receiver hydration, cancellation and spawn failure clean up owned state.

## Compatibility and recovery

The inspected Runtime base is 0.2.x. Rejecting previously resumable but
unverified contexts changes execution compatibility and requires the **next
Runtime minor (0.3.x)** before shipping. Record the boundary now; apply version
changes only within the owner's separate release authorization.

Provenance and exposure records are additive. There is no destructive migration
or required new field on old session files. Old/discovered/reset state remains
available for inspection, but a release execution requires a new context with
host-established provenance. Clearing hydration during a reset discards proof;
start a new session rather than transplanting its prior native history. No
automatic content scrubbing or skill clearing is offered as proof of recovery.
Rolling back to an older binary preserves files but does not enforce this policy.

## Validation ledger

- P0: independent contract review, documentation diff and 60 local links passed.
- P1 review found and fixed native create hydration omissions, peer admission
  ordering/cleanup, artifact authority, resource preflight, native alias/fork
  identity and physical workspace marker ancestry. Final independent read-only
  re-review passed with no remaining blocker; its whitespace check also passed.
- Runtime TypeScript build passed. 137 distinct tests across nine targeted files
  passed (124 reused passing results plus the final 13-case ACP rerun); three
  native-provider creation fixture tests also passed. Checks use temporary or
  in-memory state. The ACP rerun corrected a test stub missing the caller run ID;
  the final assertion verifies a real admitted run ID replaces the placeholder.
  Earlier failed fixture runs remain diagnosis, not passing evidence.
- No paid model, installed Desktop, other-OS or full CI acceptance is claimed.
  Normal PR/CI gates still apply before integration.
