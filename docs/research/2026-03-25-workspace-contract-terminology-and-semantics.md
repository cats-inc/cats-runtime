# Research Log: Workspace Contract Terminology and Semantics

Date: 2026-03-25
Topic: Rename and normalize runtime workspace contract terminology
Last updated: 2026-03-25

## Sources

- Internal type review: `src/core/types.ts`
- Internal API review: `docs/api.md`
- Internal architecture review: `docs/architecture.md`
- Internal MCP schema review: `src/mcp/tools.ts`
- Internal workspace/session review: `src/core/workspace/sessionWorkspace.ts`, `src/core/runtime/RuntimeSessionManager.ts`, `src/core/runtime/sessionMaintenance.ts`
- Internal CLI persistence/workspace review: `src/backends/cli/pool/SessionRegistry.ts`, `src/backends/cli/pool/workspace.ts`
- Internal peer execution contract review: `src/core/peers/types.ts`
- Product/runtime integration review: `cats/src/products/chat/state/runtime-session/`
- Human review feedback from parallel agent discussion (Gemini, Claude, Codex)

## Summary

`cats-runtime` currently mixes two different ideas into overlapping names:

- where a session executes
- whether the runtime may mutate that workspace

Today this shows up as:

- `workspaceMode = 'isolated' | 'shared' | 'read_only'`
- `workspaceIsolation = 'shared' | 'isolated' | 'worktree'`

This is a design smell, not just an awkward name choice. One enum mixes
topology with access rights, while the other is already topology-only. The
runtime then needs bridge logic to derive one from the other.

The proposed cleanup is to replace the current public/internal terminology with
two orthogonal dimensions:

- `workspaceKind = 'source' | 'sandbox' | 'worktree'`
- `workspaceAccess = 'read_write' | 'read_only'`

This removes the overloaded `shared`/`isolated` wording and makes the contract
describe exactly two things:

1. what workspace surface the session is using
2. what write capability the runtime has against that surface

## Current Problem

The existing contract causes several recurring confusions:

1. `shared` appears in both `workspaceMode` and `workspaceIsolation`, but means
   different things depending on context.
2. `isolated` appears once as a mode and once as a topology.
3. `read_only` lives in the same enum as `shared` and `isolated`, even though
   it is an access restriction rather than a workspace topology.
4. `workspaceIsolation` is overloaded across the codebase:
   - request/branch inputs use it as an enum
   - persisted session state uses it as an object
5. Upper layers can easily infer the wrong semantics, especially around:
   - rooms with no explicit `cwd`
   - runtime-owned sandbox directories
   - whether a room now has a shared workspace authority

## Proposed Terminology

### `workspaceKind`

`workspaceKind` describes the workspace surface the runtime session is actually
bound to.

- `source`
  - the session runs directly in the caller-provided authoritative `cwd`
- `sandbox`
  - the session runs in a runtime-owned sandbox directory
  - for example `~/.cats-runtime/sessions/{sessionId}`
- `worktree`
  - the session runs in a runtime-owned Git worktree derived from an
    authoritative source workspace
  - this requires a caller-provided `cwd` inside a Git repo
  - the runtime still performs normal local file I/O, but against a derived
    worktree path rooted under the runtime session base directory rather than
    directly against the source repo

### `workspaceAccess`

`workspaceAccess` describes the runtime/agent mutation rights against the
selected workspace surface.

- `read_write`
  - the runtime may mutate the workspace surface
- `read_only`
  - the runtime may read but must not mutate the workspace surface

`workspaceAccess` stays named at the workspace layer. It does not need to be
renamed to `agentAccess`, because `workspaceKind` and `workspaceAccess` are
meant to describe one contract together.

## Mapping from Current Terms

The old terms do not map one-to-one, which is part of the problem. The intended
conceptual mapping is:

| Current term | Current value | Proposed meaning |
|--------------|---------------|------------------|
| `workspaceMode` | `isolated` | session should resolve to `workspaceKind=sandbox` |
| `workspaceMode` | `shared` | session should resolve to a caller-owned writable workspace, usually `workspaceKind=source` or `workspaceKind=worktree` plus `workspaceAccess=read_write` |
| `workspaceMode` | `read_only` | `workspaceAccess=read_only` |
| `workspaceIsolation` | `shared` | `workspaceKind=source` |
| `workspaceIsolation` | `isolated` | `workspaceKind=sandbox` |
| `workspaceIsolation` | `worktree` | `workspaceKind=worktree` |

