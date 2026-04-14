# ACP Agent Backend and Runtime Facade Alignment

Date: 2026-04-15
Topic: How ACP fits `cats-runtime` as both a provider-side agent transport and a future IDE-facing runtime facade
Source:
- ACP Overview: https://agentclientprotocol.com/protocol/overview
- ACP Agents page: https://agentclientprotocol.com/get-started/agents
- ACP Registry page: https://agentclientprotocol.com/get-started/registry
- A2A latest docs: https://a2a-protocol.org/latest/
- Zed external agents docs: https://zed.dev/docs/ai/external-agents
- Codex ACP repository: https://github.com/zed-industries/codex-acp
- Claude Agent ACP repository: https://github.com/agentclientprotocol/claude-agent-acp
Summary: ACP should not become a new top-level backend family in `cats-runtime`. When the runtime consumes an ACP-compatible external agent, ACP behaves like another `agent` transport. When IDEs consume `cats-runtime` itself over ACP, that is a separate runtime-owned facade because the control direction and capability ownership are inverted. The public ACP ecosystem is also much larger than `claude-agent-acp` and `codex-acp`, so the runtime needs an explicit adoption matrix based on overlap with its existing provider families rather than a two-provider mental model. A2A remains complementary because it solves agent-to-agent/runtime-to-runtime communication instead of client-to-agent communication.
Relevance: This clarifies why `agent/acp` and a future runtime ACP facade can both exist without sharing one config surface or one implementation class, and why the runtime should track a broader ACP provider matrix without promising to ingest every public ACP agent.
Action Items:
- Record an ADR that keeps ACP inside the existing `agent` backend family
- Write a spec that separates provider-side ACP from runtime-facing ACP
- Create a plan that stages `agent/acp` first and the runtime ACP facade later
- Keep A2A and ACP layered explicitly in architecture docs
- Record which ACP-compatible agents overlap with the runtime's existing
  provider families and which ones should be first-wave, later-wave, or
  observation-only candidates

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

### 3. The ACP ecosystem is broader than `claude` and `codex`

The public ACP pages make two useful distinctions:

- the **Agents** page lists ACP-compatible agents broadly
- the **Registry** page lists a narrower curated set that currently includes
  agents with authentication support

As of 2026-04-15:

- the Agents page lists 31 ACP-compatible agents
- the Registry page lists 27 curated auth-capable agents

That matters for `cats-runtime` because it means ACP support should not be
framed only as "should we add Claude ACP or Codex ACP?" The real design
question is which part of the ACP ecosystem overlaps with the runtime's current
provider taxonomy.

### 4. Provider-side ACP and runtime-facing ACP are inverse roles

If `cats-runtime` consumes `codex-acp` or `claude-agent-acp`, then
`cats-runtime` must act as the ACP client/host for that provider target.

If Zed or another ACP-capable IDE consumes `cats-runtime`, then `cats-runtime`
must act as the ACP agent/server.

Those two directions should not share one config path in `providers.yaml`.

### 5. ACP adoption should follow runtime-provider overlap, not registry size

The runtime already has these provider families in its inventory:

- `claude`
- `codex`
- `gemini`
- `cursor`
- `copilot`
- `opencode`
- `kilo`
- `goose`
- `pi`
- `auggie`
- `junie`
- `kiro`

Those are the ACP families that should be tracked in the runtime's adoption
matrix first, because they already have config, routing, session, and product
meaning inside `cats-runtime`.

The practical prioritization is:

- **Tier 1**: `codex`, `gemini`, `opencode`, `goose`, `kilo`, `pi`, `auggie`
- **Tier 2**: `cursor`, `copilot`, `junie`
- **Conditional**: `claude`
- **Observe only**: `kiro`

This is an inference from the public ACP ecosystem plus the runtime's existing
provider seams. It is not claimed as an ACP standard.

### 6. A2A remains a different layer

The A2A docs define a peer or agentic-application interoperability layer. That
aligns to:

- runtime-to-runtime collaboration
- peer routing
- agent-to-agent integration

It does not replace ACP's client-to-agent role.

### 7. The right `cats-runtime` mental model is a layered stack

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

### Adoption Taxonomy

The runtime should keep an explicit ACP support matrix for overlapping provider
families. It should not treat the public ACP registry as a promise that every
listed agent will become a first-class `cats-runtime` provider target.

### Runtime Surface Taxonomy

The runtime should treat future ACP exposure similarly to another outward-facing
transport/facade, not another provider instance.

## Related

- [ADR 031: Keep ACP inside the `agent` backend family and model runtime ACP as a separate facade](../decisions/031-keep-acp-inside-agent-backend-and-model-runtime-acp-as-a-separate-facade.md)
- [SPEC-025: ACP Agent Adapters and Runtime ACP Facade](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md)
- [PLAN-032: ACP Agent Adapters and Runtime ACP Facade](../plans/PLAN-032-acp-agent-adapters-and-runtime-facade.md)
