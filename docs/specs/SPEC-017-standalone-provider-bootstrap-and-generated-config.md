# SPEC-017: Standalone Provider Bootstrap and Generated Config

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User / runtime setup workstream |

## Summary

`cats-runtime` currently assumes a configured runtime topology exists before the
standalone operator can have a good first-run experience. In practice, that
creates a chicken-and-egg problem:

- the packaged or source template enables many provider families at once
- a fresh standalone operator may only have one or two providers installed
- the current embedded dashboard is session-centric, not provider-first
- `npx cats-runtime` should not require users to manually find and copy an
  example YAML file before they can even see what is available

This spec defines a standalone bootstrap flow for `cats-runtime` that:

- starts without a preexisting `providers.yaml`
- shows a provider-first setup surface before normal session-centric runtime use
- treats `providers.yaml` as the generated result of setup, not the setup
  prerequisite
- keeps heavy WSL/Docker scanning conservative
- preserves an expert fast path for operators who already have a valid config

## Goals

- eliminate the standalone first-run `providers.yaml` chicken-and-egg problem
- make `npx cats-runtime` usable without requiring a manual template-copy step
- preserve `providers.yaml` as a stable declarative runtime topology file
- keep standalone setup lightweight and runtime-owned
- make auto-scan safe on machines where WSL/Docker startup has high overhead
- preserve an expert path that can skip bootstrap when a valid config is
  already supplied

## Non-Goals

- replacing `providers.yaml` with a different long-term config format
- moving packaged provider installation orchestration into `cats-runtime`
- turning the runtime dashboard or setup flow into a product-grade onboarding
  wizard
- replacing the embedded runtime pages with a full SPA rewrite in this slice
- owning `cats` product bootstrap concerns such as owner identity or Boss Cat
  initialization

## User Stories

- As a fresh standalone operator, I want `npx cats-runtime` to show me what is
  available and what is ready without editing config first.
- As an experienced operator, I want to preseed a valid config and skip
  bootstrap entirely.
- As a Windows user, I want bootstrap auto-scan to avoid waking WSL or Docker
  unless I explicitly allow it.
- As a runtime maintainer, I want setup state and generated config to live in
  separate places so the config file stays declarative.

## Requirements

### Functional Requirements

1. `cats-runtime` shall support a distinct standalone `bootstrap mode`.
2. The runtime shall enter bootstrap mode when:
   - no valid `providers.yaml` exists at the resolved config path
   - the resolved config file is invalid
   - the resolved config file is valid but enables no usable provider targets
   - the operator explicitly requests bootstrap mode
3. The runtime shall skip bootstrap mode when a valid config with at least one
   enabled provider target is supplied through:
   - the default config path, or
   - `--config`, or
   - `CATS_RUNTIME_CONFIG_PATH`
4. Bootstrap mode shall not require the operator to manually copy
   `providers.yaml.example` before setup can begin.
5. The standalone bootstrap surface shall be provider-first and separate from
   the existing session-centric dashboard and playground.
6. The bootstrap surface shall be able to present, at minimum:
   - provider families known to the runtime
   - configured or inferred install metadata
   - readiness/probe status
   - remediation hints
   - a minimal enable/select action for the targets the operator wants
7. Completing bootstrap shall write a minimal `providers.yaml` containing only
   the enabled runtime topology the operator selected.
8. `providers.yaml.example` shall remain a reference/example artifact, not the
   required active-config seed for first launch.
9. Setup workflow state shall persist separately from the generated runtime
   config under the runtime data directory.
10. Setup workflow state shall not be stored as `config/providers.yaml.*`
    sidecars.
11. Bootstrap shall support additive setup-state artifacts such as:
    - a resumable setup state file
    - the latest provider scan summary
    - the latest explicit manual scan summary
12. Bootstrap auto-scan shall separate low-cost checks from heavy runtime
    activation.
13. Automatic WSL and Docker scans during bootstrap shall respect the runtime's
    discovery policies and shall not wake heavy environments unless the
    applicable policy allows it.
14. The documented default and recommended first-run discovery posture for both
    WSL and Docker should be `if_running`.
15. `manual_only` must remain usable in bootstrap mode.
16. When the current discovery policy blocks heavy auto-scan, the setup surface
    shall still expose an explicit manual scan action for the operator.
17. The runtime dashboard shall also expose a secondary manual scan entry point
    for operators after normal startup. That entry point may trigger manual
    discovery directly or deep-link into the provider setup scan action, but it
    shall not require editing YAML by hand.
18. The latest bootstrap scan summary and the latest explicit manual scan
    summary shall persist under the runtime data directory so both the setup
    page and the dashboard can surface a shared discovery snapshot.
19. `npx cats-runtime` without a valid config should start the runtime in a
    bootstrap-capable state rather than failing closed or dropping directly into
    the current session-centric dashboard.
20. The embedded runtime dashboard and playground shall remain available as
    operator/debug surfaces after bootstrap completes.
21. The embedded runtime UI substrate should evolve toward a lightweight shared
    build that still emits static HTML artifacts.
