# PLAN-032: ACP Agent Adapters and Runtime ACP Facade

> Implementation plan for adopting ACP in both relevant directions without
> creating a new top-level backend family or confusing provider routing with
> runtime exposure.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Phase 2 Host Bridge Contract Landed) |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Spec

[SPEC-025: ACP Agent Adapters and Runtime ACP Facade](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md)

## Overview

ACP matters to `cats-runtime` in two distinct ways:

1. `cats-runtime` can consume external ACP agents as provider targets.
2. `cats-runtime` can expose itself as an ACP-compatible backend so IDEs or
   other ACP-capable clients can consume it directly.

The first direction belongs inside the existing `agent` backend family. The
second is a runtime-owned transport/facade concern.

This plan stages both directions deliberately so the runtime can:

- keep current CLI/API/agent targets stable
- add `agent/acp` without inventing a new backend taxonomy
- defer the outward-facing ACP facade until the provider-side capability model
  is better understood
- document where A2A and ACP complement each other in the final stack

ACP also matters across more provider families than `claude` and `codex`.
The runtime should therefore keep an explicit ACP adoption matrix for the
provider families it already supports, rather than treating ACP as a one-off
integration track for only two vendors.

## Scope

### In Scope

- Reserve ACP as an `agent` transport family
- Extend config, adapter inspection, and diagnostics for ACP-backed providers
- Design a provider-side ACP capability bridge for permission/filesystem/
  terminal-style requests
- Pilot the first `agent/acp` provider target
- Design a separate runtime-owned ACP facade for IDE/client consumption
- Document the ACP + A2A layering model

### Out of Scope

- Replacing the current Claude/Codex CLI seams immediately
- Shipping every ACP capability in the first slice
- Making the runtime-owned ACP facade feature-complete before any pilot
- Replacing MCP or A2A
- IDE-specific UX work beyond protocol and capability truth

## Architecture Guardrails

1. Do not add a new top-level `acp` backend family.
2. Do not model IDE-facing ACP exposure inside `providers.yaml`.
3. Keep provider-side ACP adapters under `src/backends/agent/adapters/`.
4. Keep runtime-owned ACP exposure as a separate transport/facade boundary.
5. Keep A2A documented as the peer/runtime layer and ACP as the client layer.

## Recommended Delivery Sequence

### Phase 0: Documentation and Taxonomy Lock

- [x] Land ADR/SPEC/PLAN alignment for ACP classification and layering
- [x] Record that ACP provider targets live under `agent`
- [x] Record that runtime ACP exposure is a separate facade
- [x] Record the A2A + ACP complementary stack

**Deliverables**:

- ADR 031
- SPEC 025
- PLAN 032
- supporting research note with external ACP/A2A references

### Phase 1: Reserve the `agent/acp` Transport Slot

- [x] Extend `buildAgentAdapter(...)` to recognize an ACP transport family
- [x] Extend `AgentAdapterInspection` so ACP can describe its transport,
      capability, and auth posture truthfully
- [x] Extend config parsing so agent transports can carry ACP-specific launch or
      connection settings without forcing those fields into CLI-only config
- [x] Keep provider routing unchanged so ACP targets can coexist with CLI/API
      targets for the same provider family

**Deliverables**:

- config/type scaffolding for ACP under `agent`
- runtime inspection/docs that show `agent/acp` as a first-class target family

### Phase 2: Provider-side ACP Capability Bridge

- [x] Define the minimal runtime-owned host capability surface the ACP adapter
      can call into
- [ ] Map ACP permission requests onto runtime approval/guardrail policy
- [ ] Map ACP file access onto runtime workspace/worktree rules
- [ ] Map ACP terminal requests onto runtime execution controls
- [ ] Decide how ACP-facing client MCP server access should relate to the
      runtime's existing MCP and local-tool policies

**Deliverables**:

- ACP host capability bridge contract
- explicit capability profile for the first provider-side ACP slice

### Phase 3: First `agent/acp` Provider Pilot

- [x] Choose the first ACP target to pilot
- [ ] Implement the provider-side ACP adapter against the shared `AgentAdapter`
      seam
- [ ] Normalize lifecycle and stream events into runtime `StreamEvent`s
- [ ] Persist provider-managed ACP continuity state in the existing session
      registry
- [ ] Add targeted diagnostics, probe behavior, and model/tool discovery where
      the ACP target makes them available

The default recommendation for the first pilot is `codex-acp`.

