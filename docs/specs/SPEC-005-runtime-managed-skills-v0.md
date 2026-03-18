# SPEC-005: Runtime-Managed Skills v0

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User review pending |

## Summary

`cats-runtime` already has a canonical `skills/` directory and sync tooling, but
those skills are not yet part of runtime execution. Today they are versioned
assets and agent-discovery conveniences, not execution-time runtime contracts.

That leaves a major gap versus the Paperclip comparison: there is still no
runtime-owned answer to "which skills apply to this run, how are they resolved,
and how are they attached to the execution target?"

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
- Solving all `cats-inc` profile-to-skill mapping in the same slice

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
   it can be attached to a session.
3. Session create and message flows shall be able to carry an optional explicit
   list of requested skill names.
4. The runtime shall resolve requested skill names into a normalized
   `ResolvedSkillSet` before backend execution begins.
5. The runtime shall persist requested and resolved skill metadata in session
   state so the applied skill context remains visible during history and resume
   flows.
6. The runtime shall expose a backend-neutral adapter contract for skill
   delivery.
7. The first slice shall support at least these adapter delivery modes:
   - `filesystem`: the runtime materializes a skill bundle for targets that
     discover skills from directories or runtime homes
   - `instructions`: the runtime provides compiled instruction content when
     native filesystem discovery is unavailable
   - `none`: the adapter reports that native skill delivery is unsupported
8. Explicitly requested unknown skills shall produce a client error instead of
   being silently ignored.
9. When a target cannot honor the preferred delivery mode, the runtime may
   downgrade to another supported mode only if it can surface a warning in
   session metadata or API responses.
10. Supporting files inside a skill package shall be treated as runtime-managed
    resources, not automatically executed code.
11. The first slice should prioritize CLI runtimes with known local skill
    discovery conventions, especially `codex` and `pi`.
12. The first slice shall not require a standalone plugin SDK, MCP facade, or
    scheduler concept.
13. The first slice may leave `skillProfile` as a higher-level product concern
    until the explicit-skill contract is proven, but it should not prevent a
    future runtime-owned profile-to-skill mapping layer.

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
  sourcePath: string;
  entryFile: string;
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
      or should `cats-inc` resolve profiles first in the short term?
- [ ] Should the first public API include a standalone `GET /skills` catalog, or
      should v0 stay session-contract only?
- [ ] Which non-CLI backends, if any, deserve a meaningful `instructions`
      delivery mode in the first slice?
- [ ] Should callers eventually be able to require strict skill delivery
      instead of accepting best-effort downgrade warnings?

## References

- [SPEC-003: Agent Backend for External Agent Runtimes](./SPEC-003-agent-backend.md)
- [cats-runtime gap assessment](../research/2026-03-19-paperclip-gap-assessment.md)
- [Paperclip alignment research](../research/2026-03-17-paperclip-openclaw-pi-alignment.md)
- [cats-inc paperclip control-plane analysis](../../../cats-inc/docs/research/paperclip-control-plane-analysis.md)
- [skills README](../../skills/README.md)

---

*Created: 2026-03-19*
*Author: Codex*
*Related Plan: TBD*
