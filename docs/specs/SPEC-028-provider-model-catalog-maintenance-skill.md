# SPEC-028: Provider Model Catalog Maintenance Skill

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Skill and Sync Implemented; Claude-Owned Doc Remains) |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

Create one repository-maintenance Agent Skill,
`maintain-provider-model-catalogs`, that lets Codex, Claude Code, Antigravity,
and Grok refresh, audit, or independently review `cats-runtime` provider
model-catalog knowledge from observable evidence. The skill shall cover all
registered CLI provider families and all relevant catalog mechanisms rather than treating the eight
current sections in `curated-model-catalogs.yaml.example` as a closed provider
list. It shall preserve the distinction between curated input, static fallback,
dynamic discovery, normalization, deliberately empty catalogs, and
account-specific or BYO-model providers.

The skill is developer tooling governed by ADR-036. It is not a
runtime-delivered Cats skill and does not replace the provider drift watcher,
the catalog schema, or durable evidence and decision documents.

Model catalogs are not flat. A CLI's picker exposes a model list, and each model
may carry its own option axis — reasoning level, effort, or thinking depth —
whose available values differ from model to model. An option may itself reveal
another dependent choice. Machine-readable enumeration rarely reaches those
levels, so the maintainer's own terminal is a first-class evidence source rather
than a fallback. The skill shall accept pasted picker output in whatever shape
the terminal produced it, preserve the observed hierarchy before projecting it
onto the curated schema, and let the operator choose in plain language whether
to preview every reading, confirm only uncertainty, or apply unambiguous changes.
A paste by itself authorizes capture and preview, not a repository edit.

## Goals

- provide one repeatable workflow for provider catalog refresh, audit, and
  independent review
- inventory provider coverage from current code instead of hardcoding a count
  or assuming npm-installed CLIs do not need catalog maintenance
- preserve evidence provenance, visible model labels, catalog freshness, and
  account scope honestly
- prevent unsupported rows from being silently dropped by normalization
- preserve unrelated working-tree edits and user-requested provider scope
- make the same canonical workflow discoverable by Codex, Claude Code,
  Antigravity, Grok, and future repository-mapped Agent Skills consumers
- produce a clear report of observed facts, gaps, judgment calls, and validation
- accept operator-pasted CLI output without asking anyone to hand-write JSON or
  YAML
- provide selectable human-in-the-loop behavior while retaining mandatory
  confirmation for ambiguous, lossy, destructive, or scope-expanding readings
- preserve per-model and dependent option axes whose available values differ
  between models without silently flattening them

## Non-Goals

- automatically accept upstream observations or change parser behavior
- replace ADR-034 or PLAN-036 scheduled provider-drift automation
- make routine runtime catalog reads probe provider CLIs
- add every provider to `curated-model-catalogs.yaml.example`
- infer model ids, generations, defaults, options, or limits from model memory
- authenticate accounts, spend provider quota, or run paid live probes without
  explicit authorization
- implement adapter, normalizer, or catalog-service changes unless the user's
  requested scope explicitly includes them
- commit, push, open pull requests, release, or publish without a separate user
  request
- expose the maintenance skill through the runtime `/skills/catalog` API

## User Stories

- As a maintainer, I want to refresh one provider's catalog without touching
  other providers or losing another agent's uncommitted edits.
- As a reviewer, I want an agent to reacquire evidence independently and find
  unsupported claims or silent normalization loss in another agent's change.
- As a maintainer, I want a full audit to include npm-installed providers such
  as OpenCode, Auggie, Pi, and Cline even when they do not currently have a
  curated YAML section.
- As a future contributor, I want the workflow to discover newly registered
  providers and report missing catalog coverage without first updating a
  hardcoded list inside the skill.

## Requirements

### Functional Requirements

1. The canonical skill package shall live at
   `developer-skills/maintain-provider-model-catalogs/`.
