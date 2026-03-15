# ADR 003: Move Provider Execution Topology Into File-Based Provider Instances

## Status

Accepted

## Date

2026-03-15

## Context

The original CLI runtime config treated each provider as a singleton. That was
manageable while settings lived in `.env`, but it became difficult to extend:

- one provider needed to choose only one runtime (`native` or `wsl`)
- runner/path/runtime settings for all providers crowded `.env.example`
- a single provider could not expose multiple WSL distros as separate workers

This was especially limiting on Windows, where one host may have several WSL
distros and each distro may hold its own CLI installation and login state.

## Decision

`cats-runtime` will keep `.env` for runtime-wide values and secrets, and move
provider execution topology into `config/providers.yaml`.

The file-based model is:

- `environments`: named execution contexts such as `native` or a WSL distro
- `providers.<name>.default_instance`: the instance used when callers omit `instance`
- `providers.<name>.instances.<id>`: command, runner, runtime, and provider-local storage

Runtime/session flows now treat `providerInstanceId` as first-class metadata.
Routing, discovery, and session registry matching are keyed by `(provider, instance)`.

## Rationale

- separates global runtime settings from provider topology
- makes multi-instance WSL support explicit and user-manageable
- leaves room for future environment kinds such as Docker without changing the
  session routing model again
- preserves backward compatibility by keeping legacy env-based provider config
  as a fallback when no file config is present

## Consequences

### Positive

- cleaner `.env.example`
- one provider can expose multiple independently logged-in WSL environments
- discovery and worker allocation can scale by provider instance

### Negative

- configuration becomes a two-file setup (`.env` plus `providers.yaml`)
- API and session metadata now carry an extra instance dimension
- dashboard and docs must surface instance-aware discovery state

## Follow-up

- keep Docker out of the runtime until container persistence/login behavior is validated
- add instance selection to any product-layer UIs that create sessions
- revisit whether non-default provider instances need richer health reporting
