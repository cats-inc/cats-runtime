# Cline CLI Probe — 3.0.51

Date: 2026-08-08
Scope: SPEC-027 / PLAN-034 Phase 1 for the `cline` provider family.
Host: Windows 11, `cline@3.0.51` installed globally from npm at `~/.npm-global/cline`.
Account: signed in, provider `cline`, model `anthropic/claude-opus-5`.

All findings below come from live runs on this host. Nothing here is inferred from
documentation or from other providers.

## Install tier

- npm package `cline`, binary `cline`. Matches the `environment-bootstrap` npm AI-CLI set (`d131535`).
- `cline --version` → `3.0.51` (bare version string, no prefix).
- Config directory `~/.cline` (`--config`), state under `~/.cline/data` (`--data-dir`),
  hooks under `~/.cline/hooks`.
- No credential file was present before `cline auth`; authentication is interactive
  (`cline auth [provider]`) with a `-k/--apikey` non-interactive override.
- No provider-specific auth env var was observed. `-k/--key` is a per-run override, not a
  persisted credential. `auth.envVars` is therefore left empty rather than guessed.
- No documentation URL was verified during this probe, so install knowledge falls back to
  the npm package page. Replacing it with the official docs URL is a follow-up.

### Windows support

`environment-bootstrap` describes Cline's CLI as a macOS/Linux preview, and PLAN-102
guardrail 11 held packaged Windows support back on that basis. **This probe contradicts
that for the runtime tier**: `cline --version`, `--help`, `--json` execution, tool calls,
and `history --json` all work on Windows 11 with 3.0.51.

This is evidence for the runtime install/check tier only. Whether `cats-platform` ships a
packaged Windows helper is a separate call under PLAN-102, and the upstream support
statement still stands as the vendor's own position.

## Execution contract — `--json`

`cline --json <prompt>` emits NDJSON on stdout. Every line carries `ts` and `type`.

Top-level `type` values observed:

- `hook_event` — `hookEventName` ∈ {`agent_start`, `tool_call`, `tool_result`, `agent_end`},
  with `agentId`, `taskId`, `parentAgentId`.
- `agent_event` — wraps a nested `event` object (see below).
- `run_result` — terminal summary.
- `error` — `{ ts, type: "error", message }`.

Nested `agent_event.event.type` values observed:

- `iteration_start` — `{ iteration }`
- `content_start` — **used for both text and tool content**, discriminated by `contentType`:
  - `contentType: "text"` — `{ text }`, the incremental delta.
  - `contentType: "tool"` — `{ toolCallId, toolName, input }`.
- `content_end` —
  - `contentType: "text"` — `{ text }`, the **complete** text for that block.
  - `contentType: "tool"` — `{ toolCallId, toolName, output }` where `output` is an array of
    `{ query, result, success }`.
- `usage` — `{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost,
  totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheWriteTokens, totalCost }`
- `iteration_end` — `{ iteration, hadToolCalls, toolCallCount }`
- `done` — `{ reason, text, iterations, usage }`

`run_result` carries `{ finishReason, iterations, usage, aggregateUsage, durationMs, text,
model: { id, provider, info: { … } } }`.

### Traps the parser must handle

These are the reasons a naive line-to-event mapping would be wrong:

1. **Text is emitted four times.** The same assistant text appears as `content_start`
   deltas, again complete in `content_end`, again in `done.text`, and again in
   `run_result.text`. Emitting on every occurrence quadruples the message.
2. **`accumulated` is not always present.** The first probe run emitted
   `content_start` with both `text` and `accumulated`; the second run emitted `text` only.
   A parser that keys on `accumulated` breaks non-deterministically.
3. **`content_start` is not a "start" marker.** For text it is the delta chunk itself, and
   several arrive per block. The name does not match the semantics.
4. **`usage` is cumulative, not incremental.** Each event carries both per-call (`inputTokens`)
   and running-total (`totalInputTokens`) fields. Summing the per-call fields across events
   double counts against `run_result.aggregateUsage`.
5. **Tool identity lives on `content_start`/`content_end`, not on the `hook_event`s.** The
   `tool_call` / `tool_result` hook events carry no tool name or id, only agent/task ids.

## Session identity and resume — **resume is unavailable**

Three different ids appear, and they are not interchangeable:

- `agentId` — `agent_<epochMs>_<rand>`, per agent (subagents carry `parentAgentId`).
- `taskId` — `conv_<epochMs>_<rand>`, emitted throughout the stream.
- `sessionId` — `<epochMs>_<rand>`, **no prefix**, and the only id `cline history` reports.

**The `--json` stream never emits the `sessionId`.** Correlating a run to its stored session
requires reading `cline history --json` and matching on `cwd` / `startedAt` / `pid` — the
same shape `JunieProvider` already handles for Junie's `index.jsonl`.

More importantly, resume does not work at all in machine-readable mode. Passing `--id`
together with `--json` fails with a misleading error:

```
{"ts":"…","type":"error","message":"JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)"}
```

Isolated and confirmed:

- `cline --json -m anthropic/claude-opus-5 "say HI"` → succeeds.
- `cline --json --id <valid-sessionId> "say HI"` → fails.
- `cline --json --id bogus_does_not_exist "say HI"` → fails identically.
- Prompt before `--id`, and piped stdin instead of a positional prompt → both fail.

The failure is triggered by the presence of `--id` and is independent of whether the id is
valid, so it is an upstream argument-handling defect rather than a lookup miss. Therefore
`ClineProvider.capabilities.resume` is `false` at 3.0.51, and must stay false until a
version is probed where `--id` and `--json` compose.

## Session storage

`cline history --json` returns an array with `sessionId`, `status`, `exitCode`, `cwd`,
`workspaceRoot`, `provider`, `model`, `prompt`, `usage`, `aggregateUsage`, and
`messagesPath` → `~/.cline/data/sessions/<sessionId>/<sessionId>.messages.json`.

A readable transcript therefore exists, so history import is feasible later. It is out of
scope for this slice and no scanner is added.

Note: the history record embeds the full system prompt under `metadata.systemPrompt`. Any
future import path must treat these records as potentially large and not log them verbatim.

## Models

There is no model-enumeration subcommand. The only id observed is
`anthropic/claude-opus-5`, which is the model this account happens to have configured, not
a catalog. The runtime therefore bundles **no** Cline model ids and exposes only the
`cline-default` sentinel. `-m/--model` and `-P/--provider` accept ids, so a user-curated
catalog remains possible.

## Not probed

- `--acp` (Agent Client Protocol mode). Cline advertises it; no ACP profile is added here.
  This is the most promising follow-up, since ADR-031 already houses an ACP adapter family.
- Cancellation / SIGTERM behavior mid-run.
- `--auto-approve false` interactive approval flow (needs a TTY).
- Plan mode (`-p/--plan`) stream differences.
- `--zen` background hub, `--worktree`, subagent (`parentAgentId`) streams.
- Authentication failure output, so `auth.errorPatterns` uses the generic set.

## Related

- SPEC-027 §7, Probe Items P2–P5
- PLAN-034 Phase 1
- ADR-033
