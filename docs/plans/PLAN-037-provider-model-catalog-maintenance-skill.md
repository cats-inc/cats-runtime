# PLAN-037: Provider Model Catalog Maintenance Skill

> Stand up the `developer-skills/` root from ADR-036, make the sync helpers
> actually work, and author `maintain-provider-model-catalogs` from SPEC-028.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Skill and Sync Implemented; Claude-Owned Doc Remains) |
| **Owner** | user |
| **Assigned To** | Codex |
| **Reviewer** | Codex |

## Related Spec

[SPEC-028: Provider Model Catalog Maintenance Skill](../specs/SPEC-028-provider-model-catalog-maintenance-skill.md),
anchored on [ADR-036](../decisions/036-separate-repository-maintenance-skills-from-runtime-delivered-skills.md).
Both were approved on 2026-08-28: ADR-036 is Accepted, and SPEC-028's two open
questions are answered (the `developer-skills/` boundary, and one skill carrying
refresh / review / audit modes).

## Overview

Three slices plus a decision that has to come first.

The skill itself is the easy part. The work that carries risk is underneath it:
this repository has documented a skill-sync contract for months that **has never
executed**. All three helpers iterate only the direct children of `skills/` and
require a `SKILL.md` there, while the runtime library is family-organized one
level deeper, so every run prints `No skills found` and returns. Neither
`.claude/skills/` nor `.agents/skills/` has ever been populated by them.

That makes Phase 1 the first time these scripts do anything, which is a behavior
change, not a refactor — and it is why the substrate question below must be
settled before any helper is edited.

## Blocking Decision: the helpers are also product templates

`src/core/runtime/WorkspaceSubstrateService.ts` **generates all three sync
helpers line by line** into user workspaces (`buildWindowsSyncAgentSkillsScript`
at :382, the POSIX builder from :455, the emission entries at :718 and :722),
along with prose at :376-377 describing the `skills/` sync contract. The service
is exposed as product surface through `/workspace/substrate/profiles` and
`/workspace/substrate/audit`, and `tests/workspace-substrate.test.ts:431` pins
generated content.

Neither ADR-036 nor SPEC-028 mentions this. ADR-036 decision point 4 says the
helpers "will sync only repository-maintenance skills from `developer-skills/`",
but the same helpers are templates written into arbitrary repositories where
`developer-skills/` is a cats-runtime-internal concept.

Options, to be decided before Phase 1 starts:

1. **Split the two.** The repo's own helpers move to `developer-skills/`; the
   substrate generator keeps emitting a generic `skills/`-based helper for
   generated workspaces. Same filenames, different contents — the divergence
   must be deliberate and commented at the generator, or the next reader will
   "fix" one to match the other.
2. **Parameterize the generator.** It emits a helper whose source root is a
   template variable, so cats-runtime generates its own with
   `developer-skills/` and other workspaces get `skills/`. More code, one
   contract.
3. **Stop generating skill-sync helpers into workspaces at all.** They have
   never worked, so nothing regresses. Smallest surface, but it removes a
   documented substrate feature and needs its own justification.

Recommendation: **option 3, falling back to option 1.** A generated helper that
has never copied a file is not a capability worth carrying into other people's
repositories, and removing it deletes the divergence risk rather than managing
it. If the substrate feature is wanted, option 1 is honest as long as the
generator carries a comment saying why the two differ.

**Outcome (2026-09-01): option 1.** The repository owner requested implementation
of the skill and its Claude mirror. The implementation keeps that work scoped:
cats-runtime's tracked helpers now reconcile `developer-skills/`, while the
generic substrate feature remains available to other workspaces. ADR-036 records
the split, a source comment makes it deliberate, and tests pin both sides.

## Implementation Phases

### Phase 0: Settle the substrate question

- [x] Decide among the three options above; record the outcome in ADR-036 as an
      amendment, since decision point 4 is currently silent on the generator.
- [x] If option 1 or 2: add a test that fails when the repo helper and the
      generated helper drift for reasons other than the intended difference.
- [x] Record option 3 as not selected; retain the generator's generic
      `skills/` emission and pin that root in `tests/workspace-substrate.test.ts`.

**Deliverable**: an ADR-036 amendment and, if applicable, the generator change.

### Phase 1: Make the sync helpers work

Nothing here depends on the skill's content, and the reconciliation semantics
are the part most likely to destroy a maintainer's local state, so it lands
first and alone.

