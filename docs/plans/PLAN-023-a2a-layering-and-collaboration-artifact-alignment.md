# PLAN-023: A2A Layering and Collaboration Artifact Alignment

> Implementation plan for the first delivery track under `SPEC-006`.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed (Pilot Slice 1) |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / runtime collaboration workstream |

## Related Spec

[SPEC-006: A2A Protocol, Project Memory, and Skill Layering](../specs/SPEC-006-a2a-protocol-project-memory-and-skill-layering.md)

## Overview

`cats-runtime` already had the right conceptual direction for protocol,
project-memory, and skill layering, but the artifact set was mixed:

- `docs/a2a/` still carries a legacy `agent-card` / generic `task` template set
- repo docs already define the right terminology but do not yet fully explain
  the upgraded artifact boundary
- the runtime skill library has no collaboration-specific packages for A2A
  handoff or project-memory sync workflows

`project-bootstrap` does now contain a March 2026 A2A v1.0 refresh inside the
submodule history:

- `e4518e8` `feat(a2a): refresh v1.0 templates and upgrade flow`
- `569ba7a` `fix(a2a): clarify v1.0 example details`
- `6d98881` `docs(a2a): align v1.0 spec references`

But those artifacts have not yet been validated through real repo operation.

This plan therefore treats `SPEC-006` as a pilot run:

- `project-bootstrap` is an input source, not an accepted baseline
- `cats-runtime` is the primary first-wave implementation repo for this slice
- `cats` remains a sibling first-wave pilot repo, but is not modified in this
  slice
- repos generated after that are the second-wave validation repos
- merge-back into `project-bootstrap` and production use in `cats` /
  `cats-runtime` happen only after several optimization loops

The key rule is:

- take candidate protocol-layer knowledge and example shapes from
  `project-bootstrap`
- do **not** bulk-import bootstrap's broader repo/process documentation
- use `SKILL.md` plus bootstrap tooling (`Initialize-Project` /
  `Update-Project`) as the intended collaboration operating model
- keep runtime-owned collaboration skills local instead of treating bootstrap
  as a runtime dependency or skill source

## Adoption Boundary

### Adopt from `project-bootstrap`

- the March 2026 A2A v1.0 example-set structure
- public vs authenticated Agent Card split
- JSON-RPC method example naming and README guidance
- released-protocol terminology and upgrade notes
- `Initialize-Project` / `Update-Project` as style-enforcement tools for
  second-wave repo validation

### Do Not Adopt Wholesale

- generic bootstrap repo-memory docs such as template-wide process guidance
- bootstrap `AGENTS.md` / agent-specific instruction systems
- placeholder capability content that does not match `cats-runtime`
- bootstrap as a runtime dependency for skills or A2A docs
- bootstrap's March 2026 refresh as if it were already production-proven
- merge-back to bootstrap or production rollout before pilot validation

## Goals

1. Verify and freeze which parts of the March 2026 `project-bootstrap` A2A v1.0
   refresh are suitable as pilot inputs for `cats` / `cats-runtime`.
2. Define the first-wave pilot operating contract for same-environment CLI
   agents, including when they should read `AGENTS.md`, follow
   `docs/AGENT-GUIDE.md`, and update repo memory such as research/ADR/spec/plan
   artifacts.
3. Use runtime-owned `SKILL.md` packages plus bootstrap scripts together:
   skills teach agents how to collaborate; scripts enforce consistent repo
   shape.
4. Validate the pattern in generated repos only after the first-wave
   `cats` / `cats-runtime` pilot proves workable.
5. Defer merge-back into `project-bootstrap` and production rollout until the
   pilot has gone through several optimization loops.

## Non-Goals

- Implementing a live A2A server or public Agent Card route
- Importing the whole `project-bootstrap` documentation tree
- Turning project memory into generated machine-readable state
- Treating external A2A `AgentSkill` metadata as the same artifact as local
  `SKILL.md` packages
- Treating the March 2026 bootstrap refresh as already proven in real repos
- Merging pilot learnings back into `project-bootstrap` in the first slice

## Implementation Phases

### Phase 1: Freeze Pilot Inputs and Validation Rules

- [x] Confirm the exact March 2026 `project-bootstrap` artifacts and scripts
      that enter the pilot input set
- [x] Record explicitly that those bootstrap artifacts are unverified inputs,
      not accepted production defaults
- [x] Define first-wave validation criteria for same-environment collaboration:
      shared reading of `AGENTS.md`, `docs/AGENT-GUIDE.md`, and correct
      read/write behavior around research, ADR, spec, and plan docs
- [x] Freeze the pilot boundary before modifying runtime-owned docs or skills

**Deliverables**: one explicit pilot input set and validation contract exist
before implementation starts.

### Phase 2: First-Wave Pilot in `cats` and `cats-runtime`

- [x] Replace the legacy `docs/a2a/agent-card.*` and `task.*` examples with a
      pilot-owned A2A v1.0 file set derived from the March 2026 bootstrap
      inputs but rewritten to match actual repo capabilities
