# PLAN-035: Cline Success-Path End-to-End Verification

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed — verified 2026-08-24 on Cline 3.0.57 (see Verification Result) |
| **Owner** | User |
| **Assigned To** | Unassigned |
| **Reviewer** | User |

## Related Spec

[SPEC-027: Grok, Devin, Cline, and Aider CLI Provider Onboarding](../specs/SPEC-027-grok-devin-cline-aider-cli-provider-onboarding.md)

## Why this exists

PLAN-034 enabled Cline execution behind the exact-version profile
`cline-cli-json-3.0.51`. One verification could not be completed: a **successful**
authenticated turn driven end to end. The probe account reached a zero credit balance
(`$-0.11`) mid-slice and has stayed there.

This is a deferred verification, not unfinished implementation. It is filed separately so
the gap stays visible rather than living only in a commit message.

## What is already verified

Do not redo these.

- **The adapter's argv is accepted by the real CLI.** Argument parsing happens before the
  model call, so a run reaching `agent_start` / `iteration_start` proves acceptance without
  spending credit. Confirmed against cline 3.0.51.
- **The runtime's spawn config resolves.** `buildProcessSpawnConfig` produces the `cmd.exe`
  proxy form on Windows and the real binary launches from it.
- **The failure path terminates correctly.** A non-completed `run_result` yields a terminal
  error carrying the cause. Verified live (commit `9fecb5e`).
- **The parser is fixture-backed** for text streaming, tool round trips, reasoning, denied
  tools, aborts, and provider refusals, from authenticated captures taken before the balance
  ran out.

## What is not verified

Only the success path, replayed through the runtime rather than from a stored fixture:

- Streamed text deltas arriving as incremental `text` events during a live turn.
- A live tool round trip producing paired `tool_use` / `tool_result`.
- `run_result` with `finishReason: "completed"` producing a `result` event whose usage
  reconciles against the live totals.
- That no `raw` events leak from a real successful turn.

## Precondition

The Cline account has positive credit. Check cheaply:

```
cline --json "Reply with exactly: OK"
```

A balance error means this plan is still blocked. Do not proceed by switching the account to
a different provider with `-P` / `-k`: that would verify a different execution path from the
one the runtime configures.

## Procedure

Drive the adapter's own argv through the runtime's own spawn config into the real binary,
then feed every stdout line back through the adapter's parser. The point is to exercise the
assembled invocation, not a hand-written command line.

```js
// against build/runtime/**
const provider = new ClineProvider(verifiedProfile);      // exact 3.0.51 profile
provider.prepareEphemeralTurn({ message });
const args = provider.buildSpawnArgs({ cwd, permissionMode });
const spawnConfig = buildProcessSpawnConfig(
  { path: 'cline', runner: 'auto', runtime: { mode: 'native' } },
  'cline', args, cwd,
);
// spawn(spawnConfig.command, spawnConfig.args, { shell: spawnConfig.shell, ... })
// then: provider.parseStreamLine(line) for each stdout line
```

Run three turns in a scratch directory:

1. **Text only** — `permissionMode: 'skip'`, prompt `Reply with exactly: OK`.
2. **Tool use** — `permissionMode: 'skip'`, a prompt that forces a file read.
3. **Denied tools** — `permissionMode: 'default'`, the same tool prompt.

Read stdout and stderr **separately**. They are different streams and merging them is what
hid the defect fixed in `9fecb5e`.

## Pass criteria

- Turn 1: concatenated `text` events equal the assistant's reply; exactly one `result`;
  `result.usage.inputTokens` and `outputTokens` match `run_result.aggregateUsage`; no `raw`
  events.
- Turn 2: one `tool_use` and one matching `tool_result` sharing a `toolId`, plus text.
- Turn 3: `tool_result` entries carry `isError: true`, and the turn ends with a terminal
  error rather than a `result`.
- All three: no `raw` events, and the reported usage never exceeds
  `run_result.aggregateUsage` (the per-iteration `usage` events are cumulative and must not
  be summed).

## If it fails

