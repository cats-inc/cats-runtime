# ADR-053: Extend media receipts with immutable references

- Status: Accepted; implementation authorized 2026-11-11
- Context: Platform ADR-151 / SPEC-143, Cat profile publications
- Specification: [SPEC-044](../specs/SPEC-044-reference-media-generation.md)
- Plan: [PLAN-053](../plans/PLAN-053-reference-media-generation.md)

Cats profiles need to create a new image or short video from an avatar, cover,
or selected local photo/video. Contract 2 cannot carry references. Execution,
capacity reservation, cancellation and provider receipts must remain in Runtime;
Platform owns the post, retained asset, sharing and notifications.

Add contract 3 requests and receipts to the existing media service. Contract 2
requests and receipts keep their shape and semantics. The schema-2 capability
envelope advertises `mediaContractVersion: 3` and additional profiles with nonzero
input bounds. Older hosts already ignore unknown operations and nonzero inputs.

Upload immutable sources by UUID. Materialize only those bytes in a job's private
workspace. A video source supplies its middle frame; this is frame-based
recreation, not native video editing or motion transfer. Keep the one active job,
originating-session yield, provider-selection reservation and metering boundary.
Use Grok `image_edit` and `image_to_video` as the first evidenced runners.

Use pinned FFmpeg/FFprobe packages for local MP4 validation and frame extraction.
Decode locally without network protocols, bound time and bytes, and retain exact
source/output hashes. These packages add binary distribution/notice obligations
to release preparation; this implementation authorizes no release or version bump.

No rewrite of existing receipts is needed. Schema-1 to schema-2 upgrade remains
unchanged. New contract-3 receipts are read by new consumers only; do not downgrade
a profile containing active v3 work to an older Runtime. Existing consumers are
covered by contract-2 and Platform App image regression tests.