2. The skill shall be synced to `.agents/skills/`, which Codex, Antigravity, and Grok
   discover, and `.claude/skills/` for Claude Code from the same canonical
   source. A future agent receives the same package by adding only its verified
   discovery path as another generated mirror; it does not gain a second
   canonical copy.
   The Windows, Linux, and macOS sync entrypoints shall be idempotent and cheap
   enough to re-run after any edit to the canonical source. Each sync shall
   reconcile repository-managed entries: a deleted or renamed canonical skill
   shall not leave an obsolete generated mirror, and unrelated locally installed
   skills shall not be deleted. The mirrors are ignored build output, so no
   committed copy exists for CI to diff; regeneration and isolated reconciliation
   tests, not committed mirrors, are the mitigation for staleness.
3. The canonical package shall contain one `SKILL.md` entrypoint and only the
   supporting references or scripts that materially improve this workflow.
4. The implementation shall update every document that describes the agent
   skill-discovery contract so that it matches observed behavior, and shall
   assign each agent-specific file to its owning agent: Codex owns `CODEX.md`,
   Claude owns `CLAUDE.md`, and Antigravity owns `GEMINI.md`. Shared files such
   as `AGENTS.md` and `scripts/README.md` may be updated by any agent with
   justification. Which files still need work, and which commits closed them,
   belongs in PLAN-037 rather than in this requirement — a requirement states an
   invariant, not a progress ledger.

   `GEMINI.md` shall identify `.agents/skills/` as Antigravity's project-level
   discovery path and shall not revive `.gemini/skills/` or
   `.antigravity/skills/`. Agent-owned completion and commits are tracked in
   PLAN-037 rather than in this requirement.
5. The skill description shall trigger for provider model-catalog refreshes,
   catalog audits, reviews of catalog changes, and raw CLI model-picker or
   option-picker output that appears to be supplied as catalog evidence. A paste
   with no explicit mutation request shall enter capture/preview behavior and
   shall not imply permission to edit. The description shall exclude generic
   provider adapter implementation, ordinary dependency updates, and requests
   that only select or troubleshoot the current session's model.
6. The skill shall support three modes:
   - **refresh**: collect evidence and edit the provider scope authorized by the
     user
   - **review**: independently collect or inspect evidence and report findings
     without editing unless asked to fix them
   - **audit**: reconcile all registered provider families across the catalog
     surfaces and report stale, missing, conflicting, or intentionally empty
     coverage
7. At the start of every mode, the skill shall inspect repository status and
   preserve unrelated tracked and untracked changes.
8. The skill shall derive its provider inventory from current repository
   sources, including `KNOWN_PROVIDERS` and the provider catalog, rather than
   carrying a fixed eight-provider or sixteen-provider list as authoritative.
9. The skill shall reconcile, as applicable:
   - provider registration and install knowledge
   - `config/curated-model-catalogs.yaml.example`
   - `STATIC_PROVIDER_MODELS`
   - provider-specific dynamic model discovery
   - curated model normalization
   - advanced provider knowledge
   - repo-wide tests and fixtures that consume the bundled example
10. Provider installation method (`npm_global`, native installer, local model,
    or another method) shall be treated as operational context, not as the rule
    deciding whether model-catalog maintenance is required.
11. Each provider shall be classified by its actual catalog path, such as:
    - account-resolved dynamic enumeration
    - curated static input
    - runtime static fallback
    - intentionally empty catalog
    - account-configured or BYO-model behavior
    - provider-default sentinel
    - unsupported execution path
12. The skill shall use this evidence priority when sources conflict:
    1. account-resolved machine-readable enumeration from the installed CLI
    2. user-provided output from the authenticated interactive picker
    3. static extraction from the installed shipped artifact, explicitly
       labeled as a possible superset
    4. version/help output, which can update an observed version note but does
       not verify a model list
13. Vendor documentation or web research may explain a command or feature but
    shall not substitute for account-resolved evidence when the catalog is
    entitlement- or account-dependent.
