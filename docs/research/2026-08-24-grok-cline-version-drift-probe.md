# Grok 1.0.5 and Cline 3.0.57 Version Drift Probe

Date: 2026-08-24

Policy update (2026-08-26): the fail-closed allowlist described below is
historical and was removed by
[ADR-035](../decisions/035-never-block-provider-execution-on-exact-cli-version.md).
Grok, Cline, and Antigravity now attempt the best-known adapter across forward
or unknown version drift. The probe evidence remains valid; the refusal policy
does not.

## Scope and conclusion

This note records the evidence behind admitting Grok CLI 1.0.5 and Cline CLI
3.0.57 to the supported compatibility baseline. Both were installed on a
Windows 11 development machine and reported `unsupported_version` against the
pins recorded in `src/core/compatibility/knowledge.ts`.

- Grok 1.0.5 replays cleanly through the 1.0.0 `grok-native-streaming-json`
  parser, with no adapter change needed.
- Cline 3.0.57 did change its contract, in the one place `manual_smoke` could
  never reach. Finding it needed a new single-turn probe profile; clearing it
  needed an adapter change.

Probes ran against a temp `CATS_RUNTIME_DIR`, never the operator's
`~/.cats/runtime`.

## Historical behavior: the pin was a whitelist, not a floor

At the time of this probe, `buildProfileSelection` compared the detected version with
`supportedVersions.includes(normalized)`
(`src/core/compatibility/ProviderCompatibilityService.ts:1617`), so a version
newer than the recorded baseline is refused exactly like an older one, and the
`upgrade_provider` remediation tells the operator to *upgrade* a CLI they have
already upgraded. That refusal was later rejected as policy, not merely
reworded, because version inequality is not evidence of an incompatible
invocation or stream contract.

Refusal is also self-referential for the evolution probe. `assertVerifiedProfile`
(`src/backends/cli/providers/grok.ts:307`, `src/backends/cli/providers/cline.ts:174`)
requires an `exact` profile before it will spawn, and the profile is chosen from
the same whitelist, so `--probe-provider-evolution` cannot observe a version it
has not already admitted:

```
"parserId": "grok-refusal",
"error": "Grok CLI execution requires the exact Grok 1.0.0 streaming-json compatibility profile."
```

Both providers below therefore had to be probed with the candidate version added to
`supportedVersions` first. Admitting a version to gather the evidence that
justified admitting it. ADR-035 removed that self-referential gate.

## Grok 1.0.5 — admitted

Detected `grok 1.0.5 (5115b46bc9)` at `~/.grok/bin/grok.exe`. Probe result:

- parser: `grok-native-streaming-json` (the verified 1.0.0 parser)
- normalized: 156 events — `progress` 110, `text` 44, `result` 2, `tool_use` 1,
  `tool_result` 1
- ignored as stream metadata: `available_commands` 7, `usage` 3
- unknown event types: 0; schema failures: 0; raw passthrough: 0

Every raw type the 1.0.5 CLI emitted mapped through the 1.0.0 contract, and the
observed families match `docs/research/fixtures/grok-1.0.0/`. `available_commands`
now advertises a larger tool and command list, which the adapter ignores.

Not covered by `manual_smoke`, and still recorded only for 1.0.0: auth-missing,
cancellation, fork, invalid-model, permission modes, tool failure, and
toolset-init errors.

## Cline 3.0.57 — first attempt, text path only

The first attempt returned no events at all:

```
[cline:stderr] {"type":"error","message":"cline requires re-authentication."}
```

After `cline auth`, turn 1 completed and turn 2 failed:

- normalized: 59 events — `progress` 53, `text` 5, `result` 1
- unknown event types: 0; schema failures: 0; raw passthrough: 0
- `tool_use` and `tool_result`: never observed
- turn 2: `Process exited with code 0 before responding`

The observed families (`iteration_start`, `iteration_end`, `content_end:*`,
`usage`, `done`, `hook_event:*`) are the same ones the 3.0.51 fixtures record as
`agent_event` subtypes, so nothing in the text path drifted.

At this point the tool path was unreachable, not intact. `manual_smoke` puts the tool prompt in
turn 2, and Cline declares `resume: false` (`src/backends/cli/providers/cline.ts:81`)
because passing `--id` alongside `--json` fails and the stream never emits a
resumable id. Turn 2 therefore fails for Cline at any version. The 3.0.51 pin
exists for tool-shaped quirks — the reasoning field name, object-shaped failed
tool output, cumulative usage — so clearing the text path alone is not evidence
for the surface at risk.

