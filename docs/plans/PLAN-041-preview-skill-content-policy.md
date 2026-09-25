# PLAN-041: Preview Skill Content Policy

Status: in progress, 2026-09-26. Runtime owns managed skill discovery, delivery and
retained-context admission. Platform owns Desktop staging and knowledge practice.
The cross-repository contract is
[PLAN-109](../../../cats-platform/docs/plans/PLAN-109-cats-self-development-and-catlas-practice.md),
[SPEC-117](../../../cats-platform/docs/specs/SPEC-117-cats-self-development-and-catlas-practice.md)
and [ADR-118](../../../cats-platform/docs/decisions/118-use-isolated-development-and-verified-practice-for-cats-improvement.md).

## Resume checkpoint — read-only sandbox delivery (2026-09-26)

- Current checkout: `cats-runtime`, branch `fix/readonly-sandbox-skill-delivery`,
  base `e464619` (0.3.0). The earlier preview-content branches are merged;
  the prior worktree checkpoint below is historical.
- Platform PLAN-109's authorized native authoring attempt stopped before provider
  dispatch: a read-only sandbox projects legacy `workspaceMode: read_only`, but
  Codex skill delivery mistook that access policy for shared-workspace ownership.
  No model request was spent; preserve the failed private attempt.
- Internal skill resolution now receives canonical workspace kind separately.
  Runtime may prepare skill files in its owned sandbox, while provider execution
  retains read-only access and the default permission gate. Canonical source and
  worktree kinds override stale isolated hints and never receive managed copies.
  Message rehydration preserves canonical workspace and isolation metadata.
- Fingerprint/conflict checks and preview exposure/provenance stay in force.
  This corrects internal propagation; no public field, persisted-format migration,
  version bump, publication or installed-profile change is needed or authorized.
- Validation passed: 113 distinct cases across hydration ownership, real HTTP strict create and
  message rehydration, unchanged provider permissions, source non-materialization,
  existing catalog/content-policy and Codex read-tool checks; Runtime TypeScript
  build passed. The first run exposed only a warning-substring regression;
  wording was corrected and all 23 catalog cases rerun successfully. Independent
  review found no blockers. Platform native acceptance is still pending.

## Previous checkpoint — preview-content integration

- Runtime worktree: `cats-runtime-preview-skills`, branch
  `feat/preview-content-policy`, base `a694104`.
- Platform worktree: `cats-platform-preview-skills`, branch
  `feat/preview-development-skills`, P0 contract commit `ef97dba8`.
- After branch-only delivery, the owner authorized pushing both branches,
  auto-merge PRs through full CI, and cleanup of verified merged branches/worktrees.
  No direct main push, version bump, publication or installed Desktop changes.
  Prior native-model approvals were consumed by PLAN-110; do not reuse them.
- P1 implements the policy below. Targeted validation and independent re-review
  passed. No preview supplement is shipped by P1 alone.
- P2 now adds the three complete Runtime product skills. Paired Desktop staging
  and real library/npm inventory checks passed on the Platform feature branch.
  Platform P3/P4 now implement bounded practice and independently reviewed
  knowledge export/revocation, including separate Catlas/Orchestrator fixture
  consumption. This remains local fixture evidence, not protected-holdout/model
  or installed Desktop acceptance; PLAN-109 records the precise scope.
- Both branches rebased without conflicts onto current main: Runtime `b712da2`
  and Platform `a267b6b0`. Rebased implementation heads are Runtime `758ee63` and
  Platform `1056c412`. GitHub PR checks/merge state are the authoritative delivery
  record. Preserve private validation evidence before removing worktrees.

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

- Integration PRs: [Runtime #85](https://github.com/cats-inc/cats-runtime/pull/85)
  and [Platform #139](https://github.com/cats-inc/cats-platform/pull/139). Platform
  passed full CI and merged as `b36571d2`. Runtime's first full preflight passed
  2,400 cases with five skipped, and exposed five stale fixture assertions across
  three files. The package contract now asserts actual packed preview exclusion;
  registry-built peer fixtures use real fresh hydration; the fork fixture checks
  that child native identity/capability appears only after a distinct child init.
  Production policy is unchanged. Independent review and 11 targeted cases passed
  (six branching, four peer routing, one package contract with its required build).
  The first peer rerun exposed an incorrect fixture setter name, corrected before
  the passing run. Full preflight must pass on the pushed correction before merge.
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

### P2 supplement/distribution checkpoint

- Three Runtime-owned packages plus optional references are complete under the
  reserved preview subtree. All 36 source packages pass the canonical Runtime
  metadata validator. The generic Codex frontmatter validator is not the schema
  authority for Runtime's additional library fields.
- Four real-library inventory/delivery cases and 23 catalog tests passed. Actual
  Claude inline, Pi instruction-file and Codex filesystem input were inspected
  without starting providers. The filesystem case compares reference bytes too.
  A Windows full-library case exceeded Vitest's 5-second default initially;
  its scoped 30-second timeout rerun passed, with no assertion change.
- `npm pack --dry-run --ignore-scripts --json` inspected 1,255 actual artifact
  paths: 33 ordinary skills, no preview subtree/resources or source manifest.
  npm 12 returns an object keyed by package name; the initial array-based
  inspection script was corrected before recording this result.
- Platform's `tools/check-skill-distribution.mjs --runtime-root <this checkout>`
  stages the real library and imports actual compiled Runtime policy/catalog
  modules in isolated package layouts: preview 36 skills/41 content files;
  release 33 skills/35 content files. The release artifact cannot elevate via
  a catalog override pointing at the source preview tree. No provider calls.
- Platform server/host builds and 28 staging tests passed, including both
  ordinary knowledge bundles and replacement of a stale preview stage.
- Independent code review and four text-only skill forward scenarios passed;
  follow-up clarified existing evidence versus new exercise admission and
  uncertain mutation replay. This is not native model or task acceptance.