14. The model's own knowledge shall never be used to fill catalog rows,
    defaults, context limits, output limits, or option values.
15. `last_updated` shall change only when the model list was re-read or otherwise
    verified as complete for the catalog or provider scope being updated. A
    newer `--version` result alone shall be recorded in notes with its observation
    date and scope. A pasted model list that the operator confirms is complete is
    such a verification and shall advance the field even when no option axis was
    re-read. A partial, scrolled, truncated, or completeness-unknown paste shall
    not advance it. The option axes keep their own provenance and observation
    date in `notes` under requirement 35. The field shall not be split per option
    axis, which would require the schema change requirement 17 forbids
    improvising.
16. Raw selectable model ids and picker-visible labels shall remain distinct.
    The skill shall preserve observed generation/version information in labels;
    ambiguity belongs in notes and shall not be resolved by stripping the
    generation. The same rule applies to option and control values: a displayed
    label such as `Extra high` shall not be assumed to equal a raw CLI token such
    as `xhigh` unless an observed mapping or the relevant normalizer proves it.
17. The skill shall inspect the typed curated schema before editing and shall
    not invent unsupported YAML fields.
18. The skill shall inspect the relevant normalizer before adding or renaming a
    curated row. A row that normalizes to `null` shall not be added silently.
19. When observed upstream data exceeds current normalizer support, the skill
    shall either:
    - omit the unsupported row and report the omission, or
    - extend normalizer/runtime behavior and tests only when that broader change
      is explicitly authorized
20. The skill shall search the whole repository for consumers of the exact
    bundled example before editing assertions. Tests using independent inline
    YAML fixtures shall not be changed merely to resemble the bundled file.
21. When curated input, runtime output, and a test assertion disagree, the skill
    shall establish which one is authoritative before editing any of them. It
    shall not assume the implementation is correct because a test currently
    asserts its behavior, and shall not record an unexplained divergence as
    intended behavior in a code comment or note. An unresolved three-way
    disagreement shall be reported rather than settled by editing the
    assertion. A curated `default`, option value, or limit that the runtime
    does not honor is a candidate runtime defect, and confirming it requires
    reading the resolution code rather than trusting either the test or the
    observed payload.
22. Provider-scoped requests shall modify only the authorized provider section
    and directly required tests/runtime code. If a global catalog comment
    becomes contradictory but lies outside an explicit section-only scope, the
    skill shall report it instead of silently expanding scope.
23. Full-file refreshes shall update global provenance comments so they remain
    truthful to the refreshed and untouched sections.
24. Review mode shall not accept another agent's notes as proof. It shall
    reacquire available evidence or clearly state which claims could not be
    independently verified.
25. Audit mode shall report providers that exist outside the curated YAML,
    including npm-installed providers, and explain whether their absence is
    dynamic, deliberate, unsupported, or an actionable gap.
26. The skill shall not mutate provider adapters, parser logic, compatibility
    policy, install knowledge, or accepted evidence merely because it observes
    drift. Such changes require explicit scope and the relevant tests/docs.
27. Validation shall be proportional to the changed surface and include, at
    minimum:
    - YAML/schema loading and zero unexpected normalization warnings
    - focused model catalog and advanced-knowledge tests
    - repository-wide searches for exact-file fixture expectations
    - TypeScript checking when TypeScript or tests are changed
28. When `tests/runtime-server.test.ts` or another environment-sensitive suite
    has unrelated local failures, the report shall distinguish pre-existing
    failures from regressions introduced by the catalog change; it shall not
    modify unrelated tests to obtain a green local run.
29. The final report shall state:
    - what was observed and from which source
    - what could not be determined
    - which rows or claims were intentionally omitted
    - any choice between conflicting readings
    - files changed
    - validation results and unrelated failures
