# ADR-047: Generalize bounded image generation to provider profiles

## Status

Accepted, 2026-10-23. The owner asked that Studio offer Muse, Antigravity and Codex
generation, starting with generation only. This record extends
[ADR-042](042-bound-native-image-generation.md), which stays the history of the Grok slice.
The cross-repository plan is
[cats-apps PLAN-006](../../../cats-apps/docs/plans/PLAN-006-studio-image-workspace.md).

## Context

ADR-042 bound one transport: native Grok, one model round, `image_gen` only, square JPEG.
Research showed Muse, Antigravity and Codex can each save one image. The routes differ:

- Muse saves a PNG of its own choosing, 1920 x 1280 in the observed case.
- Antigravity delegates to an image child.
- Codex calls its image tool inside a native `exec`.

None of these routes had a mechanically bounded execution. PLAN-006 allows a provider into
production only after two checks pass for that route:

- its media budget holds before anything runs;
- one live call through the Runtime route has succeeded.

## Decision

1. **Profiles in catalog data.** `catalogs/media-profiles.json` (catalog schema 2) holds one
   execution profile per provider x operation:
   - ID and revision
   - agent model and effort
   - aspect-ratio mode
   - an `enabled` gate
   - the evidence that justified it

   A disabled or unsupported profile is not advertised. Capabilities are the configured view:
   enabled profiles x configured instances the runner supports. They never probe a CLI,
   sign-in or quota.
2. **Contract 2 replaces the Grok-only HTTP shape.** This repository's pre-release policy
   applies, so there is no schema 1 alias. Platform keeps SDK 1.x Apps working by projecting
   contract 2 down to schema 1.
   - Requests name a target, profile, profile revision and agent configuration.
   - A stale revision or configuration is refused with `image_profile_changed`, so it never
     silently runs another configuration.
   - Receipts record the provider, the measured MIME type, dimensions and transparency,
     warnings, and whether the runner stopped the process after the image existed.
3. **One runner per provider, behind a shared execution module.**
   - Each runner keeps the ADR-042 rules: injected spawn, process-tree termination, output
     and time limits, and containment against a known root.
   - Bytes are decoded completely by their signature (JPEG or PNG). The format is never
     taken from a file name.
   - No assumption of a square image is made outside a native-ratio profile.
4. **Muse generation is enabled.**
   - Limits enforced by the CLI: `--max-model-steps 1`, `--no-parallel-tool-calls`, shell and
     web tools off, and a Runtime-chosen session ID.
   - Writes stay on, because muse 1.4 classes its image tool as a workspace write and
     `--disable-write` removes it. Any write can land only in the attempt's empty workspace.
   - Success is the matching `image_generation` result naming `generated_images/<call id>.png`,
     plus a valid PNG at that place. The runner then ends the process; it does not wait for a
     final answer, which may never come.
   - Any other tool proposal, a second image call, or a foreign session or result stops the
     run.
5. **Receipt upgrade.** A schema 1 receipt is a Grok square JPEG.
   - On first read it is copied to `job.schema-1.json` and replaced atomically with its
     schema 2 form. A rerun after a crash finds the same backup and finishes the upgrade.
   - Unknown or damaged receipts are refused and left untouched.
   - Upgraded receipts keep their historical model, record no agent configuration, and are
     never executed again.

## Consequences

- HTTP image routes change shape, so the next Runtime release moves to a new 0.x minor.
  Desktop bundles Runtime with the matching Platform.
- Muse's ratio is service-decided. Profiles say so (`aspectRatio.mode: "service"`), and only
  measured dimensions describe a result.
- Codex 0.163.0 offers no CLI-enforced limit on media calls. Its image tool is reachable only
  from inside native `exec` code. Under PLAN-006 that route stays disabled until a
  pre-execution bound exists or the owner accepts a runner-enforced bound.
- Antigravity still needs a check that the child delegation is bounded before it can be
  enabled.
- Separate media charges remain unknown. A profile states what the CLI bounds, not a cost
  ceiling.

See [SPEC-038](../specs/SPEC-038-image-generation-contract-2.md),
[PLAN-048](../plans/PLAN-048-image-generation-contract-2.md) and the
[Muse acceptance](../research/2026-10-23-muse-bounded-image-acceptance.md).
