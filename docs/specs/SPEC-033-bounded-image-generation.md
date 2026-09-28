# SPEC-033: Bounded image generation

- Status: Implemented; native production execution is based on the earlier one-image spike,
  with new HTTP/service/process paths validated using isolated fixtures.
- Decision: [ADR-042](../decisions/042-bound-native-image-generation.md).
- Plan: [PLAN-043](../plans/PLAN-043-bounded-image-generation.md).

## Contract

| Method and route | Behavior |
| --- | --- |
| GET `/media/images/capabilities` | Configured supported native Grok instances and fixed limits; no CLI probe |
| POST `/media/images/jobs` | Exact `{id, instance, prompt}`; UUID, prompt ≤2000 code points; persist before dispatch |
| GET `/media/images/jobs/:id` | Durable receipt with sanitized error/output metadata; no execution |
| POST `/media/images/jobs/:id/cancel` | Abort and await the existing process; no generation |
| GET `/media/images/jobs/:id/image` | Verified JPEG bytes for a successful receipt |

Existing Runtime auth middleware applies. No raw paths, credentials or arbitrary CLI args
are accepted/returned. Receipt schema 1 includes provider/instance/model, timestamps,
running/cancelling/succeeded/failed/cancelled/interrupted status and optional JPEG metadata
(SHA-256, bytes, dimensions). Same ID with a different request is a conflict.

## Limits and persistence

One active image operation plus shared global capacity/selection/singleton limits; no queue.
One model round, image_gen whitelist, one image, square aspect, no retries. Five-minute
process deadline, 2 MiB combined process output, 8 MiB JPEG, decoder limit 4 megapixels.
At most 500 receipt directories. An ambiguous pre-spawn directory is never overwritten.
Receipts and images live under the resolved Runtime data root; atomic receipt/image rename
precedes success. Startup does not resubmit interrupted attempts.

Only matching tool-call completion and terminal evidence authorize collection. Native
processes may return exit 1 after max_turns_reached despite a valid image. This exception
requires the complete bounded success evidence, not an arbitrary file left on disk.

## Validation boundary

Fixtures cover process framing, exit 1, unexpected tools, path escape, JPEG decoding,
idempotency/restart, cancellation including image-persistence races, HTTP validation,
and shared pool admission. They spawn Node fixtures, never Grok. The prior
[single-image evidence](../research/2026-09-28-grok-single-image-spike.md) is separate;
no additional paid attempt was made for Studio implementation.