30. The skill shall stop before external or release mutations unless the user
    separately authorizes commit, push, pull request, npm publication, or
    GitHub Release actions.
31. Operator-pasted evidence shall be accepted in its raw terminal form. The
    skill shall not require the operator to hand-write JSON or YAML, to
    reformat, or to strip ANSI sequences, box-drawing characters, selection
    markers, wrapped lines, or picker chrome. One line of context naming the
    provider and the command is sufficient; where it is absent and the source is
    ambiguous, the skill shall ask rather than guess. A pasted single-line
    confirmation message is evidence on the same terms as a pasted list.
32. Mechanical normalization shall be deterministic wherever it materially
    improves reliability. One cross-platform script in the skill package,
    runnable with the repository's Node.js runtime, shall strip ANSI and other
    terminal control sequences without destroying visible text, indentation, or
    ordering; retain unparsed lines; render a normalized observation summary;
    and compute gaps from an agent-created observation document. A
    provider-specific deterministic extractor may be added only when fixtures
    establish a stable grammar. The script shall not invent semantic hierarchy,
    flatten nested choices, or require the operator to supply structured input.
33. Human-in-the-loop behavior shall follow the operator's plain-language intent
    rather than a required JSON/YAML setting:
    - **capture/preview**: the default for a bare paste; parse and report without
      editing
    - **confirm all**: echo a compact table of models, labels, option axes,
      values, defaults, completeness, and unobserved data before any edit
    - **confirm uncertainty**: the default when an update is explicitly
      requested; summarize the proposed change, ask about every materially
      uncertain reading and each hard gate in requirement 36, then apply the
      confirmed in-scope subset
    - **apply authorized**: when the operator explicitly asks to skip routine
      confirmation, apply unambiguous in-scope readings, omit and report
      non-hard low-confidence readings, and still stop at requirement 36 hard
      gates

    Any preview or confirmation summary shall be redacted before it is echoed.
    The report shall record the selected behavior, the parsed reading, every
    question asked, and the operator's response. Review mode shall treat an edit
    that violates the selected behavior or bypasses a hard gate as a defect.
34. Captured evidence shall first become a lossless, ordered observation tree.
    Nodes may represent models, options, values, and dependent sub-options and
    shall retain, when observed, raw text, raw selectable id, visible label,
    current-selection marker, claimed default, completeness, source fragment,
    and parent path. A model list and each per-model or dependent option screen
    are separate observations acquired over one or more rounds. A fragment is
    evidence only for the selected model and option path shown when it was
    captured. The skill shall compute the remaining gaps, name the next capture
    action and any model or option that must be selected first, and shall never
    extend one model's observed values to another model.
35. Partial evidence produces a partial update and never a deletion. Evidence
    covering one level shall leave the other level's existing rows intact, with
    the unverified level's provenance and observation date recorded in `notes`.
    Absence from a paste is not evidence of removal: a row that an entitlement
    gate, scrolling, or truncation could have hidden shall be retained and
    reported.
36. The following become hard confirmation gates when they materially affect a
    proposed edit and shall not be inferred even under **apply authorized**
    behavior. Capture/preview may report and defer them until an edit needs the
    answer:
    - whether a selection marker denotes the account default or merely the
      session's current selection, before writing a default
    - whether the pasted list is complete, or was scrolled or truncated, before
      removing an existing row or advancing `last_updated`
    - which raw selectable id or option token a picker-visible label corresponds
      to, whenever the proposed row needs a mapping the normalizer does not carry
    - which reading wins when conflicting pasted fragments or existing evidence
      would produce different edits
    - whether to remove an existing row, expand beyond the requested provider
      scope, or accept a projection that cannot preserve the observed hierarchy