- [x] Repoint `scripts/windows/Sync-AgentSkills.ps1`,
      `scripts/linux/sync-agent-skills.sh`, and
      `scripts/macos/sync-agent-skills.sh` at `developer-skills/`.
- [x] Keep discovery at direct children — `developer-skills/<name>/SKILL.md` —
      which now matches the layout, unlike `skills/`.
- [x] Implement reconciliation per SPEC-028 requirement 2: a renamed or deleted
      canonical skill must not leave an obsolete generated mirror, and a skill
      the maintainer installed locally into `.claude/skills/` or
      `.agents/skills/` must survive. Track repository-managed entries
      explicitly rather than clearing the target directory.
- [x] Audit the existing `-Clean` / `--clean` path, which currently does
      `Remove-Item -Recurse -Force` on the whole target directory. Under the new
      contract that deletes unrelated local skills.
- [x] Make a second run with no canonical changes produce no content changes.
- [x] Tests, per SPEC-028 requirement 2 and acceptance scenario 10, running
      against an isolated target directory and never the developer's real
      `.claude/skills/` or `.agents/skills/`.

**Deliverable**: three helpers that copy files, reconcile deletions, preserve
foreign entries, and are safe to re-run.

### Phase 2: Author the skill

- [x] `developer-skills/maintain-provider-model-catalogs/SKILL.md` — mode
      selection (refresh / review / audit), provider inventory derived from
      `KNOWN_PROVIDERS` and the provider catalog, routing into references, the
      capture-only default for a bare paste, selectable interaction behavior,
      and the non-bypassable ambiguity/schema-loss gates.
- [x] `references/paste-intake.md` — the operator-paste protocol (requirements
      31-38): tolerant intake of raw terminal output, the ordered observation
      tree, natural-language interaction policies, multi-round gap calculation
      for per-model and dependent option axes, partial-evidence-never-deletes,
      hard confirmation gates, schema-loss reporting, and where redacted
      evidence is filed so a `notes` entry can cite it.
- [x] `scripts/normalize-picker-paste.mjs` — the deterministic mechanical half
      of requirement 32, implemented once for the repository's Node.js runtime:
      strip terminal control sequences without destroying visible hierarchy,
      retain unparsed lines, render an observation summary, and compute gaps
      from the agent-created observation document. It also assesses an
      agent-created edit decision so selectable interaction policies and hard
      gates produce testable artifacts without asking the operator for structured
      input. Provider semantics remain in fixture-backed extractors or explicit
      agent judgment; the script must not guess or flatten them.
- [x] `references/evidence-and-scope.md` — the evidence-priority ladder
      (requirement 12), the `last_updated` rule (15), scope preservation
      (7, 22, 23), and the three-way-disagreement rule (21).
- [x] `references/catalog-surfaces.md` — how to locate each authoritative code
      path (requirement 9) without copying current values into the skill.
- [x] `references/providers/*.md` — only where a provider's extraction
      procedure is non-obvious. On current evidence that means Claude (no
      `models` subcommand; static binary extraction yields a superset), Copilot
      and Kiro (account-gated), and Kilo (`kilo models` returns the gateway
      catalog, not the picker).
- [x] Run the sync and confirm the skill appears in `.claude/skills/` and
      `.agents/skills/` — the latter serving Codex, Antigravity, and Grok. The
      explicit Antigravity/Grok agent names alias that same target.
- [x] Confirm `npm run verify:skills` ignores `developer-skills/`, the runtime
      skill catalog does not list it, and `npm pack --dry-run` excludes it
      (acceptance scenario 9).

**Deliverable**: the skill, discoverable by four agents from one source.

### Phase 3: Documentation migration

Per SPEC-028 requirement 4. Agent-owned files go to their owners.

- [x] `AGENTS.md:280,294` — shared; update the canonical/mirror contract and
      synced discovery paths.
- [x] `scripts/README.md:36-38` — shared; document the common reconciler and
      intentional substrate-template split.
- [x] `CODEX.md:101,105` — **Codex owns this file.**
- [ ] `CLAUDE.md` — **Claude owns this file.** It currently carries only an
      interim note that the helpers copy nothing; that note is replaced once
      Phase 1 makes them work.
- [x] `GEMINI.md` — **Antigravity owns this file.** Commit `193a37b` corrected the
      over-generalized first probe and now identifies `.agents/skills/` as the
      project discovery path. Codex did not edit this file.

**Deliverable**: no document describes a sync contract that does not exist.

## Files to Create/Modify