The exact-version compatibility profile is the containment: only 3.0.51 can execute at all.
If the success path disagrees with the fixtures, prefer narrowing
`ClineProvider.capabilities` or reverting execution to a refusal over patching the parser to
match a single observed run. Capture the divergence as a new fixture first.

## Verification Result

Verified 2026-08-24. The account has credit again, so the deferred success path was
finally driven end to end.

**Read this first: the verification ran on Cline 3.0.57, not 3.0.51.** The two versions
were both admitted to the compatibility baseline that day, and 3.0.57 is what is installed
here. Where its behavior differs from what this plan encoded, the difference is called out
below rather than papered over.

### How it ran

Not through the hand-assembled snippet in the Procedure section. The runtime's own
provider-evolution entrypoint drives the same adapter, spawn config, and parser:

```
cats-runtime --probe-provider-evolution --probe-provider cline --probe-profile manual_tool
```

`manual_tool` was added for this: `manual_smoke` puts its tool prompt on turn two, and
Cline declares `resume: false`, so turn two fails at any version and the tool path was
unreachable. The single-turn profile folds text and tool observation into turn one.

### Success path — verified

From the probe artifact (`permissionMode: 'skip'`, one turn, 35 events):

- Streamed text deltas arrived as incremental `text` events — 8 of them, not one block.
- A live tool round trip produced paired `tool_use` / `tool_result`, one each.
- `run_result` reported `finishReason: "completed"` and produced exactly one `result`.
- **No `raw` events**: raw passthrough 0, unknown 0, schema failures 0.

Usage reconciles against the captured stream
(`docs/research/fixtures/cline-3.0.57/tool-use.success.redacted.ndjson`):
`run_result.aggregateUsage` is `{ inputTokens: 9469, outputTokens: 88 }`, matching the
running totals on the last per-iteration `usage` event (`totalInputTokens` 9469,
`totalOutputTokens` 88). The adapter ignores those cumulative events and reads
`aggregateUsage`, so nothing is double counted.

### Denied tools — verified, with one behavior change

Run with the runtime's own `default` mode argv (`--auto-approve false`), captured at
`docs/research/fixtures/cline-3.0.57/tool-denied.completed.redacted.ndjson`:

- The tool **is** refused. `tool_result` carries `isError: true` and the text
  `Tool approval requires an interactive session, but this session is non-interactive.`
  Nothing ran, and nothing was written to disk.
- No `raw` events.
- **The turn no longer aborts.** 3.0.51 returned `finishReason: "aborted"` and this plan's
  pass criteria expected a terminal error. 3.0.57 returns `completed`: the agent answers
  without the tool and the adapter emits a normal `result` alongside the errored
  `tool_result`. Hosts that treated a denied tool as a failed turn will see a successful
  turn carrying a flagged tool error instead.

A separate check worth recording, because it is easy to get wrong when reproducing this by
hand: omitting `--auto-approve` entirely is **not** the same as `--auto-approve false`. With
the flag omitted, 3.0.57 executed `run_commands` and created a file through the `editor`
tool without approval. The runtime always passes the explicit `false`
(`appendClinePermissionArgs`), so its `default` mode still denies — but a hand-run
reproduction that drops the flag will look like a permission hole that the runtime does not
have.

### Not covered

- The contract change found alongside this: 3.0.57 streams tool output through
  `content_update`, which the 3.0.51 parser dropped as unknown. Handled separately in
  `docs/research/2026-08-24-grok-cline-version-drift-probe.md`.
- Multi-turn behavior. Cline still cannot resume, so a runtime session is one turn.

## Related

- [PLAN-034: Grok, Devin, Cline, and Aider CLI Provider Onboarding](./PLAN-034-grok-devin-cline-aider-cli-provider-onboarding.md)
- [SPEC-027](../specs/SPEC-027-grok-devin-cline-aider-cli-provider-onboarding.md), [ADR-033](../decisions/033-adopt-grok-devin-cline-aider-as-cli-provider-families.md)
- `docs/research/2026-08-08-cline-cli-probe.md` — the full 3.0.51 contract, including the
  stdout/stderr split
- cats-platform PLAN-103 — the other deferred verification from this slice

---

*Created: 2026-08-09*
*Author: User, with Claude support*
