# SPEC-044: Reference media generation

- Status: PoC implemented on feature branch; native/focused tests and isolated Desktop evidence passed; external acceptance pending
- Date: 2026-11-11
- Decision: [ADR-053](../decisions/053-extend-media-receipts-with-immutable-references.md)
- Plan: [PLAN-053](../plans/PLAN-053-reference-media-generation.md)
- Product: [Platform SPEC-143](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-143-cat-profile-posts-media-and-sharing.md)

## Additive HTTP contract

`PUT /media/images/sources/:id` accepts raw image/MP4 bytes (maximum 50 MiB).
It returns `{id, kind, metadata}`. A retry with identical bytes returns the same
receipt; different bytes under the same UUID return conflict. No filesystem path
is accepted from the host. JPEG/PNG references use the existing 8 MiB / 8 MP /
4096-edge decoder limits. Platform normalizes larger owner photos before upload.

`GET /media/images/capabilities` retains schema 2 and adds `mediaContractVersion: 3`,
`maxSourceBytes` and the following configured profiles:

| Profile | Operation | Sources | Options |
| --- | --- | --- | --- |
| grok-reference-image | image.edit | 1–3 images or video frames | `{}` |
| grok-reference-video | video.generate | 1 image or video frame | `{durationSeconds:6}` or `{durationSeconds:10}` |

`POST /media/images/jobs` accepts the existing fields plus `contractVersion:3`,
the operation above, source UUIDs, and its options. Profile/revision/configuration
are pinned at submission. Existing `image.generate` requests remain contract 2.
Requests include an optional trusted `sourceSessionId` only when originating in
an agent turn; owner UI creation reserves an ordinary external slot.

Job GET/cancel/delete and binary `/image` routes retain their paths. V3 job GET
returns `schemaVersion:3`, ordered `sourceIds`, options and measured output.
Image outputs retain the existing image metadata; MP4 adds `durationSeconds`.
MP4 is H.264, at most 50 MiB / 30 seconds / 1920 per edge. Attached cover pictures
are not counted as additional video tracks. The entire video track is decoded.
Generated duration must be within one second of the requested duration.

## Execution and recovery

1. Validate source receipts and pin request identity before dispatch.
2. Persist receipt, materialize references; video sources use the middle frame.
3. Execute one bounded Grok turn with only the selected media tool. Both native
   image and video parallelism are capped at one. Observe tool name, references,
   duration/resolution, matching call result and terminal process evidence.
4. Collect only the current session's `images` or `videos` file. Decode, hash,
   persist bytes, then atomically publish the succeeded receipt.
5. Restart observes the original receipt. Never resubmit an uncertain invocation.
   Cancellation wins a late completion. A new attempt requires a new request ID.

Tool inputs never contain the owner's original directory path. The source upload
store is private Runtime data. Its UUID receipt is not a public media URL. The
Platform host owns selected references, automatic-post limits and delivery policy.

## Verification

Contract-2 regression plus reference-source, real MP4 decode/ frame extraction,
request conflict and invocation tests: 18 tests passed on Windows. See
[native evidence](../research/2026-11-11-reference-media-native-evidence.md).
Cross-platform binary installation and release packaging remain release gates.
