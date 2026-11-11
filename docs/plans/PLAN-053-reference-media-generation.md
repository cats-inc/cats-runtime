# PLAN-053: Reference media generation

- Status: PoC implemented on feature branch; native and isolated Desktop evidence passed
- Specification: [SPEC-044](../specs/SPEC-044-reference-media-generation.md)
- Date: 2026-11-11

- [x] Reuse existing media service, capacity/metering and source-turn yield.
- [x] Add immutable source upload, v3 requests/receipts and configured profiles.
- [x] Add bounded image_edit and image_to_video invocations and MP4 decoding.
- [x] Extract a validated middle frame from video inputs without editing originals.
- [x] Preserve v2 contracts; pass 14 existing tests and 4 new reference-media tests.
- [x] Generate a genuine avatar-conditioned Paris JPEG and a 6-second MP4;
  validate hashes, decoded dimensions and duration. No owner Cats state used.
- [x] Generate a new photo and short video from an imported source-video middle frame.
- [x] Observe Platform candidate profile photos, cover and real MP4 playback/Range.
- [ ] Complete one native-provider-to-remote-phone host flow; external tunnel/Telegram remain pending.
- [x] Record branches `feat/companion-media-poc` / Platform `feat/companion-profile-poc`,
  native receipt IDs and hashes, plus remaining live tunnel/Telegram limitations.

No version bump, provider-catalog refresh, publication or release is authorized.
Before a later release, verify FFmpeg/FFprobe binary packaging, notices and target
OS installations. Existing active v3 work must be drained before a downgrade.
