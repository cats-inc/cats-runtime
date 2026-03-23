# SPEC-005: Runtime-Managed Skills v0

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Execution Delivery Slice Landed) |
| **Owner** | Codex |
| **Reviewer** | User review pending |

## Summary

`cats-runtime` now has a delivered runtime-managed skills execution slice:
session payloads carry requested/resolved/applied metadata, delivery modes are
backend-aware, callers can explicitly clear persisted skill state with
`skills: null`, the resolver can distinguish canonical family/slug library ids
from plain slug requests, and instruction delivery now reaches live execution
paths instead of stopping at catalog resolution.

The remaining gap is not whether skills exist at runtime, but how far the v0
contract should go beyond the delivered session/runtime/execution slice.

The latest follow-on clarification is that runtime-managed execution and the
internal skill-library taxonomy are separate concerns:

- `SPEC-013` defines the role/library content taxonomy
- this spec defines resolution, materialization, injection, and reporting

This specification defines a first slice for runtime-managed skills. The goal is
to make skills a real execution input without jumping straight to a plugin
platform, MCP tool registry, or scheduler-driven agent behavior model.

## Goals

- Make skills a runtime-owned execution concern rather than prompt-only or
  repo-only metadata
- Reuse the existing `skills/` directory as the canonical source of skill
  packages
- Let sessions carry explicit skill selections as part of the runtime contract
- Provide a backend-neutral way for adapters to receive resolved skills
- Support adapter-specific skill injection where the target runtime can consume
  local skill directories or equivalent resources
- Surface active skill metadata in session state and history for observability

## Non-Goals

- Building a general plugin platform or MCP tool-registration system
- Copying Paperclip heartbeat, inbox, approval, or company workflow semantics
- Auto-executing arbitrary scripts from skill packages
- Replacing the existing `instructions` field with a skill-only mechanism
- Solving all `cats` profile-to-skill mapping in the same slice

## User Stories

- As a runtime caller, I want to attach named skills to a session so execution
  targets receive domain-specific guidance without me inlining long prompt
  templates.
- As a runtime maintainer, I want one canonical place to resolve and validate
  skills before passing them to different backends.
- As a product integrator, I want session metadata to tell me which skills were
  requested and which were actually applied.
- As an adapter author, I want a normalized resolved-skill payload rather than
  having to rescan the repo or invent my own skill lookup logic.

## Requirements

### Functional Requirements

1. The runtime shall treat `skills/` as the canonical source of runtime-managed
   skill packages.
2. The runtime shall validate that a skill package is structurally usable before
   it can be attached to a session. The minimum validation bar for v0 is:
   - the skill lives under `skills/<name>/`
   - the package contains a `SKILL.md`
   - `SKILL.md` has parseable YAML frontmatter
   - frontmatter `name` exists and matches the directory name
   - frontmatter `description` exists
   - the markdown instruction body is not empty
3. The runtime shall reject malformed skill packages as unavailable for runtime
   attachment instead of attempting best-effort execution from broken metadata.
4. Session create and message flows shall be able to carry an optional explicit
   list of requested skill names or richer request refs.
5. The runtime shall resolve requested skill names into a normalized
   `ResolvedSkillSet` before backend execution begins.
6. The runtime shall persist requested and resolved skill metadata in session
   state so the applied skill context remains visible during history and resume
   flows.
7. The runtime shall expose a backend-neutral adapter contract for skill
   delivery.
8. The first slice shall support at least these adapter delivery modes:
   - `filesystem`: the runtime materializes a skill bundle for targets that
     discover skills from directories or runtime homes
   - `instructions`: the runtime provides compiled instruction content when
     native filesystem discovery is unavailable
   - `none`: the adapter reports that native skill delivery is unsupported
9. When instruction-based delivery is used, the runtime shall merge instruction
   sources in this order: resolved skill instructions first, session-level
   explicit instructions second, and turn-level explicit instructions last.
   More specific caller-provided instructions should remain later in the merged
   text so they can narrow or override broader skill guidance.
10. Explicitly requested unknown skills shall produce a client error instead of
   being silently ignored.
11. When a target cannot honor the preferred delivery mode, the runtime may
   downgrade to another supported mode only if it can surface a warning in
   session metadata or API responses.
12. Supporting files inside a skill package shall be treated as runtime-managed
    resources, not automatically executed code.
13. The first slice should prioritize CLI runtimes with known local skill
    discovery conventions, especially `codex` and `pi`.
14. The first slice shall not require a standalone plugin SDK, MCP facade, or
    scheduler concept.
15. The first slice may leave `skillProfile` as a higher-level product concern
    until the explicit-skill contract is proven, but it should not prevent a
    future runtime-owned profile-to-skill mapping layer.
16. The runtime shall be able to resolve role/library packages from the
    internal skill library without requiring product callers to understand the
    full library taxonomy.
17. Requested, resolved, and applied skill state should remain stable across
    create, resume, fork, and provider-switch re-entry flows.
18. Resolved skill state should be able to carry enough identity metadata to
    distinguish a named skill from a concrete library revision or bundle
    fingerprint.

### Non-Functional Requirements

- **Boundary ownership**: skill resolution, validation, and materialization
  shall remain inside `cats-runtime`
- **Compatibility**: existing sessions without skills shall continue working
  unchanged
- **Observability**: applied skills and delivery warnings should be visible in
  runtime session views and history
