# SPEC-028: Provider Model Catalog Maintenance Skill

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

Create one repository-maintenance Agent Skill,
`maintain-provider-model-catalogs`, that lets Codex and Claude Code refresh,
audit, or independently review `cats-runtime` provider model-catalog knowledge
from observable evidence. The skill shall cover all registered CLI provider
families and all relevant catalog mechanisms rather than treating the eight
current sections in `curated-model-catalogs.yaml.example` as a closed provider
list. It shall preserve the distinction between curated input, static fallback,
dynamic discovery, normalization, deliberately empty catalogs, and
account-specific or BYO-model providers.

The skill is developer tooling governed by ADR-036. It is not a
runtime-delivered Cats skill and does not replace the provider drift watcher,
the catalog schema, or durable evidence and decision documents.

## Goals

- provide one repeatable workflow for provider catalog refresh, audit, and
  independent review
- inventory provider coverage from current code instead of hardcoding a count
  or assuming npm-installed CLIs do not need catalog maintenance
- preserve evidence provenance, visible model labels, catalog freshness, and
  account scope honestly
- prevent unsupported rows from being silently dropped by normalization
- preserve unrelated working-tree edits and user-requested provider scope
- make the same canonical workflow discoverable by Codex and Claude Code
- produce a clear report of observed facts, gaps, judgment calls, and validation

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
2. The skill shall be synced to `.agents/skills/` for Codex and
   `.claude/skills/` for Claude Code from the same canonical source.
   The Windows, Linux, and macOS sync entrypoints shall be idempotent and cheap
   enough to re-run after any edit to the canonical source. Each sync shall
   reconcile repository-managed entries: a deleted or renamed canonical skill
   shall not leave an obsolete generated mirror, and unrelated locally installed
   skills shall not be deleted. The mirrors are ignored build output, so no
   committed copy exists for CI to diff; regeneration and isolated reconciliation
   tests, not committed mirrors, are the mitigation for staleness.
3. The canonical package shall contain one `SKILL.md` entrypoint and only the
   supporting references or scripts that materially improve this workflow.
4. The implementation shall update every document that describes the old
   `skills/` agent-mirror contract, and shall assign agent-specific files to
   their owning agents. Remaining at the time of writing:
   - `AGENTS.md:280,294` still says skills live in `skills/` and are synced to
     each agent's discovery path
   - `CODEX.md:101,105` still names `skills/` as the canonical source — owned
     by Codex
   - `CLAUDE.md` carries an interim correction only, recording that the helpers
     copy nothing and pointing here — owned by Claude
   - `scripts/README.md:36-38` still describes all three helpers as syncing
     `skills/`

   Two parts are already done and are not deliverables of this spec:
   - `GEMINI.md` was corrected in `cbe1984`. It is not obsolete — the
     Antigravity CLI reads `GEMINI.md` and `AGENTS.md` as context files — so it
     was fixed rather than deleted. Its claim that skills come from
     `.gemini/skills/<name>/SKILL.md` was false: a probe of agy 1.1.20 found no
     project-level skill discovery on either candidate path (see ADR-036
     Context).
   - `AGENTS.md` agent naming was corrected in `7ea3f35`; only its skills
     contract above remains.
5. The skill description shall trigger for provider model-catalog refreshes,
   catalog audits, and reviews of catalog changes. It shall exclude generic
   provider adapter implementation and ordinary dependency updates.
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
    verified. A newer `--version` result alone shall be recorded in notes with
    its observation date and scope.
16. Raw selectable model ids and picker-visible labels shall remain distinct.
    The skill shall preserve observed generation/version information in labels;
    ambiguity belongs in notes and shall not be resolved by stripping the
    generation.
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

## Design Overview

The skill is one discoverable workflow with conditional references rather than
one skill per provider:

```text
developer-skills/
  maintain-provider-model-catalogs/
    SKILL.md
    references/
      evidence-and-scope.md
      catalog-surfaces.md
      providers/
        claude.md
        codex.md
        antigravity.md
        cursor.md
        ...only when provider-specific procedure is needed
```

`SKILL.md` selects refresh, review, or audit mode, performs the current-provider
inventory, and loads only the relevant references. `catalog-surfaces.md`
explains how to locate authoritative code paths but does not copy current model
lists. Provider references document non-obvious extraction procedures, source
limitations, and safe stopping conditions.

The implementation shall also establish a separate developer-skill sync path:

```text
developer-skills/                 canonical, tracked
        |
        +--> .agents/skills/      generated Codex mirror
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
   content available to Codex and Claude Code, while `npm run verify:skills` and
   the runtime catalog exclude the developer skill.
10. After a canonical skill is renamed or deleted, the next sync removes its
    obsolete repository-managed mirror without deleting an unrelated local skill.
    Running the same sync again produces no further content changes.

## Open Questions

- [ ] Approve ADR-036's `developer-skills/` boundary and generated-mirror
  approach.
- [ ] Approve this single-skill, multi-mode scope before creating PLAN-037.

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
*Related Plan: Pending specification approval*