The `semantic_drift_suspected` classification on the second artifact is a
comparison artifact: the only prior baseline was the zero-event authentication
failure, so every observed type read as added.

## The single-turn tool profile, and what it found

`manual_tool` was added to `PROVIDER_EVOLUTION_PROBE_PROFILES`
(`src/core/compatibility/providerEvolutionProbe.ts:216`) so non-resumable
providers can exercise text and tools on one turn. Re-probing Cline 3.0.57 with
it reached the tool path and found real drift:

- `status: completed`, 1 turn, 263 events in 29.1 s
- `tool_use` 1 and `tool_result` 1 observed — the surface `manual_smoke` could
  never reach
- schema failures: 0; raw passthrough: 0
- **unknown: 3, all `agent_event:content_update`**

`content_update` appears nowhere in the 3.0.51 fixtures, and the adapter's event
switch handles `content_start` and `content_end` only
(`src/backends/cli/providers/cline.ts:258`). 3.0.57 uses it to stream tool
output — here, `run_commands` stdout chunks carrying the `probe-note.txt`
listing — so the runtime drops incremental tool output on the floor.

The turn contract itself survived: `tool_use`, `tool_result`, `text`, and
`result` all normalized correctly, and nothing mis-parsed. The loss was
mid-turn tool progress.

## Closing the gap and admitting 3.0.57

The adapter now handles `content_update`:

- `contentType: 'tool'` normalizes into a `tool` progress event carrying the
  chunk and its `stream` name, so hosts see command output as it arrives
- the empty chunks each stream opens with are ignored rather than emitted, since
  two of the three observed updates carried `chunk: ""`
- every other content type stays unknown, so the next shape change surfaces the
  same way this one did

Fresh captures are recorded under `docs/research/fixtures/cline-3.0.57/`:
`tool-use.success.redacted.ndjson` covers the full tool lifecycle
(`content_start:tool`, three `content_update:tool`, `content_end:tool`), and
`tool-denied.completed.redacted.ndjson` covers the refusal path. The 3.0.51
fixtures still parse unchanged against the same adapter.

A second behavior change surfaced while closing out PLAN-035: a denied tool no
longer aborts the run. 3.0.51 returned `finishReason: "aborted"`; 3.0.57 refuses
the tool the same way — `tool_result.isError` with "Tool approval requires an
interactive session" — and then lets the agent answer without it, ending in a
normal `result`. Nothing executes either way, so this is a host-visible contract
change rather than a permission hole. Note that omitting `--auto-approve`
entirely is not the same as passing `false`: without the flag, 3.0.57 ran
`run_commands` and created a file unprompted. The runtime always passes the
explicit `false`.

Re-probing 3.0.57 with `manual_tool` after the fix:

- `status: completed`, 1 turn, 35 events
- normalized 33, ignored 14, **unknown 0**, schema failures 0, raw passthrough 0
- `content_update:tool` now appears as a normalized type

Those captures establish 3.0.51 and 3.0.57 as fixture provenance. They no longer
form an execution allowlist.

The `regression` classification on that last artifact is another comparison
artifact: it compares against the pre-fix run, where the model happened to emit
255 reasoning-progress events against this run's 24. Progress volume tracks how
much the model thinks, not the contract.

## Harness defects found

- **Probe timeouts were uniform, and Aider exceeded them.** `--version` and
  `--help` run concurrently under one `CATS_RUNTIME_COMPATIBILITY_PROBE_TIMEOUT_MS`
  (default 10 000). Aider needs about 4.9 s alone and 8.3 s for the pair, so
  under a full 16-provider scan both probes timed out, `version` landed as
  `null`, and setup reported `probe_failed` with the generic "retry with
  force=1" remediation for a CLI that is installed and working. Providers can
  now declare `check.minProbeTimeoutMs`, which raises the resolved probe timeout
  without lowering the larger WSL and Docker budgets; Aider declares 30 000. A
  rescan after the change reports `aider 0.86.2` with no remediation.
- **Workspace cleanup could discard a completed probe.** `runCliProbeProfile` and
  `runAgentProbeProfile` removed the temp workspace in `finally`, so an EBUSY
  from Windows holding a handle after the CLI exited replaced the result:
  `status: failed`, `turnsCompleted: 0`, on a run that had already parsed 156
  events. Cleanup now retries and, if it still fails, warns and leaves the
  directory for `--cleanup-temp-dirs` instead of throwing.
