# ADR-031: Keep ACP inside the `agent` backend family and model runtime ACP as a separate facade

Date: 2026-04-15
Status: Proposed

## Context

`cats-runtime` already has four backend families:

- `cli`
- `api`
- `local`
- `agent`

The current `agent` family already hosts remote-agent-style integrations that
do not fit cleanly into either subprocess-backed CLI execution or
completion-oriented HTTP transports.

ACP introduces a new protocol opportunity, but it appears in two different
directions:

1. `cats-runtime` can consume an external ACP-compatible agent such as
   `codex-acp` or `claude-agent-acp`.
2. `cats-runtime` can expose itself as an ACP-compatible agent so IDEs and
   editor clients can use it as their backend.

Those two directions share protocol vocabulary, but they do not share the same
architectural role.

The provider-facing direction makes `cats-runtime` an ACP client/host that must
answer capability requests from an external ACP agent.

The IDE-facing direction makes `cats-runtime` the ACP agent/server that exposes
its own session and execution model to an external client.

At the same time, the runtime already has an A2A-aligned direction for
agent-to-agent or runtime-to-runtime collaboration. The question is whether ACP:

- becomes a new top-level backend family,
- lands as an `agent` transport,
- or should be split between provider integration and runtime exposure.

## Decision

`cats-runtime` will keep ACP-backed provider integrations inside the existing
`agent` backend family, and will model runtime-owned ACP exposure as a separate
runtime facade rather than as another provider backend.

This decision includes:

1. ACP-backed provider targets belong under `backends.agent.providers.*`.
2. The runtime should describe that direction as `agent/acp` conceptually.
3. The first concrete ACP provider transport may narrow further, for example to
   `acp_stdio`, but it still belongs to the `agent` backend family.
4. `cats-runtime` exposing itself to IDEs over ACP is a separate runtime-owned
   boundary and must not be modeled as a provider target in `providers.yaml`.
5. A2A and ACP are complementary:
   - A2A remains the agent-to-agent/runtime-to-runtime layer.
   - ACP becomes the client-to-agent layer.
6. The runtime should not introduce a new top-level `acp` backend family
   unless a proven mismatch appears that the current `agent` seam cannot absorb.

## Rationale

### Why ACP provider targets fit `agent`

Provider-facing ACP integrations have the same architectural properties as the
current `agent` family:

- provider-managed continuity
- adapter-owned lifecycle and stream framing
- remote capability discovery and inspection
- non-CLI and non-completion semantics

That makes ACP a transport family inside `agent`, not a new execution family.

### Why runtime ACP exposure is different

When `cats-runtime` exposes itself over ACP, the direction is reversed:

- the client owns ACP session creation and capability advertisement
- `cats-runtime` becomes the agent being consumed
- the runtime exposes its own session/workspace/tooling model outward

That is not a provider-routing problem. It is a runtime-boundary problem.

### Why A2A and ACP should both exist

They solve adjacent but different layers:

- ACP connects a user-facing client to an agent
- A2A connects one agentic system to another

Keeping them separate preserves a clean stack:

- IDE/client -> ACP -> `cats-runtime`
- `cats-runtime` -> A2A -> peer runtime / peer agent

## Consequences

### Positive

- keeps backend taxonomy stable
- allows CLI/API/agent ACP targets to coexist for the same provider family
- avoids conflating provider integration with runtime exposure
- leaves room for a future IDE-facing ACP surface without polluting
  `providers.yaml`
- gives A2A and ACP clear, complementary roles

### Negative

- shared ACP vocabulary may still confuse future contributors unless docs stay
  explicit about directionality
- the current `AgentAdapter` seam will likely need additive capability-bridge
  work for ACP-specific permission/filesystem/terminal interactions
- the runtime-owned ACP facade cannot be a trivial alias of the provider-side
  ACP adapter because the control direction is inverted

### Neutral

- this ADR does not choose the exact first ACP transport name
- this ADR does not require immediate ACP implementation
- existing CLI seams remain valid and do not need to be replaced

## Alternatives Considered

### 1. Create a top-level `acp` backend family

- **Pros**: protocol name is explicit in config
- **Cons**: duplicates the existing remote-agent category and hides the real
  difference between provider-side and runtime-side ACP
- **Why rejected**: ACP provider targets behave like `agent` transports, not a
  separate execution family

### 2. Treat ACP providers as enhanced CLI targets

- **Pros**: some ACP agents are launched as local commands
- **Cons**: ACP is not just subprocess spawning; it requires capability
  negotiation and bidirectional protocol handling
- **Why rejected**: the behavior matches `agent` semantics more closely than
  `cli` semantics

### 3. Build only the IDE-facing ACP facade and skip `agent/acp`

- **Pros**: enables IDE consumption earlier
- **Cons**: leaves external ACP agents outside the runtime's provider model
- **Why rejected**: both directions are useful, and they should be documented
  together without collapsing them into one abstraction

### 4. Fold A2A into ACP

- **Pros**: fewer protocol names in discussion
- **Cons**: erases the difference between client-to-agent and
  agent-to-agent/runtime-to-runtime contracts
- **Why rejected**: the layers are complementary, not interchangeable

### 5. Gradually migrate existing CLI targets to `agent/acp`

- **Pros**: could eventually reduce provider-specific subprocess parsing and
  consolidate more behavior under one agent-style transport
- **Cons**: assumes ACP targets will reach sufficient capability parity,
  stability, and governance fit for each provider family; also risks removing a
  simpler and already-proven CLI fallback too early
- **Why not chosen as the default direction now**: the runtime should treat
  CLI and `agent/acp` as coexistence paths first. Migration, if it happens at
  all, should be a later provider-by-provider decision made only after the ACP
  path proves operationally superior for that family

## Notes for Future Work

Future ACP work should preserve three explicit distinctions:

1. provider-side ACP adapter versus runtime-owned ACP facade
2. protocol transport naming versus backend family naming
3. ACP client capability bridging versus runtime-owned local tool execution

The first ACP slice should be free to start conservatively with a bounded
capability profile rather than promising parity with every ACP-capable IDE on
day one.

The runtime should also keep the relationship between existing CLI targets and
future `agent/acp` targets explicit:

- coexistence comes first
- migration is optional and provider-specific
- CLI remains a valid long-term fallback unless a later decision retires it

## Related

- [ADR 006: Introduce an agent backend and shared runtime contracts](./006-agent-backend-and-shared-runtime-contracts.md)
- [ADR 026: Model A2A as an agent backend adapter](./026-model-a2a-as-an-agent-backend-adapter.md)
- [SPEC-003: Agent Backend for External Agent Runtimes](../specs/SPEC-003-agent-backend.md)
- [SPEC-025: ACP Agent Adapters and Runtime ACP Facade](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md)
- [2026-04-15 ACP agent backend and runtime facade alignment](../research/2026-04-15-acp-agent-backend-and-runtime-facade-alignment.md)