**Create**
- `developer-skills/maintain-provider-model-catalogs/SKILL.md`
- `developer-skills/maintain-provider-model-catalogs/references/evidence-and-scope.md`
- `developer-skills/maintain-provider-model-catalogs/references/catalog-surfaces.md`
- `developer-skills/maintain-provider-model-catalogs/references/paste-intake.md`
- `developer-skills/maintain-provider-model-catalogs/references/providers/*.md`
- `developer-skills/maintain-provider-model-catalogs/scripts/normalize-picker-paste.mjs`
- `developer-skills/maintain-provider-model-catalogs/tests/**`
- `scripts/sync-agent-skills.mjs`
- a reconciliation test for the sync helpers
- normalization fixtures and tests for `normalize-picker-paste.mjs`

**Modify**
- `scripts/windows/Sync-AgentSkills.ps1`
- `scripts/linux/sync-agent-skills.sh`
- `scripts/macos/sync-agent-skills.sh`
- `src/core/runtime/WorkspaceSubstrateService.ts` (Phase 0 outcome dependent)
- `tests/workspace-substrate.test.ts` (same)
- `AGENTS.md`, `scripts/README.md`, `CODEX.md`, `CLAUDE.md`
- `docs/decisions/036-...md` (Phase 0 amendment)

## Technical Decisions

- **`developer-skills/` is flat.** Discovery is direct children, matching what
  the helpers already implement. The family nesting under `skills/` is what made
  them inert; do not reproduce it.
- **Reconciliation, not regeneration-by-deletion.** ADR-036 records that CI
  cannot detect mirror drift, because `.agents/` and `.claude/` are ignored
  (`.gitignore:2,6`). The mitigation is a cheap idempotent sync — which only
  works if the sync is also non-destructive toward entries it does not own.
- **`.agents/skills/` is shared, not Codex-private.** Probed for Antigravity on
  2026-08-28; the owner-provided working `quant-x` reference records Grok's
  equivalent accepted probe in commit `c4e523a`. One sync serves Codex,
  Antigravity, and Grok. The explicit Antigravity/Grok names are aliases for the
  same destination, not additional mirrors.
- **The skill stores procedure, not values.** Per SPEC-028's maintainability
  requirement, current model lists live in runtime code and catalogs. A
  reference that names a model id will be wrong within weeks.
- **One skill, not one per provider.** Settled in SPEC-028 and unchanged by the
  paste-intake amendment. What varies per provider is the extraction recipe,
  and a conditionally loaded reference carries that at the same context cost as
  a separate skill would. Audit mode has no per-provider form — it reconciles
  the whole registered set — and a family of near-identical skill descriptions
  would make skill selection unreliable.
- **Deterministic mechanics, lossless judged semantics.** One portable Node.js
  script owns ANSI/control-sequence removal, preservation of visible ordering,
  summary rendering, and gap calculation. It does not pretend that sixteen
  evolving picker formats share one stable semantic grammar. Provider-specific
  extractors require fixtures; otherwise the agent builds a lossless observation
  tree and leaves ambiguity explicit.
- **Selectable interaction, mandatory hard gates.** A bare paste is capture-only.
  An explicit update defaults to summarizing and confirming material
  uncertainty, while plain-language requests may choose **confirm all** or
  **apply authorized** behavior. **Apply authorized** omits and reports non-hard
  low-confidence readings instead of guessing them. No policy may bypass a
  material hard gate for ambiguity, conflicting evidence, deletion, scope
  expansion, or a lossy projection; capture-only may defer the question until
  an edit needs the answer. The report records the chosen behavior and any
  exchange so review can verify it.

## Testing Strategy

- Reconciliation and idempotence tests for the helpers, against a temp target.
  These must never touch the developer's real discovery directories.
- Normalization tests for `normalize-picker-paste.mjs` over captured raw pastes:
  ANSI sequences, box drawing, wrapped lines, nested indentation, unparsed
  lines, a single-line confirmation message, and a deliberately truncated list.
  Fixtures only — no live probes and no credentials.
- Behavioral forward-tests for the skill cover capture-only bare pastes,
  **confirm all**, **confirm uncertainty**, **apply authorized**, a hard-gated
  ambiguous raw option token, a nested branch the YAML schema cannot represent,
  and complete versus truncated freshness. These tests inspect decisions and
  resulting artifacts rather than matching exact prose.