The important point is that `read_only` should not live in the same conceptual
enum as `source`/`sandbox`/`worktree`.

For the `workspaceMode=shared` row above, the resolved kind depends on whether
worktree isolation/override was requested. That ambiguity is part of why the
current `shared` wording should be retired rather than preserved.

## Resolution Model

`workspaceKind` should be treated as the resolved runtime value, not
necessarily the first thing upper layers ask users to choose directly.

Recommended session-creation shape:

- `cwd?: string`
- `workspaceAccess?: 'read_write' | 'read_only'`
- `workspaceKindOverride?: 'source' | 'sandbox' | 'worktree'`

Recommended resolved session state:

- `workspace.kind`
- `workspace.access`
- `workspace.runtimeCwd`
- `workspace.sourceCwd?`
- `workspace.worktree?`

Recommended default resolution:

- `cwd` present, no override:
  - `workspaceKind=source`
  - `workspaceAccess=read_write`
- `cwd` absent, no override:
  - `workspaceKind=sandbox`
  - `workspaceAccess=read_write`
- explicit override:
  - honor the override after validation

## Semantics for Rooms vs Sessions

This cleanup should also clarify a product/runtime boundary:

- room shared `cwd` is a room-level product concept
- `workspaceKind` / `workspaceAccess` are runtime session concepts

This matters for rooms created without an explicit working directory.

If a room is created without a `cwd`:

- the runtime may create a session sandbox
- that sandbox path is a session-local execution surface
- it does not automatically become the room's authoritative shared `cwd`

In other words, a runtime-owned sandbox is not evidence that the room now has a
shared source workspace.

## `sandbox + read_only`

`sandbox + read_only` should be allowed, even though it is less common.

Useful corner case:

- the user wants an isolated runtime-owned workspace
- the user does not want agents to mutate it
- the user manually seeds files into the sandbox through trusted UI affordances
  such as file-browser actions or imports
- agents then process those files in read-only mode

This means:

- `workspaceAccess=read_only` governs runtime/agent mutation rights
- it does not imply a global OS-level lock against trusted human-initiated file
  injection into a runtime-owned sandbox

## Upload and Import Semantics

To keep the contract coherent:

- `source + read_only`
  - user uploads should not silently write into the source workspace
  - uploads should land in runtime-owned staging/artifact space unless the user
    explicitly promotes them through a write-capable flow
- `worktree + read_only`
  - same rule as `source + read_only`
- `sandbox + read_only`
  - trusted UI flows may seed files into the sandbox
  - agents still remain read-only

Upload/import is therefore not a hidden permission override. It is either:

- artifact ingress into runtime-owned staging, or
- trusted human seeding of a runtime-owned sandbox

## Validation Expectations

Recommended validation rules:

- `workspaceKind=source` requires `cwd`
- `workspaceKind=worktree` requires `cwd`
- `workspaceKind=worktree` also requires that `cwd` resolve inside a Git repo
- `workspaceKind=sandbox` does not require `cwd`
- `workspaceAccess=read_only` must be enforced in runtime mutation paths
- `workspaceAccess=read_only` must not be silently upgraded by uploads,
  message routes, or tool execution

## Migration Guidance

This should not be implemented as a mechanical repository-wide search/replace.

Why:

- `shared` appears in many unrelated contexts:
  - peer shared secrets
  - shared runtime UI foundation
  - shared contracts
  - shared diagnostics/read models
- `workspaceIsolation` currently names both enum-like request inputs and
  structured persisted state

Recommended migration discipline:

1. change the core type model first
2. update request/response schemas intentionally
3. follow compile errors through runtime logic
4. update tests and fixtures
5. update docs last

Search should be used to audit affected code paths, not to batch-rewrite
strings blindly.

## Suggested Next Step

If the terminology direction is accepted, the next formal artifact should be:

- an ADR that records the rename and semantic split
- followed by a phased implementation plan that keeps `cats` and other
  consumers backward-compatible during migration
- a follow-up alignment pass for peer-routing terminology, because the current
  peer contract uses a separate `PeerExecutionWorkspaceMode = 'none' | 'read_only'`
  vocabulary that should not drift further away from the main session/workspace
  model