37. Pasted evidence that materially supports a catalog change shall be preserved
    where it can be cited. Such a paste shall be stored as a redacted artifact
    under `docs/research/fixtures/<cli>-<version>/`, following the naming already
    used there — named for what was captured and carrying the `.redacted`
    marker — with the version taken from the CLI at capture time, and cited from
    the affected catalog's `notes`. If the capture's version cannot be observed,
    the skill shall not substitute the local machine's version or invent one; it
    may request a raw version paste when version materially affects the reading,
    otherwise it shall use an explicit `unknown-version` evidence scope and
    report the missing provenance. A paste too short to be worth a file may stay
    in the conversation and be summarized in `notes` instead. Either way,
    account identifiers, email addresses, organization names, and any
    authenticated session material shall be removed before the paste is written
    to disk or quoted in a note, and each removal shall leave a visible
    placeholder rather than a silent gap.
38. Projection from the observation tree into the typed curated schema shall be
    explicitly loss-checked before editing. A representable subset may be
    written only within the authorized scope. A branch that would be discarded,
    merged with a sibling, detached from its parent condition, or reduced from a
    distinct raw token and label to one guessed value shall remain in the
    redacted evidence and report instead of being silently flattened. Extending
    the curated schema, normalizer, advanced-knowledge model, or runtime behavior
    requires separate explicit authorization and the corresponding tests and
    documentation.

### Non-Functional Requirements

- **Truthfulness**: Missing evidence remains missing; it is never converted into
  a confident catalog claim.
- **Scope safety**: Unrelated provider sections and working-tree changes remain
  untouched.
- **Progressive disclosure**: `SKILL.md` contains the shared workflow and routes
  to provider/evidence references only when relevant.
- **Portability**: The workflow supports PowerShell and POSIX environments, and
  provider references identify when a probe is platform-specific.
- **Secret safety**: Commands and reports must not print, persist, or commit
  credentials or authenticated session material.
- **Maintainability**: Current provider values live in runtime code/catalogs,
  not duplicated as a second catalog inside the skill.
- **Losslessness**: Raw observations retain their hierarchy and ambiguity until
  an authorized, representable projection is chosen.
- **Operator effort**: What a maintainer supplies by hand is capped at copying
  terminal output and answering plain-language questions. Any format the
  operator would have to author by hand is a design failure.

## Design Overview

Why one skill rather than three — author's analysis, not part of the owner's
approval: the three modes share the provider inventory step, the
evidence-priority ladder, the normalizer check, the repo-wide fixture search,
and the report format. Separate skills would carry three near-identical
workflows that drift independently. The maintainability requirement above is
narrower than this argument — it forbids duplicating catalog *values* inside the
skill and does not by itself rule out multiple workflows — so it supports the
choice by analogy only.

The skill is one discoverable workflow with conditional references rather than
one skill per provider:

```text
developer-skills/
  maintain-provider-model-catalogs/
    SKILL.md
    references/
      paste-intake.md
      evidence-and-scope.md
      catalog-surfaces.md
      providers/
        claude.md
        codex.md
        antigravity.md
        cursor.md
        ...only when provider-specific procedure is needed
    scripts/
      normalize-picker-paste.mjs
```

`SKILL.md` selects refresh, review, or audit mode, performs the current-provider
inventory, and loads only the relevant references. `catalog-surfaces.md`
explains how to locate authoritative code paths but does not copy current model
lists. Provider references document non-obvious extraction procedures, source
limitations, and safe stopping conditions.

The intake split follows the same rule as the rest of the package: procedure is
shared, recipes are not. `paste-intake.md` carries the parts that must be
identical for every provider — tolerant mechanical normalization, the lossless
observation-tree contract, natural-language interaction policies, multi-round
gap calculation, schema-loss checks, and partial-evidence rules. A provider
reference carries only what differs: which capture action produces the list,
whether such an action exists at all, and what its output does and does not
prove. `normalize-picker-paste.mjs` makes only the mechanical half reproducible;
provider semantics stay in a fixture-backed extractor or in explicit agent
judgment, and ambiguity remains visible.

