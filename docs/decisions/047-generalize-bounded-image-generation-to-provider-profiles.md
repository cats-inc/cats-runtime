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
     `--disable-write` removes it. That also enables Muse's memory and artifact tools. The
     runner stops a run whose single call is anything else, but approvals are off, so that one
     call (for example a memory write outside the workspace) may already have run. No muse 1.4
     switch that keeps only the image tool was found.
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

2026-10-24 extension: the owner requested Cursor generation in Studio. Add its own pinned
GLM 5.3 / max profile and native runner, with attempt-isolated Cursor data and source collection
from the matching native tool completion. It follows the existing runner-enforced bound:
Cursor has no CLI media-call cap. Fixture validation and prior Chat generation do not replace
the one-call new-runner live gate; no additional paid generation is implied by this record.

- HTTP image routes change shape, so the next Runtime release moves to a new 0.x minor.
  Desktop bundles Runtime with the matching Platform.
- Muse's ratio is service-decided. Profiles say so (`aspectRatio.mode: "service"`), and only
  measured dimensions describe a result.
- Codex 0.163.0 and Antigravity 1.4.6 offer no CLI-enforced limit on media calls. On
  2026-10-23 the owner accepted a runner-enforced bound for both. Each run:
  - turns off what the CLI lets it turn off. Codex: shell, browser, computer and agent tools,
    user config and rules, read-only sandbox. Antigravity: terminal restrictions;
  - stops on a foreign tool (Codex: file change, MCP, web; Antigravity: any tool other than one
    `invoke_subagent`);
  - ends the process once the first image in its own session folder is complete. Codex reads
    `$CODEX_HOME/generated_images/<thread>/`; Antigravity reads
    `~/.gemini/antigravity-cli/brain/<conversation>/`.

  A second image started before the stop may still be generated; it is not kept, and the
  receipt warns `additional_image_generated`. Both routes passed one live call and are
  enabled.
- Separate media charges remain unknown. A profile states what the CLI bounds, not a cost
  ceiling.

See [SPEC-038](../specs/SPEC-038-image-generation-contract-2.md),
[PLAN-048](../plans/PLAN-048-image-generation-contract-2.md) and the
[Muse acceptance](../research/2026-10-23-muse-bounded-image-acceptance.md).
