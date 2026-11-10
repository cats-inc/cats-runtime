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
   otherwise invalid, the runtime reports it as `provider_session_unavailable`,
   closes that Runtime session for good, and never spawns the stale native id
   again. It does not start a fresh provider session in place or inject context:
   the caller that owns the transcript continues in a new Runtime session.
   Amended 2026-11-11; see the amendment below for the contract and reasons.
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

## 2026-11-11 Amendment: Report a Lost Provider Session Instead of Replacing It

Rule 8 originally said the runtime would clear the provider continuity pointer
and retry with a fresh provider session "when appropriate". Only Pi ever did
that. Every other adapter kept the stale native id: a Cats Bot conversation on
Grok answered each turn for six hours with `No saved copy of session <id> was
found remotely`, because the error arrived inside an HTTP 200 stream and the
session went back to `ready`.

The amended contract:

- An adapter classifies its CLI's own "this native session cannot be resumed"
  answer only on a spawn that passed a resume id and before any assistant or
  tool output. It emits the stream `error` event with
  `code: "provider_session_unavailable"`. `text` is the provider's sentence, or
  for hosted ACP a Runtime-written summary of the JSON-RPC rejection. When the
  answer arrives during a turn, the run records `lastRun.errorCode`.
- Runtime then persists `providerSessionUnavailable` (observed time, the stale
  native id, that text) on the session record, sets the session to `closed`,
  and stops the worker. The marker survives a Runtime restart and a duplicate
  row merge.
- The worker pool refuses to spawn a marked session at all, which covers
  resume, MCP recycle, wakeup and native fork in one place.
- From then on `POST /sessions/:id/messages`, `POST /sessions/:id/resume` and
  an explicit native `POST /sessions/:id/fork` refuse with HTTP 410 and
  `{ "error": …, "code": "provider_session_unavailable" }`. The default fork
  mode falls back to a context transplant. Session controls report
  `canSend: false` and `canResume: false`, and `sessionKey` reuse skips the
  session. History stays readable.
- Some answers arrive at spawn time, not in a turn: Claude Code exits on
  startup, and hosted ACP rejects `session/resume` during initialization, both
  after `POST /sessions/:id/resume` has already returned. They produce no
  stream error and no `lastRun.errorCode`; the next send or resume gets the 410.
- `POST /sessions/:id/reset` clears the marker together with the stale native
  id. Nothing stale is left to spawn, so the never-respawn rule still holds.
- The caller that owns the product transcript creates a new Runtime session
  (`POST /sessions`) with the same `cwd` and supplies its own handoff context.

Why Runtime reports instead of replacing:

- Runtime does not hold the product transcript. Its per-session history covers
  one Runtime session, while a product conversation spans many; only the
  product can build the right handoff.
- Cats Desktop decides whether a turn needs a context transplant by whether the
  Runtime session id changed. Swapping the native session under an unchanged
  Runtime session id would make the next turn start with no context and no
  signal: silent amnesia.
- Under the `release` skill content profile, putting a different native id on
  the same Runtime session invalidates its skill provenance, so the next send
  would fail with 409 `skill_content_profile_conflict` anyway.

This also settles the earlier conflict with SPEC-040 R5, which already required
hosted ACP to reject incompatible native histories explicitly so the host could
use its own handoff path.

Classified answers, each captured live without a model turn:

- Grok 1.0.77 streaming JSON: `No saved copy of session <id> was found …` on
  stdout, then exit 1.
- Grok 1.0.77 hosted ACP: `session/resume` rejected with JSON-RPC -32603
  `Path not found.` and `data.code: FS_NOT_FOUND`.
- Claude Code 2.1.322: a `result` frame (`error_during_execution`,
  `is_error: true`) whose `errors` contain `No conversation found with session
  ID: <id>`, then exit 1 before reading input.
- Codex 0.167.0 app-server: `thread/resume` rejected with JSON-RPC -32600
  `no rollout found for thread id <id>`.

Other providers and methods, including hosted ACP `session/load`, stay
unclassified until a capture shows their answer; their resume failures remain
ordinary errors. The captures live under `tests/fixtures/provider-captures/`.

Pi's existing in-place recovery (`recoverPiUnknownSession` in
`src/http/routes/messages.ts`) still replaces the native session behind the
same Runtime session without context. It is a documented exception to revisit,
not a pattern for other adapters.

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
