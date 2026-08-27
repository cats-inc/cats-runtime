# ADR-036: Separate Repository-Maintenance Skills from Runtime-Delivered Skills

## Status

Proposed

## Context

`cats-runtime` needs a reusable skill for maintaining provider model catalogs.
The intended users are repository maintainers working through Codex, Claude
Code, or another coding agent. The skill would teach a repeatable evidence,
editing, review, and validation workflow for files such as:

- `config/curated-model-catalogs.yaml.example`
- `src/core/models/providerModelCatalog.ts`
- `src/core/models/curatedModelCatalogNormalization.ts`
- provider-specific dynamic model-discovery modules and their tests

The repository already has a `skills/` tree, but that tree is not a neutral
home for developer tooling. It is the runtime-owned, execution-ready skill
library described by ADR-018. The runtime recursively discovers `SKILL.md`
packages below that root, validates their runtime metadata, exposes them through
the runtime skill catalog, materializes them into sessions, and includes the
tree in the published npm package.

At the same time, the repository's collaboration instructions and
`scripts/windows/Sync-AgentSkills.ps1` currently describe `skills/` as the
canonical source for coding-agent discovery mirrors under `.agents/skills` and
`.claude/skills`. The sync script only considers direct child directories that
contain `SKILL.md`, while the runtime library is organized one level deeper by
family. It therefore does not mirror the existing family-organized runtime
library, but adding a direct top-level maintenance skill merely to satisfy that
script would cause the runtime loader to discover and publish a developer-only
workflow.

These are two different audiences and delivery contracts:

1. runtime-delivered skills are product content selected and injected into Cats
   sessions
2. repository-maintenance skills are development tooling used to change and
   review this repository

Using one canonical directory for both would make a maintainer procedure appear
as a product capability and would couple development automation to the npm
runtime package contract.

## Decision

Adopt separate canonical roots for the two skill classes:

1. **`skills/` remains exclusively runtime-delivered skill content.**
   - it remains recursively discovered by the runtime
   - it remains subject to runtime skill metadata and `verify:skills`
   - it remains included in the npm package
2. **`developer-skills/` becomes the canonical source for repository-maintenance
   Agent Skills.**
   - it contains standard `SKILL.md` packages for repository development,
     maintenance, review, and release workflows
   - it is version-controlled with the repository
   - it is not read by the runtime skill catalog
   - it is not included in the npm package
3. **Agent-specific paths remain generated discovery mirrors.**
   - `.agents/skills/` is the Codex mirror
   - `.claude/skills/` is the Claude Code mirror
   - both remain ignored and are refreshed from `developer-skills/`
   - generated mirrors are never edited as canonical sources
4. **`Sync-AgentSkills.ps1` will sync only repository-maintenance skills from
   `developer-skills/`.** Runtime-delivered skills continue to use the runtime's
   own resolution and materialization code rather than being copied wholesale
   into every coding agent's project discovery path.
5. **Repository-maintenance skills encode procedure, not durable truth.** ADRs,
   specifications, plans, code, tests, and evidence artifacts remain the
   authoritative sources. A maintenance skill points agents to those sources
   and teaches how to use them without copying changing catalog values into the
   skill itself.
6. **External side effects remain request-scoped.** A maintenance skill may
   inspect local CLIs, edit authorized repository files, and run relevant local
   validation. It does not implicitly authorize authentication, paid or
   credentialed probes, commits, pushes, pull requests, releases, or publishing.

The first repository-maintenance skill under this boundary will be
`maintain-provider-model-catalogs`, defined by SPEC-028 after approval.

## Consequences

### Positive

- Developer procedures cannot accidentally appear in the Cats runtime skill
  catalog or npm package.
- Codex and Claude Code can consume one version-controlled canonical workflow
  without maintaining two independently edited copies.
- Runtime skill metadata remains focused on product delivery, while developer
  skills can follow the ordinary Agent Skills contract.
- Repository-maintenance workflows can evolve without changing runtime session
  behavior or package consumers.

### Negative

- The repository gains a second skill root whose audience must remain clear.
- The sync helper, shared collaboration docs, and agent-specific instructions
  need one coordinated migration.
- Generated mirrors can become stale until the sync helper is run; validation
  must detect mirror drift.

### Neutral

- This decision does not change runtime skill resolution or delivery.
- This decision does not add the provider catalog maintenance skill by itself.
- This decision does not choose a scheduled automation host or replace the
  upstream-drift work in ADR-034 and PLAN-036.
- Supporting another coding agent's discovery path later is an additive sync
  target, not a change to the canonical source boundary.

## Alternatives Considered

### Put the Maintenance Skill Directly Under `skills/`

- **Pros**: Reuses the currently documented canonical root and existing file
  format.
- **Cons**: The runtime recursively discovers and publishes that tree, so a
  developer-only maintenance workflow becomes runtime product content.
- **Why rejected**: Audience and delivery behavior are materially different.

### Track Separate Canonical Copies Under `.agents/skills` and `.claude/skills`

- **Pros**: Each coding agent discovers the skill without a sync step.
- **Cons**: Duplicates content, invites cross-agent drift, and conflicts with
  the current ignored/generated-directory policy.
- **Why rejected**: There must be one reviewable source of truth.

### Install the Skill Only in Each Maintainer's Home Directory

- **Pros**: No repository structure or package changes.
- **Cons**: New development machines and collaborators do not receive the
  workflow with the code version it governs.
- **Why rejected**: This is repository-specific institutional procedure, not a
  private preference.

### Keep the Procedure Only in `AGENTS.md`

- **Pros**: Every repository agent sees it immediately.
- **Cons**: Provider-specific extraction and validation instructions would
  permanently consume general instruction context and cannot use progressive
  disclosure effectively.
- **Why rejected**: The procedure is task-specific and belongs in an
  on-demand skill backed by durable project documents.

## References

- [ADR-010: Separate A2A Protocol Artifacts, Project Memory, and Skill Packages](./010-separate-a2a-protocol-project-memory-and-skill-packages.md)
- [ADR-018: Separate Skill-Library Content from Runtime Execution Engine](./018-separate-skill-library-content-from-runtime-execution-engine.md)
- [ADR-034: Automate Light-Tier Provider Drift and Separate Observation from Acceptance](./034-automate-light-tier-provider-drift-and-separate-observation-from-acceptance.md)
- [SPEC-028: Provider Model Catalog Maintenance Skill](../specs/SPEC-028-provider-model-catalog-maintenance-skill.md)
- [Runtime Skill Library](../../skills/README.md)
- [Agent Collaboration Guide](../AGENT-GUIDE.md)

---

*Proposed: 2026-08-28*
*Proposed by: Codex from user direction*
