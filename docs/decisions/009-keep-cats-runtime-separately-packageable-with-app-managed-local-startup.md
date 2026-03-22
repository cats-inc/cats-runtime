# ADR 009: Keep `cats-runtime` Separately Packageable with App-Managed Local Startup

## Status

Proposed

## Date

2026-03-19

## Context

`cats-runtime` is the accepted runtime boundary for upper-layer products such as
`cats`. The runtime already owns provider execution, session lifecycle,
streaming, discovery, and backend-specific behavior behind one public HTTP
contract.

Recent product direction clarified a new distribution goal for the first
consumer, `cats`:

- technical users should be able to try the product through a self-hosted npm
  app flow such as `npx cats`
- that flow should feel like one product even when multiple local services are
  involved

This creates a tempting but risky shortcut: collapsing `cats-runtime` into
`cats` internals just to make startup feel simpler.

That shortcut would conflict with decisions already recorded in this repo and
in `cats`:

- `cats-runtime` is meant to stay the stable runtime boundary
- the runtime is already useful beyond one product shell
- process-local packaging convenience should not erase the explicit service
  contract that keeps upper layers decoupled

At the same time, insisting that every user manually install, configure, and
start `cats-runtime` as a separate concern would make the desired self-hosted
product trial path much worse.

The project needs an explicit answer for how `cats-runtime` should behave under
an app-managed self-hosted distribution model.

## Decision

`cats-runtime` will remain a separately packageable runtime boundary while also
supporting app-managed local startup by upper-layer hosts such as `cats`
and a future Electron shell.

This decision includes:

1. `cats-runtime` remains its own project, documentation surface, and runtime
   contract. It is not demoted to a private source-level module inside
   `cats`.
2. The runtime must continue to support **standalone mode**, where an operator
   starts it directly for development, debugging, or independent consumers.
3. The runtime must also support **app-managed local mode**, where a product
   host starts and supervises it as a local dependency.
4. In app-managed mode, hosts should interact with `cats-runtime` over its
   public process and HTTP readiness boundary, not by source-importing runtime
   internals into the product app.
5. Runtime packaging and startup contracts should be explicit enough for local
   supervisors to manage them cleanly: executable entrypoint, health/readiness,
   config discovery, data-dir ownership, and shutdown behavior.
6. Convenience for app-managed startup should not come at the cost of
   provider-specific leakage into upper-layer products.
7. If reusable client helpers are needed for product apps, they should live in
   thin client libraries or documented API contracts, not by bypassing the
   runtime boundary itself.

## Rationale

- preserves `cats-runtime` as a reusable boundary for more than one product
- keeps debugging and operational visibility clearer because runtime and
  product layers remain separable
- supports the desired one-product self-hosted experience without forcing
  manual multi-service orchestration on every technical evaluator
- stays compatible with the accepted Electron-sidecar direction

## Consequences

### Positive

- `cats` and future hosts can offer a smoother local startup flow without
  absorbing runtime internals.
- The runtime stays reusable for other consumers, including independent local
  tools or future product shells.
- Operational contracts such as readiness, shutdown, and health become clearer
  because they must work for both standalone and app-managed startup.
- The same topology can serve direct local development, npm-based self-hosted
  trials, and later desktop wrappers.

### Negative

- The local product experience still involves more than one process, even when
  startup is wrapped by one command.
- Version compatibility and startup ordering between product apps and the
  runtime need explicit handling.
- Packaging work must account for both independent runtime operation and
  app-managed startup.

### Neutral

- This decision does not require a specific package manager or installer
  format.
- This decision does not prevent future optimizations to reduce process
  overhead, as long as the public runtime boundary remains intact.

## Alternatives Considered

### Alternative 1: Merge `cats-runtime` into `cats`

- **Pros**: Simplest story for one-command startup on paper.
- **Cons**: Destroys the explicit runtime boundary and tightly couples product
  code to provider execution details.
- **Why rejected**: It works against the accepted architecture and reduces
  runtime reuse across products.

### Alternative 2: Require Users to Run `cats-runtime` Separately in All Cases

- **Pros**: Preserves a clean separation and keeps packaging responsibilities
  narrow.
- **Cons**: Makes the intended self-hosted technical trial path significantly
  more cumbersome.
- **Why rejected**: The product direction explicitly wants easier local trial
  and contribution flows.

### Alternative 3: Hide `cats-runtime` as a Purely Internal Private Helper

- **Pros**: Could simplify product messaging in the short term.
- **Cons**: Makes independent runtime validation, debugging, and alternative
  consumers harder.
- **Why rejected**: The runtime is already a first-class boundary with multiple
  current and future consumers.

## References

- [ADR 002: Embed the CLI runtime into `cats-runtime`](./002-embed-cli-runtime.md)
- [ADR 005: Introduce a backend-neutral runtime facade for CLI and API backends](./005-backend-neutral-runtime-and-api-backend.md)
- [ADR 006: Introduce an agent backend and shared runtime contracts](./006-agent-backend-and-shared-runtime-contracts.md)
- [cats ADR-013: Ship `cats` as an executable self-hosted npm app](../../../cats/docs/decisions/013-ship-cats-as-an-executable-self-hosted-npm-app.md)

---

*Decision made: 2026-03-19*
*Decision makers: Proposed by Codex from user direction*