- **Safety**: skill attachment shall not become an unreviewed arbitrary code
  execution mechanism

## Design Overview

### Runtime Skill Flow

```text
caller request
   |
   v
requested skill names
   |
   v
SkillCatalogService -> validate package structure
   |
   v
SkillResolver -> build ResolvedSkillSet
   |
   v
adapter capability check
   |
   +--> filesystem materialization
   +--> instructions overlay
   +--> unsupported with warning/error
```

### Suggested Session-Level Shape

Illustrative additions to runtime contracts:

```ts
interface SessionSkillSelection {
  skills?: string[];
}

interface ResolvedSkillRef {
  name: string;
  slug: string;
  sourcePath: string;
  entryFile: string;
  family?: string;
  version?: string;
  fingerprint?: string;
}

interface SessionSkillState {
  requestedSkills: string[];
  resolvedSkills: ResolvedSkillRef[];
  deliveryMode: 'filesystem' | 'instructions' | 'none';
  warnings?: string[];
}
```

The first slice should keep explicit named skills as the normative input. A
future follow-on may add runtime-owned profile mapping once the lower-level
contract is proven.

Transport-facing routes may additionally treat `skills: null` as an explicit
instruction to clear previously persisted session skill state. By contrast,
`skills.requestedSkills: []` should remain a backward-compatible no-op so older
callers that serialize empty arrays do not accidentally wipe skills.

### Internal Components

Suggested internal composition:

- `SkillCatalogService`
- `SkillResolver`
- `SkillMaterializer`
- adapter capability metadata for skill delivery mode

Responsibilities:

- `SkillCatalogService`: discover and validate repo-local skill packages
- `SkillResolver`: turn requested names into resolved package references
- `SkillMaterializer`: prepare runtime-owned filesystem bundles or compiled
  instruction overlays
- adapters: consume the normalized resolved skill payload without rescanning the
  repo

### Re-entry Guidance

Requested/resolved/applied skill state should survive the same session
re-entry moments that already preserve runtime instructions and context:

- create -> first execution
- resume -> continued execution
- fork -> branched execution
- provider switch or adapter fallback where supported

The important point is that skill delivery remains part of execution context,
not a one-time decorate-and-forget field.

### Validation Criteria

Runtime-managed skills should use the existing Agent Skills layout, but v0 only
needs a narrow structural validator rather than a full semantic linter.

The validator should confirm:

- the package exists under `skills/<name>/`
- `SKILL.md` exists at the package root
- YAML frontmatter is parseable
- frontmatter `name` matches the directory name
- frontmatter `description` is present
- the markdown body contains non-empty instructions after frontmatter removal

The validator does not need to prove that every referenced file, script, or
example is semantically correct. Supporting assets may be validated more deeply
later if v0 reveals real failure modes.

### Instruction Merge Guidance

When an adapter uses `instructions` delivery, the runtime should compile one
merged instruction payload from three layers:

1. resolved skill instructions
2. session-level explicit instructions
3. turn-level explicit instructions

This ordering keeps broader skill guidance at the base while preserving caller
intent as the most local and override-capable layer. Skill-derived instructions
should complement, not silently replace, the existing `instructions` contract.

### Delivery Strategy Guidance

The first slice should prefer:

1. native filesystem-based skill delivery when the target runtime already knows
   how to discover skills from local directories
2. instruction-overlay fallback when native skill homes do not exist
3. explicit unsupported reporting when neither mode is safe or meaningful

This keeps the design adapter-aware without forcing every backend to pretend it
supports local skill directories.

## Dependencies

- `skills/` directory structure and sync conventions
- existing session create/message contracts in `src/http/routes/sessions.ts`
  and `src/http/routes/messages.ts`
- session registry/history surfaces that already persist `instructions`,
  `context`, and related metadata
- backend-specific provider runners or adapters that can accept skill-delivery
  inputs

## Open Questions

- [ ] Should `skillProfile` map to named runtime skills inside `cats-runtime`,
      or should `cats` resolve profiles first in the short term?
- [ ] Should the first public API include a standalone `GET /skills` catalog, or
      should v0 stay session-contract only?
- [ ] How far should instruction-delivery reporting go beyond the current
      session/history inspection surfaces for prompt-driven CLI and API/agent
      targets?
- [ ] Should resolved skill state carry an explicit skill version or content
      fingerprint so cache keys, session resume, and artifact provenance can
      distinguish skill revisions?
- [ ] Should callers eventually be able to require strict skill delivery
      instead of accepting best-effort downgrade warnings?

## References

- [SPEC-003: Agent Backend for External Agent Runtimes](./SPEC-003-agent-backend.md)
- [SPEC-013: Internal Skill Library and Role Taxonomy](./SPEC-013-internal-skill-library-and-role-taxonomy.md)
- [cats-runtime gap assessment](../research/2026-03-19-paperclip-gap-assessment.md)
- [Paperclip alignment research](../research/2026-03-17-paperclip-openclaw-pi-alignment.md)
- [cats paperclip control-plane analysis](../../../cats/docs/research/paperclip-control-plane-analysis.md)
- [skills README](../../skills/README.md)

---

*Created: 2026-03-19*
*Author: Codex*
*Last updated: 2026-03-24*
*Related Plan: [PLAN-008-runtime-managed-skills-v0](../plans/PLAN-008-runtime-managed-skills-v0.md)*

