# Research: Project-Bootstrap Collaboration Extraction Inventory

Date: 2026-03-29
Topic: What `cats-runtime` and `cats` still need to internalize from
`project-bootstrap/templates/base` plus `Initialize-Project` /
`Update-Project` before repo split
Source:
- `project-bootstrap/templates/base/*`
- `project-bootstrap/scripts/windows/Initialize-Project.ps1`
- `project-bootstrap/scripts/windows/Update-Project.ps1`
- `project-bootstrap/scripts/linux/initialize-project.sh`
- `project-bootstrap/scripts/linux/update-project.sh`

## Summary

`cats-runtime` already rewrote the protocol-facing A2A example set and the
local collaboration skills, but that is not the whole bootstrap story.

The remaining split-risk is not "A2A docs are missing." The remaining split-risk
is that `project-bootstrap` still owns the reusable repo-shape/update
semantics that taught new repos how to seed or review collaboration artifacts:

- the base template still defines the generic starter layout for docs, skills,
  and script directories
- `Initialize-Project` still owns the copy-first starter semantics
- `Update-Project` still owns the conservative `*.bootstrap` review-copy
  semantics for drifted files
- `Update-Project` also owns the "retired legacy A2A file" review staging
  behavior

If `cats-runtime` and `cats` split before that knowledge is internalized,
their collaboration baseline becomes source-repo-dependent again.

## Relevant Source Surfaces

### Base Template Families Worth Extracting

These source files are the meaningful collaboration/template inputs:

- `project-bootstrap/templates/base/docs/a2a/*`
- `project-bootstrap/templates/base/docs/README.md`
- `project-bootstrap/templates/base/docs/AGENT-GUIDE.md`
- `project-bootstrap/templates/base/docs/terminology.md`
- `project-bootstrap/templates/base/docs/specs/README.md`
- `project-bootstrap/templates/base/docs/plans/README.md`
- `project-bootstrap/templates/base/docs/research/README.md`
- `project-bootstrap/templates/base/docs/decisions/README.md`
- `project-bootstrap/templates/base/scripts/README.md`
- `project-bootstrap/templates/base/skills/README.md`
- `project-bootstrap/templates/base/scripts/windows/Sync-AgentSkills.ps1`

These are the files that encode starter expectations about where collaboration
rules, protocol artifacts, and project memory should live.

### Script Behaviors Worth Extracting

`Initialize-Project` contributes these durable semantics:

- target path must already exist
- copy the full base template into the target repo
- optionally layer flavors/presets on top
- optionally initialize git

`Update-Project` contributes these durable semantics:

- treat the base template as a source of starter/update truth
- for each file, either `create`, `skip`, or stage a sibling
  `*.bootstrap` review copy instead of overwriting local edits
- apply the same create/skip/stage behavior to flavor files
- detect retired legacy A2A filenames and stage review notices or replacement
  examples alongside them

Those update semantics matter more than the exact script implementations.

## What Is Already Internalized

- `cats-runtime/docs/a2a/*` now carries a repo-owned A2A v1.0 example set
- `cats/docs/a2a/*` mirrors that pilot-owned example set
- `cats-runtime/skills/orchestration/a2a-handoff/SKILL.md` and
  `cats-runtime/skills/orchestration/project-memory-sync/SKILL.md` now encode
  runtime-owned collaboration behavior
- both repos already have repo-specific `AGENTS.md`, agent-specific files, and
  `docs/AGENT-GUIDE.md`, so the generic bootstrap placeholders are no longer
  the right shipped artifacts

## What Still Needs a Repo-Owned Rewrite

### P0: Collaboration Update Helper Semantics

This is the most important missing extraction target:

- a local helper must be able to apply starter/update truth without blind
  overwrite
- it must preserve the staged-review pattern for drifted files
- it must replace the dependency on `project-bootstrap/scripts/*`

Without this, the repos keep depending on upstream scripts for safe
collaboration-asset refreshes.

### P0: Legacy A2A Retirement Semantics

The repo-owned rewrite should preserve the useful upgrade behavior from
`Update-Project`:

- detect the retired generic `docs/a2a/task.*.example` and old single-card
  filenames
- stage replacement guidance or review copies instead of silently deleting or
  overwriting

### P1: Starter Asset Baseline for Collaboration Docs

The repo-owned rewrite should preserve the minimum starter families that define
collaboration posture:

- protocol docs
- docs indexes
- skills catalog/readme conventions
- script-readme conventions

This does **not** mean importing the generic template files wholesale. It means
rewriting the subset that these repos still need to maintain their own
collaboration baseline after split.

That first rewrite slice is now landed in `cats-runtime` workspace substrate:

- `docs/README.md`
- `docs/specs/README.md`
- `docs/plans/README.md`
- `docs/research/README.md`
- `docs/decisions/README.md`
- `skills/README.md`
- `scripts/README.md`

The remaining P1 work is now about mirrored sibling consumption and any later
refinement, not the first repo-owned baseline itself.

### P2: Flavor / Preset Matrix

The full preset/flavor system is not an immediate split blocker for
`cats-runtime` itself.

If future generated repos still need a local "starter repo" flow, then a later
repo-owned rewrite may need:

- a reduced preset vocabulary
- a reduced flavor vocabulary
- a simpler non-interactive argument surface

That is lower priority than preserving starter/update semantics for the current
repos.

## Deliberate Non-Ports

These do not need to be copied wholesale into `cats-runtime` or `cats`:

- generic placeholder project descriptions in template `AGENTS.md` / `README.md`
- the full cross-language preset catalog
- template files that are already superseded by repo-specific docs
- bootstrap interactivity patterns such as `Read-Host` prompts as a required
  post-split operating mode

## Proposed Ownership After Split

- `cats-runtime`
  - canonical runtime-owned collaboration update helper semantics
  - canonical runtime-owned A2A protocol example set
  - runtime-owned collaboration skills
- `cats`
  - mirrored protocol artifacts where the product repo must stay aligned
  - product-owned setup/install helpers from `environment-bootstrap`
  - any product-specific collaboration starter/update helpers it still needs

## Action Items

1. Add a repo-owned collaboration/bootstrap helper contract to `cats-runtime`
   that replaces dependence on `Initialize-Project` / `Update-Project`.
2. Port the conservative `*.bootstrap` staging behavior into that local helper
   contract before repo split.
3. Preserve the legacy A2A retirement guidance in the local helper flow.
4. Decide which subset of starter assets stays runtime-canonical versus
   mirrored into `cats`.

## Relevance

This note narrows the next `PLAN-023` slice. The real pre-split work is not
"copy more A2A docs"; it is internalizing the collaboration starter/update
mechanics that still live only in `project-bootstrap`.
