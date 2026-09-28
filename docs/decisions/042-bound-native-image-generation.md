# ADR-042: Bound native image generation

## Status

Accepted, 2026-09-28, for the user-authorized Studio single-image slice.

## Context

Studio requires a typed image operation, not general shell access. The existing Grok
adapter spike delivered one JPEG, but ordinary chat execution does not collect a verified
binary artifact. Further paid probes are deferred by the user.

## Decision

Expose authenticated `/media/images` operations with durable request-ID receipts. Execute
one native direct Grok process using the existing adapter, one model round and image_gen
only. Keep the observed model/effort pin in catalog data (`media-profiles.json`); do not
silently follow a future default model or switch to a provider HTTP API.

Share provider-selection leases, worker capacity/singletons and metering preflight/event
observation. Receipt persistence precedes dispatch. Repeated submissions read the original
receipt; process restarts report interrupted rather than replaying generation.

Collect only the matching UUID session's image directory. Reject shell/WSL/custom args,
uncollectable long encoded workspaces, symlinks, hardlinks, escaped paths, extra tool calls,
oversized output, non-square or undecodable JPEG. A bounded max-turns exit 1 is accepted
only with matching completed tool output and terminal session evidence.

Cancel/timeout terminates the process tree. Keep cancelling until execution exits; final
persistence resolves cancellation before success. Platform owns user works/Core records,
while Runtime retains execution receipts and validated bytes for read-only recovery.

## Consequences

This adds a compatible API without altering existing persisted formats. Native Grok is the
only supported image transport; no edit/video/import or automatic retry. Storage is finite
and has no deletion policy in this slice. Provider model usage is observed when reported;
separate image charges and refunds are unknown.

See [SPEC-033](../specs/SPEC-033-bounded-image-generation.md),
[PLAN-043](../plans/PLAN-043-bounded-image-generation.md), and
[Apps SPEC-003](../../../cats-apps/docs/specs/SPEC-003-media-studio-vertical-slice.md).
