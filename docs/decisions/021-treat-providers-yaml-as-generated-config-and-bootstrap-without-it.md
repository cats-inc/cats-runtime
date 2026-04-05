# ADR-021: Treat `providers.yaml` as Generated Config and Bootstrap Without It

> Standalone `cats-runtime` should bootstrap without a preexisting
> `providers.yaml`, then generate that config as the result of setup.

## Status

Accepted

## Date

2026-03-25

## Context

The current standalone runtime setup story is awkward:

- `providers.yaml.example` enables a broad provider universe
- a fresh operator may only have one or two real providers installed
- the current embedded dashboard is session-centric, not provider-first
- `npx cats-runtime` users should not be expected to manually locate a package
  template file before they can see what is available

The result is a chicken-and-egg problem:

- the runtime wants provider topology in `providers.yaml`
- the operator wants the runtime to tell them what is already installed and
  usable before writing that topology

That problem only becomes tractable when standalone setup keeps three layers
separate:

1. **Provider universe**
   - runtime-owned knowledge such as provider families, probe logic, install
     metadata, and model-catalog capability boundaries
   - does not depend on config
2. **Machine detection**
   - runtime-owned detection of what is present or reachable on this machine
   - does not depend on config
3. **Enabled config**
   - operator intent about what should actually be enabled
   - persisted in `providers.yaml`

The first two layers must remain usable before `providers.yaml` exists, or the
runtime simply recreates the same first-run deadlock under a different name.

Discussion across `cats-runtime`, `cats`, and the packaged host also clarified
three distinct first-launch layers:

- `cats-runtime` standalone first launch is about runtime/provider setup
- `cats` first launch is about product bootstrap and provider/model consumption
- packaged desktop/Electron first launch is a host-owned composed experience

Those layers should not be collapsed into one raw dashboard or one raw config
template.

## Decision

`cats-runtime` will treat `providers.yaml` as the generated or hand-authored
result of runtime setup, not as the required prerequisite for standalone first
launch.

This decision includes:

1. Standalone runtime startup may enter a bootstrap/setup mode when no valid
   provider config is present.
2. That bootstrap mode must be able to start without a preexisting
   `providers.yaml`.
3. Completing bootstrap writes a minimal `providers.yaml` representing the
   enabled runtime topology the operator selected.
4. `providers.yaml.example` remains a reference/example artifact, not the
   required first-run seed.
5. Setup workflow state is separate from generated config:
   - generated config lives under `config/`
   - setup state lives under `data/`
6. Setup workflow state must not be stored as `config/providers.yaml.*` sidecar
   files.
7. Advanced operators may still skip bootstrap by providing a valid config
   themselves through the default config path under
   `~/.cats/runtime/config/providers.yaml` or the `CATS_RUNTIME_DIR` root
   override.
8. Automatic setup-time scanning for WSL and Docker must remain conservative and
   respect runtime discovery policies.
9. The preferred first-run discovery posture is `if_running` for both WSL and
   Docker so bootstrap does not wake heavy environments unnecessarily.
10. The current runtime default for WSL discovery is still too aggressive and
    should be corrected to align with the intended `if_running` posture.
11. `manual_only` must remain meaningful; if auto-scan is disabled, the runtime
    should rely on explicit operator-triggered scans instead of silently
    overriding the policy.
12. The latest bootstrap scan summary and latest explicit manual scan summary
    should persist under `data/setup/` so the setup page and dashboard can
    surface the same runtime-owned discovery snapshot.
13. The standalone runtime setup surface is separate from the session-centric
    dashboard and playground.
14. The current dashboard lacks that secondary manual scan entry point; this is
    a concrete product gap to close, not a nice-to-have future polish item.
15. The dashboard should still expose a secondary manual scan entry point after
    normal startup so `manual_only` and repair flows remain available outside
    bootstrap.
16. If embedded runtime UI grows beyond the current three embedded pages, the
    runtime should move to a lightweight shared build that still outputs static
    HTML rather than immediately adopting a heavy SPA rewrite.
17. The first shared-build scope is the runtime's three embedded setup/operator
    pages:
    - dashboard
    - playground
    - provider setup
18. That shared build should centralize CSS tokens, runtime fetch/error
    helpers, and provider-status presentation logic while still shipping static
    artifacts.
19. Bootstrap should be implemented on top of shared runtime-owned services for
    provider-universe knowledge, machine detection, setup-state persistence,
    and generated-config writing.
20. The standalone provider setup page is the first thin adapter over those
    services.
21. A future CLI setup surface may be added later as another thin adapter over
    the same services, but defining its command surface is not part of this
    decision.

## Consequences

### Positive

- fixes the first-run `providers.yaml` chicken-and-egg problem
- makes `npx cats-runtime` a credible standalone entry path
- keeps `providers.yaml` declarative and understandable
- preserves an expert fast path for hand-authored or preseeded config
- prevents bootstrap state from polluting config semantics
- keeps heavy WSL/Docker startup under operator-visible policy control
- gives setup and dashboard a shared persisted scan snapshot instead of
  duplicating discovery state
- keeps future headless/CLI work cheap by centering the shared bootstrap
  services first
- gives the runtime a clear path to reduce duplicated embedded-page CSS and JS

### Negative

- the runtime now needs an explicit bootstrap/setup mode in addition to normal
  runtime mode
- setup-state persistence becomes another maintained runtime artifact
- dashboard now carries a small provider-repair/manual-scan responsibility in
  addition to its session-centric role
- the embedded runtime UI surface needs some shared substrate work to avoid
  duplicated CSS and helper logic as pages grow
- a future CLI adapter still needs to be added later if headless bootstrap
  becomes a concrete requirement

### Neutral

- this ADR does not remove `providers.yaml`
- this ADR does not require the packaged Cats desktop flow to expose the raw
  standalone bootstrap page directly
- this ADR does not require a React rewrite for runtime-owned pages

## Alternatives Considered

### Alternative 1: Keep `providers.yaml.example` as the Required First-Run Step

- **Pros**: minimal runtime changes; advanced users can already understand it
- **Cons**: forces a manual template-copy step and exposes an oversized provider
  universe before the operator knows what is actually available
- **Why rejected**: it preserves the chicken-and-egg problem instead of solving
  it

### Alternative 2: Remove YAML Entirely and Use Only Runtime State Files

- **Pros**: bootstrap and resulting state could be one system
- **Cons**: removes a useful declarative config artifact for advanced operators,
  automation, and explicit topology control
- **Why rejected**: the problem is not YAML itself; the problem is using YAML as
  the bootstrap prerequisite

### Alternative 3: Make the Existing Dashboard the First-Run Setup Surface

- **Pros**: fewer pages on paper
- **Cons**: the dashboard is session-centric and does not answer the first-run
  provider-readiness questions clearly
- **Why rejected**: it overloads an operator/session page with a distinct setup
  concern

### Alternative 4: Rewrite Runtime-Owned Pages as a Full SPA Immediately

- **Pros**: stronger shared-component story
- **Cons**: too much scope for an operator/setup surface that can be solved with
  a lighter shared build
- **Why rejected**: a lightweight static-output build is the better next step

## References

- [ADR-014](./014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR-020](./020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence.md)
- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [cats ADR-021](../../../cats-platform/docs/decisions/021-keep-packaged-setup-and-provider-installation-in-the-host.md)
- [cats SPEC-023](../../../cats-platform/docs/specs/SPEC-023-packaged-setup-wizard-and-provider-installation.md)

---

*Accepted: 2026-03-25*
*Decision makers: user + Codex*
