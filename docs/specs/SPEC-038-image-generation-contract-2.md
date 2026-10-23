# SPEC-038: Image generation contract 2

- Status: Implemented for generation. Grok, Muse, Codex and Antigravity are enabled. Codex and
  Antigravity have runner-enforced bounds, which the owner accepted on 2026-10-23.
- Decision: [ADR-047](../decisions/047-generalize-bounded-image-generation-to-provider-profiles.md).
- Plan: [PLAN-048](../plans/PLAN-048-image-generation-contract-2.md).
- Supersedes the HTTP shapes of [SPEC-033](SPEC-033-bounded-image-generation.md). Its
  limits, persistence, deletion and recovery rules still apply unless stated here.

## Routes

| Method and route | Behavior |
| --- | --- |
| GET `/media/images/capabilities` | Schema 2 configured view; no CLI probe |
| POST `/media/images/jobs` | Exact contract 2 request; persisted before dispatch |
| GET `/media/images/jobs/:id` | Schema 2 receipt; upgrades a schema 1 receipt on first read |
| POST `/media/images/jobs/:id/cancel` | Unchanged |
| DELETE `/media/images/jobs/:id` | Unchanged |
| GET `/media/images/jobs/:id/image` | Verified original bytes with the receipt's measured MIME type |

## Capabilities

```json
{
  "schemaVersion": 2,
  "revision": "16 hex chars over targets and profiles",
  "maxPromptLength": 2000,
  "maxImageBytes": 8388608,
  "targets": [{ "id": "muse/native", "provider": "muse", "instance": "native" }],
  "profiles": [{
    "id": "muse-generate", "revision": 1, "operation": "image.generate", "targetIds": ["muse/native"],
    "agentConfigs": [{ "id": "muse-spark-1.3-xhigh", "model": "muse-spark-1.3", "effort": "xhigh" }],
    "inputs": { "min": 0, "max": 0 }, "aspectRatio": { "mode": "service" }
  }]
}
```

- A target ID is `<provider>/<instance>`.
- `aspectRatio` is `{ "mode": "native", "options": ["1:1"] }` or `{ "mode": "service" }`.
- A provider appears only with an enabled profile and a configured instance its runner supports.
- Enabled profiles today:
  - `grok-generate`: Grok 4.7 / xhigh, native 1:1
  - `muse-generate`: Muse Spark 1.3 / xhigh, service-decided ratio
  - `codex-generate`: GPT-6.1-Sol / xhigh, service-decided ratio
  - `antigravity-generate`: Gemini 3.8 Flash high, native 1:1 requested

## Request

```json
{ "id": "<uuid>", "targetId": "muse/native", "profileId": "muse-generate", "profileRevision": "1",
  "agentConfigId": "muse-spark-1.3-xhigh", "operation": "image.generate", "prompt": "...",
  "sourceIds": [], "options": {} }
```

- Exactly these keys. `sourceIds` must be empty and `options` empty; generation takes neither yet.
- Errors:
  - Malformed request: 400 `invalid_image_request`.
  - Unknown or disabled profile, or a profile for another provider: 409 `image_profile_unavailable`.
  - Another revision or configuration: 409 `image_profile_changed`.
  - Instance not configured or transport unsupported: 503 `image_transport_unsupported`.
- The same ID with a different target, operation, prompt or configuration is
  `image_request_conflict`.
- A receipt upgraded from schema 1 recorded no configuration. It compares target, operation and
  prompt only.

## Receipt

```json
{ "schemaVersion": 2, "id": "<uuid>", "targetId": "muse/native", "provider": "muse", "instance": "native",
  "profileId": "muse-generate", "profileRevision": "1", "agentConfigId": "muse-spark-1.3-xhigh",
  "agentModel": "muse-spark-1.3", "agentEffort": "xhigh", "operation": "image.generate", "prompt": "...",
  "sourceIds": [], "options": {}, "status": "succeeded", "createdAt": "...", "updatedAt": "...",
  "error": null, "warnings": [], "executionOutcome": "stopped_after_image",
  "output": { "mimeType": "image/png", "bytes": 1242589, "width": 1920, "height": 1280,
    "sha256": "...", "transparency": "opaque" } }
```

