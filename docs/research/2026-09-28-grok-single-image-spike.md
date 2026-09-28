# Grok single-image adapter spike

Date: 2026-09-28. Scope: one Windows-native image generation, no retries.

## Result and authorization

The owner reduced Apps PLAN-003 Phase 0 to one basic image because the remaining
monthly Grok allowance was limited. After a separate read-only privacy check,
the owner authorized this single attempt. No editing, video generation, repeated
probe, privacy change, or release was performed.

One `image_gen` call produced a valid 1024 x 1024 JPEG of an orange cat on a light
blue background. The file contains 98,234 bytes and decoded successfully; visual
inspection confirmed a single image matching the simple prompt. SHA-256:
`26825f36213f687376e483453dd5b077d4ccce5e5cfdb1ed4fde6da37718b087`.

This verifies the adapter invocation/parser and local artifact inspection. It
does not verify a Runtime HTTP session, installed App SDK, durable host gallery,
image editing, video, recovery, or another OS/transport.

## Invocation and bounds

- CLI: Grok Build 1.0.41; Windows native; existing CLI sign-in.
- Runtime source: `b691fec5`, the checkout used for this recorded probe.
- Agent model: `grok-4.7-build-fast`, reasoning `low`. This identifies the agent,
  not the underlying image model, which was not returned.
- Used `GrokProvider.prepareEphemeralTurn`, `buildSpawnArgs` and `parseStreamLine`
  from repository source through a private Node/tsx harness.
- Replaced the adapter's 100-turn default with `--max-turns 1` for this probe only.
  Kept streaming JSON, `--verbatim`, disabled web search, memory and subagents.
- `--permission-mode dontAsk --tools image_gen`; explicitly removed `search_tool`,
  `use_tool`, `image_edit`, `image_to_video`, `reference_to_video` because the CLI
  documents MCP meta-tools as surviving a normal allowlist.
- Disabled automatic updates for this invocation. Set image parallelism to one,
  used a fresh OS-temp working directory and a new CLI session. No repo or user
  privacy configuration was edited. The harness refuses a second invocation.
- One invocation, one observed model round, one observed tool call, no retry.
  This is observed probe evidence, not a claim that a concurrency setting alone
  enforces a general lifetime tool-call budget.
- Wall time: approximately 16.3 seconds, 00:05:32.625–00:05:48.961 UTC.

Tool input:

```json
{"prompt":"A simple flat illustration of one orange cat sitting, solid light blue background, minimal shapes, no text, no letters, no watermark","aspect_ratio":"1:1"}
```

No pixel size or image quality parameter was sent. The observed 1024-pixel edge
is an output fact, not an exact-size guarantee or a proven lowest-price mode.

## Artifact and terminal semantics

The completed tool update contained `rawOutput.type = "ImageGen"`, a local `path`,
`filename = "1.jpg"` and `session_folder = "images"`. The image was saved under
the new CLI session's `images/` directory, outside the requested temp cwd.

The harness resolved the actual file against that exact session image directory,
checked JPEG signature and bounded bytes, copied it to private evidence, and
verified matching digests. No broad home-directory scan or remote URL fetch was used.

Runtime normalized one `tool_use` and one successful `tool_result` with the same
tool ID. Neither carried a typed `artifacts` array. Host media collection is still
required; the generic tool event alone is not a gallery/storage implementation.

After the tool completed, `max_turns_reached` stopped the next model round. The
terminal event reported `stopReason: cancelled`, and the process exited 1.
Thus the image succeeded while the enclosing turn ended at its explicit limit.
Do not infer missing media from this exit code, or equate a successful tool with
an otherwise normally completed turn. There was no follow-up model summary.

## Reported usage

| Metric | CLI-reported value |
|--------|--------------------|
| Uncached input tokens | 4,231 |
| Cache-read input tokens | 2,688 |
| Output tokens | 233 |
| Reasoning tokens, reported separately | 175 |
| Total tokens | 7,152 |
| Main-agent model calls | 1 |
| Reported model cost USD | 0.00761872 |

The cost equals the terminal event's per-agent-model cost. An image-generation
charge or change in monthly allowance was not separately reported or measured;
this value must not be presented as the complete price of generating the image.

## Evidence and remaining work

Private local evidence is in ignored `tmp/grok-one-image-spike/`: invocation,
raw/normalized events, summary, artifact metadata and `orange-cat.jpg`. Raw logs
and user-specific session paths are not part of this tracked note.

The preceding `/privacy` TUI check showed **Opt in**, with no ZDR-locked row.
No choice was changed. That check did not establish media failure behavior or
authorize a video request. No ZDR failure probe was performed.

Further live generation is deferred under the owner's allowance constraint.
Editing, selected-image lineage, 6-second/480p video, cancel/failure scenarios and
installed App acceptance remain open in
[Apps PLAN-003](../../../cats-apps/docs/plans/PLAN-003-media-studio-vertical-slice.md).
CLI versions are evidence provenance, not exact-version execution gates; follow
[ADR-035](../decisions/035-never-block-provider-execution-on-exact-cli-version.md).
