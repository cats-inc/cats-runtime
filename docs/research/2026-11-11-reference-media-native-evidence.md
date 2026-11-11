# Native reference-media evidence — 2026-11-11

Windows, installed Grok native CLI, configured `grok-4.7-xhigh` media profile.
Inputs were the repository's illustrated Guide Cat avatar and newly generated
test artifacts. No live Cats conversations, media directories or owner state were
copied. The CLI used its configured sign-in and a unique, task-owned workspace.
Raw provider receipts and files remain private under the task's ignored cache.

| Operation | Observed evidence |
| --- | --- |
| Avatar → Paris photo | Exactly one `image_edit`, exact absolute reference in tool input, `ImageEdit` result in that session's images folder; job `d34781b7-4106-47c8-a364-2b77c95cbfa6` |
| Photo → short video | Exactly one `image_to_video`, exact Paris reference, duration 6, resolution_name 480p; `ImageToVideo` result; job `5461301c-3e25-4c00-8a64-eefa1521bee8` |
| JPEG | 1024×1024, 305051 bytes, SHA-256 `023c6542d38ab971f48fcf3741541c3d9338c5b43158414e7a534af1eff2cd0b` |
| MP4 | H.264 + AAC with embedded JPEG cover, 544×544, 6.042 seconds, 2140807 bytes, SHA-256 `a01e4aa56606f375371eaa56c5ca6d3709dfb43d3f96adf535aee42aff629c44` |

The JPEG was visually inspected: an orange cat in front of the Eiffel Tower.
The first video collection rejected the embedded cover as a second video track.
The corrected validator excludes attached pictures, decoded the existing complete
MP4 successfully and extracted its middle frame. It did not generate another clip.
480p is the provider's preset name; do not claim exact 480-pixel dimensions.

These runs establish native reference transport and real generated output, not
Desktop posting, external tunnel connectivity or Telegram delivery. Focused tests
cover persistence/idempotency, legacy v2, source conflicts and genuine local MP4
decode/frame extraction. Product acceptance is tracked in Platform PLAN-136.


The original Paris MP4 was then imported into `MediaSourceStore`. Its middle
frame (3.021 seconds) became the exact reference supplied to two fresh native
turns. Both completed in one tool call and produced new validated output:

| Source-video recreation | Receipt |
| --- | --- |
| Frame → cafe photograph | `image_edit`; job `4cdc2c3a-d2ae-444a-9ca5-838f17f4789d`; JPEG 1024×1024, 364035 bytes, SHA-256 `c66370cfced5d15eb55681445c04d132481dc60e52826ab3bf1e8e5f4197c2f2` |
| Frame → new short video | `image_to_video`; job `cb54e3c8-2998-4cb3-90c1-d52704ba5c81`; H.264 MP4 544×544, 6.042 seconds, 2400449 bytes, SHA-256 `c796b7acffff0191dccc0bbca3e81233b817d472429ef3d0a73029c8f0fbd59c` |

The source-video hash is the Paris MP4 hash above; source bytes were not changed.
This proves frame-based recreation, not motion transfer. Platform's isolated
Windows Candidate subsequently rendered the new cafe photo as a cover and the
Paris photo in its profile timeline/lightbox, and played the Paris MP4 to its
final frame. Its authenticated media route returned 206 for a 1024-byte range.
No external tunnel or real Telegram send was attempted.