That split is also the answer to whether this should be one skill per provider.
What is provider-specific is the extraction recipe, not the workflow, and a
reference loaded on demand costs the same context as a separate skill while
keeping one copy of the rules that carry the correctness. Audit mode has no
per-provider form at all — it reconciles the whole registered set at once — and
a family of near-identical skill descriptions would make skill selection
unreliable, whereas one skill over a code-derived inventory admits the next
provider without authoring anything.

The implementation shall also establish a separate developer-skill sync path:

```text
developer-skills/                 canonical, tracked
        |
        +--> .agents/skills/      generated Codex/Antigravity/Grok mirror
        `--> .claude/skills/      generated Claude Code mirror

skills/                           runtime-delivered, npm-shipped; unchanged
```

## Dependencies

- [ADR-036](../decisions/036-separate-repository-maintenance-skills-from-runtime-delivered-skills.md)
- [ADR-025](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR-029](../decisions/029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md)
- [ADR-034](../decisions/034-automate-light-tier-provider-drift-and-separate-observation-from-acceptance.md)
- [SPEC-021](./SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- [SPEC-023](./SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
- [SPEC-024](./SPEC-024-curated-cli-catalog-pack-and-evidence-overlay.md)
- `scripts/windows/Sync-AgentSkills.ps1`
- `scripts/linux/sync-agent-skills.sh`
- `scripts/macos/sync-agent-skills.sh`
- `AGENTS.md`, `CODEX.md`, `CLAUDE.md`, `GEMINI.md`, and `scripts/README.md`,
  which currently describe all or part of the old agent-skill sync contract
  (see functional requirement 4)
- the Agent Skills validation tooling used by the active coding-agent environment

## Acceptance Scenarios

1. A Codex refresh of the Codex section uses account-resolved enumeration,
   preserves unrelated dirty sections, updates only supported fixtures, and
   reports all evidence and validation.
2. A Claude refresh from static binary extraction labels the result as a
   compiled superset, preserves visible generations in labels, and does not
   advance account-resolved defaults without picker evidence.
3. A review of another agent's catalog diff reacquires available evidence and
   reports unsupported claims without modifying files.
4. A full audit includes npm-installed providers missing from curated YAML and
   explains their dynamic, static, empty, or unsupported catalog path.
5. A newly added provider family appears in the audit without editing a fixed
   provider list inside the skill.
6. A version-only probe leaves `last_updated` unchanged.
7. A candidate row rejected by the normalizer is omitted or accompanied by an
   explicitly authorized runtime/test change; no silent-drop warning remains.
8. A curated `default: true` that the served catalog does not reflect is traced
   to the resolution code and reported as a candidate runtime defect. The
   contradicting assertion is not rewritten to match the served value, and no
   comment is added asserting the divergence is intentional.
9. Each Windows, Linux, and macOS sync entrypoint makes equivalent canonical
   content available to Codex, Antigravity, Grok, and Claude Code, while
   `npm run verify:skills` and the runtime catalog exclude the developer skill.
10. After a canonical skill is renamed or deleted, the next sync removes its
    obsolete repository-managed mirror without deleting an unrelated local skill.
    Running the same sync again produces no further content changes.
11. An operator pastes raw model-picker output carrying ANSI sequences,
    box-drawing characters, and a selection marker, saying only which CLI it came
    from. The skill parses it without asking for any reformatting, enters
    capture/preview behavior because no edit was requested, echoes a summary that
    names what it could not observe, and reports that the marker's meaning is
    unresolved. It makes no catalog edit from the paste alone and asks about the
    marker only if the operator requests that a default be recorded.
12. A model-list paste is followed by an option-picker paste captured with one
    model selected. The skill records that model's values, names the next model
    and capture action needed, and applies the observed values to no other model.
    Stopping there after confirming that the model list itself was complete may
    update the model list and `last_updated`; it leaves every other model's
    existing option rows in place, with the unverified scope and its date
    recorded in `notes`.
13. A paste omits a model the catalog currently lists. The skill keeps the row,
    reports the absence as unexplained, and asks whether the list was complete
    before anyone treats it as a removal.
14. An operator asks to update a provider and says to ask only when uncertain.
    The skill summarizes the proposed in-scope additions, asks about an unmapped
    option label, and records **confirm uncertainty** plus the answer in its
    report. The same request with **confirm all** produces a complete preview
    before any edit. Under **apply authorized**, the skill may apply clear rows
    without that preview and omit a non-hard low-confidence note, but it may not
    bypass the unmapped-label question.
15. A captured option value reveals a dependent sub-option that the current
    curated schema cannot represent. The skill retains the whole branch in its
    observation tree and redacted evidence, shows exactly what a YAML projection
    would lose, and makes no lossy projection until the operator explicitly
    chooses to omit it or authorizes a broader schema/runtime change.
16. A scrolled or truncated model-list paste updates neither removals nor
    `last_updated`. A later paste confirmed as the complete list for the same
    provider scope may advance `last_updated` without claiming that unobserved
    per-model option axes were refreshed.
17. A user pastes `/model` output only to choose or troubleshoot the current
    session model. The catalog-maintenance workflow does not claim the paste or
    propose a repository edit unless the user also expresses catalog-maintenance
    intent.

## Open Questions

- [x] Approve ADR-036's `developer-skills/` boundary and generated-mirror
  approach. Approved 2026-08-28; ADR-036 is now Accepted.
- [x] Approve this single-skill, multi-mode scope before creating PLAN-037.
  Approved 2026-08-28: one skill carrying refresh, review, and audit modes. The
  approval covers that decision only. The reasoning behind the recommendation is
  the author's and is recorded under Design Overview.
- [x] Should raw operator pastes be tracked as redacted evidence artifacts under
  `docs/research/fixtures/<cli>-<version>/`, or stay untracked? Approved
  2026-09-01: track them there, following the naming already used (for example
  `grok-1.0.0/models.success.redacted.txt`), and cite them from `notes`. A paste
  too short to be worth a file stays in the conversation. Redaction is required
  either way. Written into requirement 37.
- [x] Should a complete model-list-only paste advance `last_updated`? Approved
  2026-09-01: yes. The operator must confirm completeness for the catalog or
  provider scope; partial, scrolled, truncated, or completeness-unknown pastes do
  not advance it. The rule stays in requirement 15 rather than gaining a
  requirement of its own, so the field has one definition; the option axes' own
  provenance stays in `notes` under requirement 35. A per-option freshness field
  is rejected — it is the schema change requirement 17 forbids improvising.

## References

- [Curated model catalog example](../../config/curated-model-catalogs.yaml.example)
- [Provider model catalog service](../../src/core/models/providerModelCatalog.ts)
- [Curated model normalization](../../src/core/models/curatedModelCatalogNormalization.ts)
- [Provider advanced knowledge](../../src/core/models/providerAdvancedKnowledge.ts)
- [Provider registration](../../src/backends/cli/providers/types.ts)
- [Provider install knowledge](../../src/core/provider-install/knowledge.ts)

---

*Created: 2026-08-28*
*Author: Codex*
*Amended: 2026-09-01 by Claude — operator-pasted evidence intake and the
confirmation gate (requirements 31-37, scenarios 11-13), plus the paste clause
in requirement 15. Both open questions were answered by the repository owner the
same day. The approved single-skill, multi-mode scope is unchanged.*
*Amended: 2026-09-01 by Codex at the repository owner's request — selectable
human-in-the-loop behavior, lossless hierarchical observations, explicit
schema-loss gates, complete-scope freshness, and capture-only handling for a
bare paste (requirements 5, 15-16, 31-38; scenarios 11-17).*
*Related Plan: [PLAN-037](../plans/PLAN-037-provider-model-catalog-maintenance-skill.md)*
