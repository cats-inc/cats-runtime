# PLAN-037: Provider Model Catalog Maintenance Skill

> Stand up the `developer-skills/` root from ADR-036, make the sync helpers
> actually work, and author `maintain-provider-model-catalogs` from SPEC-028.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | user |
| **Assigned To** | Unassigned |
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

## Implementation Phases

### Phase 0: Settle the substrate question

- [ ] Decide among the three options above; record the outcome in ADR-036 as an
      amendment, since decision point 4 is currently silent on the generator.
- [ ] If option 1 or 2: add a test that fails when the repo helper and the
      generated helper drift for reasons other than the intended difference.
- [ ] If option 3: remove the generator's skill-sync emission, its prose at
      :376-377, and the `tests/workspace-substrate.test.ts` assertions that pin
      them, and note the removal in the substrate documentation.

**Deliverable**: an ADR-036 amendment and, if applicable, the generator change.

### Phase 1: Make the sync helpers work

Nothing here depends on the skill's content, and the reconciliation semantics
are the part most likely to destroy a maintainer's local state, so it lands
first and alone.

- [ ] Repoint `scripts/windows/Sync-AgentSkills.ps1`,
      `scripts/linux/sync-agent-skills.sh`, and
      `scripts/macos/sync-agent-skills.sh` at `developer-skills/`.
- [ ] Keep discovery at direct children — `developer-skills/<name>/SKILL.md` —
      which now matches the layout, unlike `skills/`.
- [ ] Implement reconciliation per SPEC-028 requirement 2: a renamed or deleted
      canonical skill must not leave an obsolete generated mirror, and a skill
      the maintainer installed locally into `.claude/skills/` or
      `.agents/skills/` must survive. Track repository-managed entries
      explicitly rather than clearing the target directory.
- [ ] Audit the existing `-Clean` / `--clean` path, which currently does
      `Remove-Item -Recurse -Force` on the whole target directory. Under the new
      contract that deletes unrelated local skills.
- [ ] Make a second run with no canonical changes produce no content changes.
- [ ] Tests, per SPEC-028 requirement 2 and acceptance scenario 10, running
      against an isolated target directory and never the developer's real
      `.claude/skills/` or `.agents/skills/`.

**Deliverable**: three helpers that copy files, reconcile deletions, preserve
foreign entries, and are safe to re-run.

### Phase 2: Author the skill

- [ ] `developer-skills/maintain-provider-model-catalogs/SKILL.md` — mode
      selection (refresh / review / audit), provider inventory derived from
      `KNOWN_PROVIDERS` and the provider catalog, routing into references, and
      the confirmation gate that blocks any edit made from pasted evidence.
- [ ] `references/paste-intake.md` — the operator-paste protocol (requirements
      31-36): tolerant parsing of raw terminal output, the confirmation table
      that must be echoed and answered before any edit, the multi-round gap
      calculation for per-model option axes, partial-evidence-never-deletes,
      and the three readings that must be asked rather than inferred.
- [ ] `scripts/normalize-picker-paste.*` — the deterministic half of
      requirement 32: strip terminal control sequences and picker chrome,
      render the confirmation table, and report which model and option readings
      are still missing. PowerShell and POSIX, per the portability requirement.
- [ ] `references/evidence-and-scope.md` — the evidence-priority ladder
      (requirement 12), the `last_updated` rule (15), scope preservation
      (7, 22, 23), and the three-way-disagreement rule (21).
- [ ] `references/catalog-surfaces.md` — how to locate each authoritative code
      path (requirement 9) without copying current values into the skill.
- [ ] `references/providers/*.md` — only where a provider's extraction
      procedure is non-obvious. On current evidence that means Claude (no
      `models` subcommand; static binary extraction yields a superset), Copilot
      and Kiro (account-gated), and Kilo (`kilo models` returns the gateway
      catalog, not the picker).
- [ ] Run the sync and confirm the skill appears in `.claude/skills/` and
      `.agents/skills/` — the latter serving Codex and Antigravity both.
- [ ] Confirm `npm run verify:skills` ignores `developer-skills/`, the runtime
      skill catalog does not list it, and `npm pack --dry-run` excludes it
      (acceptance scenario 9).

**Deliverable**: the skill, discoverable by three agents from one source.

### Phase 3: Documentation migration

