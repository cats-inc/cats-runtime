# PLAN-008: Runtime-Managed Skills v0

> Implementation plan for turning repo-local `skills/` packages into an
> execution-time runtime/session contract.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Spec

[SPEC-005: Runtime-Managed Skills v0](../specs/SPEC-005-runtime-managed-skills-v0.md)

## Overview

`cats-runtime` already stores a canonical `skills/` directory, but the current
implementation is still a narrow prompt-overlay helper:

- only one hard-coded skill is known
- malformed or unknown skills are not a first-class client error
- backend selection does not influence how skills are delivered
- CLI/API/agent execution paths do not share a real skill-delivery contract
- history/inspection surfaces cannot prove whether requested skills were
  actually applied

This plan turns runtime-managed skills into a real session/runtime concern
without overreaching into a full plugin platform or product-owned
`skillProfile` logic.

## Goals

1. Freeze a session-level requested/resolved/applied skill contract.
2. Validate runtime skill packages directly from `skills/<name>/SKILL.md`.
3. Support backend delivery modes `filesystem`, `instructions`, and `none`.
4. Validate the first slice against CLI-first targets, especially `codex` and
   `pi`.
5. Surface skill state in session inspection and history routes.
6. Keep product capability/profile mapping outside `cats-runtime`.

## Non-Goals

- building a generalized plugin SDK or MCP registry
- moving `cats` product `skillProfile` resolution into runtime
- auto-executing scripts from skill packages
- forcing every backend to pretend it supports filesystem skills

## Contract Direction

### Session Request Shape

Keep the public request contract centered on explicit named skills:

```ts
interface RuntimeSkillManifest {
  profileId?: string;
  requestedSkills: string[];
  context?: RuntimeSkillManifestContext;
  strict?: boolean;
}
```

### Session Runtime State

Persist a runtime-owned resolved/applied contract per session:

```ts
interface SessionSkillState {
  profileId?: string;
  requestedSkills: string[];
  context?: RuntimeSkillManifestContext;
  resolvedSkills: ResolvedRuntimeSkill[];
  delivery: RuntimeSkillDeliveryState;
  warnings: string[];
  appliedSkillIds: string[];
  updatedAt: string;
}
```

Where delivery state captures:

- preferred mode for the active provider/backend
- actual mode applied (`filesystem` / `instructions` / `none`)
- whether the mode was applied, downgraded, or unsupported
- materialization metadata such as runtime paths or generated instruction files

### Runtime Errors

The first slice should make these request failures explicit:

- malformed `skills` payload -> `400`
- unknown requested skill -> `400`
- structurally invalid skill package -> `400`
- strict delivery request that cannot be honored -> `409` or `400` depending on
  whether the conflict is target capability or input structure

## Delivery Strategy

### Codex

- Preferred mode: `filesystem`
- Strategy: materialize runtime-managed skill packages into the session
  workspace under Codex's expected `.agents/skills/<name>/SKILL.md` shape
- Fallback: `instructions` when filesystem delivery is not safe or not
  possible

### Pi

- Preferred mode: `instructions`
- Strategy: compile skill instructions into a runtime-owned prompt file and
  pass it through Pi's `--append-system-prompt`
- Keep per-instance `instructions_file` support intact; merge runtime-managed
  skill instructions ahead of session/turn instructions

### API / Agent Backends

- Preferred mode: `instructions`
- Strategy: pass compiled skill instructions through the existing
  system-prompt / adapter instruction seams

### Unsupported Targets

- Preferred mode: `none`
- Strategy: preserve observability and warnings without pretending the target
  consumed the requested skills

## Planned Phases

### Phase 1: Freeze Core Skill Catalog and Validation

- [x] Replace the hard-coded catalog with discovery from `skills/`
- [x] Parse `SKILL.md` frontmatter with YAML
- [x] Validate required fields (`name`, `description`, non-empty body)
- [x] Normalize requested skill names and return explicit errors for malformed
      payloads, unknown skills, and invalid packages
- [x] Add 2-3 reference skills for runtime verification

**Primary files**:

- `src/core/skills/catalog.ts`
- `src/core/types.ts`
- `src/http/parsing.ts`
- `skills/*`

### Phase 2: Session Contract and Observability

- [x] Extend session skill state to distinguish requested, resolved, delivery,
      and applied metadata
- [x] Resolve skills during `POST /sessions`
- [x] Resolve or replace skills during `POST /sessions/{id}/messages`
- [x] Carry skill state through `POST /sessions/{id}/fork`
- [x] Surface skill metadata in `GET /sessions`, `GET /sessions/{id}`, and
      `GET /sessions/{id}/history`
- [x] Persist the expanded skill state through `SessionRegistry`

**Primary files**:

- `src/http/routes/sessions.ts`
- `src/http/routes/messages.ts`
- `src/http/routes/history.ts`
- `src/backends/cli/pool/SessionRegistry.ts`
- `src/backends/cli/pool/sessionView.ts`

### Phase 3: Backend Delivery and Materialization

- [x] Add a backend-neutral skill-delivery/materialization seam
- [x] Support Codex filesystem delivery
- [x] Support Pi instruction-file delivery
- [x] Pass compiled skill instructions through API and agent backends
- [x] Record delivery warnings and materialization metadata in session state
- [x] Keep unsupported targets explicit with `none`

**Primary files**:

- `src/core/skills/catalog.ts`
- `src/backends/cli/*`
- `src/backends/api/*`
- `src/backends/agent/*`
- `src/core/runtime/RuntimeSessionManager.ts`

### Phase 4: Tests and Docs

- [x] Add catalog validation tests
- [x] Add session/message error-path tests for malformed and unknown skills
- [x] Add Codex/Pi delivery tests that verify skills are actually applied
- [x] Update API and architecture docs for the public skill contract
- [x] Update `PROGRESS.md`, `README.md`, and `skills/README.md`

## Verification Targets

- `POST /sessions` accepts explicit skill manifests
- `POST /sessions/{id}/messages` can replace or augment session skill state
- unknown or malformed skills return clear client errors
- session inspection shows requested/resolved/applied skill metadata
- history surfaces the current runtime skill state
- Codex and Pi have at least one verified application path each

## Risks and Watchpoints

- Codex filesystem delivery may require workspace-local materialization; keep
  runtime-owned paths and cleanup behavior explicit
- Pi prompt-file layering must not regress the existing instance-level
  `instructions_file` behavior
- Shared CLI workers still rely on provider-specific spawn/turn seams, so keep
  the new skill contract backend-neutral but adapter-aware
- Do not let `skillProfile` leak in as a second source of truth for runtime
  skill resolution
