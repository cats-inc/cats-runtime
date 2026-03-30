# ADR-013: Extend Provider Manifests with Install and Check Metadata

> Keep provider topology and provider-install metadata under one runtime-owned
> manifest so product hosts do not drift into their own separate provider
> install matrices.

## Status

Accepted

## Date

2026-03-20

## Context

`cats-runtime` already owns the current provider topology:

- provider families
- backend kinds
- configured instances
- model defaults
- runtime-facing provider catalog behavior

At the same time, the packaged Cats product now needs a guided first-run setup
flow that can:

- scan for already-installed local providers
- decide which providers belong to which capability packs
- show whether a provider is installable on the current platform
- install or verify providers through packaged host logic

Without a shared provider-install manifest, the likely failure mode is obvious:

- `cats-runtime` owns one provider truth for execution
- `cats` or the packaged host grows a second provider truth for install UI
- `environment-bootstrap` remains a third source of install knowledge

That would create naming drift, pack drift, platform drift, and readiness drift
across the suite.

The project needs one authoritative place for provider install/check metadata,
but that does **not** mean `cats-runtime` itself should become the installer
executor.

## Decision

`cats-runtime` provider manifests will expand to include install/check metadata
used by product hosts, while runtime execution ownership remains separate from
installer execution ownership.

This decision includes:

1. Provider topology and provider-install metadata should live together under a
   runtime-owned manifest direction.
   - the current preferred home is `config/providers.yaml` or a closely related
     runtime-owned provider manifest evolved from it
2. The manifest should be extensible enough to describe, at minimum:
   - provider capability pack membership
   - installability by platform
   - install/check action metadata
   - privilege hints
   - whether auth is expected after install
   - whether restart/relaunch may be required
3. Product hosts such as packaged Cats should consume this metadata as the
   provider-install truth source instead of maintaining separate hardcoded
   provider install tables.
4. `cats-runtime` should expose this metadata through its existing provider
   configuration/catalog direction or a closely related API surface.
5. `cats-runtime` does **not** become responsible for executing provider
   install scripts.
   - packaged hosts still own shell execution, privilege prompts, and resume
     orchestration
6. `environment-bootstrap` may remain an internal source of install/check
   knowledge and experimentation, but the runtime manifest becomes the place
   where shipped Cats provider intent and install metadata are normalized.

This ADR intentionally leaves one implementation detail open:

- the metadata may extend `config/providers.yaml` directly
- or it may live in a closely related sibling manifest keyed by the same
  runtime provider families

The architectural requirement is a single runtime-owned source of provider
install truth, not a premature commitment to one file split.

## Preferred Manifest Direction

The manifest direction should support fields equivalent to:

```yaml
providers:
  claude:
    install:
      pack: native-cli
      check:
        kind: command
        command: claude --version
      auth:
        required_after_install: true
      restart:
        may_require_resume: false
      platforms:
        windows:
          installer_id: claude-code
          asset: Install-ClaudeCode.ps1
          needs_admin: false
        macos:
          installer_id: claude-code
          asset: install-claude-code.sh
        linux:
          installer_id: claude-code
          asset: install-claude-code.sh
```

Exact field names may change during implementation, but the architecture should
preserve this split:

- runtime-owned provider/install metadata
- host-owned installer execution

Where practical, the manifest should prefer stable installer identifiers and
execution metadata over hardcoded end-user-facing script paths, so packaged
hosts can resolve those identifiers onto bundled product-owned assets without
creating a second provider matrix.

In this example, `claude` is the runtime provider family name, which matches
current `providers.yaml` naming. `claude-code` is the installer/tool identifier
used to resolve the concrete install asset for that family on each platform.

## Consequences

### Positive

- reduces provider drift between runtime execution and product setup UI
- gives packaged hosts one source of provider-install truth
- keeps provider pack classification close to provider topology
- allows internal bootstrap knowledge to be ported into shipped Cats assets
  without forcing product UIs to hardcode install knowledge independently

### Negative

- runtime config/catalog shape becomes broader than execution-only metadata
- provider metadata review now needs to consider setup/install UX as well as
  runtime execution
- packaging still needs a host-side resolution layer for bundled script assets

### Neutral

- this ADR does not require every provider to be installable in the first
  packaged release
- this ADR does not force raw script paths to remain the final implementation;
  stable installer IDs and packaged asset mapping are still valid
- this ADR does not give `cats-runtime` ownership of privilege prompts or GUI
  progress behavior

## Alternatives Considered

### Alternative 1: Keep Install Metadata Only in `cats`

- **Pros**: product team can move quickly without touching runtime config
- **Cons**: creates a second provider truth that will drift from runtime
  topology
- **Why rejected**: provider family truth should stay runtime-owned

### Alternative 2: Keep Install Metadata Only in `environment-bootstrap`

- **Pros**: install knowledge stays close to install scripts
- **Cons**: product hosts still need a second mapping layer for provider
  families, capability packs, and runtime-facing naming
- **Why rejected**: install assets and provider-topology truth are related but
  not identical responsibilities

### Alternative 3: Let `cats-runtime` Execute Install Scripts Directly

- **Pros**: one project owns both metadata and execution
- **Cons**: runtime becomes an installer/process orchestrator
- **Why rejected**: packaged hosts should own install execution and privilege
  flows

### Alternative 4: Force a Two-File Split Up Front

- **Pros**: keeps execution topology and install metadata physically separate
- **Cons**: commits the project to a file split before implementation proves
  whether that separation is actually clearer
- **Why rejected**: the important decision is runtime ownership of provider
  install truth; the exact file split can stay implementation-driven

## References

- [ADR-003](./003-provider-instance-config.md)
- [ADR-008](./008-runtime-owned-provider-model-catalog.md)
- [ADR-009](./009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup.md)
- [cats SPEC-023](../../../cats-platform/docs/specs/SPEC-023-packaged-setup-wizard-and-provider-installation.md)
- [environment-bootstrap README](../../../environment-bootstrap/README.md)

---

*Accepted: 2026-03-20*
*Decision makers: user + Codex*