The canonical ACP adoption matrix lives in
[SPEC-025](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md#acp-ecosystem-scope).
Phase 3 should interpret that matrix this way:

- `codex-acp` is the first executable Tier 1 pilot
- once the first pilot proves lifecycle, continuity, and diagnostics, the rest
  of Tier 1 becomes the next rollout bucket
- Tier 2, conditional, and observation-only families remain follow-on work

**Candidate first targets**:

- `codex-acp`
- `claude-agent-acp`

Selection should be based on:

- protocol overlap with an existing runtime seam
- capability truthfulness
- auth and launch stability
- testability in local repo workflows

Current rationale for preferring `codex-acp` first:

- the existing `codex` CLI provider already models Codex-specific JSON-RPC
  bootstrap, thread lifecycle, turn start, and approval/event handling, so the
  runtime already understands a meaningful slice of Codex-native semantics
- that makes `codex-acp` a narrower delta than starting from a provider family
  whose current runtime seam is less protocol-shaped
- the first ACP-specific work can therefore focus more on ACP client capability
  bridging and less on relearning provider-native turn semantics at the same
  time
- `claude-agent-acp` remains a strong second target once the ACP host
  capability bridge and diagnostics shape have been proven on one concrete
  target first
- after `codex-acp`, the next most promising runtime-owned follow-ons are the
  Tier 1 families whose existing runtime seams are already CLI- or
  protocol-oriented enough to benefit from the same ACP host bridge with
  limited extra taxonomy work

**Deliverables**:

- one working `agent/acp` provider target
- session creation/message/cancel/close flows through the existing runtime
  session API

### Phase 4: Runtime-owned ACP Facade for IDE Consumption

- [ ] Define the ACP session lifecycle mapping onto runtime session routes
- [ ] Decide the first transport shape for the runtime ACP facade
- [ ] Implement a conservative capability profile for IDE/client consumption
- [ ] Ensure facade sessions reuse the same runtime session ownership,
      diagnostics, and worktree truth
- [ ] Add readiness/debug guidance for ACP-capable clients

**Deliverables**:

- a bounded `cats-runtime` ACP facade suitable for at least one external client
- documented capability matrix and known limitations

### Phase 5: A2A + ACP Layering Follow-Through

- [ ] Update architecture and terminology docs so ACP and A2A are shown as
      complementary layers
- [ ] Confirm how runtime-owned ACP sessions can coexist with A2A peer routing
- [ ] Keep diagnostics truthful about which flows are:
      - client-to-runtime over ACP
      - runtime-to-provider over `agent/acp`
      - runtime-to-peer over A2A

**Deliverables**:

- clear docs and diagnostics boundaries for ACP versus A2A

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider-side ACP and runtime-facing ACP get conflated | High | Keep separate file/module boundaries and separate docs from the first slice |
| ACP capability requests bypass runtime guardrails | High | Route permission/fs/terminal requests through runtime-owned policy seams only |
| First ACP target overfits the transport taxonomy | Medium | Reserve `agent/acp` conceptually and keep the first executable transport name additive |
| IDE-facing ACP facade promises too much too early | Medium | Start with a bounded capability profile and document unsupported features explicitly |
| A2A and ACP are treated as competing protocols | Medium | Keep layering docs explicit and update architecture/terminology together |

## Open Questions

1. Should the first executable ACP provider transport be named `acp`,
   `acp_stdio`, or another additive name?
2. Which ACP client capabilities should be mandatory versus optional in the
   first provider-side slice?
3. Should the first runtime-owned ACP facade target stdio only, or should it
   also consider another transport in the initial design?
4. Which first ACP provider target gives the cleanest validation path:
   `codex-acp`, `claude-agent-acp`, or another ACP-compatible agent?

## Progress Log

| Date | Update |
|------|--------|
| 2026-04-15 | Draft plan created to stage ACP under `agent` while reserving a separate runtime-owned ACP facade and documenting ACP + A2A complementarity |
| 2026-04-15 | Phase 1 skeleton landed with `agent/acp` transport recognition, ACP launch config fields, truthful inspection, and focused coverage; execution remains a Phase 2 follow-up |
| 2026-04-15 | Phase 2 host-bridge contract landed with a runtime-owned ACP host bridge backed by runtime tool policy, `LocalToolRuntime`, and session workspace/permission context; ACP transport lifecycle execution remains Phase 3 work |
| 2026-04-15 | Expanded the ACP adoption plan from a `claude`/`codex` framing to a provider-overlap support matrix with SPEC-owned tiers, so Phase 3 can treat `codex-acp` as the first Tier 1 pilot rather than a special-case two-provider branch |
| 2026-04-15 | Phase 3 bootstrap diagnostics landed for `codex-acp`: the runtime now resolves Codex as the first concrete ACP pilot target and can run a stdio help probe for ACP command launches before lifecycle execution is enabled |
| 2026-04-15 | Phase 3 stdio JSON-RPC plumbing landed for `agent/acp`: the runtime now has an ACP stdio client that can frame requests, match responses, handle notifications, and answer server-side requests such as permission prompts before adapter-level lifecycle mapping is wired in |
| 2026-04-15 | Phase 3 prompt lifecycle slice landed for `codex-acp`: `agent/acp` can now initialize a stdio ACP process, create or load a provider-managed session, suppress replay noise during `session/load`, route prompt-turn updates into runtime stream events, and answer basic ACP permission requests through runtime permission-mode mapping |
| 2026-04-15 | Refined ACP permission mediation so `whitelist` mode no longer behaves like a blanket reject: ACP permission requests now inspect requested tool metadata and compare it against runtime `allowedTools` before selecting an allow or reject option |
