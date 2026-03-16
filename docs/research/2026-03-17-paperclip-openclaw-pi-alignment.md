# 2026-03-17: Paperclip Alignment Notes for OpenClaw and Pi

## Purpose

Capture the direct comparison between:

- `cats-runtime` as it exists today
- `paperclip`'s adapter layer for `openclaw_gateway` and `pi_local`

The goal is to answer two practical design questions:

1. Should `OpenClaw` fit into `cats-runtime` as `cli`, `api`, or a new backend?
2. Where should `Pi CLI` land, and what should its integration look like?

## Sources

Local source files reviewed:

- [paperclip/packages/adapter-utils/src/types.ts](../../../paperclip/packages/adapter-utils/src/types.ts)
- [paperclip/server/src/adapters/registry.ts](../../../paperclip/server/src/adapters/registry.ts)
- [paperclip/packages/adapters/openclaw-gateway/src/server/execute.ts](../../../paperclip/packages/adapters/openclaw-gateway/src/server/execute.ts)
- [paperclip/packages/adapters/openclaw-gateway/README.md](../../../paperclip/packages/adapters/openclaw-gateway/README.md)
- [paperclip/packages/adapters/pi-local/src/server/execute.ts](../../../paperclip/packages/adapters/pi-local/src/server/execute.ts)
- [paperclip/packages/adapters/pi-local/src/server/models.ts](../../../paperclip/packages/adapters/pi-local/src/server/models.ts)
- [paperclip/packages/adapters/pi-local/src/server/parse.ts](../../../paperclip/packages/adapters/pi-local/src/server/parse.ts)
- [paperclip/server/src/services/heartbeat.ts](../../../paperclip/server/src/services/heartbeat.ts)
- [cats-runtime/src/core/types.ts](../../src/core/types.ts)
- [cats-runtime/src/core/runtime/RuntimeSessionManager.ts](../../src/core/runtime/RuntimeSessionManager.ts)
- [cats-runtime/src/backends/api/runtime/ApiBackendManager.ts](../../src/backends/api/runtime/ApiBackendManager.ts)

## Executive Summary

- `OpenClaw Gateway` is not a good fit for `cats-runtime`'s current `api`
  backend. It is an external agent runtime and should push the introduction of
  `src/backends/agent`.
- `Pi CLI` is not a good fit for `src/backends/agent`. It is a local CLI
  runtime with subprocess/session-file semantics and should remain a `cli`
  backend integration.
- Paperclip's `heartbeat` service contains useful invocation metadata ideas, but
  not a runtime control model worth porting wholesale into `cats-runtime`.

## Finding 1: Paperclip's Adapter Contract Is Broader Than `cats-runtime`

