# ADR-014: Keep Lightweight Provider Setup and Diagnostics in `cats-runtime`

> Let `cats-runtime` expose standalone provider setup and diagnostics
> capabilities, while full packaged onboarding remains a product-host concern.

## Status

Accepted

## Date

2026-03-20

## Context

`cats-runtime` is already an explicit standalone runtime boundary:

- it can be started directly as its own npm-distributed service
- it exposes an embedded dashboard
- it already owns provider execution, discovery, streaming, and runtime-facing
  provider topology

At the same time, the Cats product direction now has a stronger packaged
onboarding requirement:

- `cats` should eventually ship a full first-run setup wizard
- that wizard includes product concepts such as welcome flow, capability-pack
  presentation, Boss Cat initialization, and host-managed resume/elevation UX

Those product requirements do not erase the standalone runtime use case.
Operators who install `cats-runtime` directly still need a reasonable way to:

- inspect configured providers
- scan for installed CLIs
- verify provider readiness
- diagnose broken provider targets
- adjust runtime-owned provider settings

If `cats-runtime` has no setup or diagnostics surface of its own, two bad
outcomes follow:

- standalone runtime usage becomes "edit config by hand and hope"
- all provider readiness logic gets pushed upward into product shells even
  though the runtime already owns the execution boundary

The project needs a clear split between:

- runtime-owned setup and diagnostics capability
- product-owned onboarding experience

## Decision

`cats-runtime` will keep a lightweight provider setup and diagnostics surface of
its own, exposed through headless runtime APIs and optionally through its
embedded dashboard.

This decision includes:

1. `cats-runtime` owns standalone provider setup primitives:
   - scan
   - detect
   - probe
   - verify
   - readiness reporting
   - runtime-owned provider configuration reads and writes
2. `cats-runtime` may expose these primitives through:
   - headless HTTP/API surfaces
   - the embedded dashboard as lightweight Settings or setup screens for
     standalone operators
3. This runtime setup surface is intentionally lighter than the product wizard.
   It does not own:
   - Boss Cat concepts
   - packaged first-run welcome flow
   - capability-pack marketing language or product framing
   - packaged host privilege orchestration and resume UX
4. Full packaged onboarding for the Cats product remains product-host-owned, as
   recorded in `cats` ADR-021.
5. Runtime setup and diagnostics must use the same provider compatibility and
   evidence engine used by normal runtime execution paths rather than a second
   ad hoc parser stack.
6. This ADR does not require `cats-runtime` to own consumer-grade CLI
   installation orchestration.
   - the runtime may surface install metadata, readiness gaps, and diagnostic
     guidance
   - packaged hosts may still own multi-step install execution, privilege
     prompts, and interruption resume
7. `cats-runtime` should remain useful when distributed independently from
   `cats`.

## Rationale

- preserves the standalone value of `cats-runtime` as an npm-distributed
  runtime, not just a hidden sidecar
- keeps provider readiness and diagnostics close to the runtime boundary that
  already owns provider behavior
- avoids forcing every consumer to rebuild the same provider setup and
  diagnostics logic above the runtime
- stays compatible with `cats` owning the richer product onboarding
  experience

## Consequences

### Positive

- standalone runtime users get a real setup/diagnostics path instead of only
  manual config edits
- upper-layer products can consume runtime setup primitives through stable APIs
- provider readiness logic stays near provider execution and compatibility logic
- the embedded dashboard gains a clearer purpose for direct runtime operators

### Implementation Notes

The current runtime-owned diagnostics slice is intentionally headless-first and
host-consumable:

- `GET /health` remains the authoritative readiness boundary and now carries the
  shared startup/shutdown contract metadata that packaged or host-managed
  supervisors can consume directly
- `GET /diagnostics/runtime` freezes the machine-readable startup, lifecycle,
  and shutdown contract exposed by the runtime process
- `GET /diagnostics/providers` remains the lightweight provider-readiness and
  probe surface owned by `cats-runtime`
- `GET /diagnostics/health` is the aggregate host-facing summary for runtime +
  provider health, so packaged desktop shells and future product hosts do not
  need to stitch multiple diagnostics routes together
- the embedded dashboard consumes the same runtime-owned diagnostics surface
  rather than inventing a separate product-only health contract

This ADR still does not move product onboarding, installation orchestration, or
policy-heavy approval UX into `cats-runtime`.

### Negative

- `cats-runtime` must now define and maintain a setup/diagnostics API surface
- the embedded dashboard may need modest UX expansion for provider settings and
  readiness views
- the runtime boundary grows more operational control-plane behavior

### Neutral

- this ADR does not require `cats-runtime` to own the full packaged install
  wizard
- this ADR does not require `cats-runtime` to own all provider installation
  execution flows
- this ADR does not prevent a product host from layering a richer setup
  experience above the same primitives

## Alternatives Considered

### Alternative 1: Keep All Setup UX Only in `cats`

- **Pros**: one obvious place for onboarding UI
- **Cons**: leaves standalone `cats-runtime` without a practical setup surface
  and pushes runtime-owned readiness logic upward
- **Why rejected**: runtime capability and product experience are related but
  not the same layer

### Alternative 2: Make `cats-runtime` Own the Full Product Wizard

- **Pros**: one runtime-owned onboarding flow everywhere
- **Cons**: pollutes the runtime with product concepts and packaged-host UX
- **Why rejected**: packaged onboarding remains a product concern

### Alternative 3: Keep `cats-runtime` Setup Fully Manual

- **Pros**: smallest runtime surface area
- **Cons**: standalone usage degrades to config-file editing and manual CLI
  troubleshooting
- **Why rejected**: the runtime already owns too much provider behavior for
  this to remain a credible operator experience

## References

- [ADR-009](./009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup.md)
- [ADR-013](./013-extend-provider-manifests-with-install-and-check-metadata.md)
- [SPEC-007](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md)
- [cats ADR-021](../../../cats-platform/docs/decisions/021-keep-packaged-setup-and-provider-installation-in-the-host.md)
- [cats SPEC-023](../../../cats-platform/docs/specs/SPEC-023-packaged-setup-wizard-and-provider-installation.md)

---

*Accepted: 2026-03-20*
*Last updated: 2026-03-22*
*Decision makers: user + Codex*