22. That lightweight build should allow shared:
    - design tokens / CSS theme variables
    - runtime fetch helpers
    - provider-badge / provider-status rendering helpers
    across the dashboard, playground, and provider setup page.
23. The runtime shall expose a minimal CLI bootstrap surface for standalone and
    headless operators.
24. The first CLI bootstrap slice should include:
    - `cats-runtime bootstrap`
    - `cats-runtime init-config`
    - `cats-runtime diagnose setup`
25. `cats-runtime bootstrap` shall start or force bootstrap/setup mode even
    when the operator would otherwise land in normal mode.
26. `cats-runtime init-config` shall support generating a minimal
    `providers.yaml` from discovered or explicitly selected targets without
    requiring manual template copying.
27. `cats-runtime diagnose setup` shall summarize provider readiness, setup
    blockers, and remediation pointers without requiring the operator to open
    the embedded setup page.

### Non-Functional Requirements

- **Clarity**: standalone first-run should answer "what do I have?" and "what
  can I use now?" before exposing normal session workflows
- **Safety**: auto-scan must avoid unnecessary WSL/Docker startup
- **Maintainability**: runtime UI pages should share styling and utility code
  without requiring a full frontend framework rewrite
- **Compatibility**: advanced operators may still hand-author or preseed
  `providers.yaml`

## Design Overview

```text
npx cats-runtime
      |
      v
resolve config path
      |
      +--> valid config with enabled targets? ---- yes ---> normal runtime mode
      |
      no
      v
bootstrap mode
      |
      +--> provider-first setup page
      +--> conservative scan / diagnostics
      +--> operator selects targets
      +--> write minimal providers.yaml
      +--> persist setup-state under data/
      |
      v
normal runtime mode
```

## Setup Artifact Model

The runtime should separate:

- **provider knowledge**: shipped runtime-owned manifests/knowledge
- **setup state**: data-dir state used by bootstrap and resumption
- **enabled config**: generated `providers.yaml`

Illustrative layout:

```text
config/
  providers.yaml

data/
  setup/
    setup-state.json
    provider-scan.json
    provider-manual-scan.json
  compatibility/
    ...
```

`providers.yaml` is the resulting declared topology. It is not the bootstrap
workflow state file.

The provider scan artifacts under `data/setup/` are runtime-owned discovery
snapshots. They are available for bootstrap resumption, manual scan history, and
dashboard/provider-setup read models; they are not hand-edited config files.

## UI Substrate Direction

The runtime does not need a heavy framework rewrite just to add a standalone
provider setup page. However, maintaining more embedded pages as fully isolated
inline HTML/CSS/JS will create avoidable duplication.

The preferred next substrate for embedded runtime pages is:

- shared CSS tokens
- shared runtime API utilities
- shared provider/status rendering helpers
- a lightweight build step such as `esbuild`
- static HTML output that remains easy for standalone runtime serving and
  Electron packaging to consume

The expected first shared-build scope is the current three-page embedded UI
surface:

- dashboard
- playground
- provider setup

Those pages should continue shipping as static runtime-served artifacts, but
they should stop duplicating theme variables, fetch/error helpers, and
provider-status presentation logic.

This is not a requirement to adopt React or to merge runtime pages into the
Cats SPA.

## Cross-Project Boundaries

- `cats-runtime` standalone bootstrap owns runtime/provider setup only
- `cats` product setup owns owner/Boss Cat/product bootstrap and consumes
  runtime provider/model data as a client
- packaged desktop/Electron setup may compose both flows into one host-owned
  experience, but that does not remove the standalone runtime bootstrap need

## Dependencies

- [ADR-014](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR-020](../decisions/020-keep-setup-diagnostic-reports-config-derived-and-separate-from-compatibility-evidence.md)
- [SPEC-015](./SPEC-015-runtime-setup-diagnostic-report.md)
- [cats ADR-021](../../../cats/docs/decisions/021-keep-packaged-setup-and-provider-installation-in-the-host.md)
- [cats SPEC-023](../../../cats/docs/specs/SPEC-023-packaged-setup-wizard-and-provider-installation.md)

## Open Questions

- [ ] Should bootstrap expose a dedicated `--bootstrap` flag, or should missing
      config be sufficient for the first slice?
- [ ] Should invalid-config recovery and missing-config bootstrap share one page
      or use different entry states?
- [ ] What is the smallest viable manual-scan action for `manual_only` in the
      first bootstrap slice?
- [ ] Should bootstrap always write the default config path, or can it stage a
      generated config elsewhere first?
- [ ] Should `init-config` support a fully non-interactive provider-selection
      input format in the first slice, or can it start with guided defaults?

## References

- [Setup Guide](../setup-guide.md)
- [API](../api.md)
- [Architecture](../architecture.md)
- [Research: First-Run Setup Diagnostic Report](../research/2026-03-24-setup-diagnostic-report.md)

---

*Created: 2026-03-25*
*Author: Codex*
*Related Plan: TBD*
