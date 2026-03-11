# ADR 002: Embed the CLI Runtime Into `cats-runtime`

## Status

Accepted

## Date

2026-03-11

## Context

ADR 001 deliberately started `cats-runtime` as a thin HTTP facade around
`agent-fleet`. That reduced migration risk, but it also left local development
and deployment with two always-on services and two ports.

The current direction for `cats-runtime` is no longer "thin facade forever".
It is the long-term runtime boundary that will host:

- subscription CLI execution
- future API-key backends
- future Ollama/local model backends

Keeping the CLI runtime outside the repo would preserve an unnecessary process
boundary and make `cats-runtime` look stable while delegating the real logic
elsewhere.

## Decision

`cats-runtime` will embed the CLI runtime directly.

The code previously living in `agent-fleet` is ported into:

- `src/backends/cli`
- `src/http`
- `src/core`

`agent-fleet` remains unchanged as a migration source and comparison point, but
it is no longer a runtime dependency of `cats-runtime`.

## Rationale

- Removes the extra local HTTP hop and second required service
- Makes `cats-runtime` the real execution boundary rather than a proxy shell
- Establishes the long-term layout: `core + backends/* + http`
- Leaves room for future `backends/api` without rethinking the inbound service

## Consequences

### Positive

- Single local service and port for consumers
- Lower latency and simpler deployment
- Easier future work on shared session/domain models inside one codebase

### Negative

- `cats-runtime` now owns more code and operational complexity
- The initial port carries over some internal naming and implementation patterns
  from `agent-fleet` that may need later cleanup

## Follow-up

- Keep `crew-chat-poc` pointed at the embedded `cats-runtime`
- Add `src/backends/api`
- Revisit any remaining public-contract migration shims only when breaking changes are acceptable
