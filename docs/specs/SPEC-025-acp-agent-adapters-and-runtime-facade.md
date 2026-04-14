# SPEC-025: ACP Agent Adapters and Runtime ACP Facade

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

`cats-runtime` already has a stable backend split:

- `cli` for subprocess-backed provider tools
- `api` / `local` for completion-oriented remote and local model runtimes
- `agent` for external agent-style runtimes such as OpenClaw and Agent SDK

ACP introduces an additional integration path, but it appears in two distinct
directions that must not be collapsed:

1. **ACP provider adapter**: `cats-runtime` consumes an external ACP-compatible
   agent as a provider target.
2. **Runtime ACP facade**: an IDE or other ACP-capable client consumes
   `cats-runtime` itself as an ACP-compatible agent.

This spec defines both directions together so the runtime can adopt ACP without
inventing a new top-level backend family or confusing provider-routing with
runtime exposure.

It also records how ACP complements the runtime's A2A direction:

- ACP is the client-to-agent layer
- A2A is the agent-to-agent/runtime-to-runtime layer

## Goals

- Keep ACP-backed provider integrations inside the existing `agent` backend
  family
- Allow ACP and existing CLI/API/agent targets to coexist for the same provider
  family
- Define the capability and lifecycle requirements for a provider-side ACP
  adapter
- Reserve a separate runtime-owned ACP facade for future IDE consumption of
  `cats-runtime`
- Keep A2A and ACP layered cleanly instead of merging them into one abstraction

## Non-Goals

- Replacing the current Claude/Codex CLI seams immediately
- Shipping every ACP capability in the first implementation slice
- Replacing MCP with ACP
- Replacing A2A with ACP
- Building IDE-specific UX inside `cats-runtime`
- Freezing the exact first ACP transport name before the first executable slice

## User Stories

- As a runtime operator, I want to configure `codex` or `claude` with both
  `cli/native` and `agent/acp` targets so I can compare behavior without
  changing the rest of the product.
- As a runtime maintainer, I want ACP provider support to reuse the existing
  `agent` backend family instead of adding a fifth backend taxonomy.
- As a future IDE integrator, I want an ACP-capable editor such as Zed or a
  future ACP-capable IDE client to use `cats-runtime` as its backend without
  talking directly to provider-specific CLIs.
- As an architect, I want ACP and A2A to compose into a clean stack rather than
  compete for the same architectural slot.

## Problem Statement

The same protocol label, ACP, can appear in opposite directions:

- `cats-runtime` as ACP client/host to an external ACP agent
- `cats-runtime` as ACP agent/server to an external ACP client

These flows share JSON-RPC vocabulary, but they do not share the same source of
truth, ownership, or capability model.

If they are treated as the same thing, the runtime risks:

- polluting `providers.yaml` with runtime-exposure concerns
- overfitting provider adapters to IDE-facing client assumptions
- confusing A2A and ACP layering

## Requirements

### Functional Requirements

1. The runtime shall continue to classify ACP-backed provider integrations under
   backend kind `agent`, not a new top-level `acp` backend.
2. The runtime shall allow the same provider family to expose multiple targets
   concurrently across `cli`, `api`, `local`, and `agent`.
3. The runtime shall support a new ACP transport family inside
   `backends.agent.providers.*`.
4. The provider-facing ACP adapter shall implement the shared `AgentAdapter`
   seam rather than introducing a parallel backend contract.
5. The provider-facing ACP adapter shall bridge ACP capability requests such as
   permission, filesystem, terminal, and optional client-side MCP exposure onto
   runtime-owned capability seams rather than bypassing runtime governance.
6. The provider-facing ACP adapter shall normalize ACP lifecycle and stream
   events into existing runtime `StreamEvent` categories plus raw provider
   payloads when needed.
7. The runtime shall expose ACP adapter inspection and diagnostics in a way
   that is distinguishable from gateway-style agent transports.
8. The runtime shall model IDE-facing ACP exposure as a separate runtime-owned
   facade and shall not represent that surface as a provider target in
   `providers.yaml`.
9. The runtime-owned ACP facade shall map ACP session and prompt flows onto the
   existing runtime session API rather than inventing a second session source of
   truth.
10. The runtime-owned ACP facade shall support a conservative, explicitly
    documented capability profile in its first slice rather than implying full
    parity with every ACP-capable client.
11. The runtime's architecture docs shall describe ACP and A2A as complementary
    layers:
    - ACP for client-to-agent integration
    - A2A for agent-to-agent/runtime-to-runtime integration
12. The runtime shall keep provider-side ACP integration and runtime-facing ACP
    exposure independently configurable and independently evolvable.

### Non-Functional Requirements

- **Coexistence**: Existing CLI/API/agent targets must remain valid while ACP is
  added incrementally.
- **Truthfulness**: Docs and diagnostics must state clearly which ACP
  capabilities are implemented, delegated, or unsupported.
