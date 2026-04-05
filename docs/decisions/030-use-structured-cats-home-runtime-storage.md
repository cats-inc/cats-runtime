# ADR-030: Use Structured `~/.cats` Runtime Storage with a Config Subtree

## Status

Accepted

## Context

`cats-runtime` already defaults its durable data under `~/.cats/runtime`, but
the runtime still mixes directory-level and file-level defaults:

- `data/` and `sessions/` live under `~/.cats/runtime`
- `providers.yaml` currently defaults to `~/.cats/runtime/providers.yaml`
- `management.yaml` still defaults to repo-local `config/management.yaml`
- path overrides exist, but there is no single directory-first runtime root
  contract exposed to operators

We want runtime storage to be consistent across standalone runtime use,
desktop-hosted runtime use, and future tools that consume the same home tree.

## Decision

`cats-runtime` will treat `~/.cats/runtime` as the canonical runtime root and
split its durable files like this:

```text
~/.cats/
  runtime/
    config/
      providers.yaml
      management.yaml
    data/
    sessions/
```

The runtime will follow these rules:

1. `CATS_RUNTIME_DIR` becomes the primary directory-level override.
2. `CATS_RUNTIME_CONFIG_PATH`, `CATS_RUNTIME_DATA_DIR`, and
   `CATS_RUNTIME_SESSION_BASE_DIR` remain supported as fine-grained overrides.
3. When those fine-grained overrides are relative, they are resolved under
   `CATS_RUNTIME_DIR`, not under the current working directory.
4. `providers.yaml` defaults to `~/.cats/runtime/config/providers.yaml`.
5. `management.yaml` defaults to `~/.cats/runtime/config/management.yaml`.
6. Standalone runtime execution and desktop-hosted runtime execution must use
   the same storage layout.
7. Repo-local `config/management.yaml` is no longer a runtime default.

## Consequences

### Positive

- Runtime storage becomes coherent: config files live under one config subtree,
  while data and sessions remain separate.
- Standalone and desktop-hosted runtime flows share the same durable paths.
- Operator intent becomes directory-first instead of a collection of unrelated
  path variables.
- Repo-local defaults stop leaking into production/runtime behavior.

### Negative

- Existing tests and docs that assume flat `~/.cats/runtime/providers.yaml` or
  repo-local `config/management.yaml` must be updated.
- Legacy operator notes that mention the old paths need migration guidance.

### Neutral

- Fine-grained path overrides stay available, but they become secondary to the
  runtime root directory.

## Alternatives Considered

### Alternative 1: Keep `providers.yaml` flat and only move `management.yaml`

- **Pros**: Smaller code diff; less documentation churn.
- **Cons**: Runtime config remains split across two patterns.
- **Why rejected**: It preserves the same inconsistency that caused the current
  confusion.

### Alternative 2: Remove all file-level overrides entirely

- **Pros**: Cleaner API surface.
- **Cons**: Makes tests and special operator setups harder.
- **Why rejected**: Fine-grained overrides still have value for tests and edge
  cases; they just should not define the primary contract.

## References

- [023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers](./023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers.md)
- [021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it](./021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it.md)
- `cats-platform` ADR-053: `Use structured ~/.cats platform storage`

---

*Decision made: 2026-04-05*
*Decision makers: User, Codex*
