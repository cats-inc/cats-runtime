# ACP Agent Backend and Runtime Facade Alignment

Date: 2026-04-15
Topic: How ACP fits `cats-runtime` as both a provider-side agent transport and a future IDE-facing runtime facade
Source:
- ACP Overview: https://agentclientprotocol.com/protocol/overview
- A2A latest docs: https://a2a-protocol.org/latest/
- Zed external agents docs: https://zed.dev/docs/ai/external-agents
- Codex ACP repository: https://github.com/zed-industries/codex-acp
- Claude Agent ACP repository: https://github.com/agentclientprotocol/claude-agent-acp
Summary: ACP should not become a new top-level backend family in `cats-runtime`. When the runtime consumes an ACP-compatible external agent, ACP behaves like another `agent` transport. When IDEs consume `cats-runtime` itself over ACP, that is a separate runtime-owned facade because the control direction and capability ownership are inverted. A2A remains complementary because it solves agent-to-agent/runtime-to-runtime communication instead of client-to-agent communication.
Relevance: This clarifies why `agent/acp` and a future runtime ACP facade can both exist without sharing one config surface or one implementation class.
Action Items:
- Record an ADR that keeps ACP inside the existing `agent` backend family
- Write a spec that separates provider-side ACP from runtime-facing ACP
- Create a plan that stages `agent/acp` first and the runtime ACP facade later
- Keep A2A and ACP layered explicitly in architecture docs

## Key Findings

### 1. ACP is a client-to-agent protocol

The ACP overview positions ACP as the boundary between an external client and
an agent. That matters because it means the protocol is inherently directional:

- the client asks to initialize/create/prompt
- the agent answers and may request capabilities from the client

This is not the same architectural role as a provider-routing config entry.

### 2. ACP-capable IDEs already consume provider-specific adapters directly

Zed's external-agent documentation shows a concrete production pattern:

- Zed installs and manages `codex-acp`
- Zed can also run custom ACP-compatible agents via a command
- ACP-capable external agents can have different auth and capability profiles

That confirms ACP is not hypothetical editor-only vocabulary. It is already a
real distribution and runtime shape for coding agents.

### 3. Provider-side ACP and runtime-facing ACP are inverse roles

If `cats-runtime` consumes `codex-acp` or `claude-agent-acp`, then
`cats-runtime` must act as the ACP client/host for that provider target.

If Zed or another ACP-capable IDE consumes `cats-runtime`, then `cats-runtime`
must act as the ACP agent/server.

Those two directions should not share one config path in `providers.yaml`.

### 4. A2A remains a different layer

The A2A docs define a peer or agentic-application interoperability layer. That
aligns to:

- runtime-to-runtime collaboration
- peer routing
- agent-to-agent integration

It does not replace ACP's client-to-agent role.

### 5. The right `cats-runtime` mental model is a layered stack

The cleanest long-term picture is:

- client/IDE -> ACP -> `cats-runtime`
- `cats-runtime` -> A2A -> peer runtime or peer agent
- `cats-runtime` -> `agent/acp` -> external ACP-compatible provider agent

This keeps client, runtime, peer, and provider roles separate.

## Implications for `cats-runtime`

### Backend Taxonomy

ACP should stay inside `agent` for provider integrations.

### Config Taxonomy

`providers.yaml` should describe provider-side ACP targets only. It should not
be used to describe IDE-facing runtime ACP exposure.

### Runtime Surface Taxonomy

The runtime should treat future ACP exposure similarly to another outward-facing
transport/facade, not another provider instance.

## Related

- [ADR 031: Keep ACP inside the `agent` backend family and model runtime ACP as a separate facade](../decisions/031-keep-acp-inside-agent-backend-and-model-runtime-acp-as-a-separate-facade.md)
- [SPEC-025: ACP Agent Adapters and Runtime ACP Facade](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md)
- [PLAN-032: ACP Agent Adapters and Runtime ACP Facade](../plans/PLAN-032-acp-agent-adapters-and-runtime-facade.md)
