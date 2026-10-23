# SPEC-038: Image generation contract 2

- Status: Implemented for generation. Grok and Muse are enabled; Antigravity and Codex have
  no runner yet.
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
  working directory is the attempt's own empty workspace.
- Accepted evidence is all of:
  - the session stream equals the receipt ID;
  - the only tool proposal is `image_generation`;
  - its result reads `Saved generated image to generated_images/<call id>.png`, where the call
    ID matches the result's call ID;
  - that file is a contained, single-link, stable, valid PNG.
- The runner then ends the process tree.
- Other tools, a second proposal, a foreign session or result, an error result or a missing
  file fail the attempt. The error is classified (`auth_required`, `quota_exhausted`,
  `generation_refused`, `generation_failed`). Nothing is retried.

## Validation boundary

- Fixtures cover invocation flags, real pipe framing with a Node stand-in for muse, stopping a
  run that keeps going, transparency, each refusal path, cancellation, PNG corruption and size
  caps, capabilities gating, stale revisions and the schema 1 upgrade.
- One owner-authorized live Muse image passed through `executeMuseImage`. See the
  [acceptance record](../research/2026-10-23-muse-bounded-image-acceptance.md). That run went
  through the runner, not the HTTP server or Desktop.
