# ADR 001: Use an HTTP Adapter Around `agent-fleet` First

## Status

Superseded by [ADR 002](./002-embed-cli-runtime.md)

## Date

2026-03-11

## Context

`cats-runtime` is intended to become the stable runtime boundary for upper-layer
apps such as `cats-inc` and the transitional `crew-chat-poc` migration. The
existing CLI execution engine already lives in `agent-fleet`.

The immediate question was whether `cats-runtime` should:

1. import `agent-fleet` internals directly, or
2. treat `agent-fleet` as an external backend behind a thin adapter

## Decision

`cats-runtime` will treat `agent-fleet` as an external HTTP backend in phase 1.

## Rationale

- Keeps the public contract separate from `agent-fleet` implementation details
- Lets `crew-chat-poc` migrate one layer at a time
- Makes future backends such as `api-runtime` or Ollama integration fit the same
  facade
- Avoids a fake rename where code is merely source-imported under a new directory

## Consequences

### Positive

- Cleaner backend boundary
- Easier future extraction into `cats-inc/cats-runtime`
- Consumers can switch from `agent-fleet` to `cats-runtime` with a smaller diff

### Negative

- Another HTTP hop exists in phase 1
- Some endpoints are still passthroughs rather than a richer normalized contract

## Follow-up

- Migrate `crew-chat-poc` to `cats-runtime`
- Add the future `api-runtime` backend under the same facade