Per SPEC-028 requirement 4. Agent-owned files go to their owners.

- [ ] `AGENTS.md:280,294` — shared; still says skills live in `skills/` and are
      synced to each agent's discovery path.
- [ ] `scripts/README.md:36-38` — shared; still describes all three helpers as
      syncing `skills/`.
- [ ] `CODEX.md:101,105` — **Codex owns this file.**
- [ ] `CLAUDE.md` — **Claude owns this file.** It currently carries only an
      interim note that the helpers copy nothing; that note is replaced once
      Phase 1 makes them work.
- [ ] `GEMINI.md` needs no change: it was corrected in `cbe1984` and `193a37b`
      and already describes `.agents/skills/` accurately.

**Deliverable**: no document describes a sync contract that does not exist.

## Files to Create/Modify

**Create**
- `developer-skills/maintain-provider-model-catalogs/SKILL.md`
- `developer-skills/maintain-provider-model-catalogs/references/evidence-and-scope.md`
- `developer-skills/maintain-provider-model-catalogs/references/catalog-surfaces.md`
- `developer-skills/maintain-provider-model-catalogs/references/paste-intake.md`
- `developer-skills/maintain-provider-model-catalogs/references/providers/*.md`
- `developer-skills/maintain-provider-model-catalogs/scripts/normalize-picker-paste.*`
- a reconciliation test for the sync helpers
- parser fixtures and tests for `normalize-picker-paste.*`

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
- **`.agents/skills/` is shared, not Codex-private.** Probed 2026-08-28: agy
  reads `<workspace>/.agents/skills/`. One sync to that directory serves Codex
  and Antigravity. No `--agent antigravity` value is needed; an alias for the
  same destination would be cosmetic.
- **The skill stores procedure, not values.** Per SPEC-028's maintainability
  requirement, current model lists live in runtime code and catalogs. A
  reference that names a model id will be wrong within weeks.
- **One skill, not one per provider.** Settled in SPEC-028 and unchanged by the
  paste-intake amendment. What varies per provider is the extraction recipe,
  and a conditionally loaded reference carries that at the same context cost as
  a separate skill would. Audit mode has no per-provider form — it reconciles
  the whole registered set — and a family of near-identical skill descriptions
  would make skill selection unreliable.
- **Deterministic parse, judged confirmation.** The script owns what must come
  out identical every time; the agent's judgment is spent only on the readings
  the script flags as ambiguous. A confirmation gate that depends on the model
  remembering to ask is not a gate, which is why requirement 33 makes the
  recorded exchange part of the report and reviewable.

## Testing Strategy

- Reconciliation and idempotence tests for the helpers, against a temp target.
  These must never touch the developer's real discovery directories.
- Parser tests for `normalize-picker-paste.*` over captured raw pastes: ANSI
  sequences, box drawing, a wrapped line, a single-line confirmation message,
  and a deliberately truncated list. Fixtures only — no live probes, no
  credentials.
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
- **The generated substrate helper and the repo helper silently diverge.** This
  is the Phase 0 decision; option 3 removes the risk, options 1 and 2 manage it.
- **The skill accumulates catalog values and rots.** Reviewed against the
  maintainability requirement when the references are written; provider
  references document procedure and limitation, never current model lists.
- **Nothing forces the docs in Phase 3 to stay true.** They drifted for months
  precisely because no test covers prose. Out of scope here, but worth noting
  that the only durable fix is making the helper's real behavior discoverable.

## Progress Log

| Date | Update |
|------|--------|
| 2026-08-28 | Plan created from ADR-036 (Accepted) and SPEC-028 (both open questions answered) |
| 2026-08-28 | Phase 0 added after review found `WorkspaceSubstrateService` generates all three sync helpers into user workspaces, a surface neither ADR-036 nor SPEC-028 accounts for |
| 2026-09-01 | SPEC-028 amended with operator-pasted evidence intake and the confirmation gate (requirements 31-36, scenarios 11-13) after the owner observed that nothing in the spec said how a maintainer hands over picker output, and that option axes are per-model. Phase 2 gains `paste-intake.md` and `normalize-picker-paste.*`; the approved one-skill scope is unchanged. Two questions left open in SPEC-028 for the owner: whether raw pastes become tracked fixtures, and whether a model-list-only paste advances `last_updated` |
