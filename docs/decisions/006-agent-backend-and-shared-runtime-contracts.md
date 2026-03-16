# ADR 006: Introduce an Agent Backend and Shared Runtime Contracts

## Status

Accepted

## Date

2026-03-17

## Context

ADR 005 established a backend-neutral runtime facade so `cats-runtime` could
host both CLI and API/local execution behind one public HTTP contract.

The next integration target, OpenClaw Gateway, does not fit cleanly into either
existing execution family:

- it is not a local subprocess runtime like `cli`
- it is not a completion-oriented transport like `api`
- it owns more of the run/session lifecycle than API/local backends do
- it may return provider-managed continuity state, runtime metadata, and
  external event streams

At the same time, the current public session contract is still missing three
useful backend-neutral concepts that should not be invented in an OpenClaw-only
way:

- a caller-visible logical session identity
- a structured bootstrap/invocation context contract
- generic output/artifact surfacing for non-code workflows

Recent planning also clarified that `cats-runtime` should stay useful for more
than coding agents. Many sessions will produce reports, documents, slide decks,
or other artifacts that are not naturally modeled as Git worktrees.

## Decision

`cats-runtime` will introduce a first-class `agent` backend kind and, before
deep adapter-specific work begins, will establish shared runtime contracts for
session affinity, bootstrap context, and output/artifact surfacing.

This decision includes:

1. `agent` is a separate backend kind, not a subtype of `api`.
2. OpenClaw is the first forcing-function adapter for `src/backends/agent`.
3. Pi remains a `cli` integration because its execution model is still local
   subprocess + local session files.
4. The runtime will define a caller-visible logical session identity named
   `sessionKey`.
5. Callers may provide `sessionKey`; when omitted, the runtime may return an
   opaque generated key for later reuse.
6. Reuse behavior must be explicit through request policy. It must not be
   inferred from `group`, `cwd`, or provider-native continuity state.
7. `providerSessionId` and related provider state remain backend-owned
   continuity pointers, not the caller-facing identity of the session.
8. When provider resume fails because a provider session is expired, unknown, or
   otherwise invalid, the runtime preserves logical session identity and
   runtime-owned transcript/context, clears the provider continuity pointer, and
   retries via fresh provider session creation when appropriate.
9. Bootstrap context remains backend-neutral and may carry `message`,
   optional `instructions`, structured `context`, and future metadata without
   requiring provider-specific prompt hacks.
10. Output/artifact surfacing remains generic through concepts such as
    `outputDir` and artifact metadata. Git-specific workspace materializers such
    as `git_worktree` are optional future implementations, not prerequisites.

## Rationale

- keeps the external runtime category separate from completion-oriented APIs
- avoids letting the first OpenClaw adapter define public session semantics by
  accident
- preserves a stable, reusable continuity model for upstream apps
- makes runtime outputs useful for non-code workflows, not just coding agents
- keeps provider-native continuity tokens clearly subordinate to runtime-owned
  session identity

## Consequences

### Positive

- OpenClaw and future Agent SDK integrations have a dedicated backend seam
- session continuity can be expressed consistently across backends
- bootstrap/invocation metadata becomes reusable instead of provider-specific
- output tracking can support reports, documents, media, and code artifacts
  with one contract
- Git-specific workspace behavior is deferred until a real cross-consumer need
  exists

### Negative

- Phase 1 planning and implementation scope becomes broader because shared
  runtime contracts must be defined before the first adapter lands
- create/resume semantics become more explicit and may require additional
  request fields such as reuse policy
- session models and history surfaces will need to carry more metadata than
  today

### Neutral

- some CLI and API backends may not use every new field immediately, but the
  shared contract still applies to them

## Alternatives Considered

### Alternative 1: Treat OpenClaw as Another `api` Backend

- **Pros**: fewer new folders and fewer new backend kinds
- **Cons**: completion-oriented runtime code would absorb a second, remote-agent
  orchestration model
- **Why rejected**: it would distort `api` semantics and encourage
  OpenClaw-specific branching in shared paths

### Alternative 2: Build OpenClaw First, Then Generalize Contracts Later

- **Pros**: faster first adapter delivery
- **Cons**: the first adapter would implicitly define session/bootstrap/output
  semantics for the rest of the runtime
- **Why rejected**: it would likely bake OpenClaw-specific assumptions into the
  public contract and increase later rework

### Alternative 3: Make Git Worktrees the Default Workspace Story

- **Pros**: strong coding workflow for repository-based agents
- **Cons**: overfits the runtime to code-generation scenarios and excludes many
  report/document/media workflows
- **Why rejected**: `cats-runtime` needs a backend-neutral output contract
  before it needs a Git-specific workspace materializer

## References

- [ADR 005: Introduce a backend-neutral runtime facade for CLI and API backends](./005-backend-neutral-runtime-and-api-backend.md)
- [SPEC-003: Agent Backend for External Agent Runtimes](../specs/SPEC-003-agent-backend.md)
- [PLAN-004: Agent Backend for OpenClaw and Future Agent SDK Runtimes](../plans/PLAN-004-agent-backend.md)
- [2026-03-17 Paperclip alignment notes for OpenClaw and Pi](../research/2026-03-17-paperclip-openclaw-pi-alignment.md)

---

*Decision made: 2026-03-17*
*Decision makers: Codex + user direction*