Paperclip's adapters expose a contract centered on `execute(ctx)`,
`testEnvironment(ctx)`, optional `sessionCodec`, optional `listModels`, and a
shared `AdapterExecutionResult`. See
[types.ts](../../../paperclip/packages/adapter-utils/src/types.ts#L174).

That contract is intentionally broad enough to host:

- local subprocess adapters such as `pi_local`
- protocol adapters such as `openclaw_gateway`
- plain process/http fallbacks

`cats-runtime` is stricter. Today it routes only into:

- `WorkerPool` for CLI sessions
- `ApiBackendManager` for completion-style API/local sessions

See [RuntimeSessionManager.ts](../../src/core/runtime/RuntimeSessionManager.ts#L77).

That is why `OpenClaw` feels awkward: it does not match either of the two
current execution shapes.

## Finding 2: OpenClaw Gateway Behaves Like an External Agent Runtime

Paperclip's OpenClaw adapter:

- negotiates a WebSocket gateway connect flow
- authenticates with headers, tokens, device auth, and optional pairing
- computes a `sessionKey`
- sends an `agent` request
- waits on `agent.wait`
- consumes `event agent` frames for assistant/lifecycle/error streams

See
[execute.ts](../../../paperclip/packages/adapters/openclaw-gateway/src/server/execute.ts#L1057).

This is not "chat completion with tools". It is "invoke a remote agent runtime".

### Why It Does Not Belong in `src/backends/api`

`cats-runtime`'s `ApiBackendManager` assumes:

- chat-style `messages`
- local tool definitions
- per-turn completion
- transcript replay or provider continuation ids

See [ApiBackendManager.ts](../../src/backends/api/runtime/ApiBackendManager.ts#L198).

OpenClaw does not naturally conform to that shape. Forcing it in would create:

- fake `messages -> agent payload` translation
- awkward session-key plumbing inside a completion-oriented manager
- confusing ownership between runtime transcript and provider-managed session
  state

### Recommended OpenClaw Positioning

OpenClaw should be the first implementation target for `src/backends/agent`.

That backend should specifically model:

- provider-managed session keys
- agent-native event streaming
- external run lifecycle
- optional runtime-service metadata returned by the remote agent

## Finding 3: Pi CLI Is a Strong `cli` Candidate, Not an `agent` Candidate

Paperclip's `pi_local` adapter is a normal subprocess integration with some
polish:

- it launches `pi`
- chooses model/provider from a `provider/model` string
- resumes with a local session file
- injects local skills
- reads a local instructions file
- parses Pi JSONL output back into normalized transcript data

See
[execute.ts](../../../paperclip/packages/adapters/pi-local/src/server/execute.ts#L99)
and
[models.ts](../../../paperclip/packages/adapters/pi-local/src/server/models.ts#L149).

### Why Pi Belongs in `src/backends/cli`

Pi's execution model is still:

- local command
- local environment
- local cwd
- local session file
- local stdout/stderr JSONL stream

That matches existing `cli` backend assumptions far better than it matches a
future `agent` backend.

### Recommended Provider Family

Use product naming and keep the family name as `pi`.

Recommended future topology shape:

```yaml
routing:
  providers:
    pi:
      default_target:
        backend: cli
        instance: native

backends:
  cli:
    providers:
      pi:
        instances:
          native:
            environment: native
            command: pi
            runner: auto
            sessions_dir: ~/.pi/paperclips
```

Notes:

- Keep product naming consistent with `claude`, `codex`, `gemini`.
- Do not call the family `xai`, `grok`, or another vendor/model alias.

## Detailed Pi Integration Recommendations

### 1. File Layout

Recommended layout:

```text
src/backends/cli/
  pi/
    models.ts
    parser.ts
    sessionCodec.ts
  providers/
    pi.ts
```

Rationale:

- `providers/pi.ts` should own spawn args and stream-event mapping, like the
  existing CLI providers.
- `pi/` should host the heavier helper logic: model discovery, JSONL parsing,
  and session file helpers.

### 2. Model Handling

Pi expects model selection in `provider/model` form, then splits it into:

- `--provider <provider>`
- `--model <model>`

Paperclip does that in
[execute.ts](../../../paperclip/packages/adapters/pi-local/src/server/execute.ts#L110).

Recommendation for `cats-runtime`:

- session creation should accept `model: "provider/model"`
- config default model should use the same shape
- validation should fail fast if the slash-delimited format is missing
- add a model discovery helper that shells out to `pi --list-models`

### 3. Session Semantics

Pi session continuity is file-based. Paperclip stores session files under
`~/.pi/paperclips` and resumes with `--session <path>`.

Recommendations for `cats-runtime`:

- treat Pi as a subprocess-backed `cli` provider with explicit session file
  ownership
- persist both session file path and cwd in session metadata
- only resume when saved cwd and requested cwd are compatible
- when Pi reports "unknown session", drop the saved session pointer and retry
  once with a fresh session, mirroring Paperclip's behavior

This is more similar to `codex`/`opencode` resume logic than to `OpenClaw`.

### 4. Prompt Layering

Paperclip's Pi integration is better than a naive "send user text only" model.
It layers:

- optional instructions file contents
- bootstrap prompt
- session handoff text
- heartbeat/user prompt

See
[execute.ts](../../../paperclip/packages/adapters/pi-local/src/server/execute.ts#L241).

Recommendations for `cats-runtime`:

- support an optional instructions file path in the Pi instance config or
  session create payload
- preserve existing `model` override behavior
- add optional bootstrap or handoff prompt support only if the runtime starts
  needing session rotation for long-lived Pi sessions

The simplest MVP is:

- `model`
- optional `instructions_file`
- optional `extra_args`

### 5. Tooling Strategy

Pi already ships its own tool set:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

Paperclip passes these directly via Pi CLI flags. See
[execute.ts](../../../paperclip/packages/adapters/pi-local/src/server/execute.ts#L332).

Recommendation for `cats-runtime`:

- do not wrap Pi inside the runtime-hosted local tool loop
- let Pi use its native tools as a CLI session
- continue using runtime-hosted tools only for `api/local` backends

This keeps the backend split honest.

### 6. Skills and Instructions

Paperclip injects skill symlinks into `~/.pi/agent/skills`. See
[execute.ts](../../../paperclip/packages/adapters/pi-local/src/server/execute.ts#L53).

Recommendation for `cats-runtime`:

- do not copy this behavior blindly
- only add Pi skill injection if `cats-runtime` first gains its own explicit
  notion of runtime-managed skills
- until then, keep Pi integration focused on command/model/session handling

This avoids introducing hidden filesystem side effects that other CLI providers
do not currently have.

### 7. Environment and Auth

Paperclip supports arbitrary env injection and model availability probing before
execution.

Recommendations for `cats-runtime`:

- add optional per-instance env bindings only if multiple users truly need them
- otherwise prefer inherited shell env for provider auth
- add a dedicated Pi model probe endpoint or reuse a generic CLI model listing
  helper

### 8. Testing

Recommended Pi test coverage in `cats-runtime`:

- config parsing for Pi instances
- model format validation
- `pi --list-models` parser
- JSONL transcript parser
- resume behavior with cwd match/mismatch
- unknown-session fallback to fresh session

## Heartbeat Takeaway

Paperclip's heartbeat service is useful mainly as a reminder that external
agent-style runtimes benefit from structured invocation context.

What to keep:

- wake reason
- task/comment/approval identifiers
- workspace context
- session handoff metadata if rotation is ever introduced

What not to keep:

- scheduler ownership
- run-store database model
- company workflow semantics
- budget/approval orchestration

## Actionable Conclusions

1. Add `src/backends/agent` for OpenClaw and future Agent SDK targets.
2. Keep Pi on the `cli` roadmap and do not conflate it with agent backend work.
3. Borrow only the useful heartbeat subset as structured invocation metadata.
4. Do not import Paperclip skill injection or company concerns into
   `cats-runtime`.

---

*Created: 2026-03-17*
*Author: Codex*