- `npm run verify:skills` continues to validate only `skills/`.
- `npm pack --dry-run` excludes `developer-skills/`.
- Existing `tests/workspace-substrate.test.ts` updated per the Phase 0 outcome.
- No new runtime behavior is introduced, so the wider suite is a regression
  check only.

## Risks & Mitigations

- **A working sync deletes a maintainer's local skills.** The helpers have never
  run, so nobody has seen their destructive `-Clean` path in practice. Phase 1
  addresses reconciliation before the skill exists to sync, and the tests use an
  isolated target.
- **The generated substrate helper and the repo helper silently diverge.** Option
  1 was selected. A source comment identifies the generic-versus-repository
  split, and tests pin `skills/` in generated helpers plus the shared reconciler
  used by all three repository entrypoints.
- **The skill accumulates catalog values and rots.** Reviewed against the
  maintainability requirement when the references are written; provider
  references document procedure and limitation, never current model lists.
- **The intake flattens a provider's nested picker into the current YAML shape.**
  The observation tree is lossless and precedes projection. Requirement 38 makes
  any discarded, merged, detached, or guessed branch a hard gate rather than a
  silent edit.
- **Routine confirmations make raw paste intake more work than manual editing.**
  Requirement 33 defaults an explicit update to confirming only uncertainty and
  allows the operator to choose **confirm all** or **apply authorized** in
  ordinary language, while requirement 36 preserves the small set of
  non-bypassable questions.
- **Nothing forces the docs in Phase 3 to stay true.** They drifted for months
  precisely because no test covers prose. Out of scope here, but worth noting
  that the only durable fix is making the helper's real behavior discoverable.

## Progress Log

| Date | Update |
|------|--------|
| 2026-08-28 | Plan created from ADR-036 (Accepted) and SPEC-028 (both open questions answered) |
| 2026-08-28 | Phase 0 added after review found `WorkspaceSubstrateService` generates all three sync helpers into user workspaces, a surface neither ADR-036 nor SPEC-028 accounts for |
| 2026-09-01 | SPEC-028 amended with operator-pasted evidence intake and an initial confirmation gate (requirements 31-36, scenarios 11-13) after the owner observed that nothing in the spec said how a maintainer hands over picker output, and that option axes are per-model. Phase 2 gains `paste-intake.md` and a normalization helper; the approved one-skill scope is unchanged. Two questions were left for the owner: whether raw pastes become tracked fixtures, and whether a complete model-list-only paste advances `last_updated` |
| 2026-09-01 | Owner answered both the same day. Supporting pastes are filed as redacted artifacts under `docs/research/fixtures/<cli>-<version>/` and cited from `notes` (new requirement 37); a complete scope-confirmed pasted model list advances `last_updated`, and that rule stays inside requirement 15 rather than becoming a requirement of its own, so the field keeps one definition. A per-option freshness field is rejected as the schema change requirement 17 forbids improvising |
| 2026-09-01 | Owner-directed review refined the intake design: a bare paste is capture-only; explicit updates default to confirming uncertainty and may opt into confirm-all or apply-authorized behavior; hard ambiguity, deletion, scope, conflict, and schema-loss gates remain mandatory. Evidence first becomes a lossless hierarchical observation tree, only complete scope-confirmed lists advance `last_updated`, and the mechanical helper is one cross-platform `normalize-picker-paste.mjs` rather than parallel PowerShell/POSIX parsers. SPEC-028 scenarios 14-17 and Phase 2 forward-tests cover these decisions |
| 2026-09-01 | Implementation completed in the feature-branch working tree: Phase 0 selected the split option and amended ADR-036; one Node reconciler now backs all three platform entrypoints, tracks managed mirrors, preserves local skills, handles rename/delete, rejects linked source/target escapes before writing, and is idempotent. The canonical skill, paste normalizer, ordered-tree/gap fixtures, interaction-policy decision artifacts, and Claude plus shared Codex/Antigravity/Grok mirrors were created. Focused tests (17), direct normalizer/decision tests (6), typecheck, runtime-skill verification (33 runtime packages), runtime catalog exclusion, and npm pack exclusion passed. The full `npm test` regression run reached three unrelated `tests/runtime-peer-routing.test.ts` cleanup timeouts while repeatedly discovering 36 local Antigravity sessions, then stopped producing output; the runner was interrupted, and an isolated single-thread rerun reproduced the same three 60-second timeouts after all tested HTTP exchanges completed. Shared docs and CODEX.md were updated; GEMINI.md was already corrected by its owner in `193a37b`, while CLAUDE.md remains assigned to Claude. |