- [x] Update local docs where needed to reflect the new three-layer split:
      protocol, project memory, and skill packages
- [x] Align `docs/AGENT-GUIDE.md`, `docs/README.md`, and `docs/terminology.md`
      with the pilot operating contract and explicit external-skill vs local
      skill distinction
- [x] Record the intentional divergence directly in the plan/spec/docs because
      this slice did not introduce a new architectural boundary beyond ADR-010

**Deliverables**: `cats` / `cats-runtime` become the first-wave repos validating
whether the A2A-first collaboration model actually works in a real codebase.

### Phase 3: Add Collaboration Skills and Tooling Posture

- [x] Add a first runtime-owned `a2a-handoff` skill package
- [x] Add a first runtime-owned `project-memory-sync` skill package
- [x] Keep both skills procedural and lightweight: they should reference repo
      memory docs rather than copy long-lived state into `SKILL.md`
- [x] Extend the runtime skill-library docs/catalog metadata only as needed to
      describe these new collaboration skills truthfully
- [x] Document how bootstrap tools such as `Initialize-Project` and
      `Update-Project` fit the pilot operating model without treating them as
      already-merged runtime dependencies

**Deliverables**: the runtime ships the first reusable collaboration skills
and tooling guidance that embody `SPEC-006` without turning the skill library
into a second memory system.

### Phase 4: Second-Wave Validation and Backport Gate

- [x] Validate the same operating model in a throwaway repo created and updated
      through bootstrap tooling
- [x] Record interpretation drift, style drift, and collaboration failures found
      in that second-wave validation
- [x] Keep the model explicitly marked as a pilot rather than a production
      default after the first validation round
- [x] Defer any merge-back track until later optimization loops exist

**Deliverables**: there is a clear gate between pilot validation and any future
merge-back into `project-bootstrap` or production adoption in `cats` /
`cats-runtime`.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `docs/a2a/README.md` | Modify | Replace legacy template framing with pilot-owned A2A v1.0 guidance |
| `docs/a2a/agent-card.public.json.example` | Create | Pilot public discovery card example |
| `docs/a2a/agent-card.public.yaml.example` | Create | Pilot YAML public discovery card example |
| `docs/a2a/agent-card.authenticated.json.example` | Create | Pilot authenticated extended card example |
| `docs/a2a/agent-card.authenticated.yaml.example` | Create | Pilot YAML authenticated extended card example |
| `docs/a2a/jsonrpc-send-message.request.json.example` | Create | Pilot `SendMessage` request example |
| `docs/a2a/jsonrpc-send-message.response.json.example` | Create | Pilot `SendMessage` response example |
| `docs/a2a/jsonrpc-send-streaming-message.request.json.example` | Create | Pilot streaming request example |
| `docs/a2a/jsonrpc-send-streaming-message.response.sse.example` | Create | Pilot streaming SSE example |
| `docs/a2a/jsonrpc-get-task.request.json.example` | Create | Pilot `GetTask` example |
| `docs/a2a/jsonrpc-cancel-task.request.json.example` | Create | Pilot `CancelTask` example |
| `docs/a2a/jsonrpc-get-extended-agent-card.request.json.example` | Create | Pilot extended-card lookup example |
| `docs/AGENT-GUIDE.md` | Modify | Clarify protocol vs project-memory vs skill boundaries |
| `docs/README.md` | Modify | Update A2A section and maturity notes |
| `docs/terminology.md` | Modify | Tighten layering terms where needed |
| `skills/orchestration/a2a-handoff/SKILL.md` | Create | Runtime-owned procedural handoff skill |
| `skills/orchestration/project-memory-sync/SKILL.md` | Create | Runtime-owned procedural memory-sync skill |
| `skills/README.md` | Modify | Add collaboration skills to the catalog |
| `src/core/runtime/WorkspaceSubstrateService.ts` | Modify | Retire legacy A2A starter file paths in runtime workspace substrate output |
| `tests/workspace-substrate.test.ts` | Modify | Cover the updated pilot A2A starter artifacts |
| `docs/research/2026-03-29-a2a-pilot-second-wave-validation.md` | Create | Record second-wave bootstrap validation findings |
| `docs/research/README.md` | Modify | Index the new validation note |
| `PROGRESS.md` | Modify | Reflect the pilot collaboration slice if governance truth changes |

## Technical Decisions

- Decision 1: Treat the March 2026 `project-bootstrap` A2A v1.0 refresh as a
  candidate pilot input, not an accepted production baseline, because it has
  not yet been validated in a real repo workflow.
- Decision 2: Run validation in waves: `cats` / `cats-runtime` first, freshly
  generated repos second, because bootstrap merge-back should follow evidence
  rather than precede it.
- Decision 3: Use runtime-owned `SKILL.md` packages plus bootstrap scripts
  together, because skills teach agent behavior while scripts constrain repo
  shape and reduce free-form interpretation.