- `executionOutcome` values:
  - `completed`: the CLI finished its turn.
  - `stopped_after_image`: the runner ended the process after the verified image existed.
  - `null`: no image.
- `transparency` is measured from decoded pixels. JPEG is always `opaque`.
- Images are stored as `image.jpg` or `image.png` by measured type.
- A schema 1 receipt is backed up to `job.schema-1.json` before its atomic replacement:
  - Grok, `profileId: grok-generate`, `agentConfigId: null`, `agentEffort: null`.
  - Output gains `transparency: opaque`.

## Limits

- Bytes are decoded completely (jpeg-js or pngjs with CRC checks) up to 8 MiB.
- Each edge is at most 4096 px; an image has at most 8 Mi pixels.
- The process deadline is five minutes, with 2 MiB of combined process output.
- One active image attempt Runtime-wide.

### Muse runner

- Invocation:
  - `muse exec --json`, with `--max-model-steps 1` and `--no-parallel-tool-calls`.
  - `--disable-shell` and `--disable-web-tools`; approval prompts are disabled.
  - `--disable-reminders`, `--disable-request-user-input` and `--no-foreign-personal-context`.
  - `--session-id <receipt id>`.
  - The prompt is passed only after `--`.
- Writes stay enabled, because muse 1.4 removes `image_generation` with `--disable-write`. The
  working directory is the attempt's own empty workspace. This also enables memory and artifact
  tools. A run whose one call is such a tool is stopped and fails, but that call may already have
  run.
- Accepted evidence is all of:
  - the session stream, including the result record, equals the receipt ID;
  - the only tool proposal is `image_generation`;
  - its result reads `Saved generated image to generated_images/<call id>.png`, where the call
    ID matches the result's call ID;
  - that file is a contained, single-link, stable, valid PNG.
- The runner then ends the process tree.
- Other tools, a second proposal, a foreign session or result, an error result or a missing
  file fail the attempt. The error is classified (`auth_required`, `quota_exhausted`,
  `generation_refused`, `generation_failed`). Nothing is retried.

### Codex and Antigravity runners

- **Codex.** The invocation is `codex exec --json --skip-git-repo-check --ignore-user-config
  --ignore-rules --sandbox read-only`, with `--disable` for `shell_tool`, `browser_use`,
  `computer_use`, `multi_agent` and `apps`, the model and effort as `-c` values,
  `--cd <workspace>`, and the prompt after `--`.
  - `thread.started` names the thread. Only agent message, reasoning, todo list and image
    items may appear; any other item stops the run.
  - The image is the first complete file in `$CODEX_HOME/generated_images/<thread>/`.
- **Antigravity.** The invocation is `agy -p <prompt> --output-format stream-json` with the
  adapter's base arguments, `--add-dir <workspace>`, `--model`, `--dangerously-skip-permissions`
  (print mode cannot run a tool otherwise) and `--sandbox`.
  - `init` names the conversation. One `invoke_subagent` or one direct `generate_image` in all;
    anything else stops the run. Print mode needs skipped permissions, so a stopped parent tool
    may already have run. The image child's own calls never reach the stream, so what it may do
    depends on that built-in child's toolset.
  - A result whose ratio differs from the requested 1:1 is kept with `ratio_differs_from_request`.
  - The image is the first complete file in `~/.gemini/antigravity-cli/brain/<conversation>/`.
- Shared rules for both:
  - Only that session's folder is read.
  - A file counts as complete when it is unchanged across two looks and decodes.
  - Containment and single-link checks apply.
  - Extra files present when the image is collected add the `additional_image_generated`
    warning; an image finished after the stop is not seen.
  - A file that keeps failing to decode stops the run with `invalid_image`.
  - If no image appears before the process ends, the attempt fails with the classified error.

## Validation boundary

- Fixtures cover invocation flags, real pipe framing with a Node stand-in for muse, stopping a
  run that keeps going, transparency, each refusal path, cancellation, PNG corruption and size
  caps, capabilities gating, stale revisions and the schema 1 upgrade.
- One owner-authorized live image each passed through the runner. These runs went through the
  runner, not the HTTP server or Desktop.
  - Muse: [acceptance](../research/2026-10-23-muse-bounded-image-acceptance.md).
  - Codex and Antigravity: [acceptance](../research/2026-10-23-codex-antigravity-bounded-image-acceptance.md).