- **Separation of concerns**: Provider routing must stay distinct from
  runtime-boundary transports.
- **Security**: ACP capability requests must not become a back door around the
  runtime's approval, workspace, or tool-governance rules.
- **Extensibility**: The design must leave room for both provider-side ACP and
  runtime-owned ACP without forcing them into one implementation class.

## Design Overview

### Conceptual Split

### 1. Provider-side ACP Adapter

This direction treats ACP as another `agent` transport:

- `cats-runtime` owns the runtime session
- the external ACP agent owns its provider-specific session semantics
- the adapter bridges ACP JSON-RPC, capability requests, and event framing into
  runtime contracts

Conceptual config shape:

The example below intentionally follows the current `providers.yaml` family /
`default_instance` / `instances` layout that existing remote backends already
use today. It is conceptual only in the ACP-specific transport fields; it does
not propose a second config hierarchy for ACP, and it does not freeze the exact
ACP launch/connect keys for the first executable slice.

```yaml
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: native

backends:
  agent:
    providers:
      codex:
        default_instance: acp-local
        transport: acp
        instances:
          acp-local:
            model: gpt-5.4
            # first executable slice may add launch-specific settings such as
            # command/args/env when the ACP transport is finalized
```

This preserves side-by-side targets such as:

- `cli/native`
- `api/main`
- `agent/acp-local`

That means the current config mental model stays intact:

- `routing.providers.<family>.default_target` still chooses the active target
- `backends.agent.providers.<family>` still owns remote agent transports
- ACP only adds another transport family under that existing shape

### 2. Runtime-owned ACP Facade

This direction exposes `cats-runtime` itself as an ACP-compatible agent:

- the IDE/client owns ACP client behavior
- `cats-runtime` owns session routing, worktrees, diagnostics, and tool policy
- ACP JSON-RPC becomes an additive transport over the same runtime session API

This surface does **not** belong in `providers.yaml`.

### 3. A2A Complement

The long-term stack should remain explicit:

- IDE/client -> ACP -> `cats-runtime`
- `cats-runtime` -> A2A -> peer runtime or peer agent
- `cats-runtime` -> `agent/acp` -> external ACP-compatible provider agent

Those layers are compatible because they solve different boundaries.

## Capability Model

### Provider-side ACP Adapter

The provider-side adapter must eventually account for ACP capability requests
such as:

- permission prompts
- file reads and writes
- terminal creation and command execution
- optional client MCP server visibility

The runtime must not answer those requests ad hoc. They should map onto
existing runtime-owned capability seams wherever possible, for example:

- workspace/worktree rules
- execution guardrails
- runtime-hosted local tool policies
- MCP visibility policies

### Runtime-owned ACP Facade

The runtime-facing facade should start with a conservative capability profile.

Early slices may explicitly limit or defer:

- checkpoint parity
- history import/export parity
- arbitrary IDE-owned capability passthrough
- every possible ACP client extension

The first goal is a truthful, usable bridge to runtime sessions, not feature
maximalism.

## Proposed Runtime Surfaces

### Provider-side ACP

- `src/backends/agent/adapters/acp/`
- additive ACP-specific inspection metadata
- additive ACP capability diagnostics
- runtime session/provider-state persistence through the existing session
  registry and inspection routes

### Runtime-owned ACP Facade

Possible future shapes include:

- `src/acp/` plus a dedicated stdio entrypoint
- a runtime-owned ACP proxy command analogous in spirit to the existing MCP
  stdio helper, but adapted for ACP's bidirectional capability model
- additive health/readiness reporting so supervising hosts can distinguish the
  runtime process from ACP client sessions

This spec does not freeze the exact file layout yet. It only freezes the
architectural separation.

## Acceptance Criteria

- [ ] ACP-backed provider targets are documented as `agent` transports rather
      than a new top-level backend family
- [ ] The docs show that one provider family may expose CLI/API/agent ACP
      targets side by side
- [ ] A provider-side ACP adapter contract is defined against the shared
      `AgentAdapter` seam
- [ ] A runtime-owned ACP facade is documented as a separate runtime transport
      boundary, not a provider target
- [ ] The first ACP capability profile is explicitly bounded and truthful
- [ ] The architecture documentation states that ACP and A2A are complementary
      layers rather than substitutes
- [ ] An implementation plan exists for the staged delivery sequence

## Related

- [ADR 031: Keep ACP inside the `agent` backend family and model runtime ACP as a separate facade](../decisions/031-keep-acp-inside-agent-backend-and-model-runtime-acp-as-a-separate-facade.md)
- [ADR 026: Model A2A as an agent backend adapter](../decisions/026-model-a2a-as-an-agent-backend-adapter.md)
- [SPEC-003: Agent Backend for External Agent Runtimes](./SPEC-003-agent-backend.md)
- [PLAN-032: ACP Agent Adapters and Runtime ACP Facade](../plans/PLAN-032-acp-agent-adapters-and-runtime-facade.md)