- Decision 4: Create runtime-owned collaboration skills locally instead of
  importing from another repo, because shipped `cats-runtime` skills must stay
  repo-owned and truthful to this runtime's workflow.

## Testing Strategy

- **Pilot validation**: verify that multiple same-environment CLI agents can
  follow the A2A-first collaboration model inside `cats` / `cats-runtime`
- **Documentation review**: verify the pilot `docs/a2a/` file set traces back
  to the March 2026 bootstrap refresh without overclaiming runtime capability
- **Skill validation**: run `npm run verify:skills` if new skill packages are
  added
- **Manual verification**:
  - confirm agents read `AGENTS.md` and `docs/AGENT-GUIDE.md` consistently
  - confirm agents follow the same research / ADR / spec / plan writing norms
  - compare the resulting pilot `docs/a2a/` set against
    `project-bootstrap/docs/a2a/`
  - validate second-wave repos produced through bootstrap tooling after the
    first-wave pilot is working
- **Required commands**:
  - `npm run verify:skills`
  - `git diff --check`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Mistaking the March 2026 bootstrap refresh for proven production truth | High | Keep the whole track explicitly framed as a pilot run and require first-wave/second-wave validation before merge-back |
| Over-copying bootstrap placeholders into runtime docs | High | Treat bootstrap as a reference candidate, then rewrite capability content to match `cats-runtime` and `cats` |
| Mixing protocol examples with repo-memory guidance again | Medium | Keep the three-layer split explicit in both the plan and the updated docs and skills |
| Collaboration skills duplicate durable state instead of referencing docs | Medium | Keep new skills procedural and point them at canonical markdown memory sources |
| Scripts enforce repo shape but agents still diverge in behavior | Medium | Pair bootstrap tooling with explicit collaboration skills and pilot validation scenarios |

## Reference Inputs

- [SPEC-006](../specs/SPEC-006-a2a-protocol-project-memory-and-skill-layering.md)
- [ADR-010](../decisions/010-separate-a2a-protocol-project-memory-and-skill-packages.md)
- [project-bootstrap SPEC-001](../../../project-bootstrap/docs/specs/SPEC-001-current-a2a-template-artifacts-and-upgrade-behavior.md)
- [project-bootstrap ADR-001](../../../project-bootstrap/docs/decisions/001-adopt-current-a2a-agent-card-and-json-rpc-template-set.md)
- [project-bootstrap docs/a2a/README.md](../../../project-bootstrap/docs/a2a/README.md)
- `project-bootstrap` commits:
  - `e4518e8` `feat(a2a): refresh v1.0 templates and upgrade flow`
  - `569ba7a` `fix(a2a): clarify v1.0 example details`
  - `6d98881` `docs(a2a): align v1.0 spec references`

### Validated Pilot Inputs

- `project-bootstrap/docs/a2a/README.md` and the matching `templates/base`
  files are valid protocol-layer candidate inputs for:
  - public vs authenticated Agent Card split
  - released A2A v1.0 JSON-RPC method example naming
  - retirement of the generic standalone `task.*.example` model
- `Initialize-Project` and `Update-Project` are valid repo-shape candidate
  inputs for second-wave validation:
  - `Initialize-Project` copies the base template into a new repo
  - `Update-Project` stages `*.bootstrap` review copies for diverged files
  - `Update-Project` stages legacy A2A review copies for retired filenames

### Template-Side Assumptions Kept Out of Baseline Truth

- bootstrap template docs do not prove that a real repo's operating model is
  clear to same-environment CLI agents
- bootstrap template A2A examples do not prove that a live repo's capabilities
  or auth model are represented truthfully
- bootstrap scripts shape files, but they do not teach agents when to update
  `docs/research/`, `docs/decisions/`, `docs/specs/`, or `docs/plans/`
- bootstrap is not treated as a runtime dependency or a production-default
  collaboration source

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-29 | Plan created for the first `SPEC-006` implementation track |
| 2026-03-29 | Reframed as a pilot run with bootstrap input validation, first-wave `cats` / `cats-runtime` verification, second-wave generated-repo verification, and deferred merge-back |
| 2026-03-29 | Confirmed `project-bootstrap` March 2026 A2A refresh commits (`e4518e8`, `569ba7a`, `6d98881`) as candidate pilot inputs rather than baseline truth |
| 2026-03-29 | Replaced legacy `docs/a2a/agent-card.*` and `task.*` examples with a pilot-owned A2A v1.0 example set rewritten for `cats-runtime` |
| 2026-03-29 | Added `a2a-handoff` and `project-memory-sync` collaboration skills, aligned runtime docs/indexes, and updated workspace substrate starter artifacts away from retired legacy A2A filenames |
| 2026-03-29 | Completed one second-wave validation pass with `project-bootstrap` initialize/update tooling in a throwaway repo and recorded the resulting drift notes under `docs/research/` |

---

*Created: 2026-03-29*
*Author: Codex*
